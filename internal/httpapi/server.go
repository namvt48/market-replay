// Package httpapi is the REST layer documented in docs §6.3: symbols,
// bars/bars-at/chunk/calendar (served from bars.Registry), sessions and
// their trade journals, and the watchlist (both from storage.Store), plus
// the embedded frontend's static files.
package httpapi

import (
	"io/fs"
	"net/http"
	"strings"

	"market-replay/internal/bars"
	"market-replay/internal/econ"
	"market-replay/internal/indicators"
	"market-replay/internal/storage"
)

// Server wires a bars.Registry and storage.Store into the HTTP API.
type Server struct {
	Registry *bars.Registry
	Store    storage.Store
	// Econ is the optional economic calendar. nil is fine: the endpoints then
	// report an unavailable calendar rather than failing, so an install with
	// no calendar data behaves exactly as it did before the feature existed.
	Econ *econ.Store
	// Indicators runs registered indicator scripts against bars.Registry
	// data. Never nil in practice (cmd/server always constructs and
	// registers built-ins into one before wiring the Server).
	Indicators *indicators.Engine
	WebFS      fs.FS // static frontend files; nil is fine (no "/" route registered), used in tests
}

// Handler builds the *http.ServeMux for this Server. Go 1.22+'s enhanced
// ServeMux prefers the more specific literal pattern (e.g.
// "/api/v1/sessions") over a wildcard for the same prefix, so registration
// order here doesn't matter.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", s.handleHealthz)

	mux.HandleFunc("GET /api/v1/symbols", s.handleSymbols)
	mux.HandleFunc("GET /api/v1/bars", s.handleBars)
	mux.HandleFunc("GET /api/v1/bars/at", s.handleBarsAt)
	mux.HandleFunc("GET /api/v1/chart-bars/at", s.handleChartBarsAt)
	mux.HandleFunc("GET /api/v1/calendar", s.handleCalendar)

	mux.HandleFunc("POST /api/v1/sessions", s.handleCreateSession)
	mux.HandleFunc("GET /api/v1/sessions", s.handleListSessions)
	mux.HandleFunc("GET /api/v1/sessions-deleted", s.handleListDeletedSessions)
	mux.HandleFunc("DELETE /api/v1/sessions", s.handleDeleteEmptySessions)
	mux.HandleFunc("POST /api/v1/sessions/{id}/restore", s.handleRestoreSession)
	mux.HandleFunc("DELETE /api/v1/sessions/{id}/permanent", s.handlePermanentlyDeleteSession)
	mux.HandleFunc("PATCH /api/v1/sessions/{id}", s.handlePatchSession)
	mux.HandleFunc("DELETE /api/v1/sessions/{id}", s.handleDeleteSession)
	mux.HandleFunc("PUT /api/v1/sessions/{id}/trades", s.handleReplaceTrades)
	mux.HandleFunc("GET /api/v1/sessions/{id}/trades", s.handleListTrades)

	mux.HandleFunc("GET /api/v1/watchlist", s.handleGetWatchlist)
	mux.HandleFunc("PUT /api/v1/watchlist", s.handlePutWatchlist)

	mux.HandleFunc("POST /api/v1/drawings", s.handleUpsertDrawings)
	mux.HandleFunc("GET /api/v1/drawings", s.handleListDrawings)

	mux.HandleFunc("GET /api/v1/econ/meta", s.handleEconMeta)
	mux.HandleFunc("GET /api/v1/econ/week", s.handleEconWeek)

	mux.HandleFunc("GET /api/v1/analytics/sources", s.handleAnalyticsSources)
	mux.HandleFunc("GET /api/v1/analytics/performance", s.handleAnalyticsPerformance)
	mux.HandleFunc("GET /api/v1/analytics/drawdown", s.handleAnalyticsDrawdown)
	mux.HandleFunc("POST /api/v1/analytics/simulations/stop-loss", s.handleSimulationStopLoss)
	mux.HandleFunc("POST /api/v1/analytics/simulations/risk-reward", s.handleSimulationRiskReward)
	mux.HandleFunc("POST /api/v1/analytics/simulations/monte-carlo", s.handleSimulationMonteCarlo)
	mux.HandleFunc("GET /api/v1/analytics/edge", s.handleAnalyticsEdge)
	mux.HandleFunc("GET /api/v1/analytics/execution-discipline", s.handleAnalyticsExecution)

	mux.HandleFunc("GET /api/v1/preferences", s.handleListPreferences)
	mux.HandleFunc("PUT /api/v1/preferences/{key}", s.handlePutPreference)
	mux.HandleFunc("DELETE /api/v1/preferences/{key}", s.handleDeletePreference)

	mux.HandleFunc("GET /api/v1/drawing-templates", s.handleListDrawingTemplates)
	mux.HandleFunc("PUT /api/v1/drawing-templates/{id}", s.handlePutDrawingTemplate)
	mux.HandleFunc("DELETE /api/v1/drawing-templates/{id}", s.handleDeleteDrawingTemplate)

	mux.HandleFunc("PUT /api/v1/workspace-snapshots/{ownerType}/{ownerId}", s.handlePutWorkspaceSnapshot)
	mux.HandleFunc("GET /api/v1/workspace-snapshots/{ownerType}/{ownerId}", s.handleGetWorkspaceSnapshot)
	mux.HandleFunc("DELETE /api/v1/workspace-snapshots/{ownerType}/{ownerId}", s.handleDeleteWorkspaceSnapshot)

	mux.HandleFunc("GET /api/v1/indicators", s.handleListIndicators)
	mux.HandleFunc("POST /api/v1/indicators/run", s.handleRunIndicator)

	if s.WebFS != nil {
		mux.Handle("GET /", withStaticCacheControl(http.FileServerFS(s.WebFS)))

		// Client-side screens under /start/ (e.g. /start/eval) have no
		// backing static file, so serve the SPA shell (index.html) and let
		// the frontend router render the screen. Go 1.22+'s ServeMux picks
		// the most specific pattern, so the literal /start/eval wins over
		// /start/, and both beat the "/" wildcard regardless of order.
		mux.HandleFunc("GET /start/eval", s.handleSPA)
		mux.HandleFunc("GET /start/", s.handleSPA)
	}

	return withCompression(withLogging(mux))
}

// withStaticCacheControl sets a caching policy for the embedded frontend's
// static files. Vite fingerprints everything under /assets/ with a content
// hash (index-<hash>.js), so those files never change under a given URL —
// safe to cache for a year. Everything else (index.html, favicon.svg) has a
// stable URL whose content *can* change on the next deploy, so it must be
// revalidated every time; without this, http.FileServerFS has nothing to
// key a cache on anyway, since go:embed strips file mtimes (no
// Last-Modified/ETag), so browsers would otherwise fall back to
// unpredictable heuristic caching.
func withStaticCacheControl(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		next.ServeHTTP(w, r)
	})
}

// handleSPA serves the embedded frontend's index.html for SPA routes that
// have no backing static file. On a missing/invalid WebFS index, it 404s.
// Never cacheable, same reasoning as withStaticCacheControl's non-/assets/
// branch — this literally serves index.html's bytes under a different URL.
func (s *Server) handleSPA(w http.ResponseWriter, r *http.Request) {
	index, err := fs.ReadFile(s.WebFS, "index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	w.Write(index)
}
