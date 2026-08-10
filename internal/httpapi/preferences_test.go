package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func putPreference(t *testing.T, s *Server, key, payload string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/preferences/"+key, bytes.NewBufferString(payload))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func TestPreferences_RoundTripAndOverwrite(t *testing.T) {
	s := newTestServer(t)

	if rec := putPreference(t, s, "market-replay:chart-layout", `{"version":1,"preset":"4"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("put status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if rec := putPreference(t, s, "market-replay:drawing-favorites:v1", `["trend-line","rectangle"]`); rec.Code != http.StatusNoContent {
		t.Fatalf("put status = %d, body = %s", rec.Code, rec.Body.String())
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/preferences", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var prefs map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &prefs); err != nil {
		t.Fatalf("decode list: %v (body %s)", err, rec.Body.String())
	}
	if len(prefs) != 2 {
		t.Fatalf("len(prefs) = %d, want 2: %s", len(prefs), rec.Body.String())
	}
	// Stored verbatim: the server must not reshape a document it does not
	// interpret, or a round trip would silently rewrite the client's state.
	if string(prefs["market-replay:drawing-favorites:v1"]) != `["trend-line","rectangle"]` {
		t.Errorf("payload round-tripped as %s", prefs["market-replay:drawing-favorites:v1"])
	}

	if rec := putPreference(t, s, "market-replay:chart-layout", `{"version":1,"preset":"single"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("overwrite status = %d", rec.Code)
	}
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/preferences", nil)
	rec2 := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec2, req2)
	if err := json.Unmarshal(rec2.Body.Bytes(), &prefs); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if !bytes.Contains(prefs["market-replay:chart-layout"], []byte(`"single"`)) {
		t.Errorf("overwrite lost: %s", prefs["market-replay:chart-layout"])
	}
}

func TestPreferences_Delete(t *testing.T) {
	s := newTestServer(t)
	putPreference(t, s, "market-replay:chart-layout", `{"version":1}`)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/preferences/market-replay:chart-layout", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, body = %s", rec.Code, rec.Body.String())
	}
	// Deleting a key that was never stored is a no-op, not a 404: a client
	// resetting a setting it never synced has nothing to apologise for.
	rec2 := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec2, httptest.NewRequest(http.MethodDelete, "/api/v1/preferences/never-stored", nil))
	if rec2.Code != http.StatusNoContent {
		t.Fatalf("delete unknown status = %d", rec2.Code)
	}

	listRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(listRec, httptest.NewRequest(http.MethodGet, "/api/v1/preferences", nil))
	if strings.Contains(listRec.Body.String(), "chart-layout") {
		t.Errorf("deleted key still listed: %s", listRec.Body.String())
	}
}

func TestPreferences_RejectsBadInput(t *testing.T) {
	s := newTestServer(t)

	if rec := putPreference(t, s, "market-replay:chart-layout", `{"version":1`); rec.Code != http.StatusBadRequest {
		t.Errorf("malformed JSON status = %d, want 400", rec.Code)
	}
	// URL-legal but outside the namespaced charset the client uses.
	if rec := putPreference(t, s, "bad~key", `{}`); rec.Code != http.StatusBadRequest {
		t.Errorf("invalid key status = %d, want 400", rec.Code)
	}
	oversized := `{"blob":"` + strings.Repeat("x", maxPreferencePayload) + `"}`
	if rec := putPreference(t, s, "market-replay:huge", oversized); rec.Code != http.StatusBadRequest {
		t.Errorf("oversized payload status = %d, want 400", rec.Code)
	}
}

func TestPreferences_EmptyListIsAnObject(t *testing.T) {
	s := newTestServer(t)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/preferences", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	// `{}` and not `null`: the client iterates the result on boot.
	if got := strings.TrimSpace(rec.Body.String()); got != "{}" {
		t.Errorf("body = %s, want {}", got)
	}
}
