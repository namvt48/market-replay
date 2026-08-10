package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// maxPreferencePayload bounds one stored setting. Saved chart layouts are
// the largest of them at a few KB; this leaves room to grow while keeping a
// malformed or hostile client from writing an unbounded blob into SQLite.
const maxPreferencePayload = 256 << 10

// validPreferenceKey keeps keys to the namespaced form the client already
// uses ("market-replay:chart-layout"). Validating at the boundary means the
// storage layer never sees a key it would have to sanitise.
func validPreferenceKey(key string) bool {
	if key == "" || len(key) > 128 {
		return false
	}
	for _, r := range key {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == ':' || r == '-' || r == '_' || r == '.':
		default:
			return false
		}
	}
	return true
}

// handleListPreferences serves GET /api/v1/preferences — every stored
// workspace setting at once, so the client can hydrate before it renders
// rather than issuing one request per setting.
func (s *Server) handleListPreferences(w http.ResponseWriter, r *http.Request) {
	prefs, err := s.Store.ListPreferences(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	// No caching: these change from this same client, and a stale hydrate
	// would silently roll a setting back.
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, prefs)
}

// handlePutPreference serves PUT /api/v1/preferences/{key}. The body is the
// setting's JSON document, stored verbatim — the server deliberately does
// not interpret the shape of a colour scheme or a pane layout, so adding a
// setting never needs a backend change.
func (s *Server) handlePutPreference(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if !validPreferenceKey(key) {
		writeError(w, fmt.Errorf("%w: invalid preference key", errBadRequest))
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxPreferencePayload+1))
	if err != nil {
		writeError(w, fmt.Errorf("%w: could not read body: %v", errBadRequest, err))
		return
	}
	if len(body) > maxPreferencePayload {
		writeError(w, fmt.Errorf("%w: preference payload exceeds %d bytes", errBadRequest, maxPreferencePayload))
		return
	}
	// Opaque to the server, but still has to be valid JSON: storing a
	// malformed document would only fail later, on a read, with no way to
	// tell which write broke it.
	if !json.Valid(body) {
		writeError(w, fmt.Errorf("%w: preference payload is not valid JSON", errBadRequest))
		return
	}
	if err := s.Store.SetPreference(r.Context(), key, json.RawMessage(body)); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleDeletePreference serves DELETE /api/v1/preferences/{key}, for a
// client resetting a setting back to its default.
func (s *Server) handleDeletePreference(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if !validPreferenceKey(key) {
		writeError(w, fmt.Errorf("%w: invalid preference key", errBadRequest))
		return
	}
	if err := s.Store.DeletePreference(r.Context(), key); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
