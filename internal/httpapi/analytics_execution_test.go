package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleAnalyticsExecution_Success(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	putTestTrades(t, s, id, `[`+
		`{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":1000,"entryPriceTicks":1000,"exitTs":1300,"exitPriceTicks":1010,"realizedCents":10000,"feesCents":400,"mfeTicks":40,"maeTicks":5,"initialStopTicks":980,"rMultiple":1,"exitReason":"takeProfit","createdAt":1300},`+
		`{"id":"t2","symbol":"NQ","side":"long","qty":1,"entryTs":1400,"entryPriceTicks":1000,"exitTs":1500,"exitPriceTicks":990,"realizedCents":-5000,"feesCents":400,"mfeTicks":10,"maeTicks":20,"initialStopTicks":980,"rMultiple":-0.5,"exitReason":"stopLoss","createdAt":1500}`+
		`]`)

	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/execution-discipline?sourceType=session&sourceId="+id, "")
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
			TradeCount int    `json:"tradeCount"`
		} `json:"source"`
		CalculationVersion string `json:"calculationVersion"`
		Audit              struct {
			TotalTrades     int    `json:"totalTrades"`
			CostModelSource string `json:"costModelSource"`
		} `json:"audit"`
		Execution struct {
			CostModel struct {
				TickValueCents float64 `json:"tickValueCents"`
			} `json:"costModel"`
			ExitReasonBreakdown struct {
				Manual     int `json:"manual"`
				StopLoss   int `json:"stopLoss"`
				TakeProfit int `json:"takeProfit"`
			} `json:"exitReasonBreakdown"`
			GrossExpectancyR float64 `json:"grossExpectancyR"`
			NetExpectancyR   float64 `json:"netExpectancyR"`
		} `json:"execution"`
		Decision struct {
			Matrix map[string]int `json:"matrix"`
		} `json:"decision"`
		Psychology struct {
			Profile string `json:"profile"`
		} `json:"psychology"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if resp.Source.ID != id || resp.Source.Type != "session" || resp.Source.TradeCount != 2 {
		t.Errorf("source = %+v", resp.Source)
	}
	if resp.CalculationVersion != "decision-intelligence-v1" {
		t.Errorf("calculationVersion = %q", resp.CalculationVersion)
	}
	if resp.Audit.TotalTrades != 2 {
		t.Errorf("audit.totalTrades = %d, want 2", resp.Audit.TotalTrades)
	}
	if resp.Audit.CostModelSource != "symbol-config" {
		t.Errorf("audit.costModelSource = %q, want symbol-config", resp.Audit.CostModelSource)
	}
	if resp.Execution.CostModel.TickValueCents != 500 {
		t.Errorf("execution.costModel.tickValueCents = %v, want 500 (NQ fixture: 0.25*20*100)", resp.Execution.CostModel.TickValueCents)
	}
	if resp.Execution.NetExpectancyR >= resp.Execution.GrossExpectancyR {
		t.Errorf("netExpectancyR %v should be < grossExpectancyR %v", resp.Execution.NetExpectancyR, resp.Execution.GrossExpectancyR)
	}
	if resp.Execution.ExitReasonBreakdown.StopLoss != 1 || resp.Execution.ExitReasonBreakdown.TakeProfit != 1 {
		t.Errorf("exitReasonBreakdown = %+v, want stopLoss:1 takeProfit:1", resp.Execution.ExitReasonBreakdown)
	}
	if resp.Psychology.Profile == "" {
		t.Errorf("psychology.profile is empty, want a psychology profile")
	}
}

func TestHandleAnalyticsExecution_SuccessEvaluation(t *testing.T) {
	s := newTestServer(t)
	id := createTestSessionWithKind(t, s, "eval", 100_000_00)
	putTestTrades(t, s, id, `[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":1000,"entryPriceTicks":1000,"exitTs":1300,"exitPriceTicks":1010,"realizedCents":10000,"feesCents":400,"mfeTicks":40,"maeTicks":5,"initialStopTicks":980,"rMultiple":1,"createdAt":1300}]`)

	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/execution-discipline?sourceType=evaluation&sourceId="+id, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsExecution_MissingSourceType(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/execution-discipline?sourceId=whatever", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsExecution_MissingSourceId(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/execution-discipline?sourceType=session", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsExecution_SourceNotFound(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/execution-discipline?sourceType=session&sourceId=nope", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsExecution_SourceTypeMismatch404(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s) // kind defaults to "replay"
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/execution-discipline?sourceType=evaluation&sourceId="+id, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsExecution_NoClosedTradesIs422(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s) // no PUT trades at all
	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/execution-discipline?sourceType=session&sourceId="+id, "")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleAnalyticsExecution_SingleListTradesCallPerRequest(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	putTestTrades(t, s, id, `[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":1000,"entryPriceTicks":1000,"exitTs":1300,"exitPriceTicks":1010,"realizedCents":10000,"feesCents":400,"mfeTicks":40,"maeTicks":5,"initialStopTicks":980,"rMultiple":1,"createdAt":1300}]`)

	counting := &countingStore{Store: s.Store}
	s.Store = counting

	rec := serve(t, s, http.MethodGet, "/api/v1/analytics/execution-discipline?sourceType=session&sourceId="+id, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if counting.listTradesCalls != 1 {
		t.Fatalf("ListTrades called %d times, want exactly 1", counting.listTradesCalls)
	}
}

func TestHandleAnalyticsExecution_CanceledContextIs499NotNoisy500(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	putTestTrades(t, s, id, `[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":1000,"entryPriceTicks":1000,"exitTs":1300,"exitPriceTicks":1010,"realizedCents":10000,"feesCents":400,"mfeTicks":40,"maeTicks":5,"initialStopTicks":980,"rMultiple":1,"createdAt":1300}]`)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/execution-discipline?sourceType=session&sourceId="+id, nil)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != 499 {
		t.Fatalf("status = %d, want 499 (canceled context, not a noisy 500)", rec.Code)
	}
}
