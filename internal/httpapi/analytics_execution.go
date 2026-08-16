package httpapi

import (
	"net/http"

	"market-replay/internal/analytics"
)

// defaultSpreadTicks/defaultSlippageTicks are the policy cost-model
// assumptions applied to every execution-discipline report — no persisted
// spread/slippage source exists per-symbol today, so these are fixed
// server-side defaults, not client-configurable query params (the doc's
// endpoint signature takes only sourceType/sourceId).
const (
	defaultSpreadTicks   = 0.25
	defaultSlippageTicks = 0.35
)

// handleAnalyticsExecution serves
// GET /api/v1/analytics/execution-discipline?sourceType=&sourceId=
//
// the "Execution & Discipline" tab's backend: execution quality (MFE
// percentile, capture ratio, cost-adjusted expectancy), decision quality
// (4-box process matrix, OHLC-re-walked rule-following dividend), and
// tilt/psychology, computed from one source's real closed trades.
func (s *Server) handleAnalyticsExecution(w http.ResponseWriter, r *http.Request) {
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
	if len(trades) == 0 {
		writeError(w, analytics.ErrNoEligibleTrades)
		return
	}

	report, err := analytics.BuildExecutionReport(r.Context(), analytics.ExecutionReportRequest{
		Session: sess, Trades: trades, MarketData: &barsMarketData{registry: s.Registry},
		CostModel: analytics.ExecutionCostModel{
			SpreadTicks:   defaultSpreadTicks,
			SlippageTicks: defaultSlippageTicks,
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
