package analytics

import (
	"context"
	"errors"
	"testing"

	"market-replay/internal/model"
)

func rrSingleTradeMarketData(high, low int64) *fakeMarketData {
	return &fakeMarketData{
		tickValue: map[string]float64{"NQ": 100},
		priceBarsFn: func(_, _ string, windows []TimeWindow) []PriceWindow {
			out := make([]PriceWindow, len(windows))
			for i, w := range windows {
				out[i] = PriceWindow{Found: true, Bars: []PriceBar{{Ts: (w.FromTs + w.ToTs) / 2, HighTicks: high, LowTicks: low}}}
			}
			return out
		},
	}
}

func TestRR_TargetHitBeforeStop(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 15_000, withInitialStop(9900)), // riskTicks=100
	}
	// target(1R)=10100 touched (high=10150); stop=9900 not touched (low=9950).
	md := rrSingleTradeMarketData(10150, 9950)
	result, err := BuildRRSimulation(context.Background(), RRSimulationRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, TargetsR: []float64{1}, IncludeCurrentModel: false,
	})
	if err != nil {
		t.Fatalf("BuildRRSimulation: %v", err)
	}
	sc := result.Scenarios[0]
	if sc.Profit != 100 {
		t.Errorf("profit = %v, want 100 (target hit)", sc.Profit)
	}
}

func TestRR_StopHitBeforeTarget(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 15_000, withInitialStop(9900)),
	}
	// stop=9900 touched (low=9850); target(1R)=10100 not touched (high=10050).
	md := rrSingleTradeMarketData(10050, 9850)
	result, err := BuildRRSimulation(context.Background(), RRSimulationRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, TargetsR: []float64{1}, IncludeCurrentModel: false,
	})
	if err != nil {
		t.Fatalf("BuildRRSimulation: %v", err)
	}
	sc := result.Scenarios[0]
	if sc.Profit != -100 {
		t.Errorf("profit = %v, want -100 (stop hit)", sc.Profit)
	}
}

func TestRR_NeitherHitKeepsActualOutcome(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 15_000, withInitialStop(9900)),
	}
	// Neither the 1R target (10100) nor the stop (9900) is touched.
	md := rrSingleTradeMarketData(10050, 9950)
	result, err := BuildRRSimulation(context.Background(), RRSimulationRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, TargetsR: []float64{1}, IncludeCurrentModel: false,
	})
	if err != nil {
		t.Fatalf("BuildRRSimulation: %v", err)
	}
	sc := result.Scenarios[0]
	if sc.Profit != 150 {
		t.Errorf("profit = %v, want 150 (actual outcome kept)", sc.Profit)
	}
}

func TestRR_SameBarAmbiguityIsStopFirst(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 15_000, withInitialStop(9900)),
	}
	// Same bar touches both target (high=10150 >= 10100) and stop (low=9850 <= 9900).
	md := rrSingleTradeMarketData(10150, 9850)
	result, err := BuildRRSimulation(context.Background(), RRSimulationRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, TargetsR: []float64{1}, IncludeCurrentModel: false,
	})
	if err != nil {
		t.Fatalf("BuildRRSimulation: %v", err)
	}
	sc := result.Scenarios[0]
	if sc.Profit != -100 {
		t.Errorf("profit = %v, want -100 (stop-first on same-bar ambiguity)", sc.Profit)
	}
}

func TestRR_ShortDirection(t *testing.T) {
	trades := []model.Trade{
		newTrade("b", "short", 0, 1000, 20000, 15_000, withInitialStop(20100)), // riskTicks=100
	}
	// Short 1R target = 19900 (touched: low=19850); stop=20100 not touched (high=20050).
	md := rrSingleTradeMarketData(20050, 19850)
	result, err := BuildRRSimulation(context.Background(), RRSimulationRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, TargetsR: []float64{1}, IncludeCurrentModel: false,
	})
	if err != nil {
		t.Fatalf("BuildRRSimulation: %v", err)
	}
	sc := result.Scenarios[0]
	if sc.Profit != 100 {
		t.Errorf("profit = %v, want 100 (short target hit)", sc.Profit)
	}
}

func TestRR_CurrentScenarioUsesActualOutcome(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 15_000, withInitialStop(9900)),
	}
	md := rrSingleTradeMarketData(10050, 9950)
	result, err := BuildRRSimulation(context.Background(), RRSimulationRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, TargetsR: []float64{2}, IncludeCurrentModel: true,
	})
	if err != nil {
		t.Fatalf("BuildRRSimulation: %v", err)
	}
	if len(result.Scenarios) != 2 {
		t.Fatalf("scenarios = %d, want 2", len(result.Scenarios))
	}
	current := result.Scenarios[0]
	if current.ID != "current" || current.TargetR != nil {
		t.Errorf("current scenario = %+v, want id=current targetR=nil", current)
	}
	if current.Profit != 150 {
		t.Errorf("current profit = %v, want 150 (actual)", current.Profit)
	}
}

func TestRR_ScenarioOrderMatchesRequestOrder(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 15_000, withInitialStop(9900)),
	}
	md := rrSingleTradeMarketData(10050, 9950)
	result, err := BuildRRSimulation(context.Background(), RRSimulationRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, TargetsR: []float64{2, 1, 1.5}, IncludeCurrentModel: true,
	})
	if err != nil {
		t.Fatalf("BuildRRSimulation: %v", err)
	}
	wantIDs := []string{"current", "target-2.0", "target-1.0", "target-1.5"}
	if len(result.Scenarios) != len(wantIDs) {
		t.Fatalf("scenarios = %d, want %d", len(result.Scenarios), len(wantIDs))
	}
	for i, s := range result.Scenarios {
		if s.ID != wantIDs[i] {
			t.Errorf("scenario[%d].id = %q, want %q", i, s.ID, wantIDs[i])
		}
	}
}

func TestRR_NoEligibleTradesReturnsSentinel(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 15_000), // no InitialStopTicks
	}
	_, err := BuildRRSimulation(context.Background(), RRSimulationRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: rrSingleTradeMarketData(10050, 9950), TargetsR: []float64{1}, IncludeCurrentModel: true,
	})
	if !errors.Is(err, ErrNoEligibleTrades) {
		t.Fatalf("err = %v, want ErrNoEligibleTrades", err)
	}
}

func TestRR_FetchesBarsOnceRegardlessOfScenarioCount(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 15_000, withInitialStop(9900)),
		newTrade("b", "short", 2000, 3000, 20000, -5_000, withInitialStop(20100)),
	}
	md := rrSingleTradeMarketData(20050, 9950)
	_, err := BuildRRSimulation(context.Background(), RRSimulationRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, TargetsR: []float64{1, 1.5, 2, 2.5, 3}, IncludeCurrentModel: true,
	})
	if err != nil {
		t.Fatalf("BuildRRSimulation: %v", err)
	}
	if md.priceBarsCallCount != 1 {
		t.Fatalf("PriceBarsBatch called %d times, want exactly 1 (fetched once, reused across every scenario)", md.priceBarsCallCount)
	}
}

func TestRR_NoNaNOrInf(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 10000, 15_000, withInitialStop(9900)),
		newTrade("b", "short", 2000, 3000, 20000, -5_000, withInitialStop(20100)),
	}
	md := rrSingleTradeMarketData(20050, 9950)
	result, err := BuildRRSimulation(context.Background(), RRSimulationRequest{
		Trades: trades, Timeframe: "1m", InitialBalanceCents: 100_000,
		MarketData: md, TargetsR: []float64{1, 2, 3}, IncludeCurrentModel: true,
	})
	if err != nil {
		t.Fatalf("BuildRRSimulation: %v", err)
	}
	for _, sc := range result.Scenarios {
		if isNaNOrInf(sc.WinRate) || isNaNOrInf(sc.Profit) || isNaNOrInf(sc.AverageDrawdownPercent) {
			t.Errorf("scenario %+v has NaN/Inf", sc)
		}
		if sc.AverageDrawdownPercent < 0 {
			t.Errorf("averageDrawdownPercent = %v, want positive magnitude convention", sc.AverageDrawdownPercent)
		}
		for _, p := range sc.EquityCurve {
			if isNaNOrInf(p.CumulativeR) || isNaNOrInf(p.Balance) {
				t.Errorf("equity point %+v has NaN/Inf", p)
			}
		}
	}
}
