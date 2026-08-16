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
	if supportedStats.PValue >= 0.05 {
		t.Errorf("supported pValue = %v, want < 0.05", supportedStats.PValue)
	}

	balanced := append(repeat(1, 50), repeat(-1, 50)...)
	balancedStats := CalculateEdgeStats(balanced, EdgeStatsOverrides{})
	if balancedStats.Verdict != EdgeVerdictNoEvidence {
		t.Errorf("balanced verdict = %q, want no-evidence", balancedStats.Verdict)
	}

	winRate, avgWinR, avgLossR := 0.2, 1.0, 1.0
	belowBreakeven := CalculateEdgeStats(repeat(1, 60), EdgeStatsOverrides{
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
	if stats.Verdict != EdgeVerdictEdge {
		t.Errorf("verdict = %q, want edge (zero-edge check skipped, not force-failed)", stats.Verdict)
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

func TestEdgeStats_ZeroStandardDeviationHasNoInfinityInJSON(t *testing.T) {
	stats := CalculateEdgeStats(repeat(1, 60), EdgeStatsOverrides{})
	// TS reference: tStat === +Infinity, pValue === 0. Go cannot JSON-encode
	// Infinity, so the zero-variance case is nil+note instead (see
	// EdgeStats' doc comment) — the report layer turns TStatNote into an
	// audit warning rather than serializing it on the edge object itself.
	if stats.TStatistic != nil {
		t.Errorf("tStatistic = %v, want nil (zero variance)", *stats.TStatistic)
	}
	if stats.TStatNote != "zeroVarianceSample" {
		t.Errorf("tStatNote = %q, want zeroVarianceSample", stats.TStatNote)
	}
	if stats.PValue != 0 {
		t.Errorf("pValue = %v, want 0", stats.PValue)
	}
}

func TestEdgeStats_ZeroExpectancyAndZeroVarianceIsTStatisticZero(t *testing.T) {
	values := repeat(0, 60)
	stats := CalculateEdgeStats(values, EdgeStatsOverrides{})
	if stats.TStatistic == nil || *stats.TStatistic != 0 {
		t.Errorf("tStatistic = %v, want pointer to 0", stats.TStatistic)
	}
	if stats.PValue != 1 {
		t.Errorf("pValue = %v, want 1", stats.PValue)
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
	if stats.Verdict != EdgeVerdictZeroEdge {
		t.Errorf("verdict = %q, want zero-edge", stats.Verdict)
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
		if isNaNOrInf(stats.ExpectancyR) || isNaNOrInf(stats.PValue) || isNaNOrInf(stats.WinRate) {
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
