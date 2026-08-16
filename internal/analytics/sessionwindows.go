package analytics

import "time"

// sessionWindow is one named market session's fixed UTC hour range
// [StartHourUTC, EndHourUTC).
type sessionWindow struct {
	name                     string
	startHourUTC, endHourUTC int
}

// sessionWindows classifies a trade's entry hour into Asia/London/New
// York/out-of-session (rule 12). These are deliberately fixed UTC hours,
// independent of the request's display timezone: a trade entered during
// the Tokyo session is "Asia" no matter which timezone the viewer's
// dashboard happens to be set to — session membership is a fact about when
// markets were open, not about the viewer's clock. The request's timezone
// still drives every *display* grouping (by-hour, by-day, by-month,
// calendar — see bytime.go etc).
var sessionWindows = []sessionWindow{
	{name: "Asia", startHourUTC: 0, endHourUTC: 7},
	{name: "London", startHourUTC: 7, endHourUTC: 12},
	{name: "New York", startHourUTC: 12, endHourUTC: 21},
	{name: "Out of session", startHourUTC: 21, endHourUTC: 24},
}

func classifySessionWindow(entryTs int64) string {
	hour := time.Unix(entryTs, 0).UTC().Hour()
	for _, w := range sessionWindows {
		if hour >= w.startHourUTC && hour < w.endHourUTC {
			return w.name
		}
	}
	return sessionWindows[len(sessionWindows)-1].name // unreachable: windows cover all 24 hours
}

type sessionAccumulator struct {
	totalTrades, wins int
	sumR              float64
	rCount            int
	totalPnlCents     int64
}

// buildBySession always emits all four named windows, even with zero
// trades, so the chart's axis is stable across sources.
func buildBySession(stats []*tradeStat) []SessionStat {
	accs := make(map[string]*sessionAccumulator, len(sessionWindows))
	for _, w := range sessionWindows {
		accs[w.name] = &sessionAccumulator{}
	}
	for _, st := range stats {
		a := accs[classifySessionWindow(st.entryTs)]
		a.totalTrades++
		if st.result == resultWinner {
			a.wins++
		}
		if st.riskValid {
			a.sumR += st.actualR
			a.rCount++
		}
		a.totalPnlCents += st.netPnlCents
	}

	out := make([]SessionStat, 0, len(sessionWindows))
	for _, w := range sessionWindows {
		a := accs[w.name]
		var winRate, avgRr float64
		if a.totalTrades > 0 {
			winRate = float64(a.wins) / float64(a.totalTrades) * 100
		}
		if a.rCount > 0 {
			avgRr = a.sumR / float64(a.rCount)
		}
		out = append(out, SessionStat{
			Session:     w.name,
			TotalTrades: a.totalTrades,
			WinRate:     winRate,
			AverageRr:   avgRr,
			TotalPnl:    centsToDollars(a.totalPnlCents),
		})
	}
	return out
}
