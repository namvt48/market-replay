package analytics

import (
	"fmt"
	"sort"
	"time"
)

func truncateToDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

func zeroWeekdayFrequency() []WeekdayFrequency {
	out := make([]WeekdayFrequency, 7)
	for i, name := range weekdayNames {
		out[i] = WeekdayFrequency{Day: name}
	}
	return out
}

// buildFrequency computes rule 17, keyed by each trade's close date in loc.
//
// byWeekday's average is trades-of-that-weekday divided by how many times
// that weekday actually occurred across the source's full date span
// (first trade's day to last trade's day) — not divided by a flat 7, and
// not divided by "days with at least one trade" — so a source that never
// traded on, say, a Saturday still reports a true (zero) average for it
// rather than skewing the other days' denominators.
func buildFrequency(stats []*tradeStat, loc *time.Location) Frequency {
	if len(stats) == 0 {
		return Frequency{ByWeekday: zeroWeekdayFrequency()}
	}

	firstDay := truncateToDay(time.Unix(stats[0].exitTs, 0).In(loc))
	lastDay := truncateToDay(time.Unix(stats[len(stats)-1].exitTs, 0).In(loc))

	var weekdayTradeCounts, weekdayOccurrences [7]int
	weekTrades := map[string]int{}
	weekBounds := map[string][2]time.Time{}
	var weekOrder []string
	monthTrades := map[string]int{}
	var monthOrder []string

	for _, st := range stats {
		t := time.Unix(st.exitTs, 0).In(loc)
		weekdayTradeCounts[mondayIndex(t.Weekday())]++

		year, week := t.ISOWeek()
		wkey := fmt.Sprintf("%04d-W%02d", year, week)
		if _, ok := weekTrades[wkey]; !ok {
			weekOrder = append(weekOrder, wkey)
			monday := truncateToDay(t.AddDate(0, 0, -mondayIndex(t.Weekday())))
			weekBounds[wkey] = [2]time.Time{monday, monday.AddDate(0, 0, 6)}
		}
		weekTrades[wkey]++

		mkey := t.Format("2006-01")
		if _, ok := monthTrades[mkey]; !ok {
			monthOrder = append(monthOrder, mkey)
		}
		monthTrades[mkey]++
	}

	totalDays := 0
	for d := firstDay; !d.After(lastDay); d = d.AddDate(0, 0, 1) {
		weekdayOccurrences[mondayIndex(d.Weekday())]++
		totalDays++
	}

	byWeekday := make([]WeekdayFrequency, 7)
	for i := 0; i < 7; i++ {
		var avg float64
		if weekdayOccurrences[i] > 0 {
			avg = float64(weekdayTradeCounts[i]) / float64(weekdayOccurrences[i])
		}
		byWeekday[i] = WeekdayFrequency{Day: weekdayNames[i], AverageTrades: avg}
	}

	sort.Strings(weekOrder)
	byWeek := make([]WeekFrequency, 0, len(weekOrder))
	for _, key := range weekOrder {
		bounds := weekBounds[key]
		byWeek = append(byWeek, WeekFrequency{
			WeekStart:   bounds[0].Format("2006-01-02"),
			WeekEnd:     bounds[1].Format("2006-01-02"),
			TotalTrades: weekTrades[key],
		})
	}

	sort.Strings(monthOrder)
	byMonth := make([]MonthFrequency, 0, len(monthOrder))
	for _, key := range monthOrder {
		byMonth = append(byMonth, MonthFrequency{Month: key, TotalTrades: monthTrades[key]})
	}

	total := len(stats)
	var avgPerDay, avgPerWeek, avgPerMonth float64
	if totalDays > 0 {
		avgPerDay = float64(total) / float64(totalDays)
	}
	if len(weekOrder) > 0 {
		avgPerWeek = float64(total) / float64(len(weekOrder))
	}
	if len(monthOrder) > 0 {
		avgPerMonth = float64(total) / float64(len(monthOrder))
	}

	return Frequency{
		ByWeekday:             byWeekday,
		ByWeek:                byWeek,
		ByMonth:               byMonth,
		AverageTradesPerDay:   avgPerDay,
		AverageTradesPerWeek:  avgPerWeek,
		AverageTradesPerMonth: avgPerMonth,
	}
}
