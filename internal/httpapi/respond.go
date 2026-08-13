package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"market-replay/internal/bars"
	"market-replay/internal/indicators"
	"market-replay/internal/storage"
)

// errBadRequest is the sentinel every hand-constructed validation error in
// this package wraps, so writeError can tell "client sent something
// malformed" (400) apart from "server-side failure" (500) via errors.Is,
// the same pattern gex-dashboard uses for its own sentinel chain.
var errBadRequest = errors.New("httpapi: bad request")

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError maps a domain error to an HTTP status: "client asked for
// something that doesn't exist" (bars.ErrUnknownSymbolTF,
// storage.ErrSessionNotFound -> 404), "client sent a malformed request"
// (errBadRequest -> 400), or an opaque 500 for anything else — callers
// get a real status code, never a 200 wrapping a missing result.
func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, bars.ErrUnknownSymbolTF), errors.Is(err, storage.ErrSessionNotFound), errors.Is(err, indicators.ErrUnknownScript):
		status = http.StatusNotFound
	case errors.Is(err, errBadRequest), errors.Is(err, indicators.ErrInvalidInput):
		status = http.StatusBadRequest
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
