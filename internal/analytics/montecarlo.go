package analytics

import (
	"context"
	"math/rand"
)

// MonteCarloRequest is one Monte Carlo simulation run. Unlike the
// performance/drawdown/simulator requests, this is pure statistics — no
// source, no trades, no market data — so every field is a caller-supplied
// number, already validated by the httpapi layer (ranges, total simulated
// trade cap, a resolved Seed even if the client omitted one).
type MonteCarloRequest struct {
	SimulationCount     int
	TradesPerSimulation int
	StartBalanceCents   int64
	AverageGainCents    int64
	AverageLossCents    int64
	WinRatePercent      float64
	Seed                int64
}

// MonteCarloPath is one simulated equity path. Balances always has
// TradesPerSimulation+1 entries — the first is the start balance.
type MonteCarloPath struct {
	SimulationIndex int       `json:"simulationIndex"`
	Balances        []float64 `json:"balances"`
}

// MonteCarloSummary aggregates every path. AverageProfitFactor is nil (with
// a reason in AverageProfitFactorNote) instead of +Inf when there are no
// simulated losses, same convention as Expectancy.ProfitFactor.
type MonteCarloSummary struct {
	AverageEndingBalance    float64  `json:"averageEndingBalance"`
	MaxEndingBalance        float64  `json:"maxEndingBalance"`
	MinEndingBalance        float64  `json:"minEndingBalance"`
	AverageProfitFactor     *float64 `json:"averageProfitFactor"`
	AverageProfitFactorNote string   `json:"averageProfitFactorNote,omitempty"`
	MaxConsecutiveWins      int      `json:"maxConsecutiveWins"`
	MaxConsecutiveLosses    int      `json:"maxConsecutiveLosses"`
	TotalWins               int      `json:"totalWins"`
	TotalLosses             int      `json:"totalLosses"`
}

// MonteCarloResult is RunMonteCarlo's return value, minus the "inputs"
// echo (the httpapi layer copies that straight from the parsed request
// body, byte-exact, rather than round-tripping the cents conversion this
// package does internally).
type MonteCarloResult struct {
	Seed    int64             `json:"seed"`
	Paths   []MonteCarloPath  `json:"paths"`
	Summary MonteCarloSummary `json:"summary"`
}

// RunMonteCarlo simulates SimulationCount independent paths of
// TradesPerSimulation Bernoulli(WinRatePercent) trades each: a winner adds
// AverageGainCents, a loser subtracts AverageLossCents — no added
// volatility, so the model matches exactly what the spec (and the
// contract, not the FE's current client-only mock) asks for. rand.New with
// a fixed source makes the whole run deterministic: same request +
// same Seed always produces byte-identical Paths/Summary.
func RunMonteCarlo(ctx context.Context, req MonteCarloRequest) (MonteCarloResult, error) {
	if err := ctx.Err(); err != nil {
		return MonteCarloResult{}, err
	}
	if req.SimulationCount <= 0 {
		return MonteCarloResult{Seed: req.Seed}, nil
	}

	rng := rand.New(rand.NewSource(req.Seed))
	paths := make([]MonteCarloPath, req.SimulationCount)
	endingBalancesCents := make([]int64, req.SimulationCount)

	var totalWins, totalLosses int
	var maxConsecutiveWins, maxConsecutiveLosses int
	var grossGainCents, grossLossCents int64

	for i := 0; i < req.SimulationCount; i++ {
		balanceCents := req.StartBalanceCents
		balances := make([]float64, 0, req.TradesPerSimulation+1)
		balances = append(balances, centsToDollars(balanceCents))

		var consecutiveWins, consecutiveLosses int
		for j := 0; j < req.TradesPerSimulation; j++ {
			if rng.Float64()*100 < req.WinRatePercent {
				balanceCents += req.AverageGainCents
				grossGainCents += req.AverageGainCents
				totalWins++
				consecutiveWins++
				consecutiveLosses = 0
			} else {
				balanceCents -= req.AverageLossCents
				grossLossCents += req.AverageLossCents
				totalLosses++
				consecutiveLosses++
				consecutiveWins = 0
			}
			if consecutiveWins > maxConsecutiveWins {
				maxConsecutiveWins = consecutiveWins
			}
			if consecutiveLosses > maxConsecutiveLosses {
				maxConsecutiveLosses = consecutiveLosses
			}
			balances = append(balances, centsToDollars(balanceCents))
		}

		paths[i] = MonteCarloPath{SimulationIndex: i + 1, Balances: balances}
		endingBalancesCents[i] = balanceCents
	}

	var sumEndingCents int64
	maxEndingCents := endingBalancesCents[0]
	minEndingCents := endingBalancesCents[0]
	for _, c := range endingBalancesCents {
		sumEndingCents += c
		if c > maxEndingCents {
			maxEndingCents = c
		}
		if c < minEndingCents {
			minEndingCents = c
		}
	}
	averageEndingCents := float64(sumEndingCents) / float64(req.SimulationCount)

	var profitFactor *float64
	var note string
	switch {
	case req.TradesPerSimulation == 0:
		note = "no_trades"
	case grossLossCents == 0:
		note = "no_losses"
	default:
		pf := float64(grossGainCents) / float64(grossLossCents)
		profitFactor = &pf
	}

	return MonteCarloResult{
		Seed:  req.Seed,
		Paths: paths,
		Summary: MonteCarloSummary{
			AverageEndingBalance:    averageEndingCents / 100,
			MaxEndingBalance:        centsToDollars(maxEndingCents),
			MinEndingBalance:        centsToDollars(minEndingCents),
			AverageProfitFactor:     profitFactor,
			AverageProfitFactorNote: note,
			MaxConsecutiveWins:      maxConsecutiveWins,
			MaxConsecutiveLosses:    maxConsecutiveLosses,
			TotalWins:               totalWins,
			TotalLosses:             totalLosses,
		},
	}, nil
}
