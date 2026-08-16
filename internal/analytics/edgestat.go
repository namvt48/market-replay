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
// Unit convention (documented once, holds for every field below):
//   - WinRate and BreakevenRate are percent, 0..100.
//   - ExpectancyR, AvgWinR, AvgLossR, AvgRR are R-multiples (ratios), not
//     percent — AvgLossR is a positive magnitude (already abs'd).
//
// AvgRR and BreakevenRate are nil — not a fabricated 0 or 100 — when the
// sample has no losses at all: the payoff ratio and the breakeven rate it
// implies are genuinely undefined without a loss to measure against, and
// the zero-edge guardrail is skipped (not force-passed) in that case; see
// CalculateEdgeStats.
//
// TStatistic is nil (with the reason in TStatNote, an internal-only field
// the report layer turns into an audit warning — see BuildEdgeReport)
// instead of +/-Infinity when the sample has zero variance:
// encoding/json cannot represent a non-finite float64, and the
// project-wide "no NaN/Infinity in JSON" rule bars it regardless.
type EdgeStats struct {
	N             int         `json:"sampleSize"`
	ExpectancyR   float64     `json:"expectancyR"`
	WinRate       float64     `json:"winRate"`
	AvgWinR       float64     `json:"averageWinR"`
	AvgLossR      float64     `json:"averageLossR"`
	AvgRR         *float64    `json:"averageRR"`
	BreakevenRate *float64    `json:"breakevenRate"`
	TStatistic    *float64    `json:"tStatistic"`
	TStatNote     string      `json:"-"`
	PValue        float64     `json:"pValue"`
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

// CalculateEdgeStats computes the edge verdict from a sample of R-multiples.
// Guardrail chain, in order:
//  1. n < 50 -> insufficient.
//  2. pValue >= 0.05 -> no-evidence.
//  3. breakevenRate is defined AND winRate <= breakevenRate -> zero-edge
//     (a sample with no losses has no breakeven rate to violate, so this
//     check is skipped rather than force-passed or force-failed).
//  4. else -> edge.
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

	sampleWinRate := 0.0
	if n > 0 {
		sampleWinRate = float64(len(wins)) / float64(n)
	}
	winRateRatio := floatOr(overrides.WinRate, sampleWinRate)
	avgWinR := floatOr(overrides.AvgWinR, average(wins))
	avgLossR := math.Abs(floatOr(overrides.AvgLossR, average(losses)))

	var avgRR, breakevenRateRatio *float64
	if avgLossR > edgeEpsilon {
		rr := avgWinR / avgLossR
		avgRR = &rr
		ber := 1 / (1 + rr)
		breakevenRateRatio = &ber
	}

	expectancyR := average(r)
	std := sampleStdDev(r)

	var tStatistic *float64
	var tStatNote string
	var pValue float64
	switch {
	case std > edgeEpsilon:
		t := expectancyR * math.Sqrt(float64(n)) / std
		tStatistic = &t
		pValue = twoSidedStudentTPValue(t, float64(n-1))
	case expectancyR > edgeEpsilon:
		tStatNote = "zeroVarianceSample" // conceptually +Infinity
		pValue = 0
	case expectancyR < -edgeEpsilon:
		tStatNote = "zeroVarianceSample" // conceptually -Infinity
		pValue = 0
	default:
		zero := 0.0
		tStatistic = &zero
		pValue = 1
	}

	verdict := EdgeVerdictEdge
	switch {
	case n < edgeSampleGuardrail:
		verdict = EdgeVerdictInsufficient
	case pValue >= edgeSignificanceThreshold:
		verdict = EdgeVerdictNoEvidence
	case breakevenRateRatio != nil && winRateRatio <= *breakevenRateRatio:
		verdict = EdgeVerdictZeroEdge
	}

	var breakevenRatePercent *float64
	if breakevenRateRatio != nil {
		p := *breakevenRateRatio * 100
		breakevenRatePercent = &p
	}

	return EdgeStats{
		N: n, ExpectancyR: expectancyR, WinRate: winRateRatio * 100,
		AvgWinR: avgWinR, AvgLossR: avgLossR, AvgRR: avgRR, BreakevenRate: breakevenRatePercent,
		TStatistic: tStatistic, TStatNote: tStatNote, PValue: pValue, Verdict: verdict,
	}
}
