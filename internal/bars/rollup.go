package bars

import (
	"fmt"
	"math"
	"sort"
	"time"

	"market-replay/internal/model"
)

// hourSeconds is the bucket width of the hourly rollup. Every chart
// timeframe served from that rollup ('h', or 'm' whose multiplier is a
// whole number of hours) has bucket boundaries that are exact multiples of
// this, so a rollup entry can never straddle two display buckets.
const hourSeconds = 3600

// rollupBar is one precomputed OHLCV aggregate over a contiguous run of
// raw 1m bars, kept alongside the bar-index range it covers.
//
// The index range is the point of the whole structure: /chart-bars/at
// carries a hard replay spoiler boundary (maxTs), which routinely lands
// *inside* the newest bucket. Keeping [from,to) lets the aggregator use the
// precomputed values for every bucket that fits entirely under the boundary
// and recompute only the single clipped one from raw bars — instead of
// throwing the rollup away and rescanning the whole window, which is what
// made a 240-bucket 1M request read ~10M bars (39 ms measured on 16 years
// of NQ 1m).
type rollupBar struct {
	from, to               int32
	open, high, low, close int32
	volume                 uint64
}

// rollups holds the derived aggregate indexes over one BarFile. Both are
// optional: a nil/empty slice simply means the aggregator falls back to
// scanning raw bars, exactly as it did before these indexes existed.
type rollups struct {
	// hourly covers every bar in the file, bucketed by floor(ts/3600).
	hourly []rollupBar
	// daily is one entry per session day, mirroring the .idx calendar's
	// (offset,count) ranges. Empty when the file has no calendar, or when
	// the calendar disagrees with the .bin — see buildDailyRollup.
	daily []rollupBar
	// rthHourly contains only bars inside 09:30–16:00 in the symbol's
	// session timezone, aligned to hour buckets starting at 09:30.
	rthHourly []rollupBar
	// rthDaily is one entry per regular trading session. Weekly and monthly
	// RTH buckets are unions of these complete entries.
	rthDaily []rollupBar
}

// buildRollups derives the hourly index from f. The daily index needs the
// companion .idx and is attached separately by the registry once loaded.
func buildRollups(f *BarFile) *rollups {
	return &rollups{hourly: buildHourlyRollup(f)}
}

// attachCalendarRollup builds and stores the session-day index. The
// registry calls this after loadCalendar and before the file is published
// to a slot, so no reader can observe a half-built index.
//
// It returns why the index could not be built, if it could not. That reason
// used to be discarded, which made a stale .idx a silent twenty-fold
// slowdown: daily, weekly and monthly aggregation quietly reverted to
// scanning raw bars with nothing anywhere saying so.
func (f *BarFile) attachCalendarRollup(cal *Calendar) (rejected string) {
	if f.rollups == nil {
		f.rollups = &rollups{}
	}
	daily, reason := buildDailyRollup(f, cal, f.rollups.hourly)
	f.rollups.daily = daily
	if cal != nil {
		// A daily index only builds when every entry proved in-bounds,
		// ascending and non-overlapping — which is precisely the invariant
		// Calendar.Range needs before it can binary-search.
		cal.ordered = len(f.rollups.daily) == len(cal.dates)
	}
	return reason
}

// attachRTHRollups builds the regular-session indexes before a BarFile is
// published by the registry. Invalid timezone metadata is surfaced instead
// of silently leaving requests on the multi-million-bar scan path.
func (f *BarFile) attachRTHRollups(meta model.SymbolMeta) error {
	location := time.UTC
	var err error
	if meta.SessionTz != "" {
		location, err = cachedLoadLocation(meta.SessionTz)
		if err != nil {
			return fmt.Errorf("load session timezone %q: %w", meta.SessionTz, err)
		}
	}
	if f.rollups == nil {
		f.rollups = &rollups{}
	}
	f.rollups.rthHourly, f.rollups.rthDaily = buildRTHRollups(f, location)
	return nil
}

// buildRTHRollups filters and aggregates the raw file in one pass. RTH bars
// for one hour/day occupy a contiguous raw range, so [from,to) remains safe
// for recomputing the single entry clipped by a replay spoiler boundary.
func buildRTHRollups(f *BarFile, location *time.Location) (hourly, daily []rollupBar) {
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

// buildHourlyRollup aggregates f into wall-clock hour buckets in one pass.
// Returns nil for a file too large to index with int32 bar indices (~2.1B
// bars, a 51 GB file) — the aggregator then keeps scanning raw bars, which
// is slower but still correct.
func buildHourlyRollup(f *BarFile) []rollupBar {
	n := f.Count()
	if n == 0 || n > math.MaxInt32 {
		return nil
	}
	out := make([]rollupBar, 0, n/60+1)
	current := rollupBar{from: -1}
	currentHour := int64(math.MinInt64)
	for i := 0; i < n; i++ {
		hour := f.TsAt(i) / hourSeconds * hourSeconds
		if hour != currentHour {
			if current.from >= 0 {
				out = append(out, current)
			}
			currentHour = hour
			current = newRollupBar(f, i)
			continue
		}
		accumulateRollupBar(&current, f, i)
	}
	if current.from >= 0 {
		out = append(out, current)
	}
	return out
}

// buildDailyRollup aggregates one entry per calendar session day. It
// returns nil — deliberately degrading to the raw-scan path rather than
// failing here — whenever the calendar and the .bin disagree (out-of-range,
// overlapping, or out-of-order entries). That keeps the existing
// ErrIdxOutOfBounds diagnostic firing at request time from
// aggregateCalendarChartWindow, where it already has a test, instead of
// turning a stale .idx into a startup failure.
func buildDailyRollup(f *BarFile, cal *Calendar, hourly []rollupBar) (entries []rollupBar, rejected string) {
	n := f.Count()
	if cal == nil || len(cal.dates) == 0 || n == 0 || n > math.MaxInt32 {
		return nil, ""
	}
	out := make([]rollupBar, 0, len(cal.dates))
	for _, date := range cal.dates {
		entry := cal.byDate[date]
		if entry.Offset < 0 || entry.Count <= 0 || entry.Offset+entry.Count > n {
			return nil, fmt.Sprintf("session %s claims bars [%d,%d) of a %d-bar file", date, entry.Offset, entry.Offset+entry.Count, n)
		}
		from, to := int32(entry.Offset), int32(entry.Offset+entry.Count)
		if len(out) > 0 && from < out[len(out)-1].to {
			return nil, fmt.Sprintf("session %s starts at bar %d, inside the previous session which ends at %d", date, from, out[len(out)-1].to)
		}
		out = append(out, foldRange(f, hourly, int(from), int(to)))
	}
	return out, ""
}

// foldRange aggregates raw bars [from,to) by reusing whole hourly entries
// wherever one nests entirely inside the range, reading raw bars only for
// the partial hours at the range's two edges. The hourly index partitions
// the file exactly (TestHourlyRollupCoversEveryBar), so a session day costs
// O(hours) instead of O(minutes) — which is what keeps building the daily
// index at startup a rounding error rather than a second full pass over
// 131 MB.
func foldRange(f *BarFile, hourly []rollupBar, from, to int) rollupBar {
	if len(hourly) == 0 {
		return aggregateRawRange(f, from, to)
	}
	result := rollupBar{from: int32(from), to: int32(to)}
	started := false
	for k := sort.Search(len(hourly), func(i int) bool { return int(hourly[i].to) > from }); k < len(hourly) && int(hourly[k].from) < to; k++ {
		piece := hourly[k]
		if int(piece.from) < from || int(piece.to) > to {
			piece = aggregateRawRange(f, max(int(piece.from), from), min(int(piece.to), to))
		}
		if !started {
			result.open, result.high, result.low, result.close, result.volume = piece.open, piece.high, piece.low, piece.close, piece.volume
			started = true
			continue
		}
		if piece.high > result.high {
			result.high = piece.high
		}
		if piece.low < result.low {
			result.low = piece.low
		}
		result.close = piece.close
		result.volume += piece.volume
	}
	return result
}

// aggregateRawRange folds raw bars [from,to) into one rollupBar. Callers
// guarantee 0 <= from < to <= f.Count().
func aggregateRawRange(f *BarFile, from, to int) rollupBar {
	bar := newRollupBar(f, from)
	for i := from + 1; i < to; i++ {
		accumulateRollupBar(&bar, f, i)
	}
	return bar
}

func newRollupBar(f *BarFile, i int) rollupBar {
	return rollupBar{
		from: int32(i), to: int32(i + 1),
		open: f.OpenAt(i), high: f.HighAt(i), low: f.LowAt(i), close: f.CloseAt(i),
		volume: uint64(f.VolumeAt(i)),
	}
}

func accumulateRollupBar(bar *rollupBar, f *BarFile, i int) {
	if high := f.HighAt(i); high > bar.high {
		bar.high = high
	}
	if low := f.LowAt(i); low < bar.low {
		bar.low = low
	}
	bar.close = f.CloseAt(i)
	bar.volume += uint64(f.VolumeAt(i))
	bar.to = int32(i + 1)
}
