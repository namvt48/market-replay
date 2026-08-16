package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleSimulationRiskReward_Success(t *testing.T) {
	s := newTestServer(t)
	id := putStopLossFixtureTrade(t, s)

	body := `{"sourceType":"session","sourceId":"` + id + `","targetsR":[1,2],"includeCurrentModel":true}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/risk-reward", body)
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
		IncludedTrades int `json:"includedTrades"`
		Scenarios      []struct {
			ID      string   `json:"id"`
			TargetR *float64 `json:"targetR"`
		} `json:"scenarios"`
		Metadata struct {
			IntrabarPolicy string `json:"intrabarPolicy"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if resp.Source.ID != id || resp.Source.Type != "session" {
		t.Errorf("source = %+v", resp.Source)
	}
	if resp.IncludedTrades != 1 {
		t.Errorf("includedTrades = %d, want 1", resp.IncludedTrades)
	}
	if len(resp.Scenarios) != 3 { // current + 2 targets
		t.Fatalf("scenarios = %d, want 3", len(resp.Scenarios))
	}
	if resp.Scenarios[0].ID != "current" || resp.Scenarios[0].TargetR != nil {
		t.Errorf("scenario[0] = %+v, want current/nil", resp.Scenarios[0])
	}
	if resp.Metadata.IntrabarPolicy != "stop-first" {
		t.Errorf("intrabarPolicy = %q, want stop-first", resp.Metadata.IntrabarPolicy)
	}
}

func TestHandleSimulationRiskReward_ExcludeCurrentModel(t *testing.T) {
	s := newTestServer(t)
	id := putStopLossFixtureTrade(t, s)

	body := `{"sourceType":"session","sourceId":"` + id + `","targetsR":[1],"includeCurrentModel":false}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/risk-reward", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Scenarios []struct {
			ID string `json:"id"`
		} `json:"scenarios"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Scenarios) != 1 || resp.Scenarios[0].ID == "current" {
		t.Errorf("scenarios = %+v, want exactly 1 target scenario, no current", resp.Scenarios)
	}
}

func TestHandleSimulationRiskReward_MissingSourceType(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/risk-reward", `{"sourceId":"whatever","targetsR":[1]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationRiskReward_MissingSourceId(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/risk-reward", `{"sourceType":"session","targetsR":[1]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationRiskReward_InvalidJSONBody(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/risk-reward", `not json`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationRiskReward_TargetOutOfRangeRejectedBeforeLookup(t *testing.T) {
	s := newTestServer(t)
	body := `{"sourceType":"session","sourceId":"nope","targetsR":[50.1]}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/risk-reward", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (out-of-range target rejected before source lookup), body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationRiskReward_SourceTypeMismatch404(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s) // kind defaults to "replay"
	body := `{"sourceType":"evaluation","sourceId":"` + id + `","targetsR":[1]}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/risk-reward", body)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationRiskReward_NoEligibleTradesIs422(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	putTestTrades(t, s, id, `[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":1000,"entryPriceTicks":110,"exitTs":1300,"exitPriceTicks":112,"realizedCents":5000,"feesCents":0,"mfeTicks":10,"maeTicks":5,"createdAt":1300}]`)

	body := `{"sourceType":"session","sourceId":"` + id + `","targetsR":[1]}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/risk-reward", body)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationRiskReward_SingleListTradesCallPerRequest(t *testing.T) {
	s := newTestServer(t)
	id := putStopLossFixtureTrade(t, s)

	counting := &countingStore{Store: s.Store}
	s.Store = counting

	body := `{"sourceType":"session","sourceId":"` + id + `","targetsR":[1,2,3]}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/risk-reward", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if counting.listTradesCalls != 1 {
		t.Fatalf("ListTrades called %d times, want exactly 1", counting.listTradesCalls)
	}
}

func TestHandleSimulationRiskReward_CanceledContextIs499NotNoisy500(t *testing.T) {
	s := newTestServer(t)
	id := putStopLossFixtureTrade(t, s)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	body := `{"sourceType":"session","sourceId":"` + id + `","targetsR":[1,2,3]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/analytics/simulations/risk-reward", bytes.NewBufferString(body))
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != 499 {
		t.Fatalf("status = %d, want 499 (canceled context, not a noisy 500)", rec.Code)
	}
}
