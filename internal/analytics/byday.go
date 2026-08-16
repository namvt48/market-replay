package analytics

import "time"

var weekdayNames = [7]string{"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"}

// mondayIndex converts Go's Sunday=0..Saturday=6 Weekday into Monday=0..Sunday=6.
func mondayIndex(wd time.Weekday) int {
	return (int(wd) + 6) % 7
}

type dayAccumulator struct {
	profitCents, lossCents, netCents int64
	wins, total                      int
}

// buildByDay computes rule 14: always Monday..Sunday, keyed by each trade's
// close date in loc (grouping by close, not open, matches the equity
// curve's own convention of realizing PnL at exit).
func buildByDay(stats []*tradeStat, loc *time.Location) []DayStat {
	var accs [7]dayAccumulator
	for _, st := range stats {
		idx := mondayIndex(time.Unix(st.exitTs, 0).In(loc).Weekday())
		a := &accs[idx]
		a.total++
		a.netCents += st.netPnlCents
		switch {
		case st.netPnlCents > 0:
			a.profitCents += st.netPnlCents
		case st.netPnlCents < 0:
			a.lossCents += st.netPnlCents
		}
		if st.result == resultWinner {
			a.wins++
		}
	}

	out := make([]DayStat, 7)
	for i := 0; i < 7; i++ {
		a := accs[i]
		var winRate float64
		if a.total > 0 {
			winRate = float64(a.wins) / float64(a.total) * 100
		}
		out[i] = DayStat{
			Day:         weekdayNames[i],
			Profit:      centsToDollars(a.profitCents),
			Loss:        centsToDollars(a.lossCents),
			NetPnl:      centsToDollars(a.netCents),
			TotalTrades: a.total,
			Wins:        a.wins,
			WinRate:     winRate,
		}
	}
	return out
}
