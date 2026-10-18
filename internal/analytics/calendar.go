package analytics

import (
	"sort"
	"time"
)

type calendarAccumulator struct {
	trades, wins, losses, breakeven int
	pnlCents                        int64
	startingBalanceCents            int64
	endingBalanceCents              int64
}

// buildCalendar computes rule 16: sparse rows, one per "YYYY-MM-DD" with at
// least one trade, keyed by close date in loc. Same running-balance
// approach as buildByMonth, and for the same reason.
func buildCalendar(stats []*tradeStat, initialBalanceCents int64, loc *time.Location) []CalendarDay {
	accs := map[string]*calendarAccumulator{}
	var order []string
	running := initialBalanceCents

	for _, st := range stats {
		key := time.Unix(st.exitTs, 0).In(loc).Format("2006-01-02")
		a, ok := accs[key]
		if !ok {
			a = &calendarAccumulator{startingBalanceCents: running}
			accs[key] = a
			order = append(order, key)
		}
		a.trades++
		switch st.result {
		case resultWinner:
			a.wins++
		case resultLoser:
			a.losses++
		case resultBreakeven:
			a.breakeven++
		}
		a.pnlCents += st.netPnlCents
		running += st.netPnlCents
		a.endingBalanceCents = running
	}

	sort.Strings(order) // "YYYY-MM-DD" sorts chronologically as plain strings
	out := make([]CalendarDay, 0, len(order))
	for _, key := range order {
		a := accs[key]
		out = append(out, CalendarDay{
			Date:          key,
			Trades:        a.trades,
			Wins:          a.wins,
			Losses:        a.losses,
			Breakeven:     a.breakeven,
			Pnl:           centsToDollars(a.pnlCents),
			PnlPercent:    periodReturnPercent(a.pnlCents, a.startingBalanceCents),
			EndingBalance: centsToDollars(a.endingBalanceCents),
		})
	}
	return out
}
