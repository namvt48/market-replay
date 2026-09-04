package httpapi

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestHandleStartEval(t *testing.T) {
	fsys := fstest.MapFS{"index.html": {Data: []byte("<html>eval shell</html>")}}
	s := &Server{WebFS: fsys}

	req := httptest.NewRequest(http.MethodGet, "/start/eval", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "text/html" {
		t.Errorf("Content-Type = %q, want text/html", got)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("eval shell")) {
		t.Errorf("body missing index.html content: %s", rec.Body.String())
	}
}

func TestHandleStartFallback(t *testing.T) {
	fsys := fstest.MapFS{"index.html": {Data: []byte("<html>eval shell</html>")}}
	s := &Server{WebFS: fsys}

	for _, path := range []string{"/start/eval", "/start/other", "/start/setup/step2"} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			s.Handler().ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestHandleAnalyticsFallback(t *testing.T) {
	fsys := fstest.MapFS{"index.html": {Data: []byte("<html>analytics shell</html>")}}
	s := &Server{WebFS: fsys}

	for _, path := range []string{"/analytics", "/analytics/overview"} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			s.Handler().ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
			}
			if !bytes.Contains(rec.Body.Bytes(), []byte("analytics shell")) {
				t.Fatalf("body missing analytics shell: %s", rec.Body.String())
			}
		})
	}
}

func TestHandleStartEval_NilWebFS(t *testing.T) {
	s := &Server{} // WebFS nil -> /start routes not registered, no panic

	req := httptest.NewRequest(http.MethodGet, "/start/eval", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

// TestHandleRootStaticFile guards the pre-existing FileServerFS route: the
// /start fallbacks must not break GET / serving index.html.
func TestHandleRootStaticFile(t *testing.T) {
	fsys := fstest.MapFS{"index.html": {Data: []byte("<html>app shell</html>")}}
	s := &Server{WebFS: fsys}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("app shell")) {
		t.Errorf("body missing index.html content: %s", rec.Body.String())
	}
}
