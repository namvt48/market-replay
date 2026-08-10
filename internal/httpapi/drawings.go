package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"

	"market-replay/internal/model"
)

// handleUpsertDrawings serves POST /api/v1/drawings: a batch of
// upsert-or-tombstone deltas (docs §14.2). The client (drawing plugin)
// supplies each drawing's id — this is a delta-sync model, not a
// server-generated-id resource like sessions/trades.
func (s *Server) handleUpsertDrawings(w http.ResponseWriter, r *http.Request) {
	var deltas []model.Drawing
	if err := json.NewDecoder(r.Body).Decode(&deltas); err != nil {
		writeError(w, fmt.Errorf("%w: invalid JSON body: %v", errBadRequest, err))
		return
	}
	for _, d := range deltas {
		if d.ID == "" {
			writeError(w, fmt.Errorf("%w: every drawing delta needs an id", errBadRequest))
			return
		}
		if !validTimeframe(d.CreatedTf) {
			writeError(w, fmt.Errorf("%w: every drawing delta needs a valid createdTf", errBadRequest))
			return
		}
	}

	applied, err := s.Store.UpsertDrawings(r.Context(), deltas)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"applied": applied})
}

// handleListDrawings serves GET
// /api/v1/drawings?bucket=&symbol=&createdTf=&cursorTs=. createdTf is
// repeatable (docs §14.6's created_tf IN (...) filter); cursorTs is
// optional and its anti-spoiler effect only applies to "session:"
// buckets (model.DrawingFilter / storage layer enforces this, not here).
func (s *Server) handleListDrawings(w http.ResponseWriter, r *http.Request) {
	bucket, err := requiredParam(r, "bucket")
	if err != nil {
		writeError(w, err)
		return
	}
	symbol, err := requiredParam(r, "symbol")
	if err != nil {
		writeError(w, err)
		return
	}
	createdTf := r.URL.Query()["createdTf"]
	for _, timeframe := range createdTf {
		if !validTimeframe(timeframe) {
			writeError(w, fmt.Errorf("%w: invalid createdTf", errBadRequest))
			return
		}
	}

	var cursorTs *int64
	if raw := r.URL.Query().Get("cursorTs"); raw != "" {
		v, err := parseInt64Required(r, "cursorTs")
		if err != nil {
			writeError(w, err)
			return
		}
		cursorTs = &v
	}

	drawings, err := s.Store.ListDrawings(r.Context(), model.DrawingFilter{
		Bucket: bucket, Symbol: symbol, CreatedTf: createdTf, CursorTs: cursorTs,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, drawings)
}
