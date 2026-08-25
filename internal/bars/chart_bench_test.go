package bars

import (
	"testing"
	"time"

	"market-replay/internal/model"
)

// buildDailyCalendarFixture builds n consecutive daily bars (one per
// calendar day, no weekends skipped — irrelevant for this benchmark's
// purpose of measuring scan cost against calendar size) plus the matching
// Calendar index, mirroring how a real multi-year NQ dataset looks to
// aggregateCalendarChartWindow.
func buildDailyCalendarFixture(t testing.TB, n int, startTs uint32) (*BarFile, *Calendar) {
	t.Helper()
	const daySeconds = 86400
	file, err := newUTCIndexedBarFile(simpleFixture(n, startTs, daySeconds))
	if err != nil {
		t.Fatal(err)
	}
	dates := make([]string, n)
	byDate := make(map[string]idxEntry, n)
	for i := 0; i < n; i++ {
		date := time.Unix(int64(startTs)+int64(i)*daySeconds, 0).UTC().Format("2006-01-02")
		dates[i] = date
		byDate[date] = idxEntry{Offset: i, Count: 1}
	}
	return file, &Calendar{byDate: byDate, dates: dates}
}

// BenchmarkAggregateCalendarChartWindow_Deep measures aggregateCalendarChartWindow's
// cost when atTs sits at the far end of a ~15-year daily calendar (~5500
// entries) — the case internal/bars agent audit flagged as scaling with
// history depth rather than window size, since the loop always rebuilds
// `windows` from calendar.dates[0].
func BenchmarkAggregateCalendarChartWindow_Deep(b *testing.B) {
	const n = 5500
	file, calendar := buildDailyCalendarFixture(b, n, 1_000_000_000)
	meta := model.SymbolMeta{Kind: "future", SessionTz: "America/New_York"}
	lastTs := file.TsAt(n - 1)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := AggregateChartWindow(file, calendar, meta, "1d", lastTs, 240, 0, lastTs); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkAggregateCalendarChartWindow_Shallow is the same dataset with
// atTs near the start of history — the cheap case today, and the baseline
// an O(depth) scan should NOT regress relative to.
func BenchmarkAggregateCalendarChartWindow_Shallow(b *testing.B) {
	const n = 5500
	file, calendar := buildDailyCalendarFixture(b, n, 1_000_000_000)
	meta := model.SymbolMeta{Kind: "future", SessionTz: "America/New_York"}
	earlyTs := file.TsAt(300)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := AggregateChartWindow(file, calendar, meta, "1d", earlyTs, 240, 0, earlyTs); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkAggregateChartWindow_MinuteTf covers the non-calendar (m/h) path
// for comparison — chart-bars/at's other common case.
func BenchmarkAggregateChartWindow_MinuteTf(b *testing.B) {
	const n = 50_000
	file, err := newUTCIndexedBarFile(simpleFixture(n, 1_000_000_000, 60))
	if err != nil {
		b.Fatal(err)
	}
	meta := model.SymbolMeta{Kind: "future", SessionTz: "America/New_York"}
	atTs := file.TsAt(n - 1)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := AggregateChartWindow(file, nil, meta, "5m", atTs, 240, 0, atTs); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkLoadLocation_Uncached measures time.LoadLocation's real per-call
// cost (tzdata lookup/parse) — the cost AggregateChartWindow pays on every
// single /chart-bars/at request today (chart.go's `location, err =
// time.LoadLocation(meta.SessionTz)`, no cache).
func BenchmarkLoadLocation_Uncached(b *testing.B) {
	for i := 0; i < b.N; i++ {
		if _, err := time.LoadLocation("America/New_York"); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkLoadLocation_Cached measures the sync.Map-backed cache this
// package adds in chart.go — the fix for the benchmark above.
func BenchmarkLoadLocation_Cached(b *testing.B) {
	if _, err := cachedLoadLocation("America/New_York"); err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := cachedLoadLocation("America/New_York"); err != nil {
			b.Fatal(err)
		}
	}
}
