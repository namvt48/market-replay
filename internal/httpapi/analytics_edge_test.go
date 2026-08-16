package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// putEdgeFixtureTrade creates a session, writes one risk-valid trade with a
// finite RMultiple whose [entryTs,exitTs] window sits inside the NQ/1m
// fixture's bar range, and advances the cursor so the trade is visible to
// ListTrades — the same fixture shape as putStopLossFixtureTrade, plus
// rMultiple (edge/decomposition/walk-forward all need a finite RMultiple).
func putEdgeFixtureTrade(t *testing.T, s *Server) string {
	t.Helper()
	id := createTestSession(t, s)
	entryTs := int64(testFixtureStart) + 60
	exitTs := int64(testFixtureStart) + 300
	journal := fmt.Sprintf(`[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":%d,"entryPriceTicks":110,"exitTs":%d,"exitPriceTicks":112,"realizedCents":5000,"feesCents":0,"mfeTicks":10,"maeTicks":5,"initialStopTicks":95,"rMultiple":0.5,"createdAt":%d}]`,
		entryTs, exitTs, exitTs)
	putTestTrades(t, s, id, journal)
	advanceCursor(t, s, id, exitTs)
	return id
}

func TestHandleAnalyticsEdge_Success(t *testing.T) {
	s := newTestServer(t)
	id := putEdgeFixtureTrade(t, s)

	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/edge?sourceType=session&sourceId="+id, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
	var resp struct {
		Source struct {
			ID         string `json:"id"`
			Type       string `json:"type"`
			Title      string `json:"title"`
			TradeCount int    `json:"tradeCount"`
		} `json:"source"`
		CalculationVersion string `json:"calculationVersion"`
		Audit              struct {
			TotalTrades     int `json:"totalTrades"`
			EligibleRTrades int `json:"eligibleRTrades"`
		} `json:"audit"`
		Edge struct {
			SampleSize int    `json:"sampleSize"`
			Verdict    string `json:"verdict"`
		} `json:"edge"`
		Bootstrap struct {
			Seed int64 `json:"seed"`
		} `json:"bootstrap"`
		WalkForward struct {
			ParameterSensitivity *struct {
				Method string `json:"method"`
			} `json:"parameterSensitivity"`
		} `json:"walkForward"`
		Sizing *struct{} `json:"sizing"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if resp.Source.ID != id || resp.Source.Type != "session" || resp.Source.TradeCount != 1 {
		t.Errorf("source = %+v", resp.Source)
	}
	if resp.CalculationVersion != "decision-intelligence-v1" {
		t.Errorf("calculationVersion = %q", resp.CalculationVersion)
	}
	if resp.Audit.TotalTrades != 1 || resp.Audit.EligibleRTrades != 1 {
		t.Errorf("audit = %+v, want totalTrades=1 eligibleRTrades=1", resp.Audit)
	}
	if resp.Edge.SampleSize != 1 {
		t.Errorf("edge.sampleSize = %d, want 1", resp.Edge.SampleSize)
	}
	if resp.Edge.Verdict != "insufficient" {
		t.Errorf("edge.verdict = %q, want insufficient (only 1 trade)", resp.Edge.Verdict)
	}
	if resp.Sizing != nil {
		t.Errorf("sizing = %+v, want nil (verdict is not edge)", resp.Sizing)
	}
	if resp.Bootstrap.Seed != edgeDefaultSeed {
		t.Errorf("bootstrap.seed = %d, want fixed default %d (seed omitted)", resp.Bootstrap.Seed, edgeDefaultSeed)
	}
	if resp.WalkForward.ParameterSensitivity == nil {
		t.Fatal("walkForward.parameterSensitivity = nil, want a value (trade has coverage)")
	}
	if resp.WalkForward.ParameterSensitivity.Method != "ohlc-rewalk" {
		t.Errorf("parameterSensitivity.method = %q, want ohlc-rewalk", resp.WalkForward.ParameterSensitivity.Method)
	}
}

func TestHandleAnalyticsEdge_SuccessEvaluation(t *testing.T) {
	s := newTestServer(t)
	id := createTestSessionWithKind(t, s, "eval", 100_000_00)
	entryTs := int64(testFixtureStart) + 60
	exitTs := int64(testFixtureStart) + 300
	journal := fmt.Sprintf(`[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":%d,"entryPriceTicks":110,"exitTs":%d,"exitPriceTicks":112,"realizedCents":5000,"feesCents":0,"mfeTicks":10,"maeTicks":5,"initialStopTicks":95,"rMultiple":0.5,"createdAt":%d}]`,
		entryTs, exitTs, exitTs)
	putTestTrades(t, s, id, journal)
	advanceCursor(t, s, id, exitTs)

	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/edge?sourceType=evaluation&sourceId="+id, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsEdge_SeedGivenIsEchoedAndDeterministic(t *testing.T) {
	s := newTestServer(t)
	id := putEdgeFixtureTrade(t, s)

	url := "/api/v1/analytics/edge?sourceType=session&sourceId=" + id + "&seed=424242&bootstrapIterations=1000"
	first := serve(t, s, http.MethodGet, url, "")
	second := serve(t, s, http.MethodGet, url, "")
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("status = %d/%d, bodies = %s / %s", first.Code, second.Code, first.Body.String(), second.Body.String())
	}
	if first.Body.String() != second.Body.String() {
		t.Errorf("same seed produced different response bodies:\nfirst=%s\nsecond=%s", first.Body.String(), second.Body.String())
	}
	var resp struct {
		Bootstrap struct {
			Seed int64 `json:"seed"`
		} `json:"bootstrap"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Bootstrap.Seed != 424242 {
		t.Errorf("bootstrap.seed = %d, want 424242", resp.Bootstrap.Seed)
	}
}

func TestHandleAnalyticsEdge_MissingSourceType(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/edge?sourceId=whatever", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsEdge_MissingSourceId(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/edge?sourceType=session", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsEdge_ConfidenceOutOfRangeRejectedBeforeSourceLookup(t *testing.T) {
	s := newTestServer(t)
	// sourceId "nope" would 404 if the handler reached the source lookup —
	// asserting 400 instead proves bound validation runs first.
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/edge?sourceType=session&sourceId=nope&confidence=0.5", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (confidence outside [0.80,0.99] rejected before source lookup), body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsEdge_BootstrapIterationsOutOfRangeRejectedBeforeSourceLookup(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/edge?sourceType=session&sourceId=nope&bootstrapIterations=500", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (bootstrapIterations below 1000 rejected before source lookup), body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsEdge_SourceNotFound(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/edge?sourceType=session&sourceId=nope", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsEdge_SourceTypeMismatch404(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s) // kind defaults to "replay"
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/edge?sourceType=evaluation&sourceId="+id, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsEdge_NoClosedTradesIs422(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s) // no PUT trades at all
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/edge?sourceType=session&sourceId="+id, "")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsEdge_SingleListTradesCallPerRequest(t *testing.T) {
	s := newTestServer(t)
	id := putEdgeFixtureTrade(t, s)

	counting := &countingStore{Store: s.Store}
	s.Store = counting

	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/edge?sourceType=session&sourceId="+id, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if counting.listTradesCalls != 1 {
		t.Fatalf("ListTrades called %d times, want exactly 1", counting.listTradesCalls)
	}
}

func TestHandleAnalyticsEdge_CanceledContextIs499NotNoisy500(t *testing.T) {
	s := newTestServer(t)
	id := putEdgeFixtureTrade(t, s)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/edge?sourceType=session&sourceId="+id, nil)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != 499 {
		t.Fatalf("status = %d, want 499 (canceled context, not a noisy 500)", rec.Code)
	}
}
