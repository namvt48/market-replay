package bars

import (
	"fmt"
	"sort"
	"strconv"
	"sync"
	"time"

	"market-replay/internal/model"
)

// locationCache avoids re-opening/re-parsing tzdata on every
// AggregateChartWindow call. time.LoadLocation has no built-in cache keyed
// by name (only sync.Once guards for time.Local and the fixed-zone cache,
// per $GOROOT/src/time/zoneinfo.go) — without this, every /chart-bars/at
// request pays a disk read + zoneinfo parse just to resolve a session
// timezone that's one of a handful of fixed values across all symbols.
var locationCache sync.Map // string -> *time.Location

func cachedLoadLocation(name string) (*time.Location, error) {
	if cached, ok := locationCache.Load(name); ok {
		return cached.(*time.Location), nil
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, err
	}
	actual, _ := locationCache.LoadOrStore(name, loc)
	return actual.(*time.Location), nil
}

// ChartBar is a display-timeframe OHLCV bucket. Prices remain integer ticks
// so aggregation never introduces floating-point drift.
type ChartBar struct {
	Time       int64  `json:"time"`
	OpenTicks  int32  `json:"openTicks"`
	HighTicks  int32  `json:"highTicks"`
	LowTicks   int32  `json:"lowTicks"`
	CloseTicks int32  `json:"closeTicks"`
	Volume     uint64 `json:"volume"`
}

type chartTimeframe struct {
	multiplier int
	unit       byte
}

type chartBucketWindow struct {
	start    int64
	from, to int
}

func parseChartTimeframe(value string) (chartTimeframe, error) {
	if len(value) < 2 {
		return chartTimeframe{}, fmt.Errorf("invalid timeframe %q", value)
	}
	multiplier, err := strconv.Atoi(value[:len(value)-1])
	if err != nil || multiplier < 1 {
		return chartTimeframe{}, fmt.Errorf("invalid timeframe %q", value)
	}
	unit := value[len(value)-1]
	valid := unit == 'm' && multiplier <= 1440 || unit == 'h' && multiplier <= 12 || unit == 'd' && multiplier == 1 || unit == 'w' && multiplier <= 52 || unit == 'M' && multiplier <= 12
	if !valid {
		return chartTimeframe{}, fmt.Errorf("invalid timeframe %q", value)
	}
	return chartTimeframe{multiplier: multiplier, unit: unit}, nil
}

func floorDiv(value, divisor int) int {
	quotient := value / divisor
	if value < 0 && value%divisor != 0 {
		quotient--
	}
	return quotient
}

func sessionDate(timestamp int64, meta model.SymbolMeta, location *time.Location) time.Time {
	local := time.Unix(timestamp, 0).In(location)
	date := time.Date(local.Year(), local.Month(), local.Day(), 12, 0, 0, 0, location)
	if meta.Kind == "future" && local.Hour() >= 18 {
		date = date.AddDate(0, 0, 1)
	}
	return date
}

func sessionOpen(date time.Time, meta model.SymbolMeta, location *time.Location) int64 {
	if meta.Kind == "future" {
		previous := date.AddDate(0, 0, -1)
		return time.Date(previous.Year(), previous.Month(), previous.Day(), 18, 0, 0, 0, location).Unix()
	}
	return time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, location).Unix()
}

func chartBucketStart(timestamp int64, timeframe chartTimeframe, meta model.SymbolMeta, location *time.Location) int64 {
	if timeframe.unit == 'm' || timeframe.unit == 'h' {
		seconds := int64(timeframe.multiplier * 60)
		if timeframe.unit == 'h' {
			seconds *= 60
		}
		return timestamp / seconds * seconds
	}
	date := sessionDate(timestamp, meta, location)
	if timeframe.unit == 'd' {
		return sessionOpen(date, meta, location)
	}
	if timeframe.unit == 'w' {
		daysFromMonday := (int(date.Weekday()) + 6) % 7
		weekStart := date.AddDate(0, 0, -daysFromMonday)
		anchorDays := int(time.Date(1970, time.January, 5, 0, 0, 0, 0, time.UTC).Unix() / 86400)
		weekStartDays := int(time.Date(weekStart.Year(), weekStart.Month(), weekStart.Day(), 0, 0, 0, 0, time.UTC).Unix() / 86400)
		groupWeek := floorDiv((weekStartDays-anchorDays)/7, timeframe.multiplier) * timeframe.multiplier
		groupDate := time.Unix(int64(anchorDays+groupWeek*7)*86400, 0).UTC()
		return sessionOpen(time.Date(groupDate.Year(), groupDate.Month(), groupDate.Day(), 12, 0, 0, 0, location), meta, location)
	}
	monthIndex := date.Year()*12 + int(date.Month()) - 1
	groupMonth := floorDiv(monthIndex, timeframe.multiplier) * timeframe.multiplier
	groupYear := floorDiv(groupMonth, 12)
	groupMonthOfYear := time.Month(groupMonth - groupYear*12 + 1)
	return sessionOpen(time.Date(groupYear, groupMonthOfYear, 1, 12, 0, 0, 0, location), meta, location)
}

// AggregateChartWindow returns display buckets surrounding atTs. before is
// the total number of buckets ending at the anchor; after is additional
// buckets following it. maxTs is a hard replay spoiler boundary.
func AggregateChartWindow(file *BarFile, calendar *Calendar, meta model.SymbolMeta, timeframeValue string, atTs int64, before, after int, maxTs int64) ([]ChartBar, error) {
	timeframe, err := parseChartTimeframe(timeframeValue)
	if err != nil {
		return nil, err
	}
	location := time.UTC
	if meta.SessionTz != "" {
		location, err = cachedLoadLocation(meta.SessionTz)
		if err != nil {
			return nil, fmt.Errorf("load session timezone %q: %w", meta.SessionTz, err)
		}
	}
	if file.Count() == 0 {
		return []ChartBar{}, nil
	}
	if entries := rollupFor(file, calendar, timeframe); entries != nil {
		return aggregateRollupChartWindow(file, entries, meta, timeframe, atTs, before, after, maxTs, location), nil
	}
	if calendar != nil && (timeframe.unit == 'd' || timeframe.unit == 'w' || timeframe.unit == 'M') {
		return aggregateCalendarChartWindow(file, calendar, meta, timeframe, atTs, before, after, maxTs, location)
	}
	if maxTs < atTs {
		atTs = maxTs
	}
	center := file.IndexAtOrBefore(atTs)
	lastAllowed := file.IndexAtOrBefore(maxTs)
	if center < 0 || lastAllowed < 0 {
		return []ChartBar{}, nil
	}
	if center > lastAllowed {
		center = lastAllowed
	}
	if candidate := file.IndexAtOrAfter(atTs); candidate <= lastAllowed && chartBucketStart(file.TsAt(candidate), timeframe, meta, location) == atTs {
		center = candidate
	}

	wantedBefore := before
	if wantedBefore < 1 {
		wantedBefore = 1
	}
	from := center
	currentBucket := chartBucketStart(file.TsAt(center), timeframe, meta, location)
	seen := 1
	for index := center - 1; index >= 0; index-- {
		bucket := chartBucketStart(file.TsAt(index), timeframe, meta, location)
		if bucket != currentBucket {
			seen++
			currentBucket = bucket
			if seen > wantedBefore {
				break
			}
		}
		from = index
	}

	to := center + 1
	currentBucket = chartBucketStart(file.TsAt(center), timeframe, meta, location)
	seenAfter := 0
	for index := center + 1; index <= lastAllowed; index++ {
		bucket := chartBucketStart(file.TsAt(index), timeframe, meta, location)
		if bucket != currentBucket {
			seenAfter++
			currentBucket = bucket
			if seenAfter > after {
				break
			}
		}
		to = index + 1
	}

	output := make([]ChartBar, 0, wantedBefore+after)
	for index := from; index < to; index++ {
		bucket := chartBucketStart(file.TsAt(index), timeframe, meta, location)
		if len(output) == 0 || output[len(output)-1].Time != bucket {
			output = append(output, ChartBar{
				Time: bucket, OpenTicks: file.OpenAt(index), HighTicks: file.HighAt(index), LowTicks: file.LowAt(index), CloseTicks: file.CloseAt(index), Volume: uint64(file.VolumeAt(index)),
			})
			continue
		}
		bar := &output[len(output)-1]
		if high := file.HighAt(index); high > bar.HighTicks {
			bar.HighTicks = high
		}
		if low := file.LowAt(index); low < bar.LowTicks {
			bar.LowTicks = low
		}
		bar.CloseTicks = file.CloseAt(index)
		bar.Volume += uint64(file.VolumeAt(index))
	}
	return output, nil
}

// rollupFor picks the precomputed index whose bucket boundaries can never
// straddle a display bucket of timeframe, or nil when no such index exists
// and the caller must scan raw bars.
//
//   - session-day entries nest inside 'd'/'w'/'M' buckets by construction
//     (those buckets are unions of whole sessions), and only when the file
//     has the calendar the daily index was derived from — matching the
//     pre-existing guard on aggregateCalendarChartWindow.
//   - hour entries nest inside 'h' buckets, and inside 'm' buckets whose
//     width is a whole number of hours. Any other 'm' multiplier (5m, 15m,
//     90m…) can split an hour, so it keeps scanning raw 1m bars — already
//     cheap, since such a window spans at most a few thousand bars.
func rollupFor(file *BarFile, calendar *Calendar, timeframe chartTimeframe) []rollupBar {
	r := file.rollups
	if r == nil {
		return nil
	}
	switch timeframe.unit {
	case 'd', 'w', 'M':
		if calendar != nil && len(r.daily) > 0 {
			return r.daily
		}
	case 'h':
		if len(r.hourly) > 0 {
			return r.hourly
		}
	case 'm':
		if timeframe.multiplier%60 == 0 && len(r.hourly) > 0 {
			return r.hourly
		}
	}
	return nil
}

// aggregateRollupChartWindow answers one /chart-bars/at seek from a
// precomputed index: it groups consecutive rollup entries that share a
// chartBucketStart, then folds each group's already-aggregated OHLCV.
//
// Cost is O(entries touched), not O(raw bars in the window), and only the
// single entry clipped by maxTs is recomputed from raw bars — so a 240-
// bucket request reads a few hundred entries instead of millions of bars.
//
// Bucket selection deliberately mirrors aggregateCalendarChartWindow: a
// bucket whose start equals atTs exactly wins over the bucket merely
// containing atTs, which is what anchors a seek to a session/week/month
// open that no bar lands on (a Friday-evening futures open preceding a
// Monday-morning first bar).
func aggregateRollupChartWindow(
	file *BarFile, entries []rollupBar, meta model.SymbolMeta, timeframe chartTimeframe,
	atTs int64, before, after int, maxTs int64, location *time.Location,
) []ChartBar {
	if maxTs < atTs {
		atTs = maxTs
	}
	lastAllowed := file.IndexAtOrBefore(maxTs)
	centerIndex := file.IndexAtOrBefore(atTs)
	if centerIndex < 0 || lastAllowed < 0 {
		return []ChartBar{}
	}
	// Entries that begin past the spoiler boundary can never contribute.
	// The one straddling it can, and is recomputed when folded.
	usable := sort.Search(len(entries), func(i int) bool { return int(entries[i].from) > lastAllowed })
	if usable == 0 {
		return []ChartBar{}
	}
	entries = entries[:usable]

	bucketStart := func(i int) int64 {
		return chartBucketStart(file.TsAt(int(entries[i].from)), timeframe, meta, location)
	}

	wantedBefore := before
	if wantedBefore < 1 {
		wantedBefore = 1
	}

	// chartBucketStart is monotonically non-decreasing over ascending
	// entries, so the anchor lookup is a binary search rather than the
	// linear window scan the calendar path uses.
	center := sort.Search(len(entries), func(i int) bool { return bucketStart(i) >= atTs })
	if !(center < len(entries) && bucketStart(center) == atTs) {
		center = sort.Search(len(entries), func(i int) bool { return int(entries[i].to) > centerIndex })
		if center >= len(entries) || int(entries[center].from) > centerIndex {
			center = len(entries) - 1
		}
	}

	// Expand the anchor bucket to its right edge, then walk left closing one
	// bucket at a time. Each entry's start is computed exactly once.
	end := center + 1
	anchorStart := bucketStart(center)
	for end < len(entries) && bucketStart(end) == anchorStart {
		end++
	}
	forwardFrom := end

	windows := make([]chartBucketWindow, 0, wantedBefore+after)
	current := anchorStart
	for i := end - 1; i >= 0; i-- {
		// A bucket start never exceeds the timestamps it covers, and starts
		// are monotonic — so an entry at-or-after the current bucket's start,
		// reached while walking backwards out of that bucket, is necessarily
		// still inside it. Testing that costs one integer compare, where
		// chartBucketStart would redo the whole timezone/session-open
		// derivation for each of the ~22 sessions in a monthly bucket.
		if ts := file.TsAt(int(entries[i].from)); ts < current {
			windows = append(windows, chartBucketWindow{start: current, from: i + 1, to: end})
			if len(windows) == wantedBefore {
				break
			}
			current = chartBucketStart(ts, timeframe, meta, location)
			end = i + 1
		}
		if i == 0 {
			windows = append(windows, chartBucketWindow{start: current, from: 0, to: end})
		}
	}
	// windows was built newest-first; the response is oldest-first.
	for left, right := 0, len(windows)-1; left < right; left, right = left+1, right-1 {
		windows[left], windows[right] = windows[right], windows[left]
	}

	for cursor := forwardFrom; cursor < len(entries) && len(windows) < wantedBefore+after; {
		start := bucketStart(cursor)
		next := cursor + 1
		for next < len(entries) && bucketStart(next) == start {
			next++
		}
		windows = append(windows, chartBucketWindow{start: start, from: cursor, to: next})
		cursor = next
	}

	output := make([]ChartBar, 0, len(windows))
	for _, window := range windows {
		if bar, ok := foldRollupEntries(file, entries[window.from:window.to], window.start, lastAllowed); ok {
			output = append(output, bar)
		}
	}
	return output
}

// foldRollupEntries folds one bucket's entries into a ChartBar, reading raw
// bars only for an entry the spoiler boundary cuts in half.
func foldRollupEntries(file *BarFile, entries []rollupBar, start int64, lastAllowed int) (ChartBar, bool) {
	bar := ChartBar{Time: start}
	initialized := false
	for _, entry := range entries {
		from := int(entry.from)
		if from > lastAllowed {
			break
		}
		folded := entry
		if int(entry.to)-1 > lastAllowed {
			folded = aggregateRawRange(file, from, lastAllowed+1)
		}
		if !initialized {
			bar.OpenTicks, bar.HighTicks, bar.LowTicks, bar.CloseTicks = folded.open, folded.high, folded.low, folded.close
			bar.Volume = folded.volume
			initialized = true
			continue
		}
		if folded.high > bar.HighTicks {
			bar.HighTicks = folded.high
		}
		if folded.low < bar.LowTicks {
			bar.LowTicks = folded.low
		}
		bar.CloseTicks = folded.close
		bar.Volume += folded.volume
	}
	return bar, initialized
}

// calendarDateIndexBefore binary-searches calendar.dates (sorted ascending,
// Offsets monotonically increasing) for the latest date whose bar range
// starts at or before barIndex. Returns 0 if barIndex precedes every
// calendar date — the safe default that degrades to scanning from the
// start, same as before this function existed.
func calendarDateIndexBefore(calendar *Calendar, barIndex int) int {
	lo, hi := 0, len(calendar.dates)-1
	result := 0
	for lo <= hi {
		mid := (lo + hi) / 2
		if calendar.byDate[calendar.dates[mid]].Offset <= barIndex {
			result = mid
			lo = mid + 1
		} else {
			hi = mid - 1
		}
	}
	return result
}

// maxDaysPerBucket upper-bounds how many calendar.dates entries a single
// grouped window for timeframe can span, so aggregateCalendarChartWindow
// can safely skip calendar dates that are too old to ever land in one of
// the wantedBefore windows. Deliberately generous (real trading weeks/
// months have fewer sessions than this) — overestimating only means
// scanning a few extra, still-cheap dates, while underestimating would
// silently drop data.
func maxDaysPerBucket(timeframe chartTimeframe) int {
	switch timeframe.unit {
	case 'w':
		return timeframe.multiplier * 8
	case 'M':
		return timeframe.multiplier * 35
	default: // 'd' (always multiplier 1, validated by parseChartTimeframe)
		return 1
	}
}

func aggregateCalendarChartWindow(file *BarFile, calendar *Calendar, meta model.SymbolMeta, timeframe chartTimeframe, atTs int64, before, after int, maxTs int64, location *time.Location) ([]ChartBar, error) {
	if maxTs < atTs {
		atTs = maxTs
	}
	centerIndex := file.IndexAtOrBefore(atTs)
	lastAllowed := file.IndexAtOrBefore(maxTs)
	if centerIndex < 0 || lastAllowed < 0 {
		return []ChartBar{}, nil
	}

	wantedBefore := before
	if wantedBefore < 1 {
		wantedBefore = 1
	}

	// calendar.dates can span decades (~5,500+ sessions for 20+ years of
	// NQ). Building `windows` from date 0 on every call costs ~15x more
	// once atTs/maxTs sit near the end of history than near the start
	// (BenchmarkAggregateCalendarChartWindow_Deep vs _Shallow) — bound the
	// scan to the dates that could actually land in [fromWindow,toWindow)
	// instead of always walking the whole calendar.
	startDateIdx := calendarDateIndexBefore(calendar, centerIndex) - wantedBefore*maxDaysPerBucket(timeframe)
	if startDateIdx < 0 {
		startDateIdx = 0
	}

	windows := make([]chartBucketWindow, 0, len(calendar.dates)-startDateIdx)
	for _, date := range calendar.dates[startDateIdx:] {
		entry := calendar.byDate[date]
		if entry.Offset < 0 || entry.Count <= 0 || entry.Offset+entry.Count > file.Count() {
			return nil, fmt.Errorf("%w: date=%s offset=%d count=%d fileCount=%d", ErrIdxOutOfBounds, date, entry.Offset, entry.Count, file.Count())
		}
		if entry.Offset > lastAllowed {
			break
		}
		to := entry.Offset + entry.Count
		if to > lastAllowed+1 {
			to = lastAllowed + 1
		}
		start := chartBucketStart(file.TsAt(entry.Offset), timeframe, meta, location)
		last := len(windows) - 1
		if last >= 0 && windows[last].start == start {
			windows[last].to = to
		} else {
			windows = append(windows, chartBucketWindow{start: start, from: entry.Offset, to: to})
		}
	}
	if len(windows) == 0 {
		return []ChartBar{}, nil
	}

	centerWindow := -1
	for index, window := range windows {
		if window.start == atTs || window.from <= centerIndex && centerIndex < window.to {
			centerWindow = index
			if window.start == atTs {
				break
			}
		}
	}
	if centerWindow < 0 {
		centerWindow = len(windows) - 1
	}
	fromWindow := centerWindow - wantedBefore + 1
	if fromWindow < 0 {
		fromWindow = 0
	}
	toWindow := centerWindow + after + 1
	if toWindow > len(windows) {
		toWindow = len(windows)
	}

	output := make([]ChartBar, 0, toWindow-fromWindow)
	for _, window := range windows[fromWindow:toWindow] {
		if window.from >= window.to {
			continue
		}
		bar := ChartBar{
			Time: window.start, OpenTicks: file.OpenAt(window.from), HighTicks: file.HighAt(window.from),
			LowTicks: file.LowAt(window.from), CloseTicks: file.CloseAt(window.from), Volume: uint64(file.VolumeAt(window.from)),
		}
		for index := window.from + 1; index < window.to; index++ {
			if high := file.HighAt(index); high > bar.HighTicks {
				bar.HighTicks = high
			}
			if low := file.LowAt(index); low < bar.LowTicks {
				bar.LowTicks = low
			}
			bar.CloseTicks = file.CloseAt(index)
			bar.Volume += uint64(file.VolumeAt(index))
		}
		output = append(output, bar)
	}
	return output, nil
}
