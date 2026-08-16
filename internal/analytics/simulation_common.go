package analytics

import (
	"errors"
	"math"

	"market-replay/internal/model"
)

// ErrNoEligibleTrades is returned by the stop-loss/RR simulators when every
// trade was excluded (no initial stop, invalid risk, or no market-data
// coverage) — the caller has nothing to simulate, which the httpapi layer
// maps to a typed 422 rather than a report full of zeros.
var ErrNoEligibleTrades = errors.New("analytics: no eligible trades for simulation")

// SimAuditCounts is the excludedTrades audit shared by the stop-loss and RR
// simulator responses.
type SimAuditCounts struct {
	NoInitialStop     int `json:"noInitialStop"`
	InvalidRisk       int `json:"invalidRisk"`
	MissingMarketData int `json:"missingMarketData"`
	// SmallSymbolGroups lists every symbol prepareSimTrades resolved fewer
	// than simSmallSymbolGroupFloor trades for — informational, not an
	// exclusion reason: nulling out an entire symbol's worth of simulation
	// output would leave a gap in the equity curve, so results still
	// compute, but a caller should treat that symbol's contribution as
	// statistically thin (same floor-warning spirit as
	// decisionDividendMinCoveredBadLoss, applied here as a warning rather
	// than a hard nil).
	SmallSymbolGroups []string `json:"smallSymbolGroups,omitempty"`
}

// simSmallSymbolGroupFloor is the minimum resolved-trade count per distinct
// symbol before SimAuditCounts.SmallSymbolGroups flags it as thin.
const simSmallSymbolGroupFloor = 20

// simTrade is one trade prepared for stop-loss/RR simulation: its original
// risk (distance + amount, always from the REAL InitialStopTicks — never
// the simulated/tightened one, so every scenario's R is comparable against
// the same denominator) plus the raw bars covering [EntryTs, ExitTs],
// fetched exactly once per request and re-walked for every scenario.
type simTrade struct {
	// index is the 1-based position within the included set (this
	// simulation's own stable order), used as SimEquityPoint's tradeIndex —
	// distinct from a trade's position in the source's full closed-trade
	// history, since simulations only ever cover the risk-valid subset.
	index int

	id      string
	side    string // "long" | "short"
	qty     int64
	entryTs int64
	exitTs  int64

	entryPriceTicks int64
	// riskTicks is the original |entry - initialStop| distance, always > 0.
	riskTicks int64
	// hasTarget/targetTicks capture the trade's own original
	// InitialTakeProfitTicks distance, when the trade was opened with one —
	// used by the walk-forward sensitivity re-walk and the decision-quality
	// rule-following re-walk, both of which need the ORIGINAL target
	// alongside the original stop. A trade opened with no target (hasTarget
	// false) simply has no target level to test; only its stop axis
	// applies.
	hasTarget   bool
	targetTicks int64
	// initialRiskAmountCents is riskTicks*qty*tickValueCents — the R
	// denominator, held constant across every scenario.
	initialRiskAmountCents float64
	tickValueCents         float64

	feesCents         int64
	actualNetPnlCents int64

	// bars are this trade's [EntryTs,ExitTs] window, ascending Ts —
	// fetched once via MarketData.PriceBarsBatch, walked in-memory by every
	// scenario (never re-fetched per scenario).
	bars []PriceBar
}

// prepareSimTrades filters sorted to the risk-valid, market-data-covered
// subset every stop-loss/RR scenario walks, and fetches each trade's price
// window exactly once (one PriceBarsBatch call per distinct symbol present
// in sorted, regardless of how many scenarios the caller will later
// simulate). model.Trade.Symbol is client-supplied per trade and never
// validated against its session's own symbol (see internal/httpapi/
// sessions.go's validateJournal), so a source's trades are not guaranteed
// to share one symbol — grouping by trade.Symbol here (rather than trusting
// a single request-level symbol) means one symbol's missing tick-value/bar
// coverage never blocks another symbol's trades in the same source. The
// common case (every trade shares one symbol) makes exactly the same
// TickValueCents/PriceBarsBatch calls as before this generalization.
func prepareSimTrades(sorted []model.Trade, timeframe string, md MarketData) ([]simTrade, SimAuditCounts) {
	var audit SimAuditCounts

	type candidate struct {
		trade     model.Trade
		riskTicks int64
	}
	var candidates []candidate
	for _, t := range sorted {
		if t.InitialStopTicks == nil {
			audit.NoInitialStop++
			continue
		}
		riskTicks := t.EntryPriceTicks - *t.InitialStopTicks
		if riskTicks < 0 {
			riskTicks = -riskTicks
		}
		if riskTicks <= 0 {
			audit.InvalidRisk++
			continue
		}
		candidates = append(candidates, candidate{trade: t, riskTicks: riskTicks})
	}
	if len(candidates) == 0 {
		return nil, audit
	}
	if md == nil {
		audit.MissingMarketData += len(candidates)
		return nil, audit
	}

	// Group candidate indices by symbol, preserving each group's relative
	// order — symbolOrder is only for deterministic iteration (map range
	// order is not stable), the actual output order is restored from
	// candidates' own chronological order below.
	groups := make(map[string][]int, 1)
	var symbolOrder []string
	for i, c := range candidates {
		sym := c.trade.Symbol
		if _, seen := groups[sym]; !seen {
			symbolOrder = append(symbolOrder, sym)
		}
		groups[sym] = append(groups[sym], i)
	}

	resolved := make([]*simTrade, len(candidates))
	resolvedCountBySymbol := make(map[string]int, len(symbolOrder))
	for _, sym := range symbolOrder {
		idxs := groups[sym]
		tickValueCents, ok := md.TickValueCents(sym)
		if !ok {
			audit.MissingMarketData += len(idxs)
			continue
		}
		windows := make([]TimeWindow, len(idxs))
		for j, ci := range idxs {
			windows[j] = TimeWindow{FromTs: candidates[ci].trade.EntryTs, ToTs: candidates[ci].trade.ExitTs}
		}
		priceWindows := md.PriceBarsBatch(sym, timeframe, windows)
		for j, ci := range idxs {
			if j >= len(priceWindows) || !priceWindows[j].Found {
				audit.MissingMarketData++
				continue
			}
			c := candidates[ci]
			initialRiskAmountCents := float64(c.riskTicks) * float64(c.trade.Qty) * tickValueCents
			if initialRiskAmountCents == 0 {
				// riskTicks > 0 guarantees this only if qty or tickValueCents
				// is zero, which would make every R-multiple undefined.
				audit.InvalidRisk++
				continue
			}
			hasTarget := false
			var targetTicks int64
			if c.trade.InitialTakeProfitTicks != nil {
				distance := c.trade.EntryPriceTicks - *c.trade.InitialTakeProfitTicks
				if distance < 0 {
					distance = -distance
				}
				if distance > 0 {
					hasTarget = true
					targetTicks = distance
				}
			}
			resolved[ci] = &simTrade{
				id:                     c.trade.ID,
				side:                   c.trade.Side,
				qty:                    c.trade.Qty,
				entryTs:                c.trade.EntryTs,
				exitTs:                 c.trade.ExitTs,
				entryPriceTicks:        c.trade.EntryPriceTicks,
				riskTicks:              c.riskTicks,
				hasTarget:              hasTarget,
				targetTicks:            targetTicks,
				initialRiskAmountCents: initialRiskAmountCents,
				tickValueCents:         tickValueCents,
				feesCents:              c.trade.FeesCents,
				actualNetPnlCents:      c.trade.RealizedCents,
				bars:                   priceWindows[j].Bars,
			}
			resolvedCountBySymbol[sym]++
		}
	}

	// Reassemble in candidates' original (chronological) order — never
	// grouped by symbol — since simTrade.index feeds equity-curve ordering
	// for a single account that may span more than one symbol.
	trades := make([]simTrade, 0, len(candidates))
	for _, r := range resolved {
		if r == nil {
			continue
		}
		r.index = len(trades) + 1
		trades = append(trades, *r)
	}

	for _, sym := range symbolOrder {
		if n := resolvedCountBySymbol[sym]; n > 0 && n < simSmallSymbolGroupFloor {
			audit.SmallSymbolGroups = append(audit.SmallSymbolGroups, sym)
		}
	}

	return trades, audit
}

// stopPriceTicks returns the absolute price level of a stop distanceTicks
// away from entry, on the correct side of entry for side.
func stopPriceTicks(side string, entryPriceTicks, distanceTicks int64) int64 {
	if side == "long" {
		return entryPriceTicks - distanceTicks
	}
	return entryPriceTicks + distanceTicks
}

// targetPriceTicks returns the absolute price level of a profit target
// distanceTicks away from entry, on the correct side of entry for side.
func targetPriceTicks(side string, entryPriceTicks, distanceTicks int64) int64 {
	if side == "long" {
		return entryPriceTicks + distanceTicks
	}
	return entryPriceTicks - distanceTicks
}

// stopTouched reports whether bar's range would have triggered a stop at
// stopTicks for a position on side.
func stopTouched(side string, bar PriceBar, stopTicks int64) bool {
	if side == "long" {
		return bar.LowTicks <= stopTicks
	}
	return bar.HighTicks >= stopTicks
}

// targetTouched reports whether bar's range would have triggered a profit
// target at targetTicks for a position on side.
func targetTouched(side string, bar PriceBar, targetTicks int64) bool {
	if side == "long" {
		return bar.HighTicks >= targetTicks
	}
	return bar.LowTicks <= targetTicks
}

// simulatedNetPnlCents computes the net PnL (after the trade's actual
// persisted fees — see simTrade's fee-reuse convention) of closing t at
// exitPriceTicks instead of its actual exit.
func simulatedNetPnlCents(t simTrade, exitPriceTicks int64) int64 {
	deltaTicks := exitPriceTicks - t.entryPriceTicks
	if t.side == "short" {
		deltaTicks = -deltaTicks
	}
	grossCents := float64(deltaTicks) * float64(t.qty) * t.tickValueCents
	return int64(math.Round(grossCents)) - t.feesCents
}

// drawdownSeries computes the running peak-to-trough drawdown of values —
// the same "peak so far, then min(0, value-peak)" rule the Drawdown API
// applies to an equity curve, generalized to any monotone-comparable
// series (equity dollars, balance dollars, or cumulative R). percent[i] is
// left at 0 when peak[i] is 0 (no meaningful percent of a zero base),
// never divided into NaN/Inf.
func drawdownSeries(values []float64) (peak, amount, percent []float64) {
	n := len(values)
	peak = make([]float64, n)
	amount = make([]float64, n)
	percent = make([]float64, n)
	if n == 0 {
		return
	}
	runningPeak := values[0]
	for i, v := range values {
		if v > runningPeak {
			runningPeak = v
		}
		peak[i] = runningPeak
		amt := v - runningPeak
		if amt > 0 {
			amt = 0
		}
		amount[i] = amt
		if runningPeak != 0 {
			percent[i] = amt / runningPeak * 100
		}
	}
	return
}

// averageNegative returns the mean of every negative value in series, or 0
// if none are negative (rule: "no drawdown" reports 0, not NaN from an
// empty average).
func averageNegative(series []float64) float64 {
	var sum float64
	var count int
	for _, v := range series {
		if v < 0 {
			sum += v
			count++
		}
	}
	if count == 0 {
		return 0
	}
	return sum / float64(count)
}

// SimMetadata is the shared "metadata" field of the stop-loss and RR
// simulator responses — both rely on the same conservative same-bar
// tie-break when a bar could have touched more than one price level with
// no intrabar path data to disambiguate.
type SimMetadata struct {
	IntrabarPolicy string `json:"intrabarPolicy"`
}

// SimSourceSummary is the minimal "source" envelope the simulation
// endpoints use — just enough to identify the source and its total closed
// trade count; unlike analyticsPerformanceResponse's SourceSummary, a
// simulation response has no need for title/subtitle/status/balance.
type SimSourceSummary struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	TradeCount int    `json:"tradeCount"`
}

// BuildSimSourceSummary builds a simulation response's "source" field.
func BuildSimSourceSummary(sess model.Session, trades []model.Trade) SimSourceSummary {
	sorted := sortClosedTrades(trades)
	return SimSourceSummary{
		ID:         sess.ID,
		Type:       string(SourceTypeForKind(sess.Kind)),
		TradeCount: len(sorted),
	}
}

// profitFactorRank turns a possibly-nil profit factor into a totally
// ordered rank for bestScenario selection: "no_losses" (nil with that
// note) ranks above every finite profit factor (a scenario with zero
// losing trades is unambiguously the best possible outcome), and any other
// nil case ranks last. Never returned to a caller as JSON — only used for
// in-memory comparison.
func profitFactorRank(pf *float64, note string) float64 {
	if pf == nil {
		if note == "no_losses" {
			return math.Inf(1)
		}
		return math.Inf(-1)
	}
	return *pf
}

// SimEquityPoint is one point on a simulation scenario's equity curve —
// shared by the stop-loss and RR simulators (both report cumulative-R
// alongside dollar balance, computed identically from the same
// initialRiskAmountCents denominator).
type SimEquityPoint struct {
	TradeIndex  int     `json:"tradeIndex"`
	TradeID     *string `json:"tradeId"`
	ClosedAt    *string `json:"closedAt"`
	CumulativeR float64 `json:"cumulativeR"`
	Balance     float64 `json:"balance"`
}
