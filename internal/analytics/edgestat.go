package analytics

import "math"

// EdgeVerdict is CalculateEdgeStats' guardrail conclusion.
type EdgeVerdict string

const (
	EdgeVerdictInsufficient EdgeVerdict = "insufficient"
	EdgeVerdictNoEvidence   EdgeVerdict = "no-evidence"
	EdgeVerdictZeroEdge     EdgeVerdict = "zero-edge"
	EdgeVerdictEdge         EdgeVerdict = "edge"
)

// edgeSampleGuardrail is the minimum eligible-trade count below which the
// verdict is "insufficient" regardless of the observed statistics.
// edgeSignificanceThreshold is the two-sided p-value at/above which the
// sample cannot reject a zero-mean outcome ("no-evidence"). edgeEpsilon
// bounds the "effectively zero" comparisons (variance, risk ratios).
const (
	edgeSampleGuardrail       = 50
	edgeSignificanceThreshold = 0.05
	edgeEpsilon               = 1e-12
)

// EdgeStatsOverrides lets a caller test a hypothetical winRate/avgWinR/
// avgLossR instead of the sample's own — e.g. to answer "would this be an
// edge if the payoff ratio were X". WinRate is a ratio (0..1), matching the
// sample-derived value it overrides; EdgeStats.WinRate itself is percent
// (0..100) — see EdgeStats' doc comment for the full unit convention.
type EdgeStatsOverrides struct {
	WinRate  *float64
	AvgWinR  *float64
	AvgLossR *float64
}

// EdgeStats is CalculateEdgeStats' result.
//
//   - WinRate, LossRate, and BreakevenRate are percent, 0..100.
//   - ExpectancyR, AvgWinR, AvgLossR, AvgRR are R-multiples (ratios), not
//     percent — AvgLossR is a positive magnitude (already abs'd).
//
// AvgRR and BreakevenRate are nil when there is no observed loss. TStatistic
// and PValue are nil when variance is zero; TStatNote explains this to the
// report audit layer.
type EdgeStats struct {
	N             int         `json:"sampleSize"`
	ExpectancyR   float64     `json:"expectancyR"`
	WinRate       float64     `json:"winRate"`
	LossRate      float64     `json:"lossRate"`
	AvgWinR       float64     `json:"averageWinR"`
	AvgLossR      float64     `json:"averageLossR"`
	AvgRR         *float64    `json:"averageRR"`
	BreakevenRate *float64    `json:"breakevenRate"`
	TStatistic    *float64    `json:"tStatistic"`
	TStatNote     string      `json:"-"`
	PValue        *float64    `json:"pValue"`
	Verdict       EdgeVerdict `json:"verdict"`
}

func finiteFloats(values []float64) []float64 {
	out := make([]float64, 0, len(values))
	for _, v := range values {
		if !math.IsNaN(v) && !math.IsInf(v, 0) {
			out = append(out, v)
		}
	}
	return out
}

func floatOr(override *float64, fallback float64) float64 {
	if override != nil {
		return *override
	}
	return fallback
}

// CalculateEdgeStats computes an edge verdict from finite R-multiples.
// The breakeven hurdle uses decisive outcomes only: decisiveShare/(1+payoff)
// against WinRate as a share of all observations.
func CalculateEdgeStats(values []float64, overrides EdgeStatsOverrides) EdgeStats {
	r := finiteFloats(values)
	n := len(r)
	var wins, losses []float64
	for _, v := range r {
		switch {
		case v > 0:
			wins = append(wins, v)
		case v < 0:
			losses = append(losses, v)
		}
	}

	decisive := len(wins) + len(losses)
	sampleWinRate := 0.0
	sampleLossRate := 0.0
	if n > 0 {
		sampleWinRate = float64(len(wins)) / float64(n)
		sampleLossRate = float64(len(losses)) / float64(n)
	}
	winRateRatio := floatOr(overrides.WinRate, sampleWinRate)
	avgWinR := floatOr(overrides.AvgWinR, average(wins))
	avgLossR := math.Abs(floatOr(overrides.AvgLossR, average(losses)))
	var avgRR, breakevenRateRatio *float64
	if avgLossR > edgeEpsilon {
		rr := avgWinR / avgLossR
		avgRR = &rr
		share := 1.0
		if n > 0 {
			share = float64(decisive) / float64(n)
		}
		ber := share / (1 + rr)
		breakevenRateRatio = &ber
	}

	expectancyR := average(r)
	std := sampleStdDev(r)
	var tStatistic, pValue *float64
	var tStatNote string
	if std > edgeEpsilon {
		t := expectancyR * math.Sqrt(float64(n)) / std
		p := twoSidedStudentTPValue(t, float64(n-1))
		tStatistic, pValue = &t, &p
	} else {
		tStatNote = "zeroVarianceSample"
	}

	verdict := EdgeVerdictInsufficient
	switch {
	case n < edgeSampleGuardrail:
	case pValue == nil:
		verdict = EdgeVerdictNoEvidence
	case *pValue >= edgeSignificanceThreshold || expectancyR <= 0:
		verdict = EdgeVerdictNoEvidence
	case breakevenRateRatio != nil && winRateRatio <= *breakevenRateRatio:
		verdict = EdgeVerdictZeroEdge
	default:
		verdict = EdgeVerdictEdge
	}
	var breakevenRatePercent *float64
	if breakevenRateRatio != nil {
		p := *breakevenRateRatio * 100
		breakevenRatePercent = &p
	}
	return EdgeStats{
		N: n, ExpectancyR: expectancyR, WinRate: winRateRatio * 100, LossRate: sampleLossRate * 100,
		AvgWinR: avgWinR, AvgLossR: avgLossR, AvgRR: avgRR, BreakevenRate: breakevenRatePercent,
		TStatistic: tStatistic, TStatNote: tStatNote, PValue: pValue, Verdict: verdict,
	}
}
