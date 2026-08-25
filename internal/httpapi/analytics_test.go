package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"market-replay/internal/model"
	"market-replay/internal/storage"
)

// countingStore wraps storage.Store to count ListTrades calls, so a test
// can assert a handler makes exactly one call per request instead of one
// per trade (N+1).
type countingStore struct {
	storage.Store
	listTradesCalls int
}

func (c *countingStore) ListTrades(ctx context.Context, sessionID string) ([]model.Trade, error) {
	c.listTradesCalls++
	return c.Store.ListTrades(ctx, sessionID)
}

func createTestSessionWithKind(t *testing.T, s *Server, kind string, initialBalanceCents int64) string {
	t.Helper()
	body := fmt.Sprintf(`{"symbol":"NQ","tf":"1m","startTs":1600000000,"kind":%q,"initialBalanceCents":%d,"config":{}}`, kind, initialBalanceCents)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create session status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return resp["id"]
}

func putTestTrades(t *testing.T, s *Server, sessionID, journal string) {
	t.Helper()
	rec := serve(t, s, http.MethodPut, "/api/v1/sessions/"+sessionID+"/trades", journal)
	if rec.Code != http.StatusOK {
		t.Fatalf("put trades status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsSources_MixesSessionAndEvaluation(t *testing.T) {
	s := newTestServer(t)
	replayID := createTestSession(t, s)
	evalID := createTestSessionWithKind(t, s, "eval", 5_000_000)
	serve(t, s, http.MethodPatch, "/api/v1/sessions/"+evalID, `{"name":"Evaluation Alpha"}`)

	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/sources", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Items []struct {
			ID    string `json:"id"`
			Type  string `json:"type"`
			Title string `json:"title"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if len(resp.Items) != 2 {
		t.Fatalf("items length = %d, want 2: %+v", len(resp.Items), resp.Items)
	}
	types := map[string]string{}
	titles := map[string]string{}
	for _, item := range resp.Items {
		types[item.ID] = item.Type
		titles[item.ID] = item.Title
	}
	if types[replayID] != "session" {
		t.Errorf("replay session type = %q, want %q", types[replayID], "session")
	}
	if types[evalID] != "evaluation" {
		t.Errorf("eval session type = %q, want %q", types[evalID], "evaluation")
	}
	if titles[evalID] != "Evaluation Alpha" {
		t.Errorf("renamed eval title = %q, want Evaluation Alpha", titles[evalID])
	}
	if len(titles[replayID]) != 7 || titles[replayID][0] != '#' {
		t.Errorf("default replay title = %q, want stable #HASH", titles[replayID])
	}
}

func TestHandleAnalyticsPerformance_InvalidSourceType(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/performance?sourceType=bogus&sourceId="+id, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsPerformance_MissingSourceId(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/performance?sourceType=session", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsPerformance_UnknownTimezone(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/performance?sourceType=session&sourceId="+id+"&timezone=Not/AZone", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsPerformance_SourceNotFound(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/performance?sourceType=session&sourceId=nope", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsPerformance_SourceTypeMismatch404(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s) // kind defaults to "replay"
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/performance?sourceType=evaluation&sourceId="+id, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (a replay session must not be reachable as sourceType=evaluation), body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsPerformance_ComputesRealNumbers(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	journal := `[` +
		`{"id":"trade-1","symbol":"NQ","side":"long","qty":1,"entryTs":1000,"entryPriceTicks":80000,"exitTs":1300,"exitPriceTicks":80100,"realizedCents":5000,"feesCents":0,"mfeTicks":150,"maeTicks":20,"rMultiple":2.0,"createdAt":1300},` +
		`{"id":"trade-2","symbol":"NQ","side":"short","qty":1,"entryTs":1400,"entryPriceTicks":80100,"exitTs":1500,"exitPriceTicks":80000,"realizedCents":-2500,"feesCents":0,"mfeTicks":10,"maeTicks":40,"rMultiple":-1.0,"createdAt":1500}` +
		`]`
	putTestTrades(t, s, id, journal)

	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/performance?sourceType=session&sourceId="+id+"&breakevenThreshold=0&timezone=UTC", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Source struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		} `json:"source"`
		Overview struct {
			TotalTrades int     `json:"totalTrades"`
			TotalPnl    float64 `json:"totalPnl"`
			WinRate     float64 `json:"winRate"`
		} `json:"overview"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if resp.Source.ID != id || resp.Source.Type != "session" {
		t.Errorf("source = %+v, want id=%q type=session", resp.Source, id)
	}
	if resp.Overview.TotalTrades != 2 {
		t.Errorf("totalTrades = %d, want 2", resp.Overview.TotalTrades)
	}
	if resp.Overview.TotalPnl != 25.0 { // 5000-2500 = 2500 cents = $25
		t.Errorf("totalPnl = %v, want 25", resp.Overview.TotalPnl)
	}
	if resp.Overview.WinRate != 50.0 {
		t.Errorf("winRate = %v, want 50", resp.Overview.WinRate)
	}
}

func TestHandleAnalyticsPerformance_SingleListTradesCallPerRequest(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	putTestTrades(t, s, id, `[{"id":"trade-1","symbol":"NQ","side":"long","qty":1,"entryTs":1000,"entryPriceTicks":80000,"exitTs":1300,"exitPriceTicks":80100,"realizedCents":5000,"feesCents":0,"mfeTicks":150,"maeTicks":20,"createdAt":1300}]`)

	counting := &countingStore{Store: s.Store}
	s.Store = counting

	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/performance?sourceType=session&sourceId="+id, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if counting.listTradesCalls != 1 {
		t.Fatalf("ListTrades called %d times, want exactly 1", counting.listTradesCalls)
	}
}
