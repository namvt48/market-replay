package analytics

import (
	"testing"

	"market-replay/internal/model"
)

func TestTilt_DetectsSizeEscalationAndRapidReentry(t *testing.T) {
	const start = int64(1_700_000_000)
	trades := []model.Trade{
		newTrade("loss-1", "long", start, start+600, 1000, -10_000, withQty(1)),
		newTrade("loss-2", "long", start+900, start+1_500, 1000, -10_000, withQty(1)),
		newTrade("chase", "long", start+1_800, start+2_400, 1000, 5_000, withQty(4)),
	}
	result := AnalyzeTilt(trades)
	if result.PostLossSizeEscalations != 1 {
		t.Errorf("postLossSizeEscalations = %d, want 1", result.PostLossSizeEscalations)
	}
	if result.RapidReentriesAfterLoss != 2 {
		t.Errorf("rapidReentriesAfterLoss = %d, want 2", result.RapidReentriesAfterLoss)
	}
	if result.TiltScore <= 0 {
		t.Errorf("tiltScore = %v, want > 0", result.TiltScore)
	}
}

func TestTilt_RapidReentryBoundaryExactly15Minutes(t *testing.T) {
	const start = int64(1_700_000_000)
	atBoundary := []model.Trade{
		newTrade("loss", "long", start, start+600, 1000, -100, withQty(1)),
		newTrade("next", "long", start+600+900, start+600+900+500, 1000, 100, withQty(1)), // gap == 900s exactly
	}
	if got := AnalyzeTilt(atBoundary).RapidReentriesAfterLoss; got != 1 {
		t.Errorf("rapidReentriesAfterLoss at gap=900s = %d, want 1 (boundary is inclusive, <=15min)", got)
	}

	justOutside := []model.Trade{
		newTrade("loss", "long", start, start+600, 1000, -100, withQty(1)),
		newTrade("next", "long", start+600+901, start+600+901+500, 1000, 100, withQty(1)), // gap == 901s
	}
	if got := AnalyzeTilt(justOutside).RapidReentriesAfterLoss; got != 0 {
		t.Errorf("rapidReentriesAfterLoss at gap=901s = %d, want 0 (just past the 15min window)", got)
	}
}

func TestTilt_UnsortedInputIsStableSortedByEntryTs(t *testing.T) {
	const start = int64(1_700_000_000)
	sorted := []model.Trade{
		newTrade("loss-1", "long", start, start+600, 1000, -10_000, withQty(1)),
		newTrade("loss-2", "long", start+900, start+1_500, 1000, -10_000, withQty(1)),
		newTrade("chase", "long", start+1_800, start+2_400, 1000, 5_000, withQty(4)),
	}
	shuffled := []model.Trade{sorted[2], sorted[0], sorted[1]}

	want := AnalyzeTilt(sorted)
	got := AnalyzeTilt(shuffled)
	if got.PostLossSizeEscalations != want.PostLossSizeEscalations || got.RapidReentriesAfterLoss != want.RapidReentriesAfterLoss || got.TiltScore != want.TiltScore {
		t.Errorf("shuffled input produced a different result: got=%+v want=%+v", got, want)
	}
}

func TestTilt_ComposedProfileForStableSizing(t *testing.T) {
	const start = int64(1_700_000_000)
	trades := make([]model.Trade, 20)
	for i := range trades {
		ts := start + int64(i)*86_400
		trades[i] = newTrade("t", "long", ts, ts+600, 1000, 1_000, withQty(1))
	}
	result := AnalyzeTilt(trades)
	if result.Profile != ProfileComposed {
		t.Errorf("profile = %q, want composed (uniform size, all winners, no adjustments)", result.Profile)
	}
	if result.SlTamperingScore != 0 {
		t.Errorf("slTamperingScore = %v, want 0", result.SlTamperingScore)
	}
}

func TestTilt_NoNaNOrInf(t *testing.T) {
	for _, trades := range [][]model.Trade{
		nil,
		{newTrade("a", "long", 0, 600, 1000, 100, withQty(1))},
	} {
		result := AnalyzeTilt(trades)
		if isNaNOrInf(result.TiltScore) || isNaNOrInf(result.SlTamperingScore) ||
			isNaNOrInf(result.SizingConsistency) || isNaNOrInf(result.AntiStreakScore) {
			t.Errorf("trades len=%d produced NaN/Inf: %+v", len(trades), result)
		}
	}
}
