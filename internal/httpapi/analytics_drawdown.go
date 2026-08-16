package httpapi

import (
	"net/http"

	"market-replay/internal/analytics"
)

// analyticsDrawdownResponse composes the "source" envelope with the
// computed drawdown report, same flattening trick as
// analyticsPerformanceResponse.
type analyticsDrawdownResponse struct {
	Source analytics.SourceSummary `json:"source"`
	analytics.DrawdownReport
}

// handleAnalyticsDrawdown serves
// GET /api/v1/analytics/drawdown?sourceType=&sourceId=
//
// sourceType/sourceId follow the same required/validated/404-on-mismatch
// rules as handleAnalyticsPerformance (loadSourceTrades).
func (s *Server) handleAnalyticsDrawdown(w http.ResponseWriter, r *http.Request) {
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

	sess, trades, err := loadSourceTrades(r.Context(), s.Store, sourceType, sourceID)
	if err != nil {
		writeErrorRespectingCancellation(w, err)
		return
	}

	report, err := analytics.BuildDrawdownReport(r.Context(), analytics.Request{
		Trades:              trades,
		Symbol:              sess.Symbol,
		Timeframe:           sess.Tf,
		InitialBalanceCents: analytics.ResolveInitialBalanceCents(sess, trades),
		MarketData:          &barsMarketData{registry: s.Registry},
	})
	if err != nil {
		writeErrorRespectingCancellation(w, err)
		return
	}

	// Depends on the live trade journal, same reasoning as
	// handleAnalyticsPerformance's no-store.
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, analyticsDrawdownResponse{
		Source:         analytics.BuildSourceSummary(sess, trades),
		DrawdownReport: report,
	})
}
