package analytics

import (
	"context"
	"time"

	"market-replay/internal/model"
)

// sevenDaysSeconds bounds the Ideal RR look-ahead window (rule 6): never
// look past entry + 7 days.
const sevenDaysSeconds = 7 * 24 * 60 * 60

// Trade result classifications (rule 3). Boundaries are strict on both
// sides: netPnl exactly at +/-threshold is breakeven, not a winner/loser.
const (
	resultWinner    = "winner"
	resultLoser     = "loser"
	resultBreakeven = "breakeven"
)

// tradeStat is the per-trade working state shared by every rule below,
// computed once so e.g. actual-R and ideal-R never drift between the
// series that report them and the aggregates derived from them.
type tradeStat struct {
	// index is the trade's 1-based position in stable closed-trade order
	// (rule 1) — used as EquityPoint/RrPoint's tradeIndex.
	index int

	id              string
	symbol          string
	side            string // "long" | "short"
	entryTs         int64
	exitTs          int64
	qty             int64
	entryPriceTicks int64

	netPnlCents     int64
	result          string
	durationSeconds float64

	// riskValid mirrors model.Trade.RMultiple != nil — the trade has a
	// usable actual R-multiple (rule 5), reused verbatim from what the
	// client already computed rather than re-derived from ticks.
	riskValid bool
	actualR   float64

	// idealRiskValid means the trade has a nonzero initial stop distance in
	// ticks, so an ideal-R/MFE-R *could* be computed given tick value data.
	// riskTicks is that distance; initialRiskAmountCents is filled in once
	// tick value is known (idealrr.go), and stays 0 until then.
	idealRiskValid         bool
	riskTicks              int64
	initialRiskAmountCents float64
	mfeTicks               int64

	// idealValid additionally requires market-data coverage of the forward
	// window (rule 6). mfeR needs only tick value, not bar coverage, so it
	// is set alongside initialRiskAmountCents even when idealValid is false.
	idealValid bool
	idealR     float64
	mfeR       float64
}

func centsToDollars(cents int64) float64 { return float64(cents) / 100 }

// classifyResult applies rule 3's boundary: strictly greater than the
// threshold is a winner, strictly less than its negation is a loser,
// everything in between (including exactly at either boundary) is
// breakeven.
func classifyResult(netPnlCents, thresholdCents int64) string {
	switch {
	case netPnlCents > thresholdCents:
		return resultWinner
	case netPnlCents < -thresholdCents:
		return resultLoser
	default:
		return resultBreakeven
	}
}

// computeTradeStats builds one tradeStat per sorted trade and fills in
// everything that doesn't need market data; idealrr.go's computeIdealRR
// fills the rest.
func computeTradeStats(sorted []model.Trade, req Request) []*tradeStat {
	stats := make([]*tradeStat, len(sorted))
	for i, t := range sorted {
		st := &tradeStat{
			index:           i + 1,
			id:              t.ID,
			symbol:          t.Symbol,
			side:            t.Side,
			entryTs:         t.EntryTs,
			exitTs:          t.ExitTs,
			qty:             t.Qty,
			entryPriceTicks: t.EntryPriceTicks,
			// RealizedCents is already net of fees — the client fill engine
			// computes it as (exit-entry delta) - feesCents before ever
			// persisting the trade. Subtracting FeesCents again here would
			// double-count them.
			netPnlCents:     t.RealizedCents,
			durationSeconds: float64(t.ExitTs - t.EntryTs),
			mfeTicks:        t.MfeTicks,
		}
		st.result = classifyResult(st.netPnlCents, req.BreakevenThresholdCents)
		if t.RMultiple != nil {
			st.riskValid = true
			st.actualR = *t.RMultiple
		}
		if t.InitialStopTicks != nil {
			riskTicks := t.EntryPriceTicks - *t.InitialStopTicks
			if riskTicks < 0 {
				riskTicks = -riskTicks
			}
			if riskTicks > 0 {
				st.idealRiskValid = true
				st.riskTicks = riskTicks
			}
		}
		stats[i] = st
	}
	computeIdealRR(stats, req.Timeframe, req.MarketData)
	return stats
}

// BuildReport computes the full performance report for one source's closed
// trades. It is deterministic and side-effect free; ctx is checked only for
// cancellation, since every other input is already in memory.
func BuildReport(ctx context.Context, req Request) (Report, error) {
	if err := ctx.Err(); err != nil {
		return Report{}, err
	}
	loc := req.Location
	if loc == nil {
		loc = time.UTC
	}

	sorted := sortClosedTrades(req.Trades)
	stats := computeTradeStats(sorted, req)

	return Report{
		Overview:    buildOverview(stats, req.InitialBalanceCents),
		EquityCurve: buildEquityCurve(stats, req.InitialBalanceCents),
		RiskReward:  buildRiskReward(stats),
		Expectancy:  buildExpectancy(stats),
		Winners:     buildWinnersStats(stats, req.InitialBalanceCents),
		Losers:      buildLosersStats(stats, req.InitialBalanceCents),
		BySide:      buildBySide(stats),
		BySession:   buildBySession(stats),
		ByTime:      buildByTime(stats, req.InitialBalanceCents, loc),
		ByDay:       buildByDay(stats, loc),
		ByMonth:     buildByMonth(stats, req.InitialBalanceCents, loc),
		Calendar:    buildCalendar(stats, req.InitialBalanceCents, loc),
		Frequency:   buildFrequency(stats, loc),
	}, nil
}
