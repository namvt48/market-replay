package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"

	"market-replay/internal/analytics"
)

type rrSimulationRequestBody struct {
	SourceType          string    `json:"sourceType"`
	SourceID            string    `json:"sourceId"`
	TargetsR            []float64 `json:"targetsR"`
	IncludeCurrentModel *bool     `json:"includeCurrentModel"`
}

// rrSimulationResponse composes the "source" envelope with the computed
// simulation result, same flattening trick as analyticsPerformanceResponse.
type rrSimulationResponse struct {
	Source analytics.SimSourceSummary `json:"source"`
	analytics.RRSimulationResult
}

// handleSimulationRiskReward serves
// POST /api/v1/analytics/simulations/risk-reward.
func (s *Server) handleSimulationRiskReward(w http.ResponseWriter, r *http.Request) {
	raw, err := readLimitedBody(r, maxSimulationPayload)
	if err != nil {
		writeError(w, err)
		return
	}
	var body rrSimulationRequestBody
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
	targets, err := dedupeFiniteInRange(body.TargetsR, 0.1, 50, 20, "targetsR")
	if err != nil {
		writeError(w, err)
		return
	}
	includeCurrentModel := true
	if body.IncludeCurrentModel != nil {
		includeCurrentModel = *body.IncludeCurrentModel
	}

	sess, trades, err := loadSourceTrades(r.Context(), s.Store, body.SourceType, body.SourceID)
	if err != nil {
		writeErrorRespectingCancellation(w, err)
		return
	}

	result, err := analytics.BuildRRSimulation(r.Context(), analytics.RRSimulationRequest{
		Trades:              trades,
		Timeframe:           sess.Tf,
		InitialBalanceCents: analytics.ResolveInitialBalanceCents(sess, trades),
		MarketData:          &barsMarketData{registry: s.Registry},
		TargetsR:            targets,
		IncludeCurrentModel: includeCurrentModel,
	})
	if err != nil {
		writeErrorRespectingCancellation(w, err)
		return
	}

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, rrSimulationResponse{
		Source:             analytics.BuildSimSourceSummary(sess, trades),
		RRSimulationResult: result,
	})
}
