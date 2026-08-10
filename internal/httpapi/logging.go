package httpapi

import (
	"log"
	"net/http"
	"time"
)

// statusRecorder captures the status code an inner handler wrote, since
// http.ResponseWriter itself doesn't expose it after the fact.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// withLogging logs method, path, status, and duration for every request.
// This is the only observability the server has (no metrics/tracing
// stack exists for a single-user app) — cheap enough to always run, and
// "no silent failures" applies to requests too: an operator with no other
// visibility should at least see this in the service's stdout/journal.
func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rec.status, time.Since(start))
	})
}
