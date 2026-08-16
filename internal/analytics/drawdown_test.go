package analytics

import (
	"context"
	"testing"

	"market-replay/internal/model"
)

func withMaeTicks(v int64) tradeOpt {
	return func(t *model.Trade) { t.MaeTicks = v }
}

func buildDrawdown(t *testing.T, req Request) DrawdownReport {
	t.Helper()
	report, err := BuildDrawdownReport(context.Background(), req)
	if err != nil {
		t.Fatalf("BuildDrawdownReport: %v", err)
	}
	return report
}

func TestDrawdown_NoTrades(t *testing.T) {
	report := buildDrawdown(t, Request{InitialBalanceCents: 100_000})
	dd := report.EquityDrawdown
	if len(dd.Points) != 1 {
		t.Fatalf("points = %d, want 1 (synthetic pre-trade point)", len(dd.Points))
	}
	if dd.Points[0].Equity != 1000 || dd.Points[0].DrawdownAmount != 0 {
		t.Errorf("point0 = %+v, want equity=1000 drawdown=0", dd.Points[0])
	}
	if dd.DrawdownFrequency != 0 || dd.CompletedEpisodes != 0 || dd.OpenEpisode {
		t.Errorf("no-trade drawdown should have no episodes: %+v", dd)
	}
	if dd.AverageDrawdownAmount != 0 || dd.AverageDrawdownPercent != 0 || dd.AverageRecoveryDays != 0 {
		t.Errorf("no-trade averages should be 0: %+v", dd)
	}
}

func TestDrawdown_OnlyWinners(t *testing.T) {
	trades := []model.Trade{
		newTrade("1", "long", 0, daySeconds, 100, 50_000),
		newTrade("2", "long", daySeconds, 2*daySeconds, 100, 30_000),
	}
	report := buildDrawdown(t, Request{Trades: trades, InitialBalanceCents: 100_000})
	dd := report.EquityDrawdown
	for i, p := range dd.Points {
		if p.DrawdownAmount != 0 || p.DrawdownPercent != 0 {
			t.Errorf("point %d = %+v, want no drawdown (monotonically increasing equity)", i, p)
		}
	}
	if dd.DrawdownFrequency != 0 || dd.OpenEpisode {
		t.Errorf("only-winners should have no episodes: %+v", dd)
	}
}

func TestDrawdown_LossStreakStaysOpen(t *testing.T) {
	trades := []model.Trade{
		newTrade("1", "long", 0, daySeconds, 100, 20_000),              // balance 1200 (peak)
		newTrade("2", "long", daySeconds, 2*daySeconds, 100, -5_000),   // 1150
		newTrade("3", "long", 2*daySeconds, 3*daySeconds, 100, -3_000), // 1120
		newTrade("4", "long", 3*daySeconds, 4*daySeconds, 100, -2_000), // 1100, never recovers
	}
	report := buildDrawdown(t, Request{Trades: trades, InitialBalanceCents: 100_000})
	dd := report.EquityDrawdown
	if dd.DrawdownFrequency != 1 {
		t.Errorf("drawdownFrequency = %d, want 1", dd.DrawdownFrequency)
	}
	if dd.CompletedEpisodes != 0 {
		t.Errorf("completedEpisodes = %d, want 0", dd.CompletedEpisodes)
	}
	if !dd.OpenEpisode {
		t.Errorf("openEpisode = false, want true")
	}
	if dd.AverageRecoveryDays != 0 {
		t.Errorf("averageRecoveryDays = %v, want 0 (no completed episode)", dd.AverageRecoveryDays)
	}
	if dd.MaxDrawdownAmount >= 0 {
		t.Errorf("maxDrawdownAmount = %v, want negative", dd.MaxDrawdownAmount)
	}
}

func TestDrawdown_MultipleEpisodesAndRecoveryDays(t *testing.T) {
	trades := []model.Trade{
		newTrade("1", "long", 0, daySeconds, 100, 50_000),               // 1500 (peak)
		newTrade("2", "long", daySeconds, 2*daySeconds, 100, -20_000),   // 1300, episode1 starts
		newTrade("3", "long", 2*daySeconds, 5*daySeconds, 100, 30_000),  // 1600, episode1 recovers (3 days after start)
		newTrade("4", "long", 5*daySeconds, 6*daySeconds, 100, -10_000), // 1500, episode2 starts
		newTrade("5", "long", 6*daySeconds, 10*daySeconds, 100, -5_000), // 1450, still open
	}
	report := buildDrawdown(t, Request{Trades: trades, InitialBalanceCents: 100_000})
	dd := report.EquityDrawdown

	if dd.DrawdownFrequency != 2 {
		t.Fatalf("drawdownFrequency = %d, want 2", dd.DrawdownFrequency)
	}
	if dd.CompletedEpisodes != 1 {
		t.Fatalf("completedEpisodes = %d, want 1", dd.CompletedEpisodes)
	}
	if !dd.OpenEpisode {
		t.Errorf("openEpisode = false, want true (episode2 never recovers)")
	}
	if dd.AverageRecoveryDays != 3 {
		t.Errorf("averageRecoveryDays = %v, want 3", dd.AverageRecoveryDays)
	}
	// The recovery point (trade 3, index 3) reaches a new peak — its own
	// drawdown must be exactly 0.
	if dd.Points[3].DrawdownAmount != 0 {
		t.Errorf("recovery point drawdownAmount = %v, want 0: %+v", dd.Points[3].DrawdownAmount, dd.Points[3])
	}
	if dd.Points[3].Equity != dd.Points[3].PeakEquity {
		t.Errorf("recovery point equity %v should equal peak %v", dd.Points[3].Equity, dd.Points[3].PeakEquity)
	}
	// Every point's peak must be a true running max — drawdown never > 0.
	for i, p := range dd.Points {
		if p.DrawdownAmount > 0 || p.DrawdownPercent > 0 {
			t.Errorf("point %d has positive drawdown, impossible: %+v", i, p)
		}
		if isNaNOrInf(p.DrawdownAmount) || isNaNOrInf(p.DrawdownPercent) {
			t.Errorf("point %d has NaN/Inf: %+v", i, p)
		}
	}
}

func TestDrawdown_MaeHistogramBinBoundaries(t *testing.T) {
	// maeR = maeTicks/riskTicks exactly (qty*tickValueCents cancels between
	// numerator and denominator), so riskTicks=10000 lets every boundary
	// value be represented by an exact integer maeTicks.
	const riskTicks = 10000
	trade := func(id string, maeTicks int64) model.Trade {
		return newTrade(id, "long", 0, daySeconds, 20000, 100,
			withInitialStop(20000-riskTicks), withMaeTicks(maeTicks))
	}
	trades := []model.Trade{
		trade("mae-0", 0),         // 0.0
		trade("mae-0999", 999),    // 0.0999
		trade("mae-01", 1000),     // 0.1
		trade("mae-10999", 10999), // 1.0999
		trade("mae-11", 11000),    // 1.1
	}
	req := Request{
		Trades:     trades,
		Symbol:     "NQ",
		MarketData: &fakeMarketData{tickValue: map[string]float64{"NQ": 100}},
	}
	mae := buildDrawdown(t, req).MaximumAdverseExcursion

	bin := func(label string) MaeHistogramBin {
		for _, b := range mae.Histogram {
			if b.Label == label {
				return b
			}
		}
		t.Fatalf("no histogram bin labeled %q", label)
		return MaeHistogramBin{}
	}
	if got := bin("0.0").Count; got != 2 {
		t.Errorf(`bin "0.0" count = %d, want 2 (0 and 0.0999 both land here)`, got)
	}
	if got := bin("0.1").Count; got != 1 {
		t.Errorf(`bin "0.1" count = %d, want 1`, got)
	}
	if got := bin("1.0").Count; got != 1 {
		t.Errorf(`bin "1.0" count = %d, want 1 (1.0999)`, got)
	}
	if got := bin(">=1.1").Count; got != 1 {
		t.Errorf(`bin ">=1.1" count = %d, want 1 (exactly 1.1 goes to the catch-all)`, got)
	}
	if mae.WinningTrades.IncludedTrades != 5 {
		t.Errorf("includedTrades = %d, want 5", mae.WinningTrades.IncludedTrades)
	}
	if mae.WinningTrades.MinMaeR != 0 {
		t.Errorf("minMaeR = %v, want 0", mae.WinningTrades.MinMaeR)
	}
	if mae.WinningTrades.MaxMaeR != 1.1 {
		t.Errorf("maxMaeR = %v, want 1.1", mae.WinningTrades.MaxMaeR)
	}
}

func TestDrawdown_MaeExcludesTradesMissingRisk(t *testing.T) {
	trades := []model.Trade{
		// Winner, no initial stop at all.
		newTrade("no-stop", "long", 0, daySeconds, 20000, 100),
		// Winner, stop equals entry (zero risk distance).
		newTrade("zero-risk", "long", 0, daySeconds, 20000, 100, withInitialStop(20000)),
		// Loser, no initial stop — must NOT be counted as excludedNoInitialRisk;
		// losers are skipped before the risk check runs at all.
		newTrade("loser-no-stop", "long", 0, daySeconds, 20000, -100),
		// A valid winner for contrast.
		newTrade("valid", "long", 0, daySeconds, 20000, 100, withInitialStop(19000), withMaeTicks(500)),
	}
	req := Request{
		Trades:     trades,
		Symbol:     "NQ",
		MarketData: &fakeMarketData{tickValue: map[string]float64{"NQ": 100}},
	}
	mae := buildDrawdown(t, req).MaximumAdverseExcursion
	if mae.WinningTrades.ExcludedNoInitialRisk != 2 {
		t.Errorf("excludedNoInitialRisk = %d, want 2 (no-stop + zero-risk)", mae.WinningTrades.ExcludedNoInitialRisk)
	}
	if mae.WinningTrades.IncludedTrades != 1 {
		t.Errorf("includedTrades = %d, want 1", mae.WinningTrades.IncludedTrades)
	}
}

func TestDrawdown_MaeMissingMarketDataWhenTickValueUnknown(t *testing.T) {
	trades := []model.Trade{
		newTrade("1", "long", 0, daySeconds, 20000, 100, withInitialStop(19000), withMaeTicks(500)),
	}
	// No MarketData at all -> tick value can never be resolved.
	mae := buildDrawdown(t, Request{Trades: trades, Symbol: "NQ"}).MaximumAdverseExcursion
	if mae.WinningTrades.MissingMarketDataTrades != 1 {
		t.Errorf("missingMarketDataTrades = %d, want 1", mae.WinningTrades.MissingMarketDataTrades)
	}
	if mae.WinningTrades.IncludedTrades != 0 {
		t.Errorf("includedTrades = %d, want 0", mae.WinningTrades.IncludedTrades)
	}
}

func TestDrawdown_MaeResolvesEachTradesOwnSymbol(t *testing.T) {
	nq := newTrade("nq-trade", "long", 0, daySeconds, 1000, 5_000, withInitialStop(980), withMaeTicks(10))
	nq.Symbol = "NQ"
	es := newTrade("es-trade", "long", 0, daySeconds, 2000, 5_000, withInitialStop(1980), withMaeTicks(10))
	es.Symbol = "ES"

	// Only NQ resolves a tick value; ES has none — under a single-symbol
	// implementation this would either wrongly cost ES at NQ's tick value or
	// exclude both trades, depending on which symbol the request happened
	// to carry.
	md := &fakeMarketData{tickValue: map[string]float64{"NQ": 100}}
	mae := buildDrawdown(t, Request{Trades: []model.Trade{nq, es}, Symbol: "NQ", MarketData: md}).MaximumAdverseExcursion
	if mae.WinningTrades.IncludedTrades != 1 {
		t.Errorf("includedTrades = %d, want 1 (only NQ resolves)", mae.WinningTrades.IncludedTrades)
	}
	if mae.WinningTrades.MissingMarketDataTrades != 1 {
		t.Errorf("missingMarketDataTrades = %d, want 1 (the ES trade)", mae.WinningTrades.MissingMarketDataTrades)
	}
}
