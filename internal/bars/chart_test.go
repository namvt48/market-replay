package bars

import (
	"testing"
	"time"

	"market-replay/internal/model"
)

func TestChartBucketStartCalendarAligned(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	meta := model.SymbolMeta{Kind: "future", SessionTz: "America/New_York"}
	tuesday := time.Date(2026, time.July, 28, 10, 0, 0, 0, location).Unix()
	thursday := time.Date(2026, time.July, 30, 10, 0, 0, 0, location).Unix()
	nextMonday := time.Date(2026, time.August, 3, 10, 0, 0, 0, location).Unix()

	week := chartTimeframe{multiplier: 1, unit: 'w'}
	if got, want := chartBucketStart(tuesday, week, meta, location), chartBucketStart(thursday, week, meta, location); got != want {
		t.Fatalf("same trading week returned %d and %d", got, want)
	}
	if got, previous := chartBucketStart(nextMonday, week, meta, location), chartBucketStart(tuesday, week, meta, location); got == previous {
		t.Fatalf("following trading week reused bucket %d", got)
	}

	month := chartTimeframe{multiplier: 1, unit: 'M'}
	july := chartBucketStart(thursday, month, meta, location)
	august := chartBucketStart(nextMonday, month, meta, location)
	if july == august {
		t.Fatalf("July and August reused bucket %d", july)
	}
	wantJuly := time.Date(2026, time.June, 30, 18, 0, 0, 0, location).Unix()
	if july != wantJuly {
		t.Fatalf("July bucket = %d, want %d", july, wantJuly)
	}
}

func TestParseChartTimeframeWeekAndMonth(t *testing.T) {
	for _, value := range []string{"1w", "2w", "1M", "3M"} {
		if _, err := parseChartTimeframe(value); err != nil {
			t.Fatalf("parse %s: %v", value, err)
		}
	}
	for _, value := range []string{"0w", "53w", "0M", "13M"} {
		if _, err := parseChartTimeframe(value); err == nil {
			t.Fatalf("parse %s succeeded, want error", value)
		}
	}
}

func TestAggregateChartWindowForSessionReturnsDeepRTHHistory(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	file, calendar := buildSessionFixture(t, 45, time.Date(2025, time.January, 5, 18, 0, 0, 0, location))
	meta := model.SymbolMeta{Kind: "future", SessionTz: "America/New_York"}
	lastTs := file.TsAt(file.Count() - 1)

	got, err := AggregateChartWindowForSession(file, calendar, meta, "1h", lastTs, 240, 0, lastTs, "rth")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 240 {
		t.Fatalf("bars = %d, want 240", len(got))
	}
	for index, bar := range got {
		local := time.Unix(bar.Time, 0).In(location)
		if local.Hour() < 9 || local.Hour() > 15 || local.Minute() != 30 {
			t.Fatalf("bar %d starts at %s, want an RTH-aligned :30 bucket", index, local)
		}
	}
}

func TestAggregateChartWindowForSessionRejectsUnknownSession(t *testing.T) {
	if _, err := AggregateChartWindowForSession(&BarFile{}, nil, model.SymbolMeta{}, "1h", 0, 1, 0, 0, "overnight"); err == nil {
		t.Fatal("unknown market session succeeded")
	}
}

// TestAggregateCalendarChartWindowDeepHistorySkipsWeekends is a regression
// for the calendarDateIndexBefore/maxDaysPerBucket bound added to bound the
// scan (BenchmarkAggregateCalendarChartWindow_Deep): it builds ~3 years of
// weekday-only daily bars, requests 3 monthly buckets anchored at the very
// last trading day, and checks both the bucket count/boundaries and the
// aggregated OHLCV — a wrong margin would either drop a bucket (too
// aggressive) or, if truly broken, misalign the aggregation entirely.
func TestAggregateCalendarChartWindowDeepHistorySkipsWeekends(t *testing.T) {
	location := time.UTC
	meta := model.SymbolMeta{Kind: "index", SessionTz: "UTC"}

	start := time.Date(2020, time.January, 1, 12, 0, 0, 0, location)
	end := time.Date(2026, time.August, 1, 12, 0, 0, 0, location)

	var ts []uint32
	var open, high, low, closeCol []int32
	var vol []uint32
	price := int32(1000)
	for day := start; day.Before(end); day = day.AddDate(0, 0, 1) {
		if day.Weekday() == time.Saturday || day.Weekday() == time.Sunday {
			continue
		}
		ts = append(ts, uint32(day.Unix()))
		open = append(open, price)
		high = append(high, price+10)
		low = append(low, price-10)
		closeCol = append(closeCol, price+1)
		vol = append(vol, uint32(len(ts)))
		price++
	}
	file, err := newBarFile(buildFixture(ts, open, high, low, closeCol, vol))
	if err != nil {
		t.Fatal(err)
	}

	dates := make([]string, len(ts))
	byDate := make(map[string]idxEntry, len(ts))
	for i, rawTs := range ts {
		date := time.Unix(int64(rawTs), 0).UTC().Format("2006-01-02")
		dates[i] = date
		byDate[date] = idxEntry{Offset: i, Count: 1}
	}
	calendar := &Calendar{byDate: byDate, dates: dates}

	lastTs := file.TsAt(len(ts) - 1)
	got, err := AggregateChartWindow(file, calendar, meta, "1M", lastTs, 3, 0, lastTs)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("len(got) = %d, want 3 monthly buckets", len(got))
	}

	wantMonths := []time.Month{time.May, time.June, time.July}
	for i, bar := range got {
		if bar.Time == 0 {
			t.Fatalf("bucket %d has zero time", i)
		}
		bucketMonth := time.Unix(bar.Time, 0).UTC().Month()
		if bucketMonth != wantMonths[i] {
			t.Errorf("bucket %d month = %s, want %s", i, bucketMonth, wantMonths[i])
		}
	}
	lastBucket := got[len(got)-1]
	if lastBucket.CloseTicks != file.CloseAt(len(ts)-1) {
		t.Errorf("last bucket close = %d, want %d (last trading day's close)", lastBucket.CloseTicks, file.CloseAt(len(ts)-1))
	}

	// The optimization must never depend on `before`/history depth: the
	// same anchor with a much larger `before` has to reproduce the last 3
	// buckets identically once trimmed, proving the bounded scan and a
	// hypothetical unbounded one agree.
	wide, err := AggregateChartWindow(file, calendar, meta, "1M", lastTs, 36, 0, lastTs)
	if err != nil {
		t.Fatal(err)
	}
	if len(wide) < 3 {
		t.Fatalf("len(wide) = %d, want at least 3", len(wide))
	}
	wideTail := wide[len(wide)-3:]
	for i := range got {
		if got[i] != wideTail[i] {
			t.Errorf("bucket %d = %+v, want %+v (mismatch between before=3 and before=36 scans)", i, got[i], wideTail[i])
		}
	}
}

func TestAggregateCalendarChartWindowMatchesBucketAnchorAcrossMarketGap(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	julyBar := time.Date(2026, time.July, 31, 16, 0, 0, 0, location).Unix()
	augustBar := time.Date(2026, time.August, 3, 10, 0, 0, 0, location).Unix()
	file, err := newBarFile(buildFixture(
		[]uint32{uint32(julyBar), uint32(augustBar)},
		[]int32{100, 200}, []int32{110, 210}, []int32{90, 190}, []int32{105, 205}, []uint32{10, 20},
	))
	if err != nil {
		t.Fatal(err)
	}
	calendar := &Calendar{
		byDate: map[string]idxEntry{
			"2026-07-31": {Offset: 0, Count: 1},
			"2026-08-03": {Offset: 1, Count: 1},
		},
		dates: []string{"2026-07-31", "2026-08-03"},
	}
	meta := model.SymbolMeta{Kind: "future", SessionTz: "America/New_York"}
	augustAnchor := time.Date(2026, time.July, 31, 18, 0, 0, 0, location).Unix()

	got, err := AggregateChartWindow(file, calendar, meta, "1M", augustAnchor, 1, 0, augustBar)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Time != augustAnchor || got[0].CloseTicks != 205 {
		t.Fatalf("bars = %+v, want August bucket at %d", got, augustAnchor)
	}
}
