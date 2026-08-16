package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

const validMonteCarloBody = `{"sourceType":"unused","simulationCount":10,"tradesPerSimulation":10,"startBalance":100000,"averageGain":500,"averageLoss":300,"winRatePercent":50,"seed":20250816}`

func TestHandleSimulationMonteCarlo_Success(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/monte-carlo", validMonteCarloBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
	var resp struct {
		Seed  int64 `json:"seed"`
		Paths []struct {
			SimulationIndex int       `json:"simulationIndex"`
			Balances        []float64 `json:"balances"`
		} `json:"paths"`
		Summary struct {
			TotalWins   int `json:"totalWins"`
			TotalLosses int `json:"totalLosses"`
		} `json:"summary"`
		Inputs struct {
			SimulationCount int `json:"simulationCount"`
		} `json:"inputs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if resp.Seed != 20250816 {
		t.Errorf("seed = %d, want 20250816 (echoed back)", resp.Seed)
	}
	if len(resp.Paths) != 10 {
		t.Fatalf("paths = %d, want 10", len(resp.Paths))
	}
	if len(resp.Paths[0].Balances) != 11 {
		t.Errorf("balances = %d, want 11 (tradesPerSimulation+1)", len(resp.Paths[0].Balances))
	}
	if resp.Summary.TotalWins+resp.Summary.TotalLosses != 100 {
		t.Errorf("totalWins+totalLosses = %d, want 100", resp.Summary.TotalWins+resp.Summary.TotalLosses)
	}
	if resp.Inputs.SimulationCount != 10 {
		t.Errorf("inputs.simulationCount = %d, want 10", resp.Inputs.SimulationCount)
	}
}

func TestHandleSimulationMonteCarlo_SeedOmittedIsGeneratedAndEchoed(t *testing.T) {
	s := newTestServer(t)
	body := `{"simulationCount":5,"tradesPerSimulation":5,"startBalance":1000,"averageGain":10,"averageLoss":10,"winRatePercent":50}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/monte-carlo", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Seed int64 `json:"seed"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Seed == 0 {
		t.Errorf("seed = 0, want a generated nonzero seed")
	}
}

func TestHandleSimulationMonteCarlo_InvalidJSONBody(t *testing.T) {
	s := newTestServer(t)
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/monte-carlo", `not json`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationMonteCarlo_SimulationCountOutOfRange(t *testing.T) {
	s := newTestServer(t)
	body := `{"simulationCount":1001,"tradesPerSimulation":10,"startBalance":1000,"averageGain":10,"averageLoss":10,"winRatePercent":50}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/monte-carlo", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (simulationCount > 1000), body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationMonteCarlo_TradesPerSimulationOutOfRange(t *testing.T) {
	s := newTestServer(t)
	body := `{"simulationCount":10,"tradesPerSimulation":5001,"startBalance":1000,"averageGain":10,"averageLoss":10,"winRatePercent":50}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/monte-carlo", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (tradesPerSimulation > 5000), body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationMonteCarlo_TotalSimulatedTradesExceedsCap(t *testing.T) {
	s := newTestServer(t)
	// 1000 * 300 = 300,000 > 250,000 cap, each value individually in range.
	body := `{"simulationCount":1000,"tradesPerSimulation":300,"startBalance":1000,"averageGain":10,"averageLoss":10,"winRatePercent":50}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/monte-carlo", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (total simulated trades exceeds 250000), body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationMonteCarlo_NonPositiveStartBalance(t *testing.T) {
	s := newTestServer(t)
	body := `{"simulationCount":10,"tradesPerSimulation":10,"startBalance":0,"averageGain":10,"averageLoss":10,"winRatePercent":50}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/monte-carlo", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (startBalance must be positive), body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationMonteCarlo_WinRateOutOfRange(t *testing.T) {
	s := newTestServer(t)
	body := `{"simulationCount":10,"tradesPerSimulation":10,"startBalance":1000,"averageGain":10,"averageLoss":10,"winRatePercent":101}`
	rec := serve(t, s, http.MethodPost, "/api/v1/analytics/simulations/monte-carlo", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (winRatePercent > 100), body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleSimulationMonteCarlo_CanceledContextIs499NotNoisy500(t *testing.T) {
	s := newTestServer(t)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/analytics/simulations/monte-carlo", bytes.NewBufferString(validMonteCarloBody))
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != 499 {
		t.Fatalf("status = %d, want 499 (canceled context, not a noisy 500)", rec.Code)
	}
}
