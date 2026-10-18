package analytics

// kellyMethod identifies the supported binary average-payoff approximation.
const kellyMethod = "binary-payoff-kelly-approximation"

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

// CalculateKellySizing returns a fractional binary-payoff Kelly approximation,
// requiring an observed positive win and loss plus every edge and OOS gate.
// It is not exact Kelly for arbitrary return distributions.
func CalculateKellySizing(edge EdgeStats, opts KellyOptions) *KellySizing {
	if edge.Verdict != EdgeVerdictEdge || edge.AvgRR == nil || *edge.AvgRR <= 0 || edge.AvgWinR <= 0 || edge.AvgLossR <= 0 || edge.WinRate <= 0 || edge.LossRate <= 0 {
		return nil
	}
	avgWinR, avgLossR := edge.AvgWinR, edge.AvgLossR
	winRate := edge.WinRate / (edge.WinRate + edge.LossRate)

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
	fullKelly := winRate/avgLossR - q/avgWinR
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
