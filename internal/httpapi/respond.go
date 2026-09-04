package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"market-replay/internal/analytics"
	"market-replay/internal/bars"
	"market-replay/internal/indicators"
	"market-replay/internal/storage"
)

// statusClientClosedRequest is nginx's de facto "client closed the request"
// status (499) — not an IANA-registered code, but Go's http.ResponseWriter
// accepts any integer status, and it is the conventional way to distinguish
// a canceled/disconnected client from a genuine server failure in logs and
// metrics, so a canceled request doesn't read as a noisy 500.
const statusClientClosedRequest = 499

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
	// storage.ErrJournalImageNotFound maps in the 404 clause so the image
	// GET/DELETE handlers use this canonical {"error": ...} shape with the
	// sentinel's message, not a per-feature helper.
	switch {
	case errors.Is(err, bars.ErrUnknownSymbolTF), errors.Is(err, storage.ErrSessionNotFound), errors.Is(err, indicators.ErrUnknownScript), errors.Is(err, storage.ErrWorkspaceSnapshotNotFound), errors.Is(err, storage.ErrJournalImageNotFound):
		status = http.StatusNotFound
	case errors.Is(err, errBadRequest), errors.Is(err, indicators.ErrInvalidInput), errors.Is(err, storage.ErrDrawingTemplateNameTaken):
		status = http.StatusBadRequest
	case errors.Is(err, analytics.ErrNoEligibleTrades):
		status = http.StatusUnprocessableEntity
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

// writeErrorRespectingCancellation is writeError, except it separates the
// two ways a request context ends early: the client disconnecting
// (context.Canceled) writes 499 — the client is already gone, so this is
// not a server failure worth paging on, and no response body is meaningful
// to send. A context deadline expiring (context.DeadlineExceeded) is a
// distinct condition — the server itself failed to finish in time — and
// writes 504 instead, so the two are never conflated in logs or alerting.
func writeErrorRespectingCancellation(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, context.Canceled):
		w.WriteHeader(statusClientClosedRequest)
	case errors.Is(err, context.DeadlineExceeded):
		w.WriteHeader(http.StatusGatewayTimeout)
	default:
		writeError(w, err)
	}
}
