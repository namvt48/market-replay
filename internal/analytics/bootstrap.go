package analytics

import (
	"context"
)

// bootstrapCancellationCheckInterval is how often (in iterations) a long
// bootstrap run checks ctx for cancellation — frequent enough that a
// canceled request stops promptly, infrequent enough that the check
// itself is not the bottleneck at 50,000 iterations.
const bootstrapCancellationCheckInterval = 100

// ConfidenceInterval is a [Lower,Upper] interval around Median.
type ConfidenceInterval struct {
	Median float64 `json:"median"`
	Lower  float64 `json:"lower"`
	Upper  float64 `json:"upper"`
}

// BootstrapResult contains intervals for expectancy and cumulative-R
// drawdown. TradeRSharpe is the unannualized mean/sampling-standard-
// deviation ratio on trade R values, with a zero benchmark; it is nil when
// every bootstrap sample has undefined variance.
type BootstrapResult struct {
	ExpectancyR  ConfidenceInterval  `json:"expectancyR"`
	MaxDrawdownR ConfidenceInterval  `json:"maxDrawdownR"`
	TradeRSharpe *ConfidenceInterval `json:"tradeRSharpe"`
	Iterations   int                 `json:"iterations"`
	Confidence   float64             `json:"confidence"`
	Seed         int64               `json:"seed"`
}

// BootstrapOptions mirrors bootstrap.ts' BootstrapOptions, except Seed is
// always a concrete value here rather than optional: per policy P8, "no
// seed supplied" is resolved to a freshly generated one by the httpapi
// layer (same randomSeed() helper the Monte Carlo simulator uses) before
// this pure function ever runs — this package always knows, and always
// reports, the seed actually used.
type BootstrapOptions struct {
	Iterations *int
	Confidence *float64
	Seed       int64
}

const (
	bootstrapDefaultIterations = 10_000
	bootstrapMinIterations     = 100
	bootstrapMaxIterations     = 50_000
	bootstrapDefaultConfidence = 0.9
	bootstrapMinConfidence     = 0.5
	bootstrapMaxConfidence     = 0.99
)

func sharpeOf(values []float64) (float64, bool) {
	if len(values) < 2 {
		return 0, false
	}
	deviation := sampleStdDev(values)
	if deviation == 0 {
		return 0, false
	}
	return average(values) / deviation, true
}

// BootstrapAnalytics resamples values (with replacement) Iterations times,
// computing expectancy/maxDrawdown/sharpe on each resample, then reports
// the Confidence-level interval for each. Deterministic: the same
// values+Seed always produce byte-identical output. ctx is checked for
// cancellation every bootstrapCancellationCheckInterval iterations — a
// canceled request returns ctx.Err() promptly instead of finishing all
// 50,000 possible iterations first.
func BootstrapAnalytics(ctx context.Context, values []float64, opts BootstrapOptions) (BootstrapResult, error) {
	iterations := bootstrapDefaultIterations
	if opts.Iterations != nil {
		iterations = *opts.Iterations
	}
	if iterations < bootstrapMinIterations {
		iterations = bootstrapMinIterations
	}
	if iterations > bootstrapMaxIterations {
		iterations = bootstrapMaxIterations
	}

	confidence := bootstrapDefaultConfidence
	if opts.Confidence != nil {
		confidence = *opts.Confidence
	}
	if confidence < bootstrapMinConfidence {
		confidence = bootstrapMinConfidence
	}
	if confidence > bootstrapMaxConfidence {
		confidence = bootstrapMaxConfidence
	}

	r := finiteFloats(values)
	if len(r) == 0 {
		empty := ConfidenceInterval{}
		return BootstrapResult{
			ExpectancyR: empty, MaxDrawdownR: empty,
			Iterations: iterations, Confidence: confidence, Seed: opts.Seed,
		}, nil
	}

	rng := newSeededRandom(opts.Seed)
	expectancy := make([]float64, iterations)
	drawdown := make([]float64, iterations)
	sharpeValues := make([]float64, 0, iterations)
	sample := make([]float64, len(r))
	for iteration := 0; iteration < iterations; iteration++ {
		if iteration%bootstrapCancellationCheckInterval == 0 {
			if err := ctx.Err(); err != nil {
				return BootstrapResult{}, err
			}
		}
		for i := range sample {
			idx := int(rng.next() * float64(len(r)))
			if idx >= len(r) {
				idx = len(r) - 1
			}
			sample[i] = r[idx]
		}
		expectancy[iteration] = average(sample)
		drawdown[iteration] = maxDrawdownOfSeries(sample)
		if sharpe, ok := sharpeOf(sample); ok {
			sharpeValues = append(sharpeValues, sharpe)
		}
	}

	result := BootstrapResult{
		ExpectancyR:  confidenceIntervalOf(expectancy, confidence),
		MaxDrawdownR: confidenceIntervalOf(drawdown, confidence),
		Iterations:   iterations,
		Confidence:   confidence,
		Seed:         opts.Seed,
	}
	if len(sharpeValues) > 0 {
		interval := confidenceIntervalOf(sharpeValues, confidence)
		result.TradeRSharpe = &interval
	}
	return result, nil
}
