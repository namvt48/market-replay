package analytics

import "testing"

func TestKelly_WithholdsSizingUntilEvidencePasses(t *testing.T) {
	insufficient := CalculateEdgeStats(repeat(1, 20), EdgeStatsOverrides{})
	if sizing := CalculateKellySizing(insufficient, KellyOptions{}); sizing != nil {
		t.Errorf("sizing = %+v, want nil (insufficient sample)", sizing)
	}
}

func TestKelly_ReturnsFractionalKellyWithinRiskCap(t *testing.T) {
	edge := CalculateEdgeStats(append(repeat(2, 70), repeat(-1, 30)...), EdgeStatsOverrides{})
	fraction, maxRisk := 0.25, 0.02
	sizing := CalculateKellySizing(edge, KellyOptions{Fraction: &fraction, MaxRiskPerTrade: &maxRisk})
	if sizing == nil {
		t.Fatal("sizing = nil, want a value")
	}
	if sizing.SuggestedRiskPerTrade > 0.02 {
		t.Errorf("suggestedRiskPerTrade = %v, want <= 0.02", sizing.SuggestedRiskPerTrade)
	}
	if sizing.Fraction != 0.25 {
		t.Errorf("fraction = %v, want 0.25", sizing.Fraction)
	}
	if sizing.Method != "fractional-kelly" {
		t.Errorf("method = %q, want fractional-kelly", sizing.Method)
	}
	if sizing.MaxRiskCap != 0.02 {
		t.Errorf("maxRiskCap = %v, want 0.02", sizing.MaxRiskCap)
	}
}

func TestKelly_NilWhenAvgRRNonPositive(t *testing.T) {
	// All losses, no wins -> avgRR is 0 (avgWinR=0) even if somehow
	// verdict were "edge"; guards against a division-by-zero fStar.
	winRate, avgWinR, avgLossR := 0.9, 0.0, 1.0
	edge := CalculateEdgeStats(repeat(-1, 60), EdgeStatsOverrides{WinRate: &winRate, AvgWinR: &avgWinR, AvgLossR: &avgLossR})
	if sizing := CalculateKellySizing(edge, KellyOptions{}); sizing != nil {
		t.Errorf("sizing = %+v, want nil (avgRR <= 0)", sizing)
	}
}
