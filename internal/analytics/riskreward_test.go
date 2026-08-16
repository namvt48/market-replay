package analytics

import (
	"testing"

	"market-replay/internal/model"
)

func TestRiskReward_ExcludesInvalidInitialRisk(t *testing.T) {
	trades := []model.Trade{
		newTrade("valid-1", "long", 0, 10, 100, 500, withRMultiple(2.0)),
		newTrade("valid-2", "long", 20, 30, 100, -300, withRMultiple(-1.0)),
		newTrade("no-stop", "long", 40, 50, 100, 100), // no RMultiple at all
	}
	stats := computeTradeStats(trades, Request{})
	rr := buildRiskReward(stats)

	if rr.ExcludedTrades != 1 {
		t.Fatalf("excludedTrades = %d, want 1", rr.ExcludedTrades)
	}
	if len(rr.Series.Actual) != 2 {
		t.Fatalf("actual series length = %d, want 2 (excluded trade must not appear)", len(rr.Series.Actual))
	}
	wantAvg := (2.0 - 1.0) / 2
	if diff := rr.AverageRr - wantAvg; diff > 1e-9 || diff < -1e-9 {
		t.Errorf("averageRr = %v, want %v", rr.AverageRr, wantAvg)
	}
	if rr.MaxRr != 2.0 {
		t.Errorf("maxRr = %v, want 2.0", rr.MaxRr)
	}
}

func TestCouldHaveProfitOrBreakeven_ThresholdAtOnePointTwoR(t *testing.T) {
	md := &fakeMarketData{
		tickValue: map[string]float64{"NQ": 5}, // 5 cents/tick/contract
		extremesFn: func(symbol, timeframe string, windows []TimeWindow) []ForwardExtreme {
			out := make([]ForwardExtreme, len(windows))
			for i := range out {
				out[i] = ForwardExtreme{Found: false} // no bar coverage — only MFE can qualify these
			}
			return out
		},
	}

	loserQualifiesViaMFE := newTrade("mfe-loser", "long", 0, 10, 1000, -100,
		withRMultiple(-1.0), withInitialStop(990), withMfeTicks(20)) // riskTicks=10, mfeR = 20*5/(10*5) = 2.0 > 1.2
	loserBelowThreshold := newTrade("small-mfe-loser", "long", 20, 30, 1000, -100,
		withRMultiple(-1.0), withInitialStop(990), withMfeTicks(5)) // mfeR = 5*5/50 = 0.5, below threshold
	winner := newTrade("winner", "long", 40, 50, 1000, 500,
		withRMultiple(2.0), withInitialStop(990), withMfeTicks(50)) // winner never counts, regardless of MFE

	stats := computeTradeStats([]model.Trade{loserQualifiesViaMFE, loserBelowThreshold, winner}, Request{
		Symbol: "NQ", Timeframe: "1m", MarketData: md,
	})
	rr := buildRiskReward(stats)

	if rr.CouldHaveProfitOrBreakeven != 1 {
		t.Fatalf("couldHaveProfitOrBreakeven = %d, want 1", rr.CouldHaveProfitOrBreakeven)
	}
	if len(rr.Series.Missed) != 1 || rr.Series.Missed[0].TradeID != "mfe-loser" {
		t.Fatalf("missed series = %+v, want exactly the mfe-loser trade", rr.Series.Missed)
	}
}
