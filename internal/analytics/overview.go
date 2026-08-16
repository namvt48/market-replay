package analytics

import (
	"sort"
	"time"

	"market-replay/internal/model"
)

// sortClosedTrades orders trades by close time (rule 1). Ties break on
// CreatedAt then ID — a total order, so every input produces exactly one
// output ordering regardless of the sort algorithm's stability.
func sortClosedTrades(trades []model.Trade) []model.Trade {
	sorted := make([]model.Trade, len(trades))
	copy(sorted, trades)
	sort.Slice(sorted, func(i, j int) bool {
		a, b := sorted[i], sorted[j]
		if a.ExitTs != b.ExitTs {
			return a.ExitTs < b.ExitTs
		}
		if a.CreatedAt != b.CreatedAt {
			return a.CreatedAt < b.CreatedAt
		}
		return a.ID < b.ID
	})
	return sorted
}

// formatTimestamp renders an epoch-second value as UTC RFC3339 — a point in
// time is absolute and does not depend on the request's display timezone
// (that only affects bucketing — see bytime.go/byday.go/etc).
func formatTimestamp(ts int64) *string {
	s := time.Unix(ts, 0).UTC().Format(time.RFC3339)
	return &s
}

// buildOverview computes rules 1-4.
func buildOverview(stats []*tradeStat, initialBalanceCents int64) Overview {
	var totalPnlCents int64
	var longCount, shortCount, breakevenCount, winCount int
	for _, st := range stats {
		totalPnlCents += st.netPnlCents
		switch st.side {
		case "long":
			longCount++
		case "short":
			shortCount++
		}
		switch st.result {
		case resultBreakeven:
			breakevenCount++
		case resultWinner:
			winCount++
		}
	}

	total := len(stats)
	var winRate float64
	if total > 0 {
		winRate = float64(winCount) / float64(total) * 100
	}
	var pnlPercent float64
	if initialBalanceCents > 0 {
		pnlPercent = float64(totalPnlCents) / float64(initialBalanceCents) * 100
	}

	return Overview{
		TotalPnl:        centsToDollars(totalPnlCents),
		PnlPercent:      pnlPercent,
		AccountBalance:  centsToDollars(initialBalanceCents + totalPnlCents),
		WinRate:         winRate,
		TotalTrades:     total,
		LongTrades:      longCount,
		ShortTrades:     shortCount,
		BreakevenTrades: breakevenCount,
	}
}

// buildEquityCurve always returns len(stats)+1 points: a synthetic "before
// any trade" point at index 0, then one point per closed trade in the same
// stable order used everywhere else.
func buildEquityCurve(stats []*tradeStat, initialBalanceCents int64) []EquityPoint {
	curve := make([]EquityPoint, 0, len(stats)+1)
	curve = append(curve, EquityPoint{
		TradeIndex:    0,
		CumulativePnl: 0,
		Balance:       centsToDollars(initialBalanceCents),
	})

	var cumulative int64
	for _, st := range stats {
		cumulative += st.netPnlCents
		id := st.id
		curve = append(curve, EquityPoint{
			TradeIndex:    st.index,
			TradeID:       &id,
			ClosedAt:      formatTimestamp(st.exitTs),
			CumulativePnl: centsToDollars(cumulative),
			Balance:       centsToDollars(initialBalanceCents + cumulative),
		})
	}
	return curve
}
