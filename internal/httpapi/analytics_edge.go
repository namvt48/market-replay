package httpapi

import (
	"fmt"
	"math"
	"net/http"

	"market-replay/internal/analytics"
)

// Edge report query bounds and defaults (doc: confidence [0.80,0.99]
// default 0.90; bootstrapIterations [1000,50000] default 10000; seed has a
// FIXED default — never the current time — so an omitted seed still
// produces a byte-stable, reproducible report for a given trade set).
const (
	edgeMinConfidence              = 0.80
	edgeMaxConfidence              = 0.99
	edgeDefaultConfidence          = 0.90
	edgeMinBootstrapIterations     = 1000
	edgeMaxBootstrapIterations     = 50000
	edgeDefaultBootstrapIterations = 10000
	edgeDefaultSeed                = 20250816
)

// handleAnalyticsEdge serves
// GET /api/v1/analytics/edge?sourceType=&sourceId=&confidence=&bootstrapIterations=&seed=
//
// the "Edge" tab's backend: edge verdict, bootstrap confidence intervals,
// edge decomposition, walk-forward robustness (with a real OHLC re-walk
// sensitivity grid), and Kelly sizing, computed from one source's real
// closed trades.
func (s *Server) handleAnalyticsEdge(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()

	sourceType, err := requiredParam(query, "sourceType")
	if err != nil {
		writeError(w, err)
		return
	}
	sourceID, err := requiredParam(query, "sourceId")
	if err != nil {
		writeError(w, err)
		return
	}

	confidence, err := parseFloat64(query, "confidence", edgeDefaultConfidence)
	if err != nil {
		writeError(w, err)
		return
	}
	if math.IsNaN(confidence) || math.IsInf(confidence, 0) || confidence < edgeMinConfidence || confidence > edgeMaxConfidence {
		writeError(w, fmt.Errorf("%w: confidence must be a finite number in [%v,%v]", errBadRequest, edgeMinConfidence, edgeMaxConfidence))
		return
	}

	bootstrapIterations, err := parseInt64(query, "bootstrapIterations", edgeDefaultBootstrapIterations)
	if err != nil {
		writeError(w, err)
		return
	}
	if bootstrapIterations < edgeMinBootstrapIterations || bootstrapIterations > edgeMaxBootstrapIterations {
		writeError(w, fmt.Errorf("%w: bootstrapIterations must be an integer in [%d,%d]", errBadRequest, edgeMinBootstrapIterations, edgeMaxBootstrapIterations))
		return
	}

	seed, err := parseInt64(query, "seed", edgeDefaultSeed)
	if err != nil {
		writeError(w, err)
		return
	}

	sess, trades, err := loadSourceTrades(r.Context(), s.Store, sourceType, sourceID)
	if err != nil {
		writeErrorRespectingCancellation(w, err)
		return
	}
	if len(trades) == 0 {
		// "Source chưa có closed trade đủ điều kiện để tính report" — the
		// same typed 422 the stop-loss/RR simulators use for "nothing to
		// compute against" (analytics.ErrNoEligibleTrades), reused here
		// rather than inventing a second sentinel for the same condition.
		writeError(w, analytics.ErrNoEligibleTrades)
		return
	}

	iterations := int(bootstrapIterations)
	report, err := analytics.BuildEdgeReport(r.Context(), analytics.EdgeReportRequest{
		Session: sess, Trades: trades, MarketData: &barsMarketData{registry: s.Registry},
		Seed: seed,
		BootstrapOptions: analytics.BootstrapOptions{
			Iterations: &iterations,
			Confidence: &confidence,
		},
	})
	if err != nil {
		writeErrorRespectingCancellation(w, err)
		return
	}

	// Depends on the live trade journal, same reasoning as
	// handleAnalyticsPerformance's no-store.
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, report)
}
