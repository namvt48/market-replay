package httpapi

import (
	"fmt"
	"math"
)

// maxSimulationPayload bounds every simulation POST body (stop-loss, RR,
// Monte Carlo) — each is a handful of scalars or a short float list, never
// anywhere near preferences.go's own limit. A var, not a const, so
// ApplyLimits (limits.go) can override it from config.yaml's
// limits.simulation_payload_bytes at startup.
var maxSimulationPayload = 64 << 10

// dedupeFiniteInRange validates a scenario/target list shared by the
// stop-loss and RR simulator requests: 1-count items, each a finite number
// in [lo,hi], duplicates dropped while keeping the first occurrence's
// position (rule: "loại duplicate nhưng giữ thứ tự request đầu tiên").
func dedupeFiniteInRange(values []float64, lo, hi float64, count int, fieldName string) ([]float64, error) {
	if len(values) == 0 {
		return nil, fmt.Errorf("%w: %s must have at least 1 value", errBadRequest, fieldName)
	}
	if len(values) > count {
		return nil, fmt.Errorf("%w: %s must have at most %d values", errBadRequest, fieldName, count)
	}
	seen := make(map[float64]bool, len(values))
	out := make([]float64, 0, len(values))
	for _, v := range values {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return nil, fmt.Errorf("%w: %s values must be finite numbers", errBadRequest, fieldName)
		}
		if v < lo || v > hi {
			return nil, fmt.Errorf("%w: %s value %v is outside [%v,%v]", errBadRequest, fieldName, v, lo, hi)
		}
		if seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out, nil
}
