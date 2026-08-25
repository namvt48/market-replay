package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// advanceCursor moves a test session's replay cursor forward so
// ListTrades' "closed at or before the cursor" filter reveals trades whose
// timestamps fall inside the NQ/1m fixture window (which starts at
// testFixtureStart, well past a freshly created session's own cursor).
func advanceCursor(t *testing.T, s *Server, id string, cursorTs int64) {
	t.Helper()
	rec := serve(t, s, http.MethodPatch, "/api/v1/sessions/"+id, fmt.Sprintf(`{"cursorTs":%d}`, cursorTs))
	if rec.Code != http.StatusOK {
		t.Fatalf("advance cursor status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

// putStopLossFixtureTrade creates a session, writes one risk-valid trade
// whose [entryTs,exitTs] window sits inside the NQ/1m fixture's bar range,
// and advances the cursor so the trade is visible to ListTrades.
func putStopLossFixtureTrade(t *testing.T, s *Server) string {
	t.Helper()
	id := createTestSession(t, s)
	entryTs := int64(testFixtureStart) + 60
	exitTs := int64(testFixtureStart) + 300
	journal := fmt.Sprintf(`[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":%d,"entryPriceTicks":110,"exitTs":%d,"exitPriceTicks":112,"realizedCents":5000,"feesCents":0,"mfeTicks":10,"maeTicks":5,"initialStopTicks":95,"createdAt":%d}]`,
		entryTs, exitTs, exitTs)
	putTestTrades(t, s, id, journal)
	advanceCursor(t, s, id, exitTs)
	return id
}

func TestHandleSimulationStopLoss_Success(t *testing.T) {
	s := newTestServer(t)
	id := putStopLossFixtureTrade(t, s)

	body := `{"sourceType":"session","sourceId":"` + id + `","reductionsPercent":[0,10,50]}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/stop-loss", body)
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
		IncludedTrades int `json:"includedTrades"`
		ExcludedTrades struct {
			NoInitialStop     int `json:"noInitialStop"`
			InvalidRisk       int `json:"invalidRisk"`
			MissingMarketData int `json:"missingMarketData"`
		} `json:"excludedTrades"`
		Scenarios []struct {
			ReductionPercent float64 `json:"reductionPercent"`
		} `json:"scenarios"`
		BestScenario struct {
			Criterion string `json:"criterion"`
		} `json:"bestScenario"`
		Metadata struct {
			IntrabarPolicy string `json:"intrabarPolicy"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if resp.Source.ID != id || resp.Source.Type != "session" || resp.Source.TradeCount != 1 {
		t.Errorf("source = %+v", resp.Source)
	}
	if resp.IncludedTrades != 1 {
		t.Errorf("includedTrades = %d, want 1", resp.IncludedTrades)
	}
	if len(resp.Scenarios) != 3 {
		t.Fatalf("scenarios = %d, want 3", len(resp.Scenarios))
	}
	if resp.Metadata.IntrabarPolicy != "stop-first" {
		t.Errorf("intrabarPolicy = %q, want stop-first", resp.Metadata.IntrabarPolicy)
	}
}

func TestHandleSimulationStopLoss_SuccessEvaluation(t *testing.T) {
	s := newTestServer(t)
	id := createTestSessionWithKind(t, s, "eval", 100_000_00)
	entryTs := int64(testFixtureStart) + 60
	exitTs := int64(testFixtureStart) + 300
	journal := fmt.Sprintf(`[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":%d,"entryPriceTicks":110,"exitTs":%d,"exitPriceTicks":112,"realizedCents":5000,"feesCents":0,"mfeTicks":10,"maeTicks":5,"initialStopTicks":95,"createdAt":%d}]`,
		entryTs, exitTs, exitTs)
	putTestTrades(t, s, id, journal)
	advanceCursor(t, s, id, exitTs)

	body := `{"sourceType":"evaluation","sourceId":"` + id + `","reductionsPercent":[0]}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/stop-loss", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationStopLoss_UsesOneMinuteBarsForAggregatedSessionTimeframe(t *testing.T) {
	s := newTestServer(t) // fixture deliberately contains NQ/1m only
	create := serve(t, s, http.MethodPost, "/api/v1/sessions", `{"symbol":"NQ","tf":"5m","startTs":1600000000,"config":{}}`)
	if create.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", create.Code, create.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(create.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	entryTs := int64(testFixtureStart) + 60
	exitTs := int64(testFixtureStart) + 300
	journal := fmt.Sprintf(`[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":%d,"entryPriceTicks":110,"exitTs":%d,"exitPriceTicks":112,"realizedCents":5000,"feesCents":0,"mfeTicks":10,"maeTicks":5,"initialStopTicks":95,"createdAt":%d}]`, entryTs, exitTs, exitTs)
	putTestTrades(t, s, created.ID, journal)
	advanceCursor(t, s, created.ID, exitTs)

	body := `{"sourceType":"session","sourceId":"` + created.ID + `","reductionsPercent":[0,20]}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/stop-loss", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationStopLoss_MissingSourceType(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/stop-loss", `{"sourceId":"whatever","reductionsPercent":[0]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationStopLoss_MissingSourceId(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/stop-loss", `{"sourceType":"session","reductionsPercent":[0]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationStopLoss_InvalidJSONBody(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/stop-loss", `not json`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationStopLoss_ReductionsPercentOutOfRangeRejectedBeforeLookup(t *testing.T) {
	s := newTestServer(t)
	// sourceId "nope" would 404 if the handler reached the trade lookup —
	// asserting 400 instead proves input validation runs first.
	body := `{"sourceType":"session","sourceId":"nope","reductionsPercent":[96]}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/stop-loss", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (out-of-range reduction rejected before source lookup), body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationStopLoss_TooManyReductions(t *testing.T) {
	s := newTestServer(t)
	reductions := make([]byte, 0, 200)
	reductions = append(reductions, '[')
	for i := 0; i < 21; i++ {
		if i > 0 {
			reductions = append(reductions, ',')
		}
		reductions = append(reductions, []byte(fmt.Sprintf("%d", i))...)
	}
	reductions = append(reductions, ']')
	body := `{"sourceType":"session","sourceId":"nope","reductionsPercent":` + string(reductions) + `}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/stop-loss", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (21 > max 20), body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationStopLoss_SourceTypeMismatch404(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s) // kind defaults to "replay"
	body := `{"sourceType":"evaluation","sourceId":"` + id + `","reductionsPercent":[0]}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/stop-loss", body)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationStopLoss_NoEligibleTradesIs422(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	// No InitialStopTicks -> excluded, no eligible trades at all.
	putTestTrades(t, s, id, `[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":1000,"entryPriceTicks":110,"exitTs":1300,"exitPriceTicks":112,"realizedCents":5000,"feesCents":0,"mfeTicks":10,"maeTicks":5,"createdAt":1300}]`)

	body := `{"sourceType":"session","sourceId":"` + id + `","reductionsPercent":[0]}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/stop-loss", body)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationStopLoss_SingleListTradesCallPerRequest(t *testing.T) {
	s := newTestServer(t)
	id := putStopLossFixtureTrade(t, s)

	counting := &countingStore{Store: s.Store}
	s.Store = counting

	body := `{"sourceType":"session","sourceId":"` + id + `","reductionsPercent":[0,10,50]}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/stop-loss", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if counting.listTradesCalls != 1 {
		t.Fatalf("ListTrades called %d times, want exactly 1", counting.listTradesCalls)
	}
}

func TestHandleSimulationStopLoss_CanceledContextIs499NotNoisy500(t *testing.T) {
	s := newTestServer(t)
	id := putStopLossFixtureTrade(t, s)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	body := `{"sourceType":"session","sourceId":"` + id + `","reductionsPercent":[0,10,50]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/analytics/simulations/stop-loss", bytes.NewBufferString(body))
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != 499 {
		t.Fatalf("status = %d, want 499 (canceled context, not a noisy 500)", rec.Code)
	}
}
