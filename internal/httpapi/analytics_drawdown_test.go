package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleAnalyticsDrawdown_SuccessSession(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	putTestTrades(t, s, id, `[`+
		`{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":1000,"entryPriceTicks":105,"exitTs":1300,"exitPriceTicks":110,"realizedCents":5000,"feesCents":0,"mfeTicks":10,"maeTicks":5,"initialStopTicks":95,"createdAt":1300}`+
		`]`)

	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/drawdown?sourceType=session&sourceId="+id, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
	var resp struct {
		Source struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		} `json:"source"`
		EquityDrawdown struct {
			Points []map[string]any `json:"points"`
		} `json:"equityDrawdown"`
		MaximumAdverseExcursion struct {
			Unit string `json:"unit"`
		} `json:"maximumAdverseExcursion"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if resp.Source.ID != id || resp.Source.Type != "session" {
		t.Errorf("source = %+v, want id=%q type=session", resp.Source, id)
	}
	if len(resp.EquityDrawdown.Points) != 2 { // synthetic point + 1 trade
		t.Errorf("points = %d, want 2", len(resp.EquityDrawdown.Points))
	}
	if resp.MaximumAdverseExcursion.Unit != "R" {
		t.Errorf("maximumAdverseExcursion.unit = %q, want R", resp.MaximumAdverseExcursion.Unit)
	}
}

func TestHandleAnalyticsDrawdown_SuccessEvaluation(t *testing.T) {
	s := newTestServer(t)
	id := createTestSessionWithKind(t, s, "eval", 5_000_000)

	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/drawdown?sourceType=evaluation&sourceId="+id, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Source struct {
			Type string `json:"type"`
		} `json:"source"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Source.Type != "evaluation" {
		t.Errorf("source.type = %q, want evaluation", resp.Source.Type)
	}
}

func TestHandleAnalyticsDrawdown_MissingSourceType(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/drawdown?sourceId="+id, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsDrawdown_MissingSourceId(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/drawdown?sourceType=session", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsDrawdown_InvalidSourceType(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/drawdown?sourceType=bogus&sourceId="+id, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsDrawdown_SourceNotFound(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/drawdown?sourceType=session&sourceId=nope", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsDrawdown_SourceTypeMismatch404(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s) // kind defaults to "replay"
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/drawdown?sourceType=evaluation&sourceId="+id, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (a replay session must not be reachable as sourceType=evaluation), body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsDrawdown_SingleListTradesCallPerRequest(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	putTestTrades(t, s, id, `[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":1000,"entryPriceTicks":105,"exitTs":1300,"exitPriceTicks":110,"realizedCents":5000,"feesCents":0,"mfeTicks":10,"maeTicks":5,"initialStopTicks":95,"createdAt":1300}]`)

	counting := &countingStore{Store: s.Store}
	s.Store = counting

	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/drawdown?sourceType=session&sourceId="+id, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if counting.listTradesCalls != 1 {
		t.Fatalf("ListTrades called %d times, want exactly 1", counting.listTradesCalls)
	}
}

func TestHandleAnalyticsDrawdown_CanceledContextIs499NotNoisy500(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	putTestTrades(t, s, id, `[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":1000,"entryPriceTicks":105,"exitTs":1300,"exitPriceTicks":110,"realizedCents":5000,"feesCents":0,"mfeTicks":10,"maeTicks":5,"initialStopTicks":95,"createdAt":1300}]`)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/drawdown?sourceType=session&sourceId="+id, nil)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != 499 {
		t.Fatalf("status = %d, want 499 (canceled context, not a noisy 500)", rec.Code)
	}
}
