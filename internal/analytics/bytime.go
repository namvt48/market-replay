package analytics

import "time"

type hourAccumulator struct {
	profitCents, lossCents, netCents int64
	sumR                             float64
	rCount                           int
	wins, total                      int
}

// buildByTime computes rule 13: 24 hourly rows, keyed by each trade's entry
// hour in loc, always fully populated so the chart's hour axis is stable.
//
// The spec's example JSON splits this into four keys (pnl/rr/profitPercent/
// winRate) but describes one row of fields per hour (profit/loss/netPnl/
// averageRr/profitPercent/winRate/totalTrades) — so all four keys here
// point at the same 24-entry list rather than four independently computed
// series, which would only risk one chart's "hour 14" drifting from
// another's.
func buildByTime(stats []*tradeStat, initialBalanceCents int64, loc *time.Location) ByTime {
	var accs [24]hourAccumulator
	for _, st := range stats {
		hour := time.Unix(st.entryTs, 0).In(loc).Hour()
		a := &accs[hour]
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
		if st.riskValid {
			a.sumR += st.actualR
			a.rCount++
		}
	}

	hourStats := make([]HourStat, 24)
	for h := 0; h < 24; h++ {
		a := accs[h]
		var avgRr, winRate, profitPercent float64
		if a.rCount > 0 {
			avgRr = a.sumR / float64(a.rCount)
		}
		if a.total > 0 {
			winRate = float64(a.wins) / float64(a.total) * 100
		}
		if initialBalanceCents > 0 {
			profitPercent = float64(a.netCents) / float64(initialBalanceCents) * 100
		}
		hourStats[h] = HourStat{
			Hour:          h,
			Profit:        centsToDollars(a.profitCents),
			Loss:          centsToDollars(a.lossCents),
			NetPnl:        centsToDollars(a.netCents),
			AverageRr:     avgRr,
			ProfitPercent: profitPercent,
			WinRate:       winRate,
			TotalTrades:   a.total,
		}
	}

	return ByTime{Pnl: hourStats, Rr: hourStats, ProfitPercent: hourStats, WinRate: hourStats}
}
