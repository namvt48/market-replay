package analytics

import (
	"testing"

	"market-replay/internal/model"
)

func TestExecutionQuality_NormalizesExcursionsAndSubtractsCosts(t *testing.T) {
	trades := []model.Trade{
		newTrade("winner", "long", 0, 1000, 1000, 10_000,
			withInitialStop(980), withRMultiple(1), withMfeTicks(40), withExitReason("takeProfit")),
		newTrade("loser", "long", 0, 1000, 1000, -5_000,
			withInitialStop(980), withRMultiple(-0.5), withMfeTicks(10), withExitReason("stopLoss")),
	}
	md := &fakeMarketData{tickValue: map[string]float64{"NQ": 500}}
	result, audit := AnalyzeExecutionQuality(trades, md, ExecutionCostModel{SpreadTicks: 0.25, SlippageTicks: 0.25})
	if len(result.Trades) != 2 {
		t.Fatalf("trades = %d, want 2", len(result.Trades))
	}
	if result.Trades[0].MfeR != 2 {
		t.Errorf("trades[0].mfeR = %v, want 2 (40 ticks / 20 risk ticks)", result.Trades[0].MfeR)
	}
	if result.NetExpectancyR >= result.GrossExpectancyR {
		t.Errorf("netExpectancyR %v should be < grossExpectancyR %v (costs subtract)", result.NetExpectancyR, result.GrossExpectancyR)
	}
	want := ExitReasonBreakdown{Manual: 0, StopLoss: 1, TakeProfit: 1}
	if result.ExitReasonBreakdown != want {
		t.Errorf("exitReasonBreakdown = %+v, want %+v", result.ExitReasonBreakdown, want)
	}
	if audit.ExcludedNoInitialRisk != 0 || audit.ExcludedNoCostConfig != 0 || audit.UnknownExitReason != 0 {
		t.Errorf("audit = %+v, want all zero", audit)
	}
	// MFE histogram: winner mfeR=2 falls in [2.0,2.4), loser mfeR=0.5 falls in [0.4,0.8).
	var total int
	for _, bin := range result.MfeHistogram {
		total += bin.Count
	}
	if total != 2 {
		t.Errorf("mfeHistogram total count = %d, want 2", total)
	}
}

func TestExecutionQuality_CostsConsumeEdgeWhenTiny(t *testing.T) {
	// A tiny realized R against a large spread/slippage cost model should
	// flip edgeAfterCosts to false.
	trades := []model.Trade{
		newTrade("thin-win", "long", 0, 1000, 1000, 100,
			withInitialStop(999), withRMultiple(0.01), withMfeTicks(1)), // riskTicks=1 -> huge cost/risk ratio
	}
	md := &fakeMarketData{tickValue: map[string]float64{"NQ": 500}}
	result, _ := AnalyzeExecutionQuality(trades, md, ExecutionCostModel{SpreadTicks: 5, SlippageTicks: 5})
	if result.EdgeAfterCosts {
		t.Errorf("edgeAfterCosts = true, want false (costs dwarf the tiny realized R)")
	}
	if result.NetExpectancyR >= 0 {
		t.Errorf("netExpectancyR = %v, want negative", result.NetExpectancyR)
	}
}

func TestExecutionQuality_ExcludesTradesWithoutValidRiskOrRMultiple(t *testing.T) {
	trades := []model.Trade{
		newTrade("no-stop", "long", 0, 1000, 1000, 10_000, withRMultiple(1), withMfeTicks(40), withExitReason("manual")),
		newTrade("no-rmultiple", "long", 0, 1000, 1000, 10_000, withInitialStop(980), withMfeTicks(40), withExitReason("manual")),
		newTrade("valid", "long", 0, 1000, 1000, 10_000, withInitialStop(980), withRMultiple(1), withMfeTicks(40), withExitReason("manual")),
	}
	md := &fakeMarketData{tickValue: map[string]float64{"NQ": 500}}
	result, audit := AnalyzeExecutionQuality(trades, md, ExecutionCostModel{SpreadTicks: 0.25, SlippageTicks: 0.25})
	if len(result.Trades) != 1 {
		t.Fatalf("trades = %d, want 1 (only the fully risk-valid trade)", len(result.Trades))
	}
	if audit.ExcludedNoInitialRisk != 2 {
		t.Errorf("audit.excludedNoInitialRisk = %d, want 2", audit.ExcludedNoInitialRisk)
	}
	// Exit reason breakdown still counts every trade, not just candidates.
	if total := result.ExitReasonBreakdown.Manual + result.ExitReasonBreakdown.StopLoss + result.ExitReasonBreakdown.TakeProfit; total != 3 {
		t.Errorf("exitReasonBreakdown total = %d, want 3", total)
	}
}

func TestExecutionQuality_UnresolvableSymbolExcludedAndAudited(t *testing.T) {
	trades := []model.Trade{
		newTrade("unknown-symbol", "long", 0, 1000, 1000, 10_000, withInitialStop(980), withRMultiple(1), withMfeTicks(40)),
	}
	md := &fakeMarketData{tickValue: map[string]float64{"ES": 1250}} // no "NQ" entry
	result, audit := AnalyzeExecutionQuality(trades, md, ExecutionCostModel{SpreadTicks: 0.25, SlippageTicks: 0.25})
	if len(result.Trades) != 0 {
		t.Fatalf("trades = %d, want 0 (symbol has no cost config)", len(result.Trades))
	}
	if audit.ExcludedNoCostConfig != 1 {
		t.Errorf("audit.excludedNoCostConfig = %d, want 1", audit.ExcludedNoCostConfig)
	}
}

func TestExecutionQuality_PerTradeSymbolResolution(t *testing.T) {
	// Two trades, two different symbols with different tick values — each
	// must be costed with its OWN symbol's tick value, not one flat value.
	nq := newTrade("nq-trade", "long", 0, 1000, 1000, 10_000, withInitialStop(980), withRMultiple(1), withMfeTicks(40))
	nq.Symbol = "NQ"
	es := newTrade("es-trade", "long", 0, 1000, 1000, 10_000, withInitialStop(980), withRMultiple(1), withMfeTicks(40))
	es.Symbol = "ES"
	md := &fakeMarketData{tickValue: map[string]float64{"NQ": 500, "ES": 1250}}
	result, audit := AnalyzeExecutionQuality([]model.Trade{nq, es}, md, ExecutionCostModel{SpreadTicks: 0.25, SlippageTicks: 0.25})
	if len(result.Trades) != 2 {
		t.Fatalf("trades = %d, want 2", len(result.Trades))
	}
	if audit.ExcludedNoCostConfig != 0 {
		t.Errorf("audit.excludedNoCostConfig = %d, want 0 (both symbols resolve)", audit.ExcludedNoCostConfig)
	}
	want := map[string]float64{"NQ": 500, "ES": 1250}
	if len(result.CostModel.TickValueBySymbol) != len(want) {
		t.Fatalf("costModel.tickValueBySymbol = %+v, want %+v", result.CostModel.TickValueBySymbol, want)
	}
	for symbol, tickValue := range want {
		if got := result.CostModel.TickValueBySymbol[symbol]; got != tickValue {
			t.Errorf("costModel.tickValueBySymbol[%q] = %v, want %v", symbol, got, tickValue)
		}
	}
}

func TestExecutionQuality_UnknownExitReasonAuditedNotFoldedIntoManual(t *testing.T) {
	trades := []model.Trade{
		newTrade("weird", "long", 0, 1000, 1000, 10_000, withExitReason("something-unexpected")),
	}
	md := &fakeMarketData{tickValue: map[string]float64{"NQ": 500}}
	result, audit := AnalyzeExecutionQuality(trades, md, ExecutionCostModel{SpreadTicks: 0.25, SlippageTicks: 0.25})
	if result.ExitReasonBreakdown.Unknown != 1 {
		t.Errorf("exitReasonBreakdown.unknown = %d, want 1", result.ExitReasonBreakdown.Unknown)
	}
	if result.ExitReasonBreakdown.Manual != 0 {
		t.Errorf("exitReasonBreakdown.manual = %d, want 0 (must not silently fold unknown into manual)", result.ExitReasonBreakdown.Manual)
	}
	if audit.UnknownExitReason != 1 {
		t.Errorf("audit.unknownExitReason = %d, want 1", audit.UnknownExitReason)
	}
}

func TestExecutionQuality_MfeHistogramCatchAllBucket(t *testing.T) {
	trades := []model.Trade{
		newTrade("huge-mfe", "long", 0, 1000, 1000, 10_000, withInitialStop(980), withRMultiple(1), withMfeTicks(100)), // mfeR = 100/20 = 5.0
	}
	md := &fakeMarketData{tickValue: map[string]float64{"NQ": 500}}
	result, _ := AnalyzeExecutionQuality(trades, md, ExecutionCostModel{SpreadTicks: 0.25, SlippageTicks: 0.25})
	last := result.MfeHistogram[len(result.MfeHistogram)-1]
	if last.ToExclusiveR != nil {
		t.Fatalf("last bucket toExclusiveR = %v, want nil (catch-all)", *last.ToExclusiveR)
	}
	if last.FromInclusiveR != 4.0 {
		t.Errorf("last bucket fromInclusiveR = %v, want 4.0", last.FromInclusiveR)
	}
	if last.Count != 1 {
		t.Errorf("last bucket count = %d, want 1 (mfeR=5.0 falls in the >=4.0 catch-all)", last.Count)
	}
}

func TestExecutionQuality_NoNaNOrInf(t *testing.T) {
	md := &fakeMarketData{tickValue: map[string]float64{"NQ": 500}}
	for _, trades := range [][]model.Trade{
		nil,
		{newTrade("a", "long", 0, 1000, 1000, 0)},
		{
			newTrade("a", "long", 0, 1000, 1000, 10_000, withInitialStop(980), withRMultiple(1), withMfeTicks(40)),
			newTrade("b", "short", 0, 1000, 1000, -5_000, withInitialStop(1020), withRMultiple(-0.5), withMfeTicks(5)),
		},
	} {
		result, _ := AnalyzeExecutionQuality(trades, md, ExecutionCostModel{SpreadTicks: 0.25, SlippageTicks: 0.25})
		if isNaNOrInf(result.AverageMfePercentile) || isNaNOrInf(result.AverageCaptureRatio) ||
			isNaNOrInf(result.GrossExpectancyR) || isNaNOrInf(result.NetExpectancyR) ||
			isNaNOrInf(result.NetWinRate) || isNaNOrInf(result.AverageCostR) {
			t.Errorf("trades len=%d produced NaN/Inf: %+v", len(trades), result)
		}
	}
}

func TestExecutionQuality_NilMarketDataExcludesAllAndAudits(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 1000, 10_000, withInitialStop(980), withRMultiple(1), withMfeTicks(40)),
	}
	result, audit := AnalyzeExecutionQuality(trades, nil, ExecutionCostModel{SpreadTicks: 0.25, SlippageTicks: 0.25})
	if len(result.Trades) != 0 {
		t.Fatalf("trades = %d, want 0 (nil MarketData)", len(result.Trades))
	}
	if audit.ExcludedNoCostConfig != 1 {
		t.Errorf("audit.excludedNoCostConfig = %d, want 1", audit.ExcludedNoCostConfig)
	}
	if isNaNOrInf(result.AverageCostR) {
		t.Errorf("averageCostR is NaN/Inf with nil MarketData: %v", result.AverageCostR)
	}
}
