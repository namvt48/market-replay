package analytics

import (
	"context"
	"fmt"
	"math"

	"market-replay/internal/model"
)

// RRSimulationRequest is one RR (risk-reward target) simulator computation
// over a single source's closed trades. TargetsR is assumed already
// validated and deduped (1-20 items, each in [0.1,50]) by the httpapi
// layer. Timeframe is the source session's own — there is no per-trade
// equivalent to group by, unlike Symbol (see prepareSimTrades).
type RRSimulationRequest struct {
	Trades              []model.Trade
	Timeframe           string
	InitialBalanceCents int64
	MarketData          MarketData
	TargetsR            []float64
	IncludeCurrentModel bool
}

// RRScenario is one target's (or the "current" baseline's) simulated
// outcome across every included trade. TargetR is nil for "current".
// AverageDrawdownPercent is a positive magnitude (unlike DrawdownPoint's
// signed convention) per the spec's FE-display rule.
type RRScenario struct {
	ID                     string           `json:"id"`
	TargetR                *float64         `json:"targetR"`
	Label                  string           `json:"label"`
	WinRate                float64          `json:"winRate"`
	Profit                 float64          `json:"profit"`
	ProfitFactor           *float64         `json:"profitFactor"`
	ProfitFactorNote       string           `json:"profitFactorNote,omitempty"`
	AverageDrawdownPercent float64          `json:"averageDrawdownPercent"`
	EquityCurve            []SimEquityPoint `json:"equityCurve"`
}

// RRBestScenario picks the recommended scenario: maximize profit factor,
// ties kept toward whichever scenario appears first in the response array
// (current first if included, then each targetR in the CLIENT'S REQUEST
// ORDER — deduped but never re-sorted; see TestRR_ScenarioOrderMatchesRequestOrder).
type RRBestScenario struct {
	ID        string `json:"id"`
	Criterion string `json:"criterion"`
}

// RRSimulationResult is BuildRRSimulation's return value, minus the
// "source" envelope (added by the httpapi layer).
type RRSimulationResult struct {
	IncludedTrades int            `json:"includedTrades"`
	ExcludedTrades SimAuditCounts `json:"excludedTrades"`
	Scenarios      []RRScenario   `json:"scenarios"`
	BestScenario   RRBestScenario `json:"bestScenario"`
	Metadata       SimMetadata    `json:"metadata"`
}

// BuildRRSimulation resimulates each targetR scenario (plus an optional
// "current" baseline using actual persisted outcomes) against every
// risk-valid, market-data-covered trade. Each target scenario keeps the
// original initial stop and adds a profit target at targetR*originalRisk;
// whichever level a trade's pre-fetched bars touch first (prepareSimTrades)
// decides the simulated exit, stop-first on same-bar ambiguity; touching
// neither before the actual exit keeps the actual outcome.
func BuildRRSimulation(ctx context.Context, req RRSimulationRequest) (RRSimulationResult, error) {
	if err := ctx.Err(); err != nil {
		return RRSimulationResult{}, err
	}

	sorted := sortClosedTrades(req.Trades)
	simTrades, audit := prepareSimTrades(sorted, req.Timeframe, req.MarketData)
	if len(simTrades) == 0 {
		return RRSimulationResult{}, ErrNoEligibleTrades
	}

	var scenarios []RRScenario
	if req.IncludeCurrentModel {
		scenarios = append(scenarios, buildCurrentRRScenario(simTrades, req.InitialBalanceCents))
	}
	for _, target := range req.TargetsR {
		scenarios = append(scenarios, buildTargetRRScenario(simTrades, target, req.InitialBalanceCents))
	}

	return RRSimulationResult{
		IncludedTrades: len(simTrades),
		ExcludedTrades: audit,
		Scenarios:      scenarios,
		BestScenario:   pickBestRRScenario(scenarios),
		Metadata:       SimMetadata{IntrabarPolicy: "stop-first"},
	}, nil
}

// simulateRRTrade walks t's pre-fetched bars looking for the first bar
// touching either the original stop or the targetR profit target,
// stop-first on same-bar ambiguity; a window with no touch at all keeps
// the actual outcome (equivalent to "neither hit before the actual exit",
// since the window never extends past it).
func simulateRRTrade(t simTrade, targetR float64) int64 {
	stopTicks := stopPriceTicks(t.side, t.entryPriceTicks, t.riskTicks)
	targetDistance := int64(math.Round(float64(t.riskTicks) * targetR))
	targetTicks := targetPriceTicks(t.side, t.entryPriceTicks, targetDistance)

	for _, bar := range t.bars {
		switch {
		case stopTouched(t.side, bar, stopTicks):
			return simulatedNetPnlCents(t, stopTicks)
		case targetTouched(t.side, bar, targetTicks):
			return simulatedNetPnlCents(t, targetTicks)
		}
	}
	return t.actualNetPnlCents
}

func buildCurrentRRScenario(trades []simTrade, initialBalanceCents int64) RRScenario {
	netPnl := make([]int64, len(trades))
	for i, t := range trades {
		netPnl[i] = t.actualNetPnlCents
	}
	return buildRRScenarioResult("current", nil, "Current RR", trades, netPnl, initialBalanceCents)
}

func buildTargetRRScenario(trades []simTrade, targetR float64, initialBalanceCents int64) RRScenario {
	netPnl := make([]int64, len(trades))
	for i, t := range trades {
		netPnl[i] = simulateRRTrade(t, targetR)
	}
	tr := targetR
	id := fmt.Sprintf("target-%.1f", targetR)
	label := fmt.Sprintf("%.1fR", targetR)
	return buildRRScenarioResult(id, &tr, label, trades, netPnl, initialBalanceCents)
}

// buildRRScenarioResult aggregates one scenario's per-trade net PnL
// (netPnlCents, index-aligned with trades) into the scenario's stats and
// equity curve. Shared by both the "current" baseline and every targetR
// scenario so their aggregation math never drifts apart.
func buildRRScenarioResult(id string, targetR *float64, label string, trades []simTrade, netPnlCents []int64, initialBalanceCents int64) RRScenario {
	equityCurve := make([]SimEquityPoint, 0, len(trades)+1)
	equityCurve = append(equityCurve, SimEquityPoint{Balance: centsToDollars(initialBalanceCents)})
	balanceSeries := make([]float64, 0, len(trades)+1)
	balanceSeries = append(balanceSeries, centsToDollars(initialBalanceCents))

	var wins int
	var grossProfitCents, grossLossCents float64
	var cumulativeNetCents int64
	var cumulativeR float64

	for i, t := range trades {
		pnl := netPnlCents[i]
		cumulativeNetCents += pnl
		cumulativeR += float64(pnl) / t.initialRiskAmountCents
		switch {
		case pnl > 0:
			wins++
			grossProfitCents += float64(pnl)
		case pnl < 0:
			grossLossCents += -float64(pnl)
		}

		tradeID := t.id
		balanceDollars := centsToDollars(initialBalanceCents + cumulativeNetCents)
		equityCurve = append(equityCurve, SimEquityPoint{
			TradeIndex:  t.index,
			TradeID:     &tradeID,
			ClosedAt:    formatTimestamp(t.exitTs),
			CumulativeR: cumulativeR,
			Balance:     balanceDollars,
		})
		balanceSeries = append(balanceSeries, balanceDollars)
	}

	total := len(trades)
	var winRate float64
	if total > 0 {
		winRate = float64(wins) / float64(total) * 100
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

	_, _, balancePercent := drawdownSeries(balanceSeries)
	avgDrawdownPercent := math.Abs(averageNegative(balancePercent))

	return RRScenario{
		ID:                     id,
		TargetR:                targetR,
		Label:                  label,
		WinRate:                winRate,
		Profit:                 centsToDollars(cumulativeNetCents),
		ProfitFactor:           profitFactor,
		ProfitFactorNote:       note,
		AverageDrawdownPercent: avgDrawdownPercent,
		EquityCurve:            equityCurve,
	}
}

// pickBestRRScenario maximizes profit factor; ties keep whichever scenario
// appears first in the response array (current, then targetsR in request order).
func pickBestRRScenario(scenarios []RRScenario) RRBestScenario {
	if len(scenarios) == 0 {
		return RRBestScenario{}
	}
	bestIdx := 0
	bestRank := profitFactorRank(scenarios[0].ProfitFactor, scenarios[0].ProfitFactorNote)
	for i := 1; i < len(scenarios); i++ {
		rank := profitFactorRank(scenarios[i].ProfitFactor, scenarios[i].ProfitFactorNote)
		if rank > bestRank {
			bestRank = rank
			bestIdx = i
		}
	}
	return RRBestScenario{ID: scenarios[bestIdx].ID, Criterion: "profitFactor"}
}
