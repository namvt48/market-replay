package httpapi

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"

	"market-replay/internal/analytics"
)

const (
	maxMonteCarloSimulations         = 1000
	maxMonteCarloTradesPerSimulation = 5000
	maxMonteCarloTotalTrades         = 250_000
	// Keep the JSON seed exactly representable in JavaScript Number.
	maxMonteCarloSeed int64 = 1<<53 - 1
)

type monteCarloRequestBody struct {
	SimulationCount     int     `json:"simulationCount"`
	TradesPerSimulation int     `json:"tradesPerSimulation"`
	StartBalance        float64 `json:"startBalance"`
	AverageGain         float64 `json:"averageGain"`
	AverageLoss         float64 `json:"averageLoss"`
	WinRatePercent      float64 `json:"winRatePercent"`
	Seed                *int64  `json:"seed"`
}

// monteCarloInputsEcho is the response's "inputs" field — a byte-exact
// echo of the parsed request, not round-tripped through the cents
// conversion RunMonteCarlo does internally.
type monteCarloInputsEcho struct {
	SimulationCount     int     `json:"simulationCount"`
	TradesPerSimulation int     `json:"tradesPerSimulation"`
	StartBalance        float64 `json:"startBalance"`
	AverageGain         float64 `json:"averageGain"`
	AverageLoss         float64 `json:"averageLoss"`
	WinRatePercent      float64 `json:"winRatePercent"`
}

type monteCarloResponse struct {
	analytics.MonteCarloResult
	Inputs monteCarloInputsEcho `json:"inputs"`
}

// handleSimulationMonteCarlo serves
// POST /api/v1/analytics/simulations/monte-carlo. Unlike the other three
// analytics endpoints, this one needs no source/trades/market-data — every
// input is a caller-supplied statistic, validated and range-clamped before
// any allocation happens in analytics.RunMonteCarlo.
func (s *Server) handleSimulationMonteCarlo(w http.ResponseWriter, r *http.Request) {
	raw, err := readLimitedBody(r, maxSimulationPayload)
	if err != nil {
		writeError(w, err)
		return
	}
	var body monteCarloRequestBody
	if err := json.Unmarshal(raw, &body); err != nil {
		writeError(w, fmt.Errorf("%w: invalid JSON body: %v", errBadRequest, err))
		return
	}

	if body.SimulationCount < 1 || body.SimulationCount > maxMonteCarloSimulations {
		writeError(w, fmt.Errorf("%w: simulationCount must be between 1 and %d", errBadRequest, maxMonteCarloSimulations))
		return
	}
	if body.TradesPerSimulation < 1 || body.TradesPerSimulation > maxMonteCarloTradesPerSimulation {
		writeError(w, fmt.Errorf("%w: tradesPerSimulation must be between 1 and %d", errBadRequest, maxMonteCarloTradesPerSimulation))
		return
	}
	if body.SimulationCount*body.TradesPerSimulation > maxMonteCarloTotalTrades {
		writeError(w, fmt.Errorf("%w: simulationCount*tradesPerSimulation must not exceed %d", errBadRequest, maxMonteCarloTotalTrades))
		return
	}
	if body.StartBalance <= 0 {
		writeError(w, fmt.Errorf("%w: startBalance must be positive", errBadRequest))
		return
	}
	if body.AverageGain < 0 || body.AverageLoss < 0 {
		writeError(w, fmt.Errorf("%w: averageGain and averageLoss must not be negative", errBadRequest))
		return
	}
	if body.WinRatePercent < 0 || body.WinRatePercent > 100 {
		writeError(w, fmt.Errorf("%w: winRatePercent must be between 0 and 100", errBadRequest))
		return
	}
	if body.Seed != nil && (*body.Seed <= 0 || *body.Seed > maxMonteCarloSeed) {
		writeError(w, fmt.Errorf("%w: seed must be between 1 and %d", errBadRequest, maxMonteCarloSeed))
		return
	}

	seed := int64(0)
	if body.Seed != nil {
		seed = *body.Seed
	} else {
		seed = randomSeed()
	}

	result, err := analytics.RunMonteCarlo(r.Context(), analytics.MonteCarloRequest{
		SimulationCount:     body.SimulationCount,
		TradesPerSimulation: body.TradesPerSimulation,
		StartBalanceCents:   centsFromDollars(body.StartBalance),
		AverageGainCents:    centsFromDollars(body.AverageGain),
		AverageLossCents:    centsFromDollars(body.AverageLoss),
		WinRatePercent:      body.WinRatePercent,
		Seed:                seed,
	})
	if err != nil {
		writeErrorRespectingCancellation(w, err)
		return
	}

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, monteCarloResponse{
		MonteCarloResult: result,
		Inputs: monteCarloInputsEcho{
			SimulationCount:     body.SimulationCount,
			TradesPerSimulation: body.TradesPerSimulation,
			StartBalance:        body.StartBalance,
			AverageGain:         body.AverageGain,
			AverageLoss:         body.AverageLoss,
			WinRatePercent:      body.WinRatePercent,
		},
	})
}

// randomSeed generates a seed when the client omitted one — the response
// always echoes the actual seed used (rule: "seed bắt buộc hoặc server
// phải trả seed thực tế đã dùng").
func randomSeed() int64 {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		// crypto/rand failing is exceptionally rare (OS entropy source
		// unavailable); any nonzero fallback keeps the request working
		// rather than failing a simulation over an unrelated OS issue.
		return 1
	}
	seed := int64(binary.BigEndian.Uint64(buf[:]) & uint64(maxMonteCarloSeed))
	if seed == 0 {
		return 1
	}
	return seed
}
