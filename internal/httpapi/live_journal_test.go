package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreateLiveSession(t *testing.T) {
	s := newTestServer(t)
	body, _ := json.Marshal(map[string]any{
		"symbol": "LIVE", "tf": "1d", "startTs": 1700000000000,
		"kind": "live", "initialBalanceCents": 1000000, "name": "Month 1",
	})
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewBuffer(body)))
	// handleCreateSession returns 201 Created for every successful create
	// (see internal/httpapi/sessions.go), not 200.
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST live session = %d, want 201; body: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || out.ID == "" {
		t.Fatalf("unmarshal response: %v body=%s", err, rec.Body.String())
	}
}

func TestCreateSessionRejectsUnknownKind(t *testing.T) {
	s := newTestServer(t)
	body, _ := json.Marshal(map[string]any{"symbol": "LIVE", "tf": "1d", "startTs": 1700000000000, "kind": "mars"})
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewBuffer(body)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST unknown kind = %d, want 400", rec.Code)
	}
}

func TestAnalyticsSourcesIncludeLive(t *testing.T) {
	s := newTestServer(t)
	body, _ := json.Marshal(map[string]any{"symbol": "LIVE", "tf": "1d", "startTs": 1700000000000, "kind": "live", "name": "Live A"})
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewBuffer(body)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("seed live session = %d, want 201", rec.Code)
	}

	rec2 := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/api/v1/analytics/sources", nil))
	if rec2.Code != http.StatusOK {
		t.Fatalf("GET sources = %d, want 200", rec2.Code)
	}
	// handleAnalyticsSources wraps the rows in an {items:[...]} envelope
	// (see internal/httpapi/analytics.go), not a bare array.
	var resp struct {
		Items []struct {
			Type  string `json:"type"`
			Title string `json:"title"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec2.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal sources: %v", err)
	}
	found := false
	for _, item := range resp.Items {
		if item.Type == "live" && item.Title == "Live A" {
			found = true
		}
	}
	if !found {
		t.Fatalf("sources list has no live item; got %+v", resp.Items)
	}
}
