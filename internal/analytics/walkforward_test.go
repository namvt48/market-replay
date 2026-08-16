package analytics

import (
	"context"
	"testing"

	"market-replay/internal/model"
)

func TestMaxDrawdownOfSeries_PeakToTrough(t *testing.T) {
	// Cumulative: 1, 2, 0.5, 3, 1 -> peak reaches 3, deepest trough after
	// that peak is 1 (drawdown -2); the earlier dip to 0.5 (peak 2, so -1.5)
	// is shallower and must not be reported instead.
	got := maxDrawdownOfSeries([]float64{1, 1, -1.5, 2.5, -2})
	if got != -2 {
		t.Errorf("maxDrawdownOfSeries = %v, want -2 (deepest peak-to-trough)", got)
	}
}

func TestMaxDrawdownOfSeries_MonotonicIncreaseIsZeroDrawdown(t *testing.T) {
	got := maxDrawdownOfSeries([]float64{1, 1, 1, 1})
	if got != 0 {
		t.Errorf("maxDrawdownOfSeries = %v, want 0 (never below its own running peak)", got)
	}
}

func TestWalkForward_ChronologicalSplitAndWindows(t *testing.T) {
	windows := 2
	result, _, err := AnalyzeWalkForward(context.Background(), WalkForwardRequest{
		R: []float64{1, 1, 1, 1, 2}, ExitTs: []int64{1, 2, 3, 4, 5},
		Config: WalkForwardConfig{Windows: &windows},
	})
	if err != nil {
		t.Fatalf("AnalyzeWalkForward: %v", err)
	}
	if result.Split != 0.8 {
		t.Errorf("split = %v, want default 0.8", result.Split)
	}
	if result.InSample.Trades != 4 || result.InSample.ExpectancyR != 1 {
		t.Errorf("inSample = %+v, want {trades:4 expectancyR:1}", result.InSample)
	}
	if result.OutOfSample.Trades != 1 || result.OutOfSample.ExpectancyR != 2 {
		t.Errorf("outOfSample = %+v, want {trades:1 expectancyR:2}", result.OutOfSample)
	}
	if result.RetentionRatio != 2 {
		t.Errorf("retentionRatio = %v, want 2", result.RetentionRatio)
	}
	// No trades/MarketData supplied -> nothing to re-walk.
	if result.ParameterSensitivity != nil {
		t.Errorf("parameterSensitivity = %+v, want nil (no trades/market data supplied)", result.ParameterSensitivity)
	}
}

func TestWalkForward_UnsortedInputIsSortedByExitTs(t *testing.T) {
	result, _, err := AnalyzeWalkForward(context.Background(), WalkForwardRequest{
		R: []float64{2, 1, 1, 1, 1}, ExitTs: []int64{5, 1, 2, 3, 4},
	})
	if err != nil {
		t.Fatalf("AnalyzeWalkForward: %v", err)
	}
	if result.OutOfSample.ExpectancyR != 2 {
		t.Errorf("outOfSample.expectancyR = %v, want 2 (r=2 entry has the latest ts)", result.OutOfSample.ExpectancyR)
	}
}

func TestWalkForward_EmptyInputIsEmptyOutOfSample(t *testing.T) {
	result, _, err := AnalyzeWalkForward(context.Background(), WalkForwardRequest{})
	if err != nil {
		t.Fatalf("AnalyzeWalkForward: %v", err)
	}
	if result.OutOfSample.Trades != 0 || result.OutOfSample.ExpectancyR != 0 {
		t.Errorf("outOfSample = %+v, want {trades:0 expectancyR:0}", result.OutOfSample)
	}
	if result.InSample.Trades != 0 {
		t.Errorf("inSample.trades = %d, want 0", result.InSample.Trades)
	}
	if result.RetentionRatio != 0 {
		t.Errorf("retentionRatio = %v, want 0 (no data at all)", result.RetentionRatio)
	}
}

func TestWalkForward_RetentionRatioZeroWhenInSampleNearZero(t *testing.T) {
	result, _, err := AnalyzeWalkForward(context.Background(), WalkForwardRequest{
		R: []float64{0, 0, 0, 0, 1}, ExitTs: []int64{1, 2, 3, 4, 5},
	})
	if err != nil {
		t.Fatalf("AnalyzeWalkForward: %v", err)
	}
	if result.RetentionRatio != 0 {
		t.Errorf("retentionRatio = %v, want 0 (inSample expectancy ~0)", result.RetentionRatio)
	}
}

// sensitivityTrade builds a simTrade directly (same package, unexported
// struct) for hand-verifiable bar-walk arithmetic — no need to go through
// prepareSimTrades/MarketData for these granular checks.
func sensitivityTrade(riskTicks, targetTicks int64, hasTarget bool, low, high int64, actualNetPnlCents int64) simTrade {
	return simTrade{
		side: "long", qty: 1, entryPriceTicks: 1000, riskTicks: riskTicks,
		hasTarget: hasTarget, targetTicks: targetTicks,
		initialRiskAmountCents: float64(riskTicks) * 1 * 100, tickValueCents: 100,
		feesCents: 0, actualNetPnlCents: actualNetPnlCents,
		bars: []PriceBar{{Ts: 1, LowTicks: low, HighTicks: high}},
	}
}

func TestSensitivityRewalkR_BaselineKeepsActualWhenNeitherTouched(t *testing.T) {
	st := sensitivityTrade(100, 100, true, 910, 1060, 3000)
	got := sensitivityRewalkR(st, 0, 0)
	if got != 0.3 {
		t.Errorf("R at (0,0) = %v, want 0.3 (actual kept, neither level touched)", got)
	}
}

func TestSensitivityRewalkR_TightenedStopChangesOutcome(t *testing.T) {
	st := sensitivityTrade(100, 100, true, 910, 1060, 3000)
	// -20% stop distance -> stop=920; bar low=910 touches it (base stop=900 does not).
	got := sensitivityRewalkR(st, -20, 0)
	want := float64(-8000) / 10000 // (920-1000)*1*100 cents, /initialRiskAmountCents
	if got != want {
		t.Errorf("R at (stop=-20,target=0) = %v, want %v (tightened stop touched)", got, want)
	}
}

func TestSensitivityRewalkR_WidenedStopStillActual(t *testing.T) {
	st := sensitivityTrade(100, 100, true, 910, 1060, 3000)
	got := sensitivityRewalkR(st, 20, 0)
	if got != 0.3 {
		t.Errorf("R at (stop=+20,target=0) = %v, want 0.3 (widened stop still untouched)", got)
	}
}

func TestSensitivityRewalkR_NarrowedTargetTouched(t *testing.T) {
	st := sensitivityTrade(100, 100, true, 910, 1060, 3000)
	// -40% target distance -> target=1060; bar high=1060 touches it.
	got := sensitivityRewalkR(st, 0, -40)
	want := float64(6000) / 10000 // (1060-1000)*1*100 cents
	if got != want {
		t.Errorf("R at (stop=0,target=-40) = %v, want %v (narrowed target touched)", got, want)
	}
}

func TestSensitivityRewalkR_SameBarAmbiguityIsStopFirst(t *testing.T) {
	st := sensitivityTrade(100, 100, true, 910, 1060, 3000)
	// Both the tightened stop (920) and narrowed target (1060) touch in the
	// same (only) bar -> stop-first wins, same result as stop-only.
	got := sensitivityRewalkR(st, -20, -40)
	want := float64(-8000) / 10000
	if got != want {
		t.Errorf("R at (stop=-20,target=-40) = %v, want %v (stop-first on same-bar ambiguity)", got, want)
	}
}

func TestSensitivityRewalkR_NoTargetOnlyStopAxisApplies(t *testing.T) {
	st := sensitivityTrade(100, 0, false, 910, 1060, 3000)
	// targetDelta is irrelevant when hasTarget is false — only stop matters.
	got := sensitivityRewalkR(st, 0, -90)
	if got != 0.3 {
		t.Errorf("R with no target = %v, want 0.3 (target delta has no effect)", got)
	}
}

// sensitivityTradeShort mirrors sensitivityTrade but for a short position —
// entry=1000, so a stop ABOVE entry and a target BELOW entry.
func sensitivityTradeShort(riskTicks, targetTicks int64, hasTarget bool, low, high int64, actualNetPnlCents int64) simTrade {
	return simTrade{
		side: "short", qty: 1, entryPriceTicks: 1000, riskTicks: riskTicks,
		hasTarget: hasTarget, targetTicks: targetTicks,
		initialRiskAmountCents: float64(riskTicks) * 1 * 100, tickValueCents: 100,
		feesCents: 0, actualNetPnlCents: actualNetPnlCents,
		bars: []PriceBar{{Ts: 1, LowTicks: low, HighTicks: high}},
	}
}

func TestSensitivityRewalkR_ShortDirectionTightenedStopTouched(t *testing.T) {
	// Short: stop base = 1000+100=1100, target base = 1000-100=900.
	// Bar high=1090 doesn't touch the base stop, but a -20% tightened stop
	// (distance 80 -> stop=1080) is touched (high=1090>=1080).
	st := sensitivityTradeShort(100, 100, true, 940, 1090, 3000)
	baseline := sensitivityRewalkR(st, 0, 0)
	if baseline != 0.3 {
		t.Errorf("R at (0,0) = %v, want 0.3 (actual kept, neither base level touched)", baseline)
	}
	got := sensitivityRewalkR(st, -20, 0)
	want := float64(-8000) / 10000 // (1000-1080)*1*100 cents for a short
	if got != want {
		t.Errorf("R at (stop=-20,target=0) = %v, want %v (tightened short stop touched)", got, want)
	}
}

func TestSensitivityRewalkR_ShortDirectionNarrowedTargetTouched(t *testing.T) {
	st := sensitivityTradeShort(100, 100, true, 940, 1090, 3000)
	// -40% target distance -> target=1000-60=940; bar low=940 touches it.
	got := sensitivityRewalkR(st, 0, -40)
	want := float64(6000) / 10000 // (1000-940)*1*100 cents for a short
	if got != want {
		t.Errorf("R at (stop=0,target=-40) = %v, want %v (narrowed short target touched)", got, want)
	}
}

func TestWalkForward_SensitivityGridShapeAndCoverage(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 1000, 3_000, withInitialStop(900), withRMultiple(0.3)),
	}
	md := &fakeMarketData{
		tickValue: map[string]float64{"NQ": 100},
		priceBarsFn: func(_, _ string, windows []TimeWindow) []PriceWindow {
			out := make([]PriceWindow, len(windows))
			for i := range windows {
				out[i] = PriceWindow{Found: true, Bars: []PriceBar{{Ts: 500, LowTicks: 910, HighTicks: 1060}}}
			}
			return out
		},
	}
	r, exitTs := TradeRValues(trades)
	result, audit, err := AnalyzeWalkForward(context.Background(), WalkForwardRequest{
		R: r, ExitTs: exitTs, Trades: trades, Timeframe: "1m", MarketData: md,
	})
	if err != nil {
		t.Fatalf("AnalyzeWalkForward: %v", err)
	}
	if result.ParameterSensitivity == nil {
		t.Fatal("parameterSensitivity = nil, want a value (trade has coverage)")
	}
	if result.ParameterSensitivity.Method != "ohlc-rewalk" {
		t.Errorf("method = %q, want ohlc-rewalk", result.ParameterSensitivity.Method)
	}
	if len(result.ParameterSensitivity.Points) != 49 {
		t.Errorf("points = %d, want 49", len(result.ParameterSensitivity.Points))
	}
	if audit.MissingMarketData != 0 || audit.NoInitialStop != 0 || audit.InvalidRisk != 0 {
		t.Errorf("audit = %+v, want all zero (single fully-eligible trade)", audit)
	}
}

func TestWalkForward_SensitivityNilWhenNoCoverage(t *testing.T) {
	trades := []model.Trade{
		newTrade("a", "long", 0, 1000, 1000, 3_000), // no InitialStopTicks
	}
	r, exitTs := TradeRValues(trades)
	result, audit, err := AnalyzeWalkForward(context.Background(), WalkForwardRequest{
		R: r, ExitTs: exitTs, Trades: trades, Timeframe: "1m",
		MarketData: &fakeMarketData{tickValue: map[string]float64{"NQ": 100}},
	})
	if err != nil {
		t.Fatalf("AnalyzeWalkForward: %v", err)
	}
	if result.ParameterSensitivity != nil {
		t.Errorf("parameterSensitivity = %+v, want nil (no eligible trade)", result.ParameterSensitivity)
	}
	if audit.NoInitialStop != 1 {
		t.Errorf("audit.noInitialStop = %d, want 1", audit.NoInitialStop)
	}
}

func TestWalkForward_CancellationStopsPromptlyWithError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err := AnalyzeWalkForward(ctx, WalkForwardRequest{R: []float64{1, -1}, ExitTs: []int64{1, 2}})
	if err == nil {
		t.Fatal("err = nil, want context.Canceled")
	}
}

func TestWalkForward_NoNaNOrInf(t *testing.T) {
	for _, r := range [][]float64{
		nil,
		{1},
		{1, -1, 2, -0.5, 0.3, 1.1, -0.2, 0, 3, -2},
	} {
		exitTs := make([]int64, len(r))
		for i := range exitTs {
			exitTs[i] = int64(i)
		}
		result, _, err := AnalyzeWalkForward(context.Background(), WalkForwardRequest{R: r, ExitTs: exitTs})
		if err != nil {
			t.Fatalf("AnalyzeWalkForward: %v", err)
		}
		if isNaNOrInf(result.InSample.ExpectancyR) || isNaNOrInf(result.OutOfSample.ExpectancyR) ||
			isNaNOrInf(result.ExpectancyDeltaR) || isNaNOrInf(result.RetentionRatio) {
			t.Errorf("len(r)=%d produced NaN/Inf: %+v", len(r), result)
		}
		for _, w := range result.Windows {
			if isNaNOrInf(w.ExpectancyR) {
				t.Errorf("window %+v has NaN/Inf expectancy", w)
			}
		}
	}
}
