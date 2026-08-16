// Package analytics: this file holds math shared by the "decision
// intelligence" modules (edgestat.go, decomposition.go, bootstrap.go,
// walkforward.go, kelly.go, execution_quality.go, decision_quality.go,
// tilt.go). Every formula here is a direct port of the already-built,
// already-tested TypeScript reference in web/src/fill-engine/ (edge-stat.ts,
// bootstrap.ts, ...) — that TS is this round's canon, chosen and reviewed
// before this Go port existed, so the math is reproduced faithfully rather
// than re-derived.
package analytics

import (
	"math"
	"sort"

	"market-replay/internal/model"
)

// TradeRValues sorts trades into stable closed-trade order (sortClosedTrades)
// and extracts each trade's finite RMultiple alongside its ExitTs — the
// (r, exitTs) pair EdgeStats/Bootstrap/WalkForward all consume. A trade
// with no RMultiple, or a non-finite one, is skipped rather than
// substituted with a fabricated value.
func TradeRValues(trades []model.Trade) (r []float64, exitTs []int64) {
	sorted := sortClosedTrades(trades)
	for _, t := range sorted {
		if t.RMultiple == nil {
			continue
		}
		v := *t.RMultiple
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		r = append(r, v)
		exitTs = append(exitTs, t.ExitTs)
	}
	return r, exitTs
}

func average(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	var sum float64
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}

// sampleStdDev is the (n-1)-denominator sample standard deviation used by
// edge-stat.ts (variance), bootstrap.ts (sharpe), and tilt.ts
// (standardDeviation) alike — one implementation, reused everywhere the TS
// reference reimplements it locally.
func sampleStdDev(values []float64) float64 {
	n := len(values)
	if n < 2 {
		return 0
	}
	mean := average(values)
	var sumSq float64
	for _, v := range values {
		d := v - mean
		sumSq += d * d
	}
	variance := sumSq / float64(n-1)
	if variance < 0 {
		variance = 0
	}
	return math.Sqrt(variance)
}

// quantile linearly interpolates the value at percentile (0..1) within an
// already-ascending-sorted slice — a direct port of bootstrap.ts' quantile.
func quantile(sorted []float64, percentile float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	position := percentile * float64(len(sorted)-1)
	if position < 0 {
		position = 0
	}
	if max := float64(len(sorted) - 1); position > max {
		position = max
	}
	lower := int(position)
	upper := lower
	if frac := position - float64(lower); frac > 0 {
		upper = lower + 1
		if upper > len(sorted)-1 {
			upper = len(sorted) - 1
		}
	}
	weight := position - float64(lower)
	return sorted[lower]*(1-weight) + sorted[upper]*weight
}

// confidenceIntervalOf sorts values and reports the [tail, median, 1-tail]
// quantiles for confidence — a direct port of bootstrap.ts' interval().
func confidenceIntervalOf(values []float64, confidence float64) ConfidenceInterval {
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	tail := (1 - confidence) / 2
	return ConfidenceInterval{
		Lower:  quantile(sorted, tail),
		Median: quantile(sorted, 0.5),
		Upper:  quantile(sorted, 1-tail),
	}
}

// maxDrawdownOfSeries is the cumulative peak-to-trough minimum of values
// treated as a sequence of increments (e.g. per-trade R) — a direct port
// of bootstrap.ts' maxDrawdown(), reusing this package's own drawdownSeries
// (originally written for the Drawdown API/simulators) on the cumulative
// sum instead of duplicating the peak-tracking loop.
func maxDrawdownOfSeries(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	cumulative := make([]float64, len(values))
	var running float64
	for i, v := range values {
		running += v
		cumulative[i] = running
	}
	// drawdownSeries expects the running peak to start at the first point;
	// bootstrap.ts starts its peak at 0 (before any increment), so prepend
	// a synthetic 0 point the same way the equity curve's index 0 does.
	withZero := append([]float64{0}, cumulative...)
	_, amount, _ := drawdownSeries(withZero)
	minimum := 0.0
	for _, a := range amount {
		if a < minimum {
			minimum = a
		}
	}
	return minimum
}

// seededRandom is a direct port of bootstrap.ts' seededRandom: a 32-bit LCG
// (state*1664525+1013904223 mod 2^32) whose output sequence is bit-for-bit
// identical to the TS version for the same seed, since Go's uint32
// wraparound multiplication matches JS's `>>> 0` truncation exactly at
// these magnitudes (max intermediate value ~7.1e15, still exact in a
// float64/JS-number mantissa).
type seededRandom struct{ state uint32 }

func newSeededRandom(seed int64) *seededRandom {
	return &seededRandom{state: uint32(seed)}
}

func (r *seededRandom) next() float64 {
	r.state = r.state*1_664_525 + 1_013_904_223
	return float64(r.state) / 4_294_967_296
}
