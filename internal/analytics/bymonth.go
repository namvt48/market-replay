package analytics

import (
	"sort"
	"time"
)

type monthAccumulator struct {
	pnlCents             int64
	totalTrades          int
	startingBalanceCents int64
	endingBalanceCents   int64
}

// periodReturnPercent is the simple return for one closed-trade period.
// A non-positive opening balance has no meaningful return denominator.
func periodReturnPercent(pnlCents, startingBalanceCents int64) *float64 {
	if startingBalanceCents <= 0 {
		return nil
	}
	value := float64(pnlCents) / float64(startingBalanceCents) * 100
	return &value
}

// buildByMonth computes rule 15: sparse rows, one per "YYYY-MM" that has at
// least one trade, keyed by close date in loc — the year is part of the
// key, so months never merge across years. stats is assumed already in
// chronological (ExitTs-ascending) order, which is what makes accumulating
// `running` while iterating in trade order (rather than in map/output
// order) produce the correct end-of-month balance for every month.
func buildByMonth(stats []*tradeStat, initialBalanceCents int64, loc *time.Location) []MonthStat {
	accs := map[string]*monthAccumulator{}
	var order []string
	running := initialBalanceCents

	for _, st := range stats {
		key := time.Unix(st.exitTs, 0).In(loc).Format("2006-01")
		a, ok := accs[key]
		if !ok {
			a = &monthAccumulator{startingBalanceCents: running}
			accs[key] = a
			order = append(order, key)
		}
		a.pnlCents += st.netPnlCents
		a.totalTrades++
		running += st.netPnlCents
		a.endingBalanceCents = running
	}

	sort.Strings(order) // "YYYY-MM" sorts chronologically as plain strings
	out := make([]MonthStat, 0, len(order))
	for _, key := range order {
		a := accs[key]
		out = append(out, MonthStat{
			Month:              key,
			MonthlyPnl:         centsToDollars(a.pnlCents),
			MonthlyGainPercent: periodReturnPercent(a.pnlCents, a.startingBalanceCents),
			EndingBalance:      centsToDollars(a.endingBalanceCents),
			TotalTrades:        a.totalTrades,
		})
	}
	return out
}
