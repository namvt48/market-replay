package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"

	"market-replay/internal/analytics"
)

type stopLossSimulationRequestBody struct {
	SourceType        string    `json:"sourceType"`
	SourceID          string    `json:"sourceId"`
	ReductionsPercent []float64 `json:"reductionsPercent"`
}

// stopLossSimulationResponse composes the "source" envelope with the
// computed simulation result, same flattening trick as
// analyticsPerformanceResponse.
type stopLossSimulationResponse struct {
	Source analytics.SimSourceSummary `json:"source"`
	analytics.StopLossSimulationResult
}

// handleSimulationStopLoss serves
// POST /api/v1/analytics/simulations/stop-loss.
func (s *Server) handleSimulationStopLoss(w http.ResponseWriter, r *http.Request) {
	raw, err := readLimitedBody(r, maxSimulationPayload)
	if err != nil {
		writeError(w, err)
		return
	}
	var body stopLossSimulationRequestBody
	if err := json.Unmarshal(raw, &body); err != nil {
		writeError(w, fmt.Errorf("%w: invalid JSON body: %v", errBadRequest, err))
		return
	}
	if body.SourceType == "" {
		writeError(w, fmt.Errorf("%w: sourceType is required", errBadRequest))
		return
	}
	if body.SourceID == "" {
		writeError(w, fmt.Errorf("%w: sourceId is required", errBadRequest))
		return
	}
	// Input limit enforced before any trade lookup or simulation work.
	reductions, err := dedupeFiniteInRange(body.ReductionsPercent, 0, 95, 20, "reductionsPercent")
	if err != nil {
		writeError(w, err)
		return
	}

	sess, trades, err := loadSourceTrades(r.Context(), s.Store, body.SourceType, body.SourceID)
	if err != nil {
		writeErrorRespectingCancellation(w, err)
		return
	}

	result, err := analytics.BuildStopLossSimulation(r.Context(), analytics.StopLossRequest{
		Trades:              trades,
		Timeframe:           sess.Tf,
		InitialBalanceCents: analytics.ResolveInitialBalanceCents(sess, trades),
		MarketData:          &barsMarketData{registry: s.Registry},
		ReductionsPercent:   reductions,
	})
	if err != nil {
		writeErrorRespectingCancellation(w, err)
		return
	}

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, stopLossSimulationResponse{
		Source:                   analytics.BuildSimSourceSummary(sess, trades),
		StopLossSimulationResult: result,
	})
}
