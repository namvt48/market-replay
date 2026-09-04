package httpapi

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"

	"market-replay/internal/analytics"
	"market-replay/internal/model"
	"market-replay/internal/storage"
)

// loadSourceTrades resolves sourceType/sourceID to (session, its closed
// trades) — shared by every analytics endpoint that operates on a real
// source (performance, drawdown, the stop-loss/RR simulators). A
// sourceType that doesn't match the found session's actual kind 404s
// exactly as an unknown id would, so a client can never reach one
// source's data by asking for it under the other source type.
func loadSourceTrades(ctx context.Context, store storage.Store, sourceType, sourceID string) (model.Session, []model.Trade, error) {
	wantKind, ok := analytics.KindForSourceType(sourceType)
	if !ok {
		return model.Session{}, nil, fmt.Errorf("%w: sourceType must be %q, %q, or %q", errBadRequest, "session", "evaluation", string(analytics.SourceTypeLive))
	}
	sess, err := store.GetSession(ctx, sourceID)
	if err != nil {
		return model.Session{}, nil, err
	}
	if sess.Kind != wantKind {
		return model.Session{}, nil, storage.ErrSessionNotFound
	}
	trades, err := store.ListTrades(ctx, sourceID)
	if err != nil {
		return model.Session{}, nil, err
	}
	return sess, trades, nil
}

// handleAnalyticsSources serves GET /api/v1/analytics/sources — every
// session (replay, evaluation, or live alike, distinguished by
// model.Session.Kind) as one row, real vs. mock. No pagination: no list
// endpoint in this codebase has a cursor/limit convention yet (see
// internal/httpapi/sessions.go's handleListSessions), so none is invented
// here either.
func (s *Server) handleAnalyticsSources(w http.ResponseWriter, r *http.Request) {
	sessions, err := s.Store.ListSessions(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	items := make([]analytics.SourceListItem, 0, len(sessions))
	for _, sess := range sessions {
		trades, err := s.Store.ListTrades(r.Context(), sess.ID)
		if err != nil {
			writeError(w, err)
			return
		}
		items = append(items, analytics.BuildSourceListItem(sess, trades))
	}
	// Depends on every session's current trade journal, which grows as
	// replays/evaluations progress.
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// analyticsPerformanceResponse composes the "source" envelope with the
// computed report. Report is embedded anonymously (no json tag) so its
// fields promote to the top level, producing exactly
// {source, overview, equityCurve, riskReward, ...} in one flat object.
type analyticsPerformanceResponse struct {
	Source analytics.SourceSummary `json:"source"`
	analytics.Report
}

// handleAnalyticsPerformance serves
// GET /api/v1/analytics/performance?sourceType=&sourceId=&breakevenThreshold=&timezone=
//
//   - sourceType         required. "session" | "evaluation" | "live" — must
//     match the found session's actual kind, or this 404s exactly as an
//     unknown id would: a client must never be able to fetch one source's
//     data by supplying another source type for its id.
//   - sourceId           required.
//   - breakevenThreshold optional, defaults to 0. Dollars, same unit as
//     every other money field in this API's JSON.
//   - timezone           optional, defaults to UTC. IANA name.
func (s *Server) handleAnalyticsPerformance(w http.ResponseWriter, r *http.Request) {
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
	breakevenThreshold, err := parseFloat64(query, "breakevenThreshold", 0)
	if err != nil {
		writeError(w, err)
		return
	}
	loc, err := analytics.LoadLocation(query.Get("timezone"))
	if err != nil {
		writeError(w, analyticsRequestError(err))
		return
	}

	sess, trades, err := loadSourceTrades(r.Context(), s.Store, sourceType, sourceID)
	if err != nil {
		writeError(w, err)
		return
	}

	report, err := analytics.BuildReport(r.Context(), analytics.Request{
		Trades:                  trades,
		Symbol:                  sess.Symbol,
		Timeframe:               sess.Tf,
		InitialBalanceCents:     analytics.ResolveInitialBalanceCents(sess, trades),
		BreakevenThresholdCents: centsFromDollars(breakevenThreshold),
		Location:                loc,
		MarketData:              &barsMarketData{registry: s.Registry},
	})
	if err != nil {
		writeError(w, err)
		return
	}

	// Depends on the live trade journal and (for an active replay) the
	// cursor position, same reasoning as handleEconWeek's no-store.
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, analyticsPerformanceResponse{
		Source: analytics.BuildSourceSummary(sess, trades),
		Report: report,
	})
}

// centsFromDollars converts a query-supplied dollar amount to integer
// cents for comparison against model.Trade.RealizedCents. Rounded, not
// truncated, so e.g. 0.005 doesn't silently become a stricter threshold
// than the caller asked for.
func centsFromDollars(dollars float64) int64 {
	return int64(math.Round(dollars * 100))
}

// analyticsRequestError maps analytics' own input errors to 400 — an
// unknown timezone is the client asking for something impossible, not a
// server fault. Same shape as econ.go's econRequestError.
func analyticsRequestError(err error) error {
	if errors.Is(err, analytics.ErrUnknownTimeZone) {
		return fmt.Errorf("%w: %v", errBadRequest, err)
	}
	return err
}
