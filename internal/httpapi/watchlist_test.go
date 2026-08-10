package httpapi

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleWatchlist_RoundTrip(t *testing.T) {
	s := newTestServer(t)

	putReq := httptest.NewRequest(http.MethodPut, "/api/v1/watchlist", bytes.NewBufferString(`["NQ"]`))
	putRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(putRec, putReq)
	if putRec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, body = %s", putRec.Code, putRec.Body.String())
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/watchlist", nil)
	getRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("GET status = %d, body = %s", getRec.Code, getRec.Body.String())
	}
	if got := getRec.Body.String(); got != "[\"NQ\"]\n" {
		t.Errorf("GET body = %q, want [\"NQ\"]", got)
	}
}

func TestHandleWatchlist_UnknownSymbolRejected(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodPut, "/api/v1/watchlist", bytes.NewBufferString(`["NQ","ZZZZ"]`))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("ZZZZ")) {
		t.Errorf("error body doesn't name the unknown symbol: %s", rec.Body.String())
	}

	// The rejected PUT must not have partially applied.
	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/watchlist", nil)
	getRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(getRec, getReq)
	if got := getRec.Body.String(); got != "[]\n" {
		t.Errorf("watchlist = %q after rejected PUT, want still empty", got)
	}
}

func TestHandleWatchlist_EmptyByDefault(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/watchlist", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Body.String(); got != "[]\n" {
		t.Errorf("body = %q, want []", got)
	}
}
