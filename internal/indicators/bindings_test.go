package indicators

import (
	"testing"
	"time"

	"market-replay/internal/model"
)

// dailyRangeScript exercises the dailyRange(n) host binding directly: each
// tick plots the returned {time,high,low} (or nothing, when there isn't
// yet enough daily history — the DSL's `na` convention).
const dailyRangeScript = `
init = () => { indicator({onMainPanel: true}); input.int('N', 3, 'n', 1, 60, 1, '', ''); };
onTick = (length, _moment, _, ta, inputs) => {
  const r = dailyRange(inputs.n);
  if (r) {
    plot('high', r.high);
    plot('low', r.low);
    plot('time', r.time);
  }
};
`

var dailyRangeMeta = model.SymbolMeta{TickSize: 1, PointValue: 1, SessionTz: "UTC"}

// dailyFixtureSpecs builds one bar per calendar day at 12:00 UTC for n
// days starting 2024-01-01, with a deterministic, easily re-derived
// high/low per day — enough to prove dailyRange(n) both windows correctly
// and excludes the still-forming "today" bucket.
func dailyFixtureSpecs(days int) []barSpec {
	base := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	specs := make([]barSpec, days)
	for i := 0; i < days; i++ {
		day := int32(i + 1)
		specs[i] = barSpec{
			ts:   base.AddDate(0, 0, i).Unix(),
			open: 2000, high: 2000 + day*10, low: 2000 - day*5, close: 2000,
			volume: 1,
		}
	}
	return specs
}

func dayMidnightUnix(t *testing.T, dayIndex int) int64 {
	t.Helper()
	base := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	return base.AddDate(0, 0, dayIndex).Unix()
}

func TestDailyRange_WindowsCompletedDaysAndExcludesToday(t *testing.T) {
	e := NewEngine()
	if err := e.Register("daily", "Daily", 1, []byte(dailyRangeScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	specs := dailyFixtureSpecs(10)
	file := openFixtureFile(t, "NQ", "1m", specs, dailyRangeMeta)

	// "Today" is day 10 (the fixture's last bar); dailyRange(3) must cover
	// days 7,8,9 and never day 10 itself.
	today := specs[9].ts
	result, err := e.Run("daily", file, nil, dailyRangeMeta, RunParams{At: today, Before: 1, MaxTs: today})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Plots) != 3 {
		t.Fatalf("want 3 plots (high/low/time), got %d: %+v", len(result.Plots), result.Plots)
	}

	wantHigh, wantLow := 0.0, 0.0
	for day := 7; day <= 9; day++ {
		h, l := float64(2000+day*10), float64(2000-day*5)
		if wantHigh == 0 || h > wantHigh {
			wantHigh = h
		}
		if wantLow == 0 || l < wantLow {
			wantLow = l
		}
	}
	byKey := map[string]float64{}
	for _, p := range result.Plots {
		byKey[p.Key] = p.Value
	}
	if !approxEqual(byKey["high"], wantHigh) {
		t.Errorf("high: got %v, want %v", byKey["high"], wantHigh)
	}
	if !approxEqual(byKey["low"], wantLow) {
		t.Errorf("low: got %v, want %v", byKey["low"], wantLow)
	}
	wantTime := float64(dayMidnightUnix(t, 6)) // day 7 (0-indexed day 6) is the earliest of the 3-day window
	if !approxEqual(byKey["time"], wantTime) {
		t.Errorf("time: got %v, want %v", byKey["time"], wantTime)
	}
}

func TestDailyRange_InsufficientHistoryReturnsUndefinedNotError(t *testing.T) {
	e := NewEngine()
	if err := e.Register("daily", "Daily", 1, []byte(dailyRangeScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	specs := dailyFixtureSpecs(2) // only 2 days exist; dailyRange(3) needs 3 completed days
	file := openFixtureFile(t, "NQ", "1m", specs, dailyRangeMeta)

	today := specs[1].ts
	result, err := e.Run("daily", file, nil, dailyRangeMeta, RunParams{At: today, Before: 1, MaxTs: today})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Plots) != 0 {
		t.Fatalf("want 0 plots (na, not enough history), got %d: %+v", len(result.Plots), result.Plots)
	}
}
