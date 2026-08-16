package analytics

import (
	"testing"

	"market-replay/internal/model"
)

func TestSortClosedTrades_TiesBreakByCreatedAtThenID(t *testing.T) {
	trades := []model.Trade{
		{ID: "c", ExitTs: 100, CreatedAt: 5},
		{ID: "a", ExitTs: 100, CreatedAt: 1},
		{ID: "b", ExitTs: 100, CreatedAt: 1},
		{ID: "z", ExitTs: 50, CreatedAt: 999},
	}
	sorted := sortClosedTrades(trades)
	want := []string{"z", "a", "b", "c"}
	for i, id := range want {
		if sorted[i].ID != id {
			t.Fatalf("position %d: got %q, want %q (order: %v)", i, sorted[i].ID, id, sortedIDs(sorted))
		}
	}
}

func sortedIDs(trades []model.Trade) []string {
	ids := make([]string, len(trades))
	for i, tr := range trades {
		ids[i] = tr.ID
	}
	return ids
}

func TestClassifyResult_BoundaryAtThreshold(t *testing.T) {
	cases := []struct {
		name      string
		netPnl    int64
		threshold int64
		want      string
	}{
		{"exactly at positive threshold is breakeven", 500, 500, resultBreakeven},
		{"one cent above threshold is a winner", 501, 500, resultWinner},
		{"exactly at negative threshold is breakeven", -500, 500, resultBreakeven},
		{"one cent below negative threshold is a loser", -501, 500, resultLoser},
		{"zero threshold, zero pnl is breakeven", 0, 0, resultBreakeven},
		{"zero threshold, one cent is a winner", 1, 0, resultWinner},
		{"zero threshold, negative one cent is a loser", -1, 0, resultLoser},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := classifyResult(c.netPnl, c.threshold)
			if got != c.want {
				t.Errorf("classifyResult(%d, %d) = %q, want %q", c.netPnl, c.threshold, got, c.want)
			}
		})
	}
}

func TestBuildOverview_SideCountsSumToTotalAndWinRate(t *testing.T) {
	trades := []model.Trade{
		newTrade("1", "long", 0, 10, 100, 1000),
		newTrade("2", "short", 20, 30, 100, -500),
		newTrade("3", "long", 40, 50, 100, 0),
	}
	stats := computeTradeStats(trades, Request{BreakevenThresholdCents: 0})
	ov := buildOverview(stats, 100_000)

	if ov.TotalTrades != 3 {
		t.Fatalf("totalTrades = %d, want 3", ov.TotalTrades)
	}
	if ov.LongTrades+ov.ShortTrades != ov.TotalTrades {
		t.Fatalf("longTrades(%d)+shortTrades(%d) != totalTrades(%d)", ov.LongTrades, ov.ShortTrades, ov.TotalTrades)
	}
	if ov.LongTrades != 2 || ov.ShortTrades != 1 {
		t.Errorf("longTrades=%d shortTrades=%d, want 2/1", ov.LongTrades, ov.ShortTrades)
	}
	// one winner (1000) out of 3 closed trades
	wantWinRate := 100.0 / 3.0
	if diff := ov.WinRate - wantWinRate; diff > 1e-9 || diff < -1e-9 {
		t.Errorf("winRate = %v, want %v", ov.WinRate, wantWinRate)
	}
	if ov.TotalPnl != 5.0 {
		t.Errorf("totalPnl = %v, want 5.0 (1000-500+0 cents)", ov.TotalPnl)
	}
}

func TestBuildOverview_EmptySourceHasNoNaNOrInf(t *testing.T) {
	stats := computeTradeStats(nil, Request{})
	ov := buildOverview(stats, 0)
	if ov.WinRate != 0 || ov.PnlPercent != 0 || ov.TotalPnl != 0 {
		t.Fatalf("empty overview should be all zero, got %+v", ov)
	}
	if isNaNOrInf(ov.WinRate) || isNaNOrInf(ov.PnlPercent) {
		t.Fatalf("overview produced NaN/Inf: %+v", ov)
	}
}

func TestBuildEquityCurve_LengthIsTotalPlusOne(t *testing.T) {
	trades := []model.Trade{
		newTrade("1", "long", 0, 10, 100, 1000),
		newTrade("2", "short", 20, 30, 100, -500),
	}
	stats := computeTradeStats(trades, Request{})
	curve := buildEquityCurve(stats, 100_000)
	if len(curve) != len(trades)+1 {
		t.Fatalf("equity curve length = %d, want %d", len(curve), len(trades)+1)
	}
	if curve[0].TradeID != nil || curve[0].ClosedAt != nil || curve[0].CumulativePnl != 0 {
		t.Fatalf("curve[0] should be the synthetic zero point, got %+v", curve[0])
	}
	if curve[0].Balance != 1000.0 {
		t.Errorf("curve[0].Balance = %v, want 1000 (initial balance in dollars)", curve[0].Balance)
	}
	last := curve[len(curve)-1]
	if last.CumulativePnl != 5.0 {
		t.Errorf("final cumulativePnl = %v, want 5.0", last.CumulativePnl)
	}
}
