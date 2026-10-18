package analytics

import "testing"

func repeat(value float64, n int) []float64 {
	out := make([]float64, n)
	for i := range out {
		out[i] = value
	}
	return out
}

func TestEdgeStats_EmptySampleIsInsufficient(t *testing.T) {
	stats := CalculateEdgeStats(nil, EdgeStatsOverrides{})
	if stats.Verdict != EdgeVerdictInsufficient {
		t.Errorf("verdict = %q, want insufficient (n=0)", stats.Verdict)
	}
	if stats.N != 0 {
		t.Errorf("n = %d, want 0", stats.N)
	}
}

func TestEdgeStats_SampleGuardrail(t *testing.T) {
	stats := CalculateEdgeStats(repeat(1, 49), EdgeStatsOverrides{})
	if stats.Verdict != EdgeVerdictInsufficient {
		t.Errorf("verdict = %q, want insufficient", stats.Verdict)
	}
}

func TestEdgeStats_SampleGuardrailBoundaryAt50(t *testing.T) {
	stats := CalculateEdgeStats(append(repeat(2, 30), repeat(-1, 20)...), EdgeStatsOverrides{})
	if stats.N != 50 {
		t.Fatalf("n = %d, want 50", stats.N)
	}
	if stats.Verdict == EdgeVerdictInsufficient {
		t.Errorf("verdict = %q, want anything but insufficient at n=50", stats.Verdict)
	}
}

func TestEdgeStats_DistinguishesEdgeNoEvidenceAndZeroEdge(t *testing.T) {
	supported := append(repeat(2, 60), repeat(-1, 40)...)
	supportedStats := CalculateEdgeStats(supported, EdgeStatsOverrides{})
	if supportedStats.Verdict != EdgeVerdictEdge {
		t.Errorf("supported verdict = %q, want edge", supportedStats.Verdict)
	}
	if supportedStats.PValue == nil || *supportedStats.PValue >= 0.05 {
		t.Errorf("supported pValue = %v, want < 0.05", supportedStats.PValue)
	}

	balanced := append(repeat(1, 50), repeat(-1, 50)...)
	balancedStats := CalculateEdgeStats(balanced, EdgeStatsOverrides{})
	if balancedStats.Verdict != EdgeVerdictNoEvidence {
		t.Errorf("balanced verdict = %q, want no-evidence", balancedStats.Verdict)
	}

	winRate, avgWinR, avgLossR := 0.2, 1.0, 1.0
	belowBreakeven := CalculateEdgeStats(append(repeat(1, 30), repeat(2, 30)...), EdgeStatsOverrides{
		WinRate: &winRate, AvgWinR: &avgWinR, AvgLossR: &avgLossR,
	})
	if belowBreakeven.Verdict != EdgeVerdictZeroEdge {
		t.Errorf("belowBreakeven verdict = %q, want zero-edge", belowBreakeven.Verdict)
	}
}

func TestEdgeStats_NoLossesMakesAvgRRAndBreakevenNil(t *testing.T) {
	// All winners: there is no loss to measure a payoff ratio or breakeven
	// rate against, so both must be nil — not a fabricated 0 or 100 — and
	// the zero-edge guardrail must not fire just because it can't apply.
	stats := CalculateEdgeStats(repeat(1, 60), EdgeStatsOverrides{})
	if stats.AvgRR != nil {
		t.Errorf("avgRR = %v, want nil (no losses)", *stats.AvgRR)
	}
	if stats.BreakevenRate != nil {
		t.Errorf("breakevenRate = %v, want nil (no losses)", *stats.BreakevenRate)
	}
	if stats.Verdict != EdgeVerdictNoEvidence {
		t.Errorf("verdict = %q, want no-evidence (zero variance is not statistical proof)", stats.Verdict)
	}
}

func TestEdgeStats_WinRateAndBreakevenRateArePercentScale(t *testing.T) {
	// 30 winners of +2R, 20 losers of -1R: winRate = 30/50 = 60%,
	// avgRR = 2/1 = 2, breakevenRate = 1/(1+2) = 33.33%.
	stats := CalculateEdgeStats(append(repeat(2, 30), repeat(-1, 20)...), EdgeStatsOverrides{})
	if stats.WinRate != 60 {
		t.Errorf("winRate = %v, want 60 (percent scale)", stats.WinRate)
	}
	if stats.BreakevenRate == nil {
		t.Fatal("breakevenRate = nil, want a value")
	}
	if got := *stats.BreakevenRate; got < 33.3 || got > 33.4 {
		t.Errorf("breakevenRate = %v, want ~33.33 (percent scale)", got)
	}
}

func TestEdgeStats_ZeroVarianceHasUndefinedInference(t *testing.T) {
	stats := CalculateEdgeStats(repeat(1, 60), EdgeStatsOverrides{})
	if stats.TStatistic != nil || stats.PValue != nil || stats.TStatNote != "zeroVarianceSample" {
		t.Errorf("degenerate inference = t:%v p:%v note:%q, want null t/p and warning", stats.TStatistic, stats.PValue, stats.TStatNote)
	}
}

func TestEdgeStats_ZeroExpectancyAndZeroVarianceHasUndefinedInference(t *testing.T) {
	stats := CalculateEdgeStats(repeat(0, 60), EdgeStatsOverrides{})
	if stats.TStatistic != nil || stats.PValue != nil || stats.Verdict != EdgeVerdictNoEvidence {
		t.Errorf("zero sample inference = %+v, want undefined statistics and no-evidence", stats)
	}
}

func TestEdgeStats_ZeroOutcomesUseDecisiveBreakevenShare(t *testing.T) {
	values := append(append(repeat(1, 60), repeat(-1, 20)...), repeat(0, 120)...)
	stats := CalculateEdgeStats(values, EdgeStatsOverrides{})
	if stats.WinRate != 30 || stats.LossRate != 10 || stats.BreakevenRate == nil || *stats.BreakevenRate != 20 {
		t.Errorf("rates = win:%v loss:%v breakeven:%v, want 30, 10, 20", stats.WinRate, stats.LossRate, stats.BreakevenRate)
	}
	if stats.Verdict != EdgeVerdictEdge || stats.PValue == nil || *stats.PValue >= 0.05 {
		t.Errorf("stats = %+v, want significant positive edge", stats)
	}
}

func TestEdgeStats_ZeroExpectancyAndZeroVarianceIsUndefined(t *testing.T) {
	stats := CalculateEdgeStats(repeat(0, 60), EdgeStatsOverrides{})
	if stats.TStatistic != nil || stats.PValue != nil || stats.TStatNote != "zeroVarianceSample" || stats.Verdict != EdgeVerdictNoEvidence {
		t.Errorf("zero sample inference = %+v, want undefined statistics and no-evidence", stats)
	}
}

func TestEdgeStats_NoWinsIsZeroEdgeNotNil(t *testing.T) {
	// All losses: avgLossR > 0 so avgRR/breakevenRate ARE defined (0 and
	// 100 respectively) — only the no-LOSSES case is nil.
	stats := CalculateEdgeStats(repeat(-1, 60), EdgeStatsOverrides{})
	if stats.AvgRR == nil || *stats.AvgRR != 0 {
		t.Errorf("avgRR = %v, want pointer to 0", stats.AvgRR)
	}
	if stats.BreakevenRate == nil || *stats.BreakevenRate != 100 {
		t.Errorf("breakevenRate = %v, want pointer to 100", stats.BreakevenRate)
	}
	if stats.Verdict != EdgeVerdictNoEvidence {
		t.Errorf("verdict = %q, want no-evidence", stats.Verdict)
	}
}

func TestEdgeStats_NoNaNOrInfAcrossVariedSamples(t *testing.T) {
	samples := [][]float64{
		{},
		repeat(1, 1),
		append(repeat(1, 30), repeat(-1, 30)...),
		append(repeat(3, 55), repeat(-2, 45)...),
	}
	for _, sample := range samples {
		stats := CalculateEdgeStats(sample, EdgeStatsOverrides{})
		if isNaNOrInf(stats.ExpectancyR) || (stats.PValue != nil && isNaNOrInf(*stats.PValue)) || isNaNOrInf(stats.WinRate) {
			t.Errorf("sample len=%d produced NaN/Inf: %+v", len(sample), stats)
		}
		if stats.AvgRR != nil && isNaNOrInf(*stats.AvgRR) {
			t.Errorf("sample len=%d avgRR is NaN/Inf: %v", len(sample), *stats.AvgRR)
		}
		if stats.BreakevenRate != nil && isNaNOrInf(*stats.BreakevenRate) {
			t.Errorf("sample len=%d breakevenRate is NaN/Inf: %v", len(sample), *stats.BreakevenRate)
		}
		if stats.TStatistic != nil && isNaNOrInf(*stats.TStatistic) {
			t.Errorf("sample len=%d tStatistic is NaN/Inf: %v", len(sample), *stats.TStatistic)
		}
	}
}
