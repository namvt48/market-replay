package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func createTestSession(t *testing.T, s *Server) string {
	t.Helper()
	body := bytes.NewBufferString(`{"symbol":"NQ","tf":"1m","startTs":1600000000,"config":{"maxContracts":5}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", body)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create session status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["id"] == "" {
		t.Fatal("response missing id")
	}
	return resp["id"]
}

func TestHandleCreateSession(t *testing.T) {
	s := newTestServer(t)
	createTestSession(t, s)
}

func TestHandleCreateSession_MissingFields(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewBufferString(`{"startTs":1}`))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleCreateSession_CustomTimeframe(t *testing.T) {
	for _, timeframe := range []string{"5s", "15s", "30s", "45m", "1w", "2w", "1M", "3M"} {
		t.Run(timeframe, func(t *testing.T) {
			s := newTestServer(t)
			body := bytes.NewBufferString(`{"symbol":"NQ","tf":"` + timeframe + `","startTs":1,"config":{}}`)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", body)
			rec := httptest.NewRecorder()
			s.Handler().ServeHTTP(rec, req)
			if rec.Code != http.StatusCreated {
				t.Fatalf("status = %d, want 201, body = %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestHandleCreateSession_InvalidTimeframe(t *testing.T) {
	for _, timeframe := range []string{"0s", "7s", "60s", "0m", "1441m", "13h", "2d", "0w", "53w", "0M", "13M", "60M"} {
		t.Run(timeframe, func(t *testing.T) {
			s := newTestServer(t)
			body := bytes.NewBufferString(`{"symbol":"NQ","tf":"` + timeframe + `","startTs":1,"config":{}}`)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", body)
			rec := httptest.NewRecorder()
			s.Handler().ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestHandleListSessions(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(id)) {
		t.Errorf("list body missing created session id: %s", rec.Body.String())
	}
}

func TestHandlePatchSession(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+id, bytes.NewBufferString(`{"name":"  Opening range  ","cursorTs":1600000600,"equityCents":1000000}`))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	sess, err := s.Store.GetSession(req.Context(), id)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if sess.Name != "Opening range" {
		t.Fatalf("name = %q, want trimmed rename", sess.Name)
	}
}

func TestHandlePatchSession_RejectsInvalidName(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	tooLong := make([]byte, maxSessionNameRunes+1)
	for i := range tooLong {
		tooLong[i] = 'a'
	}
	body, err := json.Marshal(map[string]string{"name": string(tooLong)})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+id, bytes.NewReader(body))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandlePatchSession_NotFound(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/nope", bytes.NewBufferString(`{"cursorTs":1}`))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandlePatchSession_RejectsInvalidStatus(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+id, bytes.NewBufferString(`{"status":"running-ish"}`))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleReplaceAndListTrades(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)

	journal := `[{"id":"trade-1","symbol":"NQ","side":"long","qty":2,"entryTs":1000,"entryPriceTicks":80000,"exitTs":1300,"exitPriceTicks":80100,"realizedCents":50000,"feesCents":209,"mfeTicks":150,"maeTicks":-20,"createdAt":1300},{"id":"trade-2","symbol":"NQ","side":"short","qty":1,"entryTs":1400,"entryPriceTicks":80100,"exitTs":1500,"exitPriceTicks":80000,"realizedCents":-2500,"feesCents":209,"mfeTicks":10,"maeTicks":40,"createdAt":1500}]`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/sessions/"+id+"/trades", bytes.NewBufferString(journal))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("replace trades status = %d, body = %s", rec.Code, rec.Body.String())
	}

	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+id+"/trades", nil)
	rec2 := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("list trades status = %d, body = %s", rec2.Code, rec2.Body.String())
	}
	if !bytes.Contains(rec2.Body.Bytes(), []byte(`"realizedCents":50000`)) {
		t.Errorf("list body missing stored trade: %s", rec2.Body.String())
	}

	// A rewind sends a shorter journal; the dropped trade must not survive.
	rewound := `[{"id":"trade-1","symbol":"NQ","side":"long","qty":2,"entryTs":1000,"entryPriceTicks":80000,"exitTs":1300,"exitPriceTicks":80100,"realizedCents":50000,"feesCents":209,"mfeTicks":150,"maeTicks":-20,"createdAt":1300}]`
	req3 := httptest.NewRequest(http.MethodPut, "/api/v1/sessions/"+id+"/trades", bytes.NewBufferString(rewound))
	rec3 := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusOK {
		t.Fatalf("rewound replace status = %d, body = %s", rec3.Code, rec3.Body.String())
	}
	if bytes.Contains(rec3.Body.Bytes(), []byte(`"exitTs":1500`)) {
		t.Errorf("the dropped trade survived a shorter journal write: %s", rec3.Body.String())
	}
}

func TestHandleReplaceTrades_UnknownSession(t *testing.T) {
	s := newTestServer(t)
	// A well-formed journal, so the request reaches the existence check
	// rather than stopping at body validation.
	req := httptest.NewRequest(http.MethodPut, "/api/v1/sessions/nope/trades", bytes.NewBufferString(`[{"id":"trade-1","symbol":"NQ","side":"long","qty":1,"entryTs":1,"exitTs":2,"createdAt":2}]`))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleReplaceTrades_AcceptsPausedSession(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	patch := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+id, bytes.NewBufferString(`{"status":"paused"}`))
	patchRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(patchRec, patch)

	// The client checkpoints by firing the status patch and the journal write
	// together. Rejecting the write once the status has flipped dropped the
	// session's final journal, silently, because checkpoint errors are
	// swallowed on the client.
	journal := `[{"id":"trade-1","symbol":"NQ","side":"long","qty":1,"entryTs":1000,"entryPriceTicks":80000,"exitTs":1000,"exitPriceTicks":80100,"realizedCents":50000,"feesCents":100,"mfeTicks":10,"maeTicks":2,"createdAt":1000}]`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/sessions/"+id+"/trades", bytes.NewBufferString(journal))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"realizedCents":50000`)) {
		t.Errorf("journal not stored for a paused session: %s", rec.Body.String())
	}
}

func TestHandleDeleteSession(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/sessions/"+id, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204, body = %s", rec.Code, rec.Body.String())
	}

	second := httptest.NewRequest(http.MethodDelete, "/api/v1/sessions/"+id, nil)
	secondRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(secondRec, second)
	if secondRec.Code != http.StatusNotFound {
		t.Fatalf("second delete status = %d, want 404", secondRec.Code)
	}
}

func TestHandleDeleteEmptySessions(t *testing.T) {
	s := newTestServer(t)
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewBufferString(`{"symbol":"NQ","tf":"1m","startTs":1600000000,"config":{}}`))
	createRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", createRec.Code, createRec.Body.String())
	}
	// Startup/new-session shells are active and therefore protected until
	// explicitly paused, matching the production cleanup guard.
	sessionsReq := httptest.NewRequest(http.MethodGet, "/api/v1/sessions", nil)
	sessionsRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(sessionsRec, sessionsReq)
	var sessions []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(sessionsRec.Body.Bytes(), &sessions); err != nil || len(sessions) != 1 {
		t.Fatalf("decode sessions: %v, body=%s", err, sessionsRec.Body.String())
	}
	patch := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+sessions[0].ID, bytes.NewBufferString(`{"status":"paused"}`))
	patchRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(patchRec, patch)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/sessions?empty=true", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"deleted":1`)) {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}
