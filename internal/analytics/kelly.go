package analytics

// kellyMethod is the fixed "sizing.method" value — v1 supports exactly one
// sizing method, so this is a constant rather than a field callers choose.
const kellyMethod = "fractional-kelly"

// KellySizing is CalculateKellySizing's result. FullKelly/FractionalKelly/
// SuggestedRiskPerTrade/MaxRiskCap are ratios (0..1), not percent —
// Fraction likewise (0.25 means one-quarter Kelly).
type KellySizing struct {
	Method                string  `json:"method"`
	FullKelly             float64 `json:"fullKelly"`
	Fraction              float64 `json:"fraction"`
	FractionalKelly       float64 `json:"fractionalKelly"`
	SuggestedRiskPerTrade float64 `json:"suggestedRiskPerTrade"`
	MaxRiskCap            float64 `json:"maxRiskCap"`
	Capped                bool    `json:"capped"`
}

// KellyOptions configures the sizing recommendation's fraction and cap.
type KellyOptions struct {
	Fraction        *float64
	MaxRiskPerTrade *float64
}

const (
	kellyMinFraction = 0.25
	kellyMaxFraction = 0.5
	kellyMinRiskCap  = 0.0025
	kellyMaxRiskCap  = 0.05
)

// CalculateKellySizing converts EdgeStats' measured hit rate and payoff
// ratio into a fractional-Kelly risk-per-trade recommendation. Returns nil
// unless edge.Verdict is "edge" (every guardrail passed) AND edge.AvgRR is
// defined and positive (a sample with no losses has no payoff ratio to
// size against) — sizing is withheld, not merely zeroed, until the
// evidence supports it. Callers that also require a non-negative
// out-of-sample expectancy (the doc's additional sizing guardrail) apply
// that check themselves — see BuildEdgeReport.
func CalculateKellySizing(edge EdgeStats, opts KellyOptions) *KellySizing {
	if edge.Verdict != EdgeVerdictEdge || edge.AvgRR == nil || *edge.AvgRR <= 0 {
		return nil
	}
	avgRR := *edge.AvgRR
	winRate := edge.WinRate / 100 // EdgeStats.WinRate is percent; Kelly's formula needs a ratio.

	fraction := kellyMinFraction
	if opts.Fraction != nil {
		fraction = *opts.Fraction
	}
	if fraction < kellyMinFraction {
		fraction = kellyMinFraction
	}
	if fraction > kellyMaxFraction {
		fraction = kellyMaxFraction
	}

	q := 1 - winRate
	fullKelly := (winRate*avgRR - q) / avgRR
	if fullKelly < 0 {
		fullKelly = 0
	}
	fractionalKelly := fullKelly * fraction

	maxRiskCap := 0.02
	if opts.MaxRiskPerTrade != nil {
		maxRiskCap = *opts.MaxRiskPerTrade
	}
	if maxRiskCap < kellyMinRiskCap {
		maxRiskCap = kellyMinRiskCap
	}
	if maxRiskCap > kellyMaxRiskCap {
		maxRiskCap = kellyMaxRiskCap
	}

	suggested := fractionalKelly
	if suggested > maxRiskCap {
		suggested = maxRiskCap
	}

	return &KellySizing{
		Method: kellyMethod, FullKelly: fullKelly, Fraction: fraction, FractionalKelly: fractionalKelly,
		SuggestedRiskPerTrade: suggested, MaxRiskCap: maxRiskCap, Capped: fractionalKelly > maxRiskCap,
	}
}
