package analytics

import (
	"testing"

	"market-replay/internal/model"
)

func TestDecomposeEdge_DetectsExitLeakAndConcentratedWinners(t *testing.T) {
	trades := make([]model.Trade, 10)
	for i := range trades {
		if i < 5 {
			trades[i] = newTrade("w", "long", 0, 1000, 1000, 10_000,
				withInitialStop(980), withRMultiple(1), withMfeTicks(60), withMaeTicks(5))
		} else {
			trades[i] = newTrade("l", "long", 0, 1000, 1000, -5_000,
				withInitialStop(980), withRMultiple(-0.5), withMfeTicks(60), withMaeTicks(5))
		}
	}
	result := DecomposeEdge(trades, 5)
	if result.TimingFlag != TimingExitLeak {
		t.Errorf("timingFlag = %q, want exit-leak", result.TimingFlag)
	}
	if result.TopNConcentrationPct != 100 {
		t.Errorf("topNConcentrationPct = %v, want 100", result.TopNConcentrationPct)
	}
	if result.ConcentrationFlag != ConcentrationConcentrated {
		t.Errorf("concentrationFlag = %q, want concentrated", result.ConcentrationFlag)
	}
}

func TestDecomposeEdge_TimingFlagEntryGood(t *testing.T) {
	trades := make([]model.Trade, 10)
	for i := range trades {
		trades[i] = newTrade("w", "long", 0, 1000, 1000, 5_000,
			withInitialStop(980), withRMultiple(0.5), withMfeTicks(20), withMaeTicks(5)) // maeR=0.25, mfeR=1.0
	}
	result := DecomposeEdge(trades, 5)
	if result.TimingFlag != TimingEntryGood {
		t.Errorf("timingFlag = %q, want entry-good (low MAE, positive expectancy)", result.TimingFlag)
	}
}

func TestDecomposeEdge_TimingFlagEntryRisk(t *testing.T) {
	trades := make([]model.Trade, 10)
	for i := range trades {
		trades[i] = newTrade("w", "long", 0, 1000, 1000, 3_000,
			withInitialStop(980), withRMultiple(0.3), withMfeTicks(15), withMaeTicks(20)) // maeR=1.0, mfeR=0.75
	}
	result := DecomposeEdge(trades, 5)
	if result.TimingFlag != TimingEntryRisk {
		t.Errorf("timingFlag = %q, want entry-risk (high MAE)", result.TimingFlag)
	}
}

func TestDecomposeEdge_TimingFlagBalanced(t *testing.T) {
	trades := make([]model.Trade, 10)
	for i := range trades {
		trades[i] = newTrade("w", "long", 0, 1000, 1000, 3_000,
			withInitialStop(980), withRMultiple(0.3), withMfeTicks(15), withMaeTicks(10)) // maeR=0.5, mfeR=0.75
	}
	result := DecomposeEdge(trades, 5)
	if result.TimingFlag != TimingBalanced {
		t.Errorf("timingFlag = %q, want balanced", result.TimingFlag)
	}
}

func TestDecomposeEdge_ExcludesTradesWithoutValidRisk(t *testing.T) {
	trades := []model.Trade{
		newTrade("no-stop", "long", 0, 1000, 1000, 10_000, withRMultiple(1), withMfeTicks(60), withMaeTicks(5)),
		newTrade("valid", "long", 0, 1000, 1000, 10_000, withInitialStop(980), withRMultiple(1), withMfeTicks(40), withMaeTicks(10)),
	}
	result := DecomposeEdge(trades, 5)
	// Only the second trade has a valid stop, so averageMfeR must come
	// from it alone (40/20 = 2), not be diluted by the first trade.
	if result.AverageMfeR != 2 {
		t.Errorf("averageMfeR = %v, want 2 (only the risk-valid trade counts)", result.AverageMfeR)
	}
}

func TestDecomposeEdge_NoNaNOrInfOnEmptyOrDegenerateInput(t *testing.T) {
	for _, trades := range [][]model.Trade{
		nil,
		{newTrade("a", "long", 0, 1000, 1000, 0)},
	} {
		result := DecomposeEdge(trades, 5)
		if isNaNOrInf(result.WinRate) || isNaNOrInf(result.AverageWinR) || isNaNOrInf(result.AverageLossR) ||
			isNaNOrInf(result.PayoffAsymmetry) || isNaNOrInf(result.AverageMfeR) || isNaNOrInf(result.AverageMaeR) ||
			isNaNOrInf(result.AverageRealizedR) || isNaNOrInf(result.CaptureRatio) || isNaNOrInf(result.TopNConcentrationPct) {
			t.Errorf("degenerate input produced NaN/Inf: %+v", result)
		}
	}
}
