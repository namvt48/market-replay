package analytics

import (
	"context"
	"fmt"
	"testing"

	"market-replay/internal/model"
)

func decisionQualityFakeMarketData(low, high int64) *fakeMarketData {
	return &fakeMarketData{
		tickValue: map[string]float64{"NQ": 100},
		priceBarsFn: func(_, _ string, windows []TimeWindow) []PriceWindow {
			out := make([]PriceWindow, len(windows))
			for i := range windows {
				out[i] = PriceWindow{Found: true, Bars: []PriceBar{{Ts: 500, LowTicks: low, HighTicks: high}}}
			}
			return out
		},
	}
}

func TestDecisionQuality_SeparatesProcessFromOutcome(t *testing.T) {
	trades := []model.Trade{
		newTrade("good-win", "long", 0, 1000, 1000, 10_000, withRMultiple(1)),
		newTrade("good-loss", "long", 0, 1000, 1000, -10_000, withRMultiple(-1), withExitReason("stopLoss")),
		// Original stop=980 (riskTicks=20); tampered to 970 (moved away from
		// plan for a long). Actual loss ran to -15000 cents (-7.5R); the bar
		// touches the ORIGINAL stop (low=975<=980), so re-walking the
		// untampered plan would have exited at -1R instead.
		newTrade("bad-loss", "long", 0, 1000, 1000, -15_000, withInitialStop(980), withExitReason("stopLoss"),
			withProtectionAdjustments(model.ProtectionAdjustment{Role: "stopLoss", Ts: 2, PriceTicks: 970})),
	}
	md := decisionQualityFakeMarketData(975, 1010)
	result, audit, err := AnalyzeDecisionQuality(context.Background(), trades, "1m", md)
	if err != nil {
		t.Fatalf("AnalyzeDecisionQuality: %v", err)
	}
	want := DecisionMatrix{GoodWin: 1, GoodLoss: 1, BadWin: 0, BadLoss: 1}
	if result.Matrix != want {
		t.Errorf("matrix = %+v, want %+v", result.Matrix, want)
	}
	// Only 1 badLoss trade has coverage here, well below
	// decisionDividendMinCoveredBadLoss (20) — the dividend must be nil with
	// an "insufficient" note, not a number computed from a single re-walk.
	// See TestDecisionQuality_DividendComputedWhenCoverageMeetsFloor for the
	// re-walk math itself.
	if result.RuleFollowingDividendR != nil {
		t.Errorf("ruleFollowingDividendR = %v, want nil (only 1 covered badLoss, below the floor)", *result.RuleFollowingDividendR)
	}
	if result.RuleFollowingDividendCoverageNote != "insufficient" {
		t.Errorf("ruleFollowingDividendCoverageNote = %q, want %q", result.RuleFollowingDividendCoverageNote, "insufficient")
	}
	if result.CoveredBadLossTrades != 1 {
		t.Errorf("coveredBadLossTrades = %d, want 1", result.CoveredBadLossTrades)
	}
	if result.TotalBadLossTrades != 1 {
		t.Errorf("totalBadLossTrades = %d, want 1", result.TotalBadLossTrades)
	}
	if result.PlanAdherenceScore >= 100 {
		t.Errorf("planAdherenceScore = %v, want < 100", result.PlanAdherenceScore)
	}
	if audit.MissingMarketData != 0 {
		t.Errorf("audit.missingMarketData = %d, want 0", audit.MissingMarketData)
	}
}

// TestDecisionQuality_DividendComputedWhenCoverageMeetsFloor verifies the
// re-walk math that TestDecisionQuality_SeparatesProcessFromOutcome used to
// check directly, now at a sample size that clears
// decisionDividendMinCoveredBadLoss (20): 20 identical badLoss trades, each
// contributing plannedR(-1.0) - actualR(-7.5) = 6.5, diluted over exactly
// those 20 trades (no other trades in the sample) = 6.5.
func TestDecisionQuality_DividendComputedWhenCoverageMeetsFloor(t *testing.T) {
	const n = 20
	trades := make([]model.Trade, n)
	for i := 0; i < n; i++ {
		ts := int64(i) * daySeconds
		trades[i] = newTrade(fmt.Sprintf("bad-loss-%d", i), "long", ts, ts+600, 1000, -15_000,
			withInitialStop(980), withExitReason("stopLoss"),
			withProtectionAdjustments(model.ProtectionAdjustment{Role: "stopLoss", Ts: ts + 2, PriceTicks: 970}))
	}
	md := decisionQualityFakeMarketData(975, 1010)
	result, _, err := AnalyzeDecisionQuality(context.Background(), trades, "1m", md)
	if err != nil {
		t.Fatalf("AnalyzeDecisionQuality: %v", err)
	}
	if result.CoveredBadLossTrades != n || result.TotalBadLossTrades != n {
		t.Fatalf("coveredBadLossTrades=%d totalBadLossTrades=%d, want both %d", result.CoveredBadLossTrades, result.TotalBadLossTrades, n)
	}
	if result.RuleFollowingDividendCoverageNote != "" {
		t.Errorf("ruleFollowingDividendCoverageNote = %q, want empty (floor met)", result.RuleFollowingDividendCoverageNote)
	}
	if result.RuleFollowingDividendR == nil {
		t.Fatal("ruleFollowingDividendR = nil, want a value (floor met)")
	}
	if got := *result.RuleFollowingDividendR; got < 6.49 || got > 6.51 {
		t.Errorf("ruleFollowingDividendR = %v, want ~6.5", got)
	}
}

func TestDecisionQuality_BadWinIsLuckNotSkill(t *testing.T) {
	// Long, original stop=980, tampered to 970 (harmful, adherence drops
	// below 70), but the trade still WON — process failed despite the
	// outcome, so it must classify as badWin, not goodWin.
	trades := []model.Trade{
		newTrade("bad-win", "long", 0, 1000, 1000, 5_000, withInitialStop(980),
			withProtectionAdjustments(model.ProtectionAdjustment{Role: "stopLoss", Ts: 2, PriceTicks: 970})),
	}
	result, _, err := AnalyzeDecisionQuality(context.Background(), trades, "1m", nil)
	if err != nil {
		t.Fatalf("AnalyzeDecisionQuality: %v", err)
	}
	if result.Trades[0].Classification != DecisionBadWin {
		t.Errorf("classification = %q, want badWin", result.Trades[0].Classification)
	}
	if result.Matrix.BadWin != 1 {
		t.Errorf("matrix.badWin = %d, want 1", result.Matrix.BadWin)
	}
}

func TestDecisionQuality_ShortSideTampering(t *testing.T) {
	// Short: initialStop=1020 (above entry), initialTakeProfit=900 (below
	// entry). A stop moved further UP (1030>1020) is harmful (more risk);
	// a target moved further UP toward entry (950>900) is also harmful
	// (less profit potential) — both directions inverted vs long.
	trades := []model.Trade{
		newTrade("short-tampered", "short", 0, 1000, 1000, -5_000,
			withInitialStop(1020), withInitialTakeProfit(900), withExitReason("stopLoss"),
			withProtectionAdjustments(
				model.ProtectionAdjustment{Role: "stopLoss", Ts: 1, PriceTicks: 1030},
				model.ProtectionAdjustment{Role: "takeProfit", Ts: 2, PriceTicks: 950},
			)),
	}
	result, _, err := AnalyzeDecisionQuality(context.Background(), trades, "1m", nil)
	if err != nil {
		t.Fatalf("AnalyzeDecisionQuality: %v", err)
	}
	if !result.Trades[0].TamperedStop {
		t.Errorf("tamperedStop = false, want true (short stop moved further from entry)")
	}
	if !result.Trades[0].TamperedTarget {
		t.Errorf("tamperedTarget = false, want true (short target moved toward entry)")
	}
}

func TestDecisionQuality_BreakevenCountedSeparatelyAsNonWin(t *testing.T) {
	trades := []model.Trade{
		newTrade("breakeven", "long", 0, 1000, 1000, 0, withInitialStop(980)), // RealizedCents==0
	}
	result, _, err := AnalyzeDecisionQuality(context.Background(), trades, "1m", nil)
	if err != nil {
		t.Fatalf("AnalyzeDecisionQuality: %v", err)
	}
	if result.Trades[0].Classification != DecisionGoodLoss {
		t.Errorf("classification = %q, want goodLoss (breakeven counts as non-win)", result.Trades[0].Classification)
	}
	if result.BreakevenTrades != 1 {
		t.Errorf("breakevenTrades = %d, want 1", result.BreakevenTrades)
	}
}

func TestDecisionQuality_NoBadLossIsZeroDividendNotNil(t *testing.T) {
	trades := []model.Trade{
		newTrade("good-win", "long", 0, 1000, 1000, 10_000, withRMultiple(1)),
	}
	result, _, err := AnalyzeDecisionQuality(context.Background(), trades, "1m", nil)
	if err != nil {
		t.Fatalf("AnalyzeDecisionQuality: %v", err)
	}
	if result.RuleFollowingDividendR == nil || *result.RuleFollowingDividendR != 0 {
		t.Errorf("ruleFollowingDividendR = %v, want pointer to 0 (no badLoss trades at all)", result.RuleFollowingDividendR)
	}
	if result.RuleFollowingDividendCoverageNote != "" {
		t.Errorf("ruleFollowingDividendCoverageNote = %q, want empty (no badLoss trades to explain)", result.RuleFollowingDividendCoverageNote)
	}
	if result.TotalBadLossTrades != 0 || result.CoveredBadLossTrades != 0 {
		t.Errorf("totalBadLossTrades=%d coveredBadLossTrades=%d, want both 0", result.TotalBadLossTrades, result.CoveredBadLossTrades)
	}
}

func TestDecisionQuality_BadLossWithoutCoverageIsNilDividend(t *testing.T) {
	trades := []model.Trade{
		// badLoss but no InitialStopTicks at all -> prepareSimTrades excludes it.
		newTrade("bad-loss-no-risk", "long", 0, 1000, 1000, -10_000,
			withProtectionAdjustments(
				model.ProtectionAdjustment{Role: "takeProfit", Ts: 1, PriceTicks: 1040},
				model.ProtectionAdjustment{Role: "takeProfit", Ts: 2, PriceTicks: 1040},
				model.ProtectionAdjustment{Role: "takeProfit", Ts: 3, PriceTicks: 1040},
				model.ProtectionAdjustment{Role: "takeProfit", Ts: 4, PriceTicks: 1040},
				model.ProtectionAdjustment{Role: "takeProfit", Ts: 5, PriceTicks: 1040},
			)),
	}
	result, audit, err := AnalyzeDecisionQuality(context.Background(), trades, "1m", nil)
	if err != nil {
		t.Fatalf("AnalyzeDecisionQuality: %v", err)
	}
	if result.Trades[0].Classification != DecisionBadLoss {
		t.Fatalf("classification = %q, want badLoss (5*7=35 penalty drags adherence to 65<70)", result.Trades[0].Classification)
	}
	if result.RuleFollowingDividendR != nil {
		t.Errorf("ruleFollowingDividendR = %v, want nil (badLoss trade has no risk/coverage to re-walk)", *result.RuleFollowingDividendR)
	}
	if result.RuleFollowingDividendCents != nil {
		t.Errorf("ruleFollowingDividendCents = %v, want nil", *result.RuleFollowingDividendCents)
	}
	if result.RuleFollowingDividendCoverageNote != "insufficient" {
		t.Errorf("ruleFollowingDividendCoverageNote = %q, want %q", result.RuleFollowingDividendCoverageNote, "insufficient")
	}
	if result.TotalBadLossTrades != 1 || result.CoveredBadLossTrades != 0 {
		t.Errorf("totalBadLossTrades=%d coveredBadLossTrades=%d, want 1 and 0", result.TotalBadLossTrades, result.CoveredBadLossTrades)
	}
	if audit.NoInitialStop != 1 {
		t.Errorf("audit.noInitialStop = %d, want 1", audit.NoInitialStop)
	}
}

func TestDecisionQuality_CancellationReturnsError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err := AnalyzeDecisionQuality(ctx, nil, "1m", nil)
	if err == nil {
		t.Fatal("err = nil, want context.Canceled")
	}
}

func TestDecisionQuality_NoNaNOrInf(t *testing.T) {
	for _, trades := range [][]model.Trade{
		nil,
		{newTrade("a", "long", 0, 1000, 1000, 0)},
		{newTrade("a", "long", 0, 1000, 1000, -10_000, withRMultiple(0))},
	} {
		result, _, err := AnalyzeDecisionQuality(context.Background(), trades, "1m", nil)
		if err != nil {
			t.Fatalf("AnalyzeDecisionQuality: %v", err)
		}
		if isNaNOrInf(result.PlanAdherenceScore) {
			t.Errorf("trades len=%d produced NaN/Inf planAdherenceScore: %+v", len(trades), result)
		}
		if result.RuleFollowingDividendR != nil && isNaNOrInf(*result.RuleFollowingDividendR) {
			t.Errorf("trades len=%d produced NaN/Inf ruleFollowingDividendR: %v", len(trades), *result.RuleFollowingDividendR)
		}
	}
}
