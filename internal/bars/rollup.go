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

// indexPlan says what one index() pass should produce.
type indexPlan struct {
	// rollups asks for the derived indexes. False makes index() a
	// validate-and-hash pass that reads the ts column and nothing else —
	// a quarter of the bytes, which is what makes the .roll cache worth
	// consulting before deciding to build anything.
	rollups bool
	// location is the session timezone the RTH indexes align to. Only read
	// when rollups is true; nil then means UTC, matching a symbol that
	// declares no session timezone at all.
	location *time.Location
}

// planFor derives the index plan for one dataset from its own timeframe and
// symbol metadata.
func planFor(tf string, meta model.SymbolMeta) (indexPlan, error) {
	if !rollupsServeDisplayTimeframes(tf) {
		return indexPlan{}, nil
	}
	location, err := sessionLocation(meta)
	if err != nil {
		return indexPlan{}, err
	}
	return indexPlan{rollups: true, location: location}, nil
}

// rollupsServeDisplayTimeframes reports whether any display timeframe served
// from a dataset of this timeframe can actually read a rollup.
//
// Every rollup consumer — rollupFor and rthRollupFor — answers only for the
// 'h'/'d'/'w'/'M' units and for an 'm' multiplier that is a whole number of
// hours; a seconds-unit timeframe always falls through to the raw-bar scan.
// And BaseTimeframe routes exactly the seconds-unit timeframes to the sub-
// minute dataset. So the four indexes built over a 5s file are unreachable by
// construction: TestSubMinuteRollupsUnreachable enumerates every timeframe the
// HTTP layer accepts and pins that. Building them anyway cost 6.1 GB of
// startup reads, ~13 s of CPU and ~190 MB of resident rollups for six symbols.
func rollupsServeDisplayTimeframes(tf string) bool {
	parsed, err := parseChartTimeframe(tf)
	if err != nil {
		// An unrecognised dataset timeframe keeps the old behaviour: index it
		// and let the aggregator decide, rather than silently serving a
		// dataset with no indexes because its filename was unexpected.
		return true
	}
	return parsed.unit != 's'
}

// sessionLocation resolves a symbol's session timezone. Invalid timezone
// metadata is surfaced instead of silently leaving requests on the
// multi-million-bar scan path.
func sessionLocation(meta model.SymbolMeta) (*time.Location, error) {
	if meta.SessionTz == "" {
		return time.UTC, nil
	}
	location, err := cachedLoadLocation(meta.SessionTz)
	if err != nil {
		return nil, fmt.Errorf("load session timezone %q: %w", meta.SessionTz, err)
	}
	return location, nil
}

// attachCalendarRollup validates the companion calendar against this file
// and, when plan.rollups asks for it, folds one daily entry per session day.
// The registry calls this after loadCalendar and before the file is published
// to a slot, so no reader can observe a half-built index.
//
// It returns why the index could not be built, if it could not. That reason
// used to be discarded, which made a stale .idx a silent twenty-fold
// slowdown: daily, weekly and monthly aggregation quietly reverted to
// scanning raw bars with nothing anywhere saying so.
//
// Calendar.ordered is set for every dataset, indexed or not: GET
// /api/v1/calendar accepts any timeframe the registry holds — including a
// sub-minute one that gets no rollups — and Calendar.Range binary-searches
// only on that flag.
func (f *BarFile) attachCalendarRollup(cal *Calendar, plan indexPlan) (rejected string) {
	if f.rollups == nil {
		f.rollups = &rollups{}
	}
	if cal == nil || len(cal.dates) == 0 {
		return ""
	}
	if reason := verifyCalendarRanges(f, cal); reason != "" {
		cal.ordered = false
		f.rollups.daily = nil
		return reason
	}
	cal.ordered = true
	if plan.rollups {
		f.rollups.daily = buildDailyRollup(f, cal, f.rollups.hourly)
	}
	return ""
}

const (
	// rthOpenMinute/rthCloseMinute bound the regular session in minutes past
	// local midnight: 09:30 inclusive to 16:00 exclusive.
	rthOpenMinute  = 9*60 + 30
	rthCloseMinute = 16 * 60

	daySeconds = 86400
)

// zoneWindow caches one contiguous stretch over which a location's UTC
// offset is constant, so a full-file pass resolves the timezone once per DST
// transition (twice a year) instead of once per bar.
//
// This exists because the per-bar alternative is not one lookup but roughly
// seven: Weekday, Hour, Minute, Year, Month and Day each independently
// re-derive the zone offset from the absolute time, and time.Date does it
// once more. Over ~22M bars that measured as 50% of the entire server
// startup — more than reading the 541 MB of bar data it was indexing.
type zoneWindow struct {
	location *time.Location
	offset   int64
	until    int64 // exclusive upper bound in epoch seconds
}

func newZoneWindow(location *time.Location) *zoneWindow {
	// until = MinInt64 forces the first offsetAt call to resolve, including
	// for a ts of 0 or below.
	return &zoneWindow{location: location, until: math.MinInt64}
}

// offsetAt returns the location's UTC offset at ts, refreshing the cached
// window only once ts leaves it. Callers must walk ts in ascending order —
// every caller here iterates a ts-sorted BarFile.
func (z *zoneWindow) offsetAt(ts int64) int64 {
	if ts < z.until {
		return z.offset
	}
	t := time.Unix(ts, 0).In(z.location)
	_, offset := t.Zone()
	z.offset = int64(offset)
	if _, end := t.ZoneBounds(); end.IsZero() {
		z.until = math.MaxInt64 // no further transition (UTC, or a fixed zone)
	} else {
		z.until = end.Unix()
	}
	return z.offset
}

// floorDivSeconds is integer division rounding towards negative infinity, so
// a local timestamp that lands before the epoch still maps to the calendar
// day containing it rather than the one after.
func floorDivSeconds(value, divisor int64) int64 {
	quotient := value / divisor
	if value < 0 && value%divisor != 0 {
		quotient--
	}
	return quotient
}

// tsHashOffset/tsHashPrime are FNV-1a's 64-bit parameters. The hash exists
// to answer "is this the same bar timeline as when the .roll cache was
// written?" — see rollupcache.go. FNV is chosen for being a two-instruction
// accumulate: the ts values are already in a register from the validation
// compare, so hashing all of them adds no memory traffic at all.
const (
	tsHashOffset = 14695981039346656037
	tsHashPrime  = 1099511628211
)

// indexBuildHook fires whenever index() commits to a full rollup build. Kept
// as a variable, like discardMappedPages, so a test can prove the .roll cache
// actually prevented a rebuild instead of inferring it from a timing
// difference. Always nil in production.
var indexBuildHook func()

// index walks the file once, validating that timestamps strictly increase,
// hashing them, and building every derived index the plan asks for.
//
// One pass, not three. Validation, the wall-clock hourly index and the RTH
// indexes each used to walk the whole file on their own; all three read the
// same 24 bytes per bar, so on a 5 M-bar dataset the two extra passes bought
// nothing but 2x the memory traffic. Folding validation in is safe because a
// violation is detected at bar i before bar i's OHLCV is used for anything
// that escapes: index() returns the error and the caller discards the file.
//
// RTH bars for one hour/day occupy a contiguous raw range, so [from,to)
// remains safe for recomputing the single entry clipped by a replay spoiler
// boundary. The calendar fields the RTH filter needs (weekday, minute-of-day)
// are derived by integer arithmetic from a cached zone offset rather than
// through time.Time accessors — see zoneWindow. The one thing that stays on
// time.Date is the session's 09:30 open, computed once per session: its offset
// can legitimately differ from the offset at the bar being read when a
// transition lands between them, and only a real tzdata lookup resolves that
// correctly.
//
// A file too large to index with int32 bar indices (~2.1 B bars, a 51 GB file)
// is validated and hashed but left unindexed — the aggregator then keeps
// scanning raw bars, which is slower but still correct.
func (f *BarFile) index(plan indexPlan) (tsHash uint64, err error) {
	n := f.Count()
	if f.rollups == nil {
		f.rollups = &rollups{}
	}
	if !plan.rollups || n > math.MaxInt32 {
		return f.scanTimestamps()
	}
	if indexBuildHook != nil {
		indexBuildHook()
	}

	location := plan.location
	if location == nil {
		location = time.UTC
	}

	// Capacity from the file's actual ts span, not from an assumed one-minute
	// bar spacing: n/60 over-allocated 8.5x on a 5s dataset, ~190 MB across
	// six symbols. Hour buckets cannot outnumber either the hours the file
	// spans or its bars, and a regular session covers seven hour buckets
	// (09:30 through 15:30).
	span := f.TsAt(n-1) - f.TsAt(0)
	hourCap := min(int(span/hourSeconds)+2, n)
	dayCap := min(int(span/daySeconds)+2, n)
	rthHourlyPerDay := (rthCloseMinute - rthOpenMinute + 59) / 60
	hourly := make([]rollupBar, 0, hourCap)
	rthHourly := make([]rollupBar, 0, min(dayCap*rthHourlyPerDay, n))
	rthDaily := make([]rollupBar, 0, dayCap)

	hourBar := rollupBar{from: -1}
	currentHour := int64(math.MinInt64)
	rthHourBar := rollupBar{from: -1}
	rthDayBar := rollupBar{from: -1}
	currentRTHHour := int64(math.MinInt64)
	currentRTHDay := int64(math.MinInt64)

	zone := newZoneWindow(location)
	openDay := int64(math.MinInt64) // local day number `open` was derived from
	open := int64(0)

	hash := uint64(tsHashOffset)
	previous := int64(-1)
	for i := 0; i < n; i++ {
		ts := f.TsAt(i)
		if ts <= previous {
			return 0, fmt.Errorf("%w: bar %d ts=%d <= previous %d", ErrNonMonotonicTs, i, ts, previous)
		}
		previous = ts
		hash = (hash ^ uint64(ts)) * tsHashPrime

		if hour := ts / hourSeconds * hourSeconds; hour != currentHour {
			if hourBar.from >= 0 {
				hourly = append(hourly, hourBar)
			}
			currentHour = hour
			hourBar = newRollupBar(f, i)
		} else {
			accumulateRollupBar(&hourBar, f, i)
		}

		local := ts + zone.offsetAt(ts)
		days := floorDivSeconds(local, daySeconds)
		// 1970-01-01 was a Thursday and time.Weekday counts Sunday as 0.
		if weekday := ((days+4)%7 + 7) % 7; weekday == 0 || weekday == 6 {
			continue
		}
		minute := int((local - days*daySeconds) / 60)
		if minute < rthOpenMinute || minute >= rthCloseMinute {
			continue
		}
		if days != openDay {
			openDay = days
			y, m, d := time.Unix(ts, 0).In(location).Date()
			open = time.Date(y, m, d, 9, 30, 0, 0, location).Unix()
		}
		if hour := open + int64((minute-rthOpenMinute)/60)*hourSeconds; hour != currentRTHHour {
			if rthHourBar.from >= 0 {
				rthHourly = append(rthHourly, rthHourBar)
			}
			currentRTHHour = hour
			rthHourBar = newRollupBar(f, i)
		} else {
			accumulateRollupBar(&rthHourBar, f, i)
		}
		if open != currentRTHDay {
			if rthDayBar.from >= 0 {
				rthDaily = append(rthDaily, rthDayBar)
			}
			currentRTHDay = open
			rthDayBar = newRollupBar(f, i)
		} else {
			accumulateRollupBar(&rthDayBar, f, i)
		}
	}
	if hourBar.from >= 0 {
		hourly = append(hourly, hourBar)
	}
	if rthHourBar.from >= 0 {
		rthHourly = append(rthHourly, rthHourBar)
	}
	if rthDayBar.from >= 0 {
		rthDaily = append(rthDaily, rthDayBar)
	}

	f.rollups.hourly = hourly
	f.rollups.rthHourly = rthHourly
	f.rollups.rthDaily = rthDaily
	return hash, nil
}

// scanTimestamps is index()'s validate-and-hash-only path: it reads the ts
// column and none of the five price/volume columns, a quarter of the file's
// bytes. That is what lets the registry decide whether the .roll cache is
// current before committing to a full read.
func (f *BarFile) scanTimestamps() (tsHash uint64, err error) {
	hash := uint64(tsHashOffset)
	previous := int64(-1)
	for i, n := 0, f.Count(); i < n; i++ {
		ts := f.TsAt(i)
		if ts <= previous {
			return 0, fmt.Errorf("%w: bar %d ts=%d <= previous %d", ErrNonMonotonicTs, i, ts, previous)
		}
		previous = ts
		hash = (hash ^ uint64(ts)) * tsHashPrime
	}
	return hash, nil
}

// verifyCalendarRanges checks that every session's bar range is in-bounds,
// ascending and non-overlapping against f, returning why not when it isn't.
//
// That is exactly the invariant two separate things need: the daily index,
// which cannot fold a session whose range it can't trust, and
// Calendar.Range's binary search. Reporting it instead of failing keeps the
// existing ErrIdxOutOfBounds diagnostic firing at request time from
// aggregateCalendarChartWindow, where it already has a test, rather than
// turning a stale .idx into a startup failure.
func verifyCalendarRanges(f *BarFile, cal *Calendar) (rejected string) {
	n := f.Count()
	if n > math.MaxInt32 {
		return fmt.Sprintf("%d bars exceeds the int32 bar index the session index uses", n)
	}
	previousTo := 0
	for _, date := range cal.dates {
		entry := cal.byDate[date]
		if entry.Offset < 0 || entry.Count <= 0 || entry.Offset+entry.Count > n {
			return fmt.Sprintf("session %s claims bars [%d,%d) of a %d-bar file", date, entry.Offset, entry.Offset+entry.Count, n)
		}
		if entry.Offset < previousTo {
			return fmt.Sprintf("session %s starts at bar %d, inside the previous session which ends at %d", date, entry.Offset, previousTo)
		}
		previousTo = entry.Offset + entry.Count
	}
	return ""
}

// buildDailyRollup aggregates one entry per calendar session day. Callers
// must have cleared verifyCalendarRanges first — every range is read here
// without re-checking it.
func buildDailyRollup(f *BarFile, cal *Calendar, hourly []rollupBar) []rollupBar {
	out := make([]rollupBar, 0, len(cal.dates))
	for _, date := range cal.dates {
		entry := cal.byDate[date]
		out = append(out, foldRange(f, hourly, entry.Offset, entry.Offset+entry.Count))
	}
	return out
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
