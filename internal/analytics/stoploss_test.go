package analytics

import (
	"context"
	"errors"
	"testing"

	"market-replay/internal/model"
)

// barsAtWindowStart returns a fakeMarketData whose PriceBarsBatch answers
// every window with the same single bar (Ts is only ever compared against
// [FromTs,ToTs], so a fixed mid-window bar is enough for these tests).
func barsAtWindowStart(tickValueCents float64, high, low int64) *fakeMarketData {
	return &fakeMarketData{
		tickValue: map[string]float64{"NQ": tickValueCents},
		priceBarsFn: func(_, _ string, windows []TimeWindow) []PriceWindow {
			out := make([]PriceWindow, len(windows))
			for i, w := range windows {
				out[i] = PriceWindow{Found: true, Bars: []PriceBar{{Ts: (w.FromTs + w.ToTs) / 2, HighTicks: high, LowTicks: low}}}
			}
			return out
		},
	}
}

func TestStopLoss_ZeroPercentMatchesActualOutcome(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 30_000, withInitialStop(9900)),
	}
	md := barsAtWindowStart(100, 10010, 9950)
	result, err := BuildStopLossSimulation(context.Background(), StopLossRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, ReductionsPercent: []float64{0},
	})
	if err != nil {
		t.Fatalf("BuildStopLossSimulation: %v", err)
	}
	sc := result.Scenarios[0]
	if sc.StoppedOutTrades != 0 {
		t.Errorf("stoppedOutTrades = %d, want 0 (0%% never resimulates)", sc.StoppedOutTrades)
	}
	if sc.Profit != 300 {
		t.Errorf("profit = %v, want 300 (actual RealizedCents unchanged)", sc.Profit)
	}
}

func TestStopLoss_LongTightenedStopTouchedVsNotTouched(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 30_000, withInitialStop(9900)), // riskTicks=100
	}
	// Bar dips to low=9950 — a 50%-tightened stop (distance 50, stop=9950)
	// is touched exactly; a 10%-tightened stop (distance 90, stop=9910) is not.
	md := barsAtWindowStart(100, 10010, 9950)
	result, err := BuildStopLossSimulation(context.Background(), StopLossRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, ReductionsPercent: []float64{10, 50},
	})
	if err != nil {
		t.Fatalf("BuildStopLossSimulation: %v", err)
	}
	byReduction := map[float64]StopLossScenario{}
	for _, s := range result.Scenarios {
		byReduction[s.ReductionPercent] = s
	}
	if got := byReduction[10]; got.StoppedOutTrades != 0 || got.Profit != 300 {
		t.Errorf("10%% scenario = %+v, want untouched (profit 300, stoppedOut 0)", got)
	}
	if got := byReduction[50]; got.StoppedOutTrades != 1 || got.Profit != -50 {
		t.Errorf("50%% scenario = %+v, want stopped out at simulated stop (profit -50)", got)
	}
}

func TestStopLoss_ShortTightenedStopTouchedVsNotTouched(t *testing.T) {
	trades := []model.Trade{
		newTrade("b", "short", 2000, 3000, 20000, 20_000, withInitialStop(20100)), // riskTicks=100
	}
	// Bar rallies to high=20080 — a 50%-tightened stop (distance 50, stop=20050)
	// is touched; a 5%-tightened stop (distance 95, stop=20095) is not.
	md := barsAtWindowStart(100, 20080, 19950)
	result, err := BuildStopLossSimulation(context.Background(), StopLossRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, ReductionsPercent: []float64{5, 50},
	})
	if err != nil {
		t.Fatalf("BuildStopLossSimulation: %v", err)
	}
	byReduction := map[float64]StopLossScenario{}
	for _, s := range result.Scenarios {
		byReduction[s.ReductionPercent] = s
	}
	if got := byReduction[5]; got.StoppedOutTrades != 0 || got.Profit != 200 {
		t.Errorf("5%% scenario = %+v, want untouched (profit 200, stoppedOut 0)", got)
	}
	if got := byReduction[50]; got.StoppedOutTrades != 1 || got.Profit != -50 {
		t.Errorf("50%% scenario = %+v, want stopped out (profit -50)", got)
	}
}

func TestStopLoss_ScenarioOrderMatchesRequestOrder(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 30_000, withInitialStop(9900)),
	}
	md := barsAtWindowStart(100, 10010, 9950)
	result, err := BuildStopLossSimulation(context.Background(), StopLossRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, ReductionsPercent: []float64{50, 10, 0, 30},
	})
	if err != nil {
		t.Fatalf("BuildStopLossSimulation: %v", err)
	}
	want := []float64{50, 10, 0, 30}
	if len(result.Scenarios) != len(want) {
		t.Fatalf("scenarios = %d, want %d", len(result.Scenarios), len(want))
	}
	for i, s := range result.Scenarios {
		if s.ReductionPercent != want[i] {
			t.Errorf("scenario[%d].reductionPercent = %v, want %v (order must match request)", i, s.ReductionPercent, want[i])
		}
	}
}

func TestStopLoss_NoEligibleTradesReturnsSentinel(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 30_000), // no InitialStopTicks
	}
	_, err := BuildStopLossSimulation(context.Background(), StopLossRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: barsAtWindowStart(100, 10010, 9950), ReductionsPercent: []float64{0},
	})
	if !errors.Is(err, ErrNoEligibleTrades) {
		t.Fatalf("err = %v, want ErrNoEligibleTrades", err)
	}
}

func TestStopLoss_BestScenarioPrefersHigherProfitFactor(t *testing.T) {
	// Two trades: one always a loser regardless of scenario, one whose
	// tightened stop (50%) turns a loss into a smaller loss — improving
	// profit factor relative to the untouched 0% scenario.
	trades := []model.Trade{
		newTrade("winner", "long", 0, 1000, 10000, 40_000, withInitialStop(9900)),
		newTrade("loser", "long", 2000, 3000, 10000, -20_000, withInitialStop(9900)),
	}
	md := &fakeMarketData{
		tickValue: map[string]float64{"NQ": 100},
		priceBarsFn: func(_, _ string, windows []TimeWindow) []PriceWindow {
			out := make([]PriceWindow, len(windows))
			for i, w := range windows {
				// "winner" trade's window never dips to the tightened stop;
				// "loser" trade's window dips to 9950, touching a 50%-tightened
				// stop (9950) for a smaller loss than the actual -$200.
				if w.FromTs == 0 {
					out[i] = PriceWindow{Found: true, Bars: []PriceBar{{Ts: 500, HighTicks: 10010, LowTicks: 9990}}}
				} else {
					out[i] = PriceWindow{Found: true, Bars: []PriceBar{{Ts: 2500, HighTicks: 10010, LowTicks: 9950}}}
				}
			}
			return out
		},
	}
	result, err := BuildStopLossSimulation(context.Background(), StopLossRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, ReductionsPercent: []float64{0, 50},
	})
	if err != nil {
		t.Fatalf("BuildStopLossSimulation: %v", err)
	}
	if result.BestScenario.ReductionPercent != 50 {
		t.Errorf("bestScenario.reductionPercent = %v, want 50 (smaller loss -> higher profit factor)", result.BestScenario.ReductionPercent)
	}
	if result.BestScenario.Criterion != "profitFactorThenAverageDrawdown" {
		t.Errorf("bestScenario.criterion = %q", result.BestScenario.Criterion)
	}
}

func TestStopLoss_FetchesBarsOnceRegardlessOfScenarioCount(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 30_000, withInitialStop(9900)),
		newTrade("b", "short", 2000, 3000, 20000, -10_000, withInitialStop(20100)),
	}
	md := barsAtWindowStart(100, 20080, 9950)
	_, err := BuildStopLossSimulation(context.Background(), StopLossRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, ReductionsPercent: []float64{0, 5, 10, 25, 50, 75, 95},
	})
	if err != nil {
		t.Fatalf("BuildStopLossSimulation: %v", err)
	}
	if md.priceBarsCallCount != 1 {
		t.Fatalf("PriceBarsBatch called %d times, want exactly 1 (fetched once, reused across every scenario)", md.priceBarsCallCount)
	}
}

func TestStopLoss_NoNaNOrInf(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 30_000, withInitialStop(9900)),
		newTrade("b", "short", 2000, 3000, 20000, -10_000, withInitialStop(20100)),
	}
	md := barsAtWindowStart(100, 20080, 9950)
	result, err := BuildStopLossSimulation(context.Background(), StopLossRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, ReductionsPercent: []float64{0, 25, 50, 75, 95},
	})
	if err != nil {
		t.Fatalf("BuildStopLossSimulation: %v", err)
	}
	for _, sc := range result.Scenarios {
		if isNaNOrInf(sc.WinRate) || isNaNOrInf(sc.AverageWinR) || isNaNOrInf(sc.ExpectancyR) ||
			isNaNOrInf(sc.TotalR) || isNaNOrInf(sc.Profit) || isNaNOrInf(sc.AverageDrawdownR) {
			t.Errorf("scenario %+v has NaN/Inf", sc)
		}
		for _, p := range sc.EquityCurve {
			if isNaNOrInf(p.CumulativeR) || isNaNOrInf(p.Balance) {
				t.Errorf("equity point %+v has NaN/Inf", p)
			}
		}
	}
}
