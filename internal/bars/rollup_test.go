package bars

import (
	"fmt"
	"testing"
	"time"

	"market-replay/internal/model"
)

// buildSessionFixture builds `sessions` consecutive weekday CME-style
// futures sessions of 1m bars (18:00 ET previous day through 17:00 ET, with
// the usual one-hour maintenance break omitted) plus the matching Calendar
// — the shape /chart-bars/at actually sees for NQ.
func buildSessionFixture(t testing.TB, sessions int, firstOpen time.Time) (*BarFile, *Calendar) {
	t.Helper()
	const barsPerSession = 23 * 60

	var ts []uint32
	var open, high, low, closeCol []int32
	var vol []uint32
	dates := make([]string, 0, sessions)
	byDate := make(map[string]idxEntry, sessions)

	price := int32(60_000)
	day := firstOpen
	for session := 0; session < sessions; session++ {
		for day.Weekday() == time.Friday || day.Weekday() == time.Saturday {
			day = day.AddDate(0, 0, 1)
		}
		offset := len(ts)
		for minute := 0; minute < barsPerSession; minute++ {
			// Deterministic but non-monotonic price walk, so high/low folding
			// is actually exercised instead of trivially tracking `open`.
			price += int32((session*7+minute*13)%11) - 5
			ts = append(ts, uint32(day.Add(time.Duration(minute)*time.Minute).Unix()))
			open = append(open, price)
			high = append(high, price+int32(minute%9)+1)
			low = append(low, price-int32(minute%7)-1)
			closeCol = append(closeCol, price+1)
			vol = append(vol, uint32(1+minute%50))
		}
		date := day.AddDate(0, 0, 1).Format("2006-01-02")
		dates = append(dates, date)
		byDate[date] = idxEntry{Offset: offset, Count: barsPerSession}
		day = day.AddDate(0, 0, 1)
	}

	// Indexed in the same session timezone the fixture's sessions are laid
	// out in, so the RTH indexes line up with the 09:30 opens these bars have.
	file, err := newIndexedBarFile(buildFixture(ts, open, high, low, closeCol, vol), firstOpen.Location())
	if err != nil {
		t.Fatal(err)
	}
	calendar := &Calendar{byDate: byDate, dates: dates}
	// Same wiring order the registry uses: index() builds the hourly and RTH
	// indexes, the calendar-derived daily index is attached afterwards.
	file.attachCalendarRollup(calendar, indexPlan{rollups: true, location: firstOpen.Location()})
	return file, calendar
}

// TestAggregateChartWindowRollupMatchesScan is the correctness gate for the
// rollup index: for every timeframe routed through it, and for spoiler
// boundaries deliberately landing mid-bucket, the precomputed path must
// return byte-identical bars to the raw-scan path it replaces.
//
// Clearing file.rollups is what forces the reference implementation, since
// rollupFor returns nil without an index and AggregateChartWindow falls
// back to the calendar/minute scans.
func TestAggregateChartWindowRollupMatchesScan(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	meta := model.SymbolMeta{Kind: "future", SessionTz: "America/New_York"}
	file, calendar := buildSessionFixture(t, 70, time.Date(2025, time.January, 5, 18, 0, 0, 0, location))
	scanOnly := *file
	scanOnly.rollups = nil

	lastTs := file.TsAt(file.Count() - 1)
	firstTs := file.TsAt(0)
	midTs := file.TsAt(file.Count() / 2)

	anchors := []struct {
		name string
		at   int64
	}{
		{"last", lastTs},
		{"mid", midTs},
		{"mid+37m", midTs + 37*60},
		{"first", firstTs},
		{"before-history", firstTs - 86_400},
		{"after-history", lastTs + 86_400},
	}
	// Boundaries chosen to cut the newest bucket in half — the case the
	// rollup must recompute from raw bars rather than serve precomputed.
	boundaries := []struct {
		name  string
		delta int64
	}{
		{"exact", 0},
		{"minus-1m", -60},
		{"minus-97m", -97 * 60},
		{"minus-1d", -86_400},
		{"minus-9d", -9 * 86_400},
	}

	for _, tf := range []string{"1h", "2h", "4h", "120m", "1d", "1w", "2w", "1M"} {
		// Without this the whole table would silently compare the scan path
		// against itself and pass no matter what the rollup does.
		parsed, err := parseChartTimeframe(tf)
		if err != nil {
			t.Fatal(err)
		}
		if rollupFor(file, calendar, parsed) == nil {
			t.Fatalf("%s is not routed through a rollup; this table proves nothing for it", tf)
		}
		if rollupFor(&scanOnly, calendar, parsed) != nil {
			t.Fatalf("%s reference path still has an index attached", tf)
		}
		for _, anchor := range anchors {
			for _, boundary := range boundaries {
				for _, window := range [][2]int{{1, 0}, {5, 0}, {240, 0}, {3, 4}, {0, 2}} {
					name := fmt.Sprintf("%s/%s/%s/before=%d,after=%d", tf, anchor.name, boundary.name, window[0], window[1])
					t.Run(name, func(t *testing.T) {
						maxTs := anchor.at + boundary.delta
						got, err := AggregateChartWindow(file, calendar, meta, tf, anchor.at, window[0], window[1], maxTs)
						if err != nil {
							t.Fatalf("rollup path: %v", err)
						}
						want, err := AggregateChartWindow(&scanOnly, calendar, meta, tf, anchor.at, window[0], window[1], maxTs)
						if err != nil {
							t.Fatalf("scan path: %v", err)
						}
						if len(got) != len(want) {
							t.Fatalf("len = %d, want %d\n got=%+v\nwant=%+v", len(got), len(want), got, want)
						}
						for i := range want {
							if got[i] != want[i] {
								t.Fatalf("bar %d = %+v, want %+v", i, got[i], want[i])
							}
						}
						_ = location
					})
				}
			}
		}
	}
}

// TestAggregateRTHChartWindowRollupMatchesScan keeps the RTH index honest by
// comparing it with the existing raw-filter implementation. The cases include
// multi-hour, daily, weekly and monthly buckets plus spoiler boundaries that
// cut the newest RTH entry in half.
func TestAggregateRTHChartWindowRollupMatchesScan(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	meta := model.SymbolMeta{Kind: "future", SessionTz: "America/New_York"}
	file, calendar := buildSessionFixture(t, 70, time.Date(2025, time.January, 5, 18, 0, 0, 0, location))
	scanOnly := *file
	scanOnly.rollups = &rollups{hourly: file.rollups.hourly, daily: file.rollups.daily}

	lastTs := file.TsAt(file.Count() - 1)
	midTs := file.TsAt(file.Count() / 2)
	anchors := []struct {
		name string
		at   int64
	}{
		{"last", lastTs},
		{"mid", midTs},
		{"mid-session", midTs + 211*60},
	}
	boundaries := []struct {
		name  string
		delta int64
	}{
		{"exact", 0},
		{"minus-47m", -47 * 60},
		{"minus-2d", -2 * 86_400},
	}

	for _, tf := range []string{"1h", "2h", "4h", "120m", "1d", "1w", "2w", "1M"} {
		parsed, err := parseChartTimeframe(tf)
		if err != nil {
			t.Fatal(err)
		}
		if rthRollupFor(file, parsed) == nil {
			t.Fatalf("%s is not routed through an RTH rollup; this table proves nothing for it", tf)
		}
		if rthRollupFor(&scanOnly, parsed) != nil {
			t.Fatalf("%s reference path still has an RTH index attached", tf)
		}
		for _, anchor := range anchors {
			for _, boundary := range boundaries {
				for _, window := range [][2]int{{1, 0}, {12, 0}, {60, 0}, {3, 4}} {
					name := fmt.Sprintf("%s/%s/%s/before=%d,after=%d", tf, anchor.name, boundary.name, window[0], window[1])
					t.Run(name, func(t *testing.T) {
						maxTs := anchor.at + boundary.delta
						got, err := AggregateChartWindowForSession(file, calendar, meta, tf, anchor.at, window[0], window[1], maxTs, "rth")
						if err != nil {
							t.Fatalf("RTH rollup path: %v", err)
						}
						want, err := AggregateChartWindowForSession(&scanOnly, calendar, meta, tf, anchor.at, window[0], window[1], maxTs, "rth")
						if err != nil {
							t.Fatalf("RTH scan path: %v", err)
						}
						if len(got) != len(want) {
							t.Fatalf("len = %d, want %d\n got=%+v\nwant=%+v", len(got), len(want), got, want)
						}
						for i := range want {
							if got[i] != want[i] {
								t.Fatalf("bar %d = %+v, want %+v", i, got[i], want[i])
							}
						}
					})
				}
			}
		}
	}
}

func TestAggregateRTHChartWindowFallsBackWhenIndexIsUnavailable(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	meta := model.SymbolMeta{Kind: "future", SessionTz: "America/New_York"}
	file, calendar := buildSessionFixture(t, 20, time.Date(2025, time.March, 3, 18, 0, 0, 0, location))
	indexed, err := AggregateChartWindowForSession(file, calendar, meta, "1w", file.TsAt(file.Count()-1), 8, 0, file.TsAt(file.Count()-1), "rth")
	if err != nil {
		t.Fatalf("indexed aggregation: %v", err)
	}
	file.rollups.rthHourly = nil
	file.rollups.rthDaily = nil
	fallback, err := AggregateChartWindowForSession(file, calendar, meta, "1w", file.TsAt(file.Count()-1), 8, 0, file.TsAt(file.Count()-1), "rth")
	if err != nil {
		t.Fatalf("fallback aggregation: %v", err)
	}
	if len(fallback) != len(indexed) {
		t.Fatalf("fallback bars = %d, want %d", len(fallback), len(indexed))
	}
	for i := range indexed {
		if fallback[i] != indexed[i] {
			t.Fatalf("fallback bar %d = %+v, want %+v", i, fallback[i], indexed[i])
		}
	}
}

// TestRollupFallsBackWithoutCalendar pins the routing table: no .idx means
// no daily index, so session timeframes keep using the raw scan (and the
// hourly index still serves 'h').
func TestRollupFallsBackWithoutCalendar(t *testing.T) {
	file, err := newUTCIndexedBarFile(simpleFixture(5_000, 1_700_000_000, 60))
	if err != nil {
		t.Fatal(err)
	}
	if got := rollupFor(file, nil, chartTimeframe{multiplier: 1, unit: 'd'}); got != nil {
		t.Errorf("daily rollup used without a calendar")
	}
	if got := rollupFor(file, nil, chartTimeframe{multiplier: 1, unit: 'h'}); got == nil {
		t.Errorf("hourly rollup unavailable for 1h")
	}
	// 5m/90m buckets can split an hour, so they must not read hour entries.
	for _, multiplier := range []int{5, 15, 90} {
		if got := rollupFor(file, nil, chartTimeframe{multiplier: multiplier, unit: 'm'}); got != nil {
			t.Errorf("%dm used the hourly rollup; its buckets do not align to hours", multiplier)
		}
	}
	if got := rollupFor(file, nil, chartTimeframe{multiplier: 120, unit: 'm'}); got == nil {
		t.Errorf("120m should use the hourly rollup")
	}
}

// TestBuildDailyRollupRejectsStaleCalendar keeps a mismatched .idx degrading
// to the raw scan (which reports ErrIdxOutOfBounds per request) instead of
// silently serving bars sliced from the wrong offsets.
func TestBuildDailyRollupRejectsStaleCalendar(t *testing.T) {
	file, err := newUTCIndexedBarFile(simpleFixture(100, 1_700_000_000, 60))
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]*Calendar{
		"offset past end": {
			byDate: map[string]idxEntry{"2023-11-14": {Offset: 90, Count: 50}},
			dates:  []string{"2023-11-14"},
		},
		"negative offset": {
			byDate: map[string]idxEntry{"2023-11-14": {Offset: -1, Count: 10}},
			dates:  []string{"2023-11-14"},
		},
		"zero count": {
			byDate: map[string]idxEntry{"2023-11-14": {Offset: 0, Count: 0}},
			dates:  []string{"2023-11-14"},
		},
		"overlapping ranges": {
			byDate: map[string]idxEntry{
				"2023-11-14": {Offset: 0, Count: 60},
				"2023-11-15": {Offset: 30, Count: 40},
			},
			dates: []string{"2023-11-14", "2023-11-15"},
		},
	}
	for name, calendar := range cases {
		t.Run(name, func(t *testing.T) {
			rejected := file.attachCalendarRollup(calendar, indexPlan{rollups: true, location: time.UTC})
			if file.rollups.daily != nil {
				t.Fatalf("built a daily rollup from a stale calendar: %+v", file.rollups.daily)
			}
			// The reason has to reach the operator; a silent nil turned a
			// stale .idx into unexplained slowness.
			if rejected == "" {
				t.Error("rejected a stale calendar without saying why")
			}
			// Range must stay on the linear scan, which is what keeps
			// ErrIdxOutOfBounds firing per request instead of a binary search
			// walking ranges that were never checked.
			if calendar.ordered {
				t.Error("stale calendar marked ordered; Range would binary-search it")
			}
		})
	}
}

// TestDailyRollupMatchesRawAggregation pins foldRange: deriving a session
// day from whole hourly entries plus two partial edges must produce exactly
// what folding its raw bars one by one would.
func TestDailyRollupMatchesRawAggregation(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	// A 17:23 first open deliberately puts every session boundary mid-hour,
	// so both partial-edge branches of foldRange run on every entry.
	file, calendar := buildSessionFixture(t, 12, time.Date(2025, time.March, 3, 17, 23, 0, 0, location))
	daily := file.rollups.daily
	if len(daily) != len(calendar.dates) {
		t.Fatalf("daily entries = %d, want %d", len(daily), len(calendar.dates))
	}
	for i, date := range calendar.dates {
		entry := calendar.byDate[date]
		want := aggregateRawRange(file, entry.Offset, entry.Offset+entry.Count)
		if daily[i] != want {
			t.Fatalf("session %s = %+v, want %+v", date, daily[i], want)
		}
	}
}

// TestHourlyRollupCoversEveryBar guards the invariant foldRollupEntries
// depends on: the hourly index partitions the file exactly, with no gap and
// no overlap.
func TestHourlyRollupCoversEveryBar(t *testing.T) {
	file, err := newUTCIndexedBarFile(simpleFixture(3_601, 1_700_000_037, 60))
	if err != nil {
		t.Fatal(err)
	}
	entries := file.rollups.hourly
	if len(entries) == 0 {
		t.Fatal("no hourly entries")
	}
	if entries[0].from != 0 {
		t.Errorf("first entry starts at %d, want 0", entries[0].from)
	}
	if int(entries[len(entries)-1].to) != file.Count() {
		t.Errorf("last entry ends at %d, want %d", entries[len(entries)-1].to, file.Count())
	}
	for i, entry := range entries {
		if entry.from >= entry.to {
			t.Fatalf("entry %d is empty: %+v", i, entry)
		}
		if i > 0 && entries[i-1].to != entry.from {
			t.Fatalf("gap or overlap between entry %d and %d", i-1, i)
		}
		want := aggregateRawRange(file, int(entry.from), int(entry.to))
		if entry != want {
			t.Fatalf("entry %d = %+v, want %+v", i, entry, want)
		}
	}
}

func BenchmarkAggregateChartWindow_Rollup_Monthly(b *testing.B) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		b.Fatal(err)
	}
	meta := model.SymbolMeta{Kind: "future", SessionTz: "America/New_York"}
	file, calendar := buildSessionFixture(b, 400, time.Date(2023, time.January, 2, 18, 0, 0, 0, location))
	lastTs := file.TsAt(file.Count() - 1)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := AggregateChartWindow(file, calendar, meta, "1M", lastTs, 240, 0, lastTs); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkAggregateChartWindow_Scan_Monthly(b *testing.B) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		b.Fatal(err)
	}
	meta := model.SymbolMeta{Kind: "future", SessionTz: "America/New_York"}
	file, calendar := buildSessionFixture(b, 400, time.Date(2023, time.January, 2, 18, 0, 0, 0, location))
	scanOnly := *file
	scanOnly.rollups = nil
	lastTs := file.TsAt(file.Count() - 1)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := AggregateChartWindow(&scanOnly, calendar, meta, "1M", lastTs, 240, 0, lastTs); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkAggregateRTHChartWindow_Monthly(b *testing.B) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		b.Fatal(err)
	}
	meta := model.SymbolMeta{Kind: "future", SessionTz: "America/New_York"}
	file, calendar := buildSessionFixture(b, 400, time.Date(2023, time.January, 2, 18, 0, 0, 0, location))
	scanOnly := *file
	scanOnly.rollups = &rollups{hourly: file.rollups.hourly, daily: file.rollups.daily}
	lastTs := file.TsAt(file.Count() - 1)

	for _, benchmark := range []struct {
		name string
		file *BarFile
	}{
		{"rollup", file},
		{"scan", &scanOnly},
	} {
		b.Run(benchmark.name, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				if _, err := AggregateChartWindowForSession(benchmark.file, calendar, meta, "1M", lastTs, 240, 0, lastTs, "rth"); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
