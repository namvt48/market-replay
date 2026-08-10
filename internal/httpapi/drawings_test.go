package httpapi

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleUpsertDrawings(t *testing.T) {
	s := newTestServer(t)
	body := `[{"id":"d1","bucket":"global:NQ","symbol":"NQ","anchorTs":1000,"createdTf":"1m","payload":"{}"}]`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/drawings", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"applied":1`)) {
		t.Errorf("body = %s, want applied:1", rec.Body.String())
	}
}

func TestHandleUpsertDrawings_MissingID(t *testing.T) {
	s := newTestServer(t)
	body := `[{"bucket":"global:NQ","symbol":"NQ","anchorTs":1000,"createdTf":"1m","payload":"{}"}]`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/drawings", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleUpsertDrawings_InvalidTimeframe(t *testing.T) {
	s := newTestServer(t)
	body := `[{"id":"d1","bucket":"global:NQ","symbol":"NQ","anchorTs":1000,"createdTf":"13h","payload":"{}"}]`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/drawings", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleListDrawings_RoundTripAndAntiSpoiler(t *testing.T) {
	s := newTestServer(t)

	upsertBody := `[
		{"id":"d-session","bucket":"session:sess1","symbol":"NQ","anchorTs":2000,"createdTf":"1m","payload":"{}"},
		{"id":"d-global","bucket":"global:NQ","symbol":"NQ","anchorTs":2000,"createdTf":"1m","payload":"{}"}
	]`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/drawings", bytes.NewBufferString(upsertBody))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("upsert status = %d, body = %s", rec.Code, rec.Body.String())
	}

	// cursorTs=1000 is before anchorTs=2000: the session-bucket drawing
	// must be hidden (spoiler), the global-bucket one must still show.
	sessReq := httptest.NewRequest(http.MethodGet, "/api/v1/drawings?bucket=session:sess1&symbol=NQ&cursorTs=1000", nil)
	sessRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(sessRec, sessReq)
	if sessRec.Code != http.StatusOK {
		t.Fatalf("session GET status = %d, body = %s", sessRec.Code, sessRec.Body.String())
	}
	if sessRec.Body.String() != "[]\n" {
		t.Errorf("session bucket body = %q, want empty (anti-spoiler)", sessRec.Body.String())
	}

	globalReq := httptest.NewRequest(http.MethodGet, "/api/v1/drawings?bucket=global:NQ&symbol=NQ&cursorTs=1000", nil)
	globalRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(globalRec, globalReq)
	if globalRec.Code != http.StatusOK {
		t.Fatalf("global GET status = %d, body = %s", globalRec.Code, globalRec.Body.String())
	}
	if !bytes.Contains(globalRec.Body.Bytes(), []byte("d-global")) {
		t.Errorf("global bucket body = %s, want it to include d-global (global ignores cursorTs)", globalRec.Body.String())
	}
}

func TestHandleListDrawings_MissingParams(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/drawings?bucket=global:NQ", nil) // no symbol
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}
