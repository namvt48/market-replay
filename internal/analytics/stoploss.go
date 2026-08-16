package analytics

import (
	"context"
	"math"

	"market-replay/internal/model"
)

// StopLossRequest is one stop-loss simulator computation over a single
// source's closed trades. ReductionsPercent is assumed already validated
// and deduped (1-20 items, each in [0,95]) by the httpapi layer. Timeframe
// is the source session's own — there is no per-trade equivalent to group
// by, unlike Symbol (see prepareSimTrades).
type StopLossRequest struct {
	Trades              []model.Trade
	Timeframe           string
	InitialBalanceCents int64
	MarketData          MarketData
	ReductionsPercent   []float64
}

// StopLossScenario is one reductionPercent's simulated outcome across every
// included trade. ProfitFactor is nil (with a reason in
// ProfitFactorNote) instead of +Inf, same convention as Expectancy.
type StopLossScenario struct {
	ReductionPercent float64          `json:"reductionPercent"`
	WinRate          float64          `json:"winRate"`
	StoppedOutTrades int              `json:"stoppedOutTrades"`
	AverageWinR      float64          `json:"averageWinR"`
	ExpectancyR      float64          `json:"expectancyR"`
	TotalR           float64          `json:"totalR"`
	Profit           float64          `json:"profit"`
	ProfitFactor     *float64         `json:"profitFactor"`
	ProfitFactorNote string           `json:"profitFactorNote,omitempty"`
	AverageDrawdownR float64          `json:"averageDrawdownR"`
	EquityCurve      []SimEquityPoint `json:"equityCurve"`
}

// StopLossBestScenario picks the recommended reduction: maximize profit
// factor, then the average drawdown closer to 0, then the lower reduction.
type StopLossBestScenario struct {
	ReductionPercent float64 `json:"reductionPercent"`
	Criterion        string  `json:"criterion"`
}

// StopLossSimulationResult is BuildStopLossSimulation's return value, minus
// the "source" envelope (added by the httpapi layer, same as Report and
// DrawdownReport).
type StopLossSimulationResult struct {
	IncludedTrades int                  `json:"includedTrades"`
	ExcludedTrades SimAuditCounts       `json:"excludedTrades"`
	Scenarios      []StopLossScenario   `json:"scenarios"`
	BestScenario   StopLossBestScenario `json:"bestScenario"`
	Metadata       SimMetadata          `json:"metadata"`
}

// BuildStopLossSimulation resimulates each reductionPercent scenario
// against every risk-valid, market-data-covered trade. The 0% scenario is
// never bar-walked — it must equal the actual persisted outcome exactly
// (rule: "không được resimulate thành kết quả khác chỉ do OHLC
// ambiguity") — every other scenario walks the trade's pre-fetched bars
// (prepareSimTrades) looking for the first bar that touches the tightened
// stop; a hit closes at the simulated stop price, a miss keeps the actual
// outcome.
func BuildStopLossSimulation(ctx context.Context, req StopLossRequest) (StopLossSimulationResult, error) {
	if err := ctx.Err(); err != nil {
		return StopLossSimulationResult{}, err
	}

	sorted := sortClosedTrades(req.Trades)
	simTrades, audit := prepareSimTrades(sorted, req.Timeframe, req.MarketData)
	if len(simTrades) == 0 {
		return StopLossSimulationResult{}, ErrNoEligibleTrades
	}

	scenarios := make([]StopLossScenario, len(req.ReductionsPercent))
	for i, reduction := range req.ReductionsPercent {
		scenarios[i] = buildStopLossScenario(simTrades, reduction, req.InitialBalanceCents)
	}

	return StopLossSimulationResult{
		IncludedTrades: len(simTrades),
		ExcludedTrades: audit,
		Scenarios:      scenarios,
		BestScenario:   pickBestStopLossScenario(scenarios),
		Metadata:       SimMetadata{IntrabarPolicy: "stop-first"},
	}, nil
}

// stopLossOutcome is one trade's simulated result under one scenario.
type stopLossOutcome struct {
	trade       simTrade
	netPnlCents int64
	stoppedOut  bool
}

func simulateStopLossTrade(t simTrade, reductionPercent float64) stopLossOutcome {
	if reductionPercent == 0 {
		// Base model: never resimulated, actual outcome verbatim.
		return stopLossOutcome{trade: t, netPnlCents: t.actualNetPnlCents}
	}

	distanceTicks := int64(math.Round(float64(t.riskTicks) * (1 - reductionPercent/100)))
	simulatedStopTicks := stopPriceTicks(t.side, t.entryPriceTicks, distanceTicks)

	for _, bar := range t.bars {
		if stopTouched(t.side, bar, simulatedStopTicks) {
			return stopLossOutcome{
				trade:       t,
				netPnlCents: simulatedNetPnlCents(t, simulatedStopTicks),
				stoppedOut:  true,
			}
		}
	}
	return stopLossOutcome{trade: t, netPnlCents: t.actualNetPnlCents}
}

func buildStopLossScenario(trades []simTrade, reductionPercent float64, initialBalanceCents int64) StopLossScenario {
	outcomes := make([]stopLossOutcome, len(trades))
	for i, t := range trades {
		outcomes[i] = simulateStopLossTrade(t, reductionPercent)
	}

	equityCurve := make([]SimEquityPoint, 0, len(outcomes)+1)
	equityCurve = append(equityCurve, SimEquityPoint{Balance: centsToDollars(initialBalanceCents)})
	rSeries := make([]float64, 0, len(outcomes)+1)
	rSeries = append(rSeries, 0)

	var wins, stoppedOut int
	var sumWinR, sumR float64
	var grossProfitCents, grossLossCents float64
	var cumulativeR float64
	var cumulativeNetCents int64

	for _, o := range outcomes {
		if o.stoppedOut {
			stoppedOut++
		}
		r := float64(o.netPnlCents) / o.trade.initialRiskAmountCents
		cumulativeR += r
		cumulativeNetCents += o.netPnlCents
		sumR += r
		switch {
		case o.netPnlCents > 0:
			wins++
			sumWinR += r
			grossProfitCents += float64(o.netPnlCents)
		case o.netPnlCents < 0:
			grossLossCents += -float64(o.netPnlCents)
		}

		id := o.trade.id
		equityCurve = append(equityCurve, SimEquityPoint{
			TradeIndex:  o.trade.index,
			TradeID:     &id,
			ClosedAt:    formatTimestamp(o.trade.exitTs),
			CumulativeR: cumulativeR,
			Balance:     centsToDollars(initialBalanceCents + cumulativeNetCents),
		})
		rSeries = append(rSeries, cumulativeR)
	}

	total := len(outcomes)
	var winRate, averageWinR, expectancyR float64
	if total > 0 {
		winRate = float64(wins) / float64(total) * 100
		expectancyR = sumR / float64(total)
	}
	if wins > 0 {
		averageWinR = sumWinR / float64(wins)
	}

	var profitFactor *float64
	var note string
	switch {
	case total == 0:
		note = "no_trades"
	case grossLossCents == 0:
		note = "no_losses"
	default:
		pf := grossProfitCents / grossLossCents
		profitFactor = &pf
	}

	_, rAmount, _ := drawdownSeries(rSeries)

	return StopLossScenario{
		ReductionPercent: reductionPercent,
		WinRate:          winRate,
		StoppedOutTrades: stoppedOut,
		AverageWinR:      averageWinR,
		ExpectancyR:      expectancyR,
		TotalR:           sumR,
		Profit:           centsToDollars(cumulativeNetCents),
		ProfitFactor:     profitFactor,
		ProfitFactorNote: note,
		AverageDrawdownR: averageNegative(rAmount),
		EquityCurve:      equityCurve,
	}
}

// pickBestStopLossScenario implements the tie-break chain: max profit
// factor, then the average drawdown closest to 0 (i.e. least negative),
// then the lower reduction.
func pickBestStopLossScenario(scenarios []StopLossScenario) StopLossBestScenario {
	if len(scenarios) == 0 {
		return StopLossBestScenario{}
	}
	best := scenarios[0]
	for _, s := range scenarios[1:] {
		if betterStopLossScenario(s, best) {
			best = s
		}
	}
	return StopLossBestScenario{ReductionPercent: best.ReductionPercent, Criterion: "profitFactorThenAverageDrawdown"}
}

func betterStopLossScenario(candidate, current StopLossScenario) bool {
	candidatePF := profitFactorRank(candidate.ProfitFactor, candidate.ProfitFactorNote)
	currentPF := profitFactorRank(current.ProfitFactor, current.ProfitFactorNote)
	if candidatePF != currentPF {
		return candidatePF > currentPF
	}
	if candidate.AverageDrawdownR != current.AverageDrawdownR {
		return candidate.AverageDrawdownR > current.AverageDrawdownR
	}
	return candidate.ReductionPercent < current.ReductionPercent
}
