package bars

import (
	"math"
	"testing"
	"time"
)

// buildRTHRollupsViaTimeAPI is a literal transcription of the time.Time-based
// implementation buildRTHRollups replaced. It exists purely as the reference
// half of TestBuildRTHRollupsMatchesTimeBasedReference: the optimization
// swapped ~7 tzdata lookups per bar for integer arithmetic over a cached zone
// offset, and the only thing that makes that safe is a test proving the two
// agree bar for bar — including across a DST transition, where a cached
// offset is exactly what could go wrong.
func buildRTHRollupsViaTimeAPI(f *BarFile, location *time.Location) (hourly, daily []rollupBar) {
	n := f.Count()
	if n == 0 || n > math.MaxInt32 {
		return nil, nil
	}
	hourly = make([]rollupBar, 0, n/180+1)
	daily = make([]rollupBar, 0, n/(23*60)+1)
	currentHour := int64(math.MinInt64)
	currentDay := int64(math.MinInt64)
	hourBar := rollupBar{from: -1}
	dayBar := rollupBar{from: -1}

	for i := 0; i < n; i++ {
		local := time.Unix(f.TsAt(i), 0).In(location)
		if local.Weekday() == time.Saturday || local.Weekday() == time.Sunday {
			continue
		}
		minute := local.Hour()*60 + local.Minute()
		if minute < 9*60+30 || minute >= 16*60 {
			continue
		}
		open := time.Date(local.Year(), local.Month(), local.Day(), 9, 30, 0, 0, location).Unix()
		hour := open + int64((minute-(9*60+30))/60)*hourSeconds
		if hour != currentHour {
			if hourBar.from >= 0 {
				hourly = append(hourly, hourBar)
			}
			currentHour = hour
			hourBar = newRollupBar(f, i)
		} else {
			accumulateRollupBar(&hourBar, f, i)
		}
		if open != currentDay {
			if dayBar.from >= 0 {
				daily = append(daily, dayBar)
			}
			currentDay = open
			dayBar = newRollupBar(f, i)
		} else {
			accumulateRollupBar(&dayBar, f, i)
		}
	}
	if hourBar.from >= 0 {
		hourly = append(hourly, hourBar)
	}
	if dayBar.from >= 0 {
		daily = append(daily, dayBar)
	}
	return hourly, daily
}

// buildContinuousMinuteFixture builds an unbroken run of 1m bars covering
// [from, from+days). Unbroken on purpose: a fixture that already skips
// weekends and overnight hours would never exercise the weekday/minute-of-day
// filters this test is about.
func buildContinuousMinuteFixture(t testing.TB, from time.Time, days int) *BarFile {
	t.Helper()
	count := days * 24 * 60

	ts := make([]uint32, 0, count)
	open := make([]int32, 0, count)
	high := make([]int32, 0, count)
	low := make([]int32, 0, count)
	closeCol := make([]int32, 0, count)
	vol := make([]uint32, 0, count)

	price := int32(60_000)
	start := from.Unix()
	for minute := 0; minute < count; minute++ {
		price += int32((minute*13)%11) - 5
		ts = append(ts, uint32(start+int64(minute)*60))
		open = append(open, price)
		high = append(high, price+int32(minute%9)+1)
		low = append(low, price-int32(minute%7)-1)
		closeCol = append(closeCol, price+1)
		vol = append(vol, uint32(1+minute%50))
	}

	file, err := newUTCIndexedBarFile(buildFixture(ts, open, high, low, closeCol, vol))
	if err != nil {
		t.Fatal(err)
	}
	return file
}

func TestBuildRTHRollupsMatchesTimeBasedReference(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		from time.Time
		days int
	}{
		// 2025-03-09 02:00 local: clocks jump forward, the offset cache's
		// window ends mid-fixture and the 09:30 open shifts by an hour.
		{"spring-forward", time.Date(2025, time.March, 6, 0, 0, 0, 0, time.UTC), 6},
		// 2025-11-02 02:00 local: clocks fall back, so one local hour repeats.
		{"fall-back", time.Date(2025, time.October, 30, 0, 0, 0, 0, time.UTC), 6},
		// No transition at all — proves the cached window is not silently
		// refreshed (or silently stale) on an ordinary stretch.
		{"no-transition", time.Date(2025, time.June, 2, 0, 0, 0, 0, time.UTC), 9},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			file := buildContinuousMinuteFixture(t, testCase.from, testCase.days)
			if _, err := file.index(indexPlan{rollups: true, location: location}); err != nil {
				t.Fatal(err)
			}
			gotHourly, gotDaily := file.rollups.rthHourly, file.rollups.rthDaily
			wantHourly, wantDaily := buildRTHRollupsViaTimeAPI(file, location)

			if len(gotDaily) == 0 || len(gotHourly) == 0 {
				t.Fatalf("fixture produced no RTH entries (%d hourly, %d daily); it proves nothing", len(gotHourly), len(gotDaily))
			}
			assertRollupsEqual(t, "hourly", gotHourly, wantHourly)
			assertRollupsEqual(t, "daily", gotDaily, wantDaily)
		})
	}
}

// TestZoneWindowTracksTransitions pins offsetAt's contract directly, so a
// failure points at the cache rather than at whichever rollup happened to
// consume it.
func TestZoneWindowTracksTransitions(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	zone := newZoneWindow(location)

	// Ascending order, as every caller walks a ts-sorted BarFile.
	for ts := time.Date(2025, time.March, 1, 0, 0, 0, 0, time.UTC).Unix(); ts < time.Date(2025, time.November, 10, 0, 0, 0, 0, time.UTC).Unix(); ts += 1800 {
		_, want := time.Unix(ts, 0).In(location).Zone()
		if got := zone.offsetAt(ts); got != int64(want) {
			t.Fatalf("offsetAt(%d) = %d, want %d (%s)", ts, got, want, time.Unix(ts, 0).In(location))
		}
	}
}

func TestZoneWindowHandlesFixedOffsetLocation(t *testing.T) {
	zone := newZoneWindow(time.UTC)
	if got := zone.offsetAt(0); got != 0 {
		t.Fatalf("offsetAt(0) = %d, want 0", got)
	}
	// A location with no further transition must not re-resolve forever.
	if zone.until != math.MaxInt64 {
		t.Fatalf("until = %d, want MaxInt64 for a zone that never changes again", zone.until)
	}
	if got := zone.offsetAt(time.Date(2200, time.January, 1, 0, 0, 0, 0, time.UTC).Unix()); got != 0 {
		t.Fatalf("offsetAt(far future) = %d, want 0", got)
	}
}

func TestFloorDivSecondsRoundsTowardsNegativeInfinity(t *testing.T) {
	cases := []struct{ value, want int64 }{
		{0, 0},
		{daySeconds - 1, 0},
		{daySeconds, 1},
		{-1, -1},
		{-daySeconds, -1},
		{-daySeconds - 1, -2},
	}
	for _, testCase := range cases {
		if got := floorDivSeconds(testCase.value, daySeconds); got != testCase.want {
			t.Errorf("floorDivSeconds(%d) = %d, want %d", testCase.value, got, testCase.want)
		}
	}
}

func assertRollupsEqual(t *testing.T, label string, got, want []rollupBar) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s entries = %d, want %d", label, len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%s entry %d = %+v, want %+v", label, i, got[i], want[i])
		}
	}
}
