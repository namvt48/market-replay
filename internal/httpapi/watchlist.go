package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
)

func (s *Server) handleGetWatchlist(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.GetWatchlist(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handlePutWatchlist serves PUT /api/v1/watchlist, replacing the whole
// list. Every symbol is validated against the registry's known symbols
// first — fail-fast on garbage rather than silently accepting a symbol
// that can never resolve to real data.
func (s *Server) handlePutWatchlist(w http.ResponseWriter, r *http.Request) {
	var symbols []string
	if err := json.NewDecoder(r.Body).Decode(&symbols); err != nil {
		writeError(w, fmt.Errorf("%w: invalid JSON body: %v", errBadRequest, err))
		return
	}

	known := make(map[string]bool)
	for _, meta := range s.Registry.Symbols() {
		known[meta.Symbol] = true
	}
	var unknown []string
	for _, sym := range symbols {
		if !known[sym] {
			unknown = append(unknown, sym)
		}
	}
	if len(unknown) > 0 {
		writeError(w, fmt.Errorf("%w: unknown symbol(s): %v", errBadRequest, unknown))
		return
	}

	if err := s.Store.SetWatchlist(r.Context(), symbols); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, symbols)
}
