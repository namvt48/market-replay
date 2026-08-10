package bars

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
)

// ErrIdxOutOfBounds is returned when a .idx entry's offset+count exceeds
// the sibling .bin file's bar count — a sign the two files are out of
// sync (e.g. a partial rsync). Neither the docs' validator list nor the
// pipeline checks this cross-file invariant; the registry does, so a
// mismatch fails loud instead of slicing out of range.
var ErrIdxOutOfBounds = errors.New("bars: idx entry out of bounds for bin file")

// idxEntry is one entry of the .idx file: a session day's BAR-INDEX range
// (not a byte offset, not a timestamp) within the sibling .bin file's
// column arrays.
type idxEntry struct {
	Offset int `json:"offset"`
	Count  int `json:"count"`
}

// Calendar is the parsed .idx file for one (symbol,tf): session date ->
// bar-index range. Resolving a date to real timestamps requires the
// matching BarFile, since the .idx stores array indices, not ts values.
type Calendar struct {
	byDate map[string]idxEntry
	dates  []string // sorted ascending (YYYY-MM-DD sorts chronologically)

	// ordered records that every entry has been checked in-bounds, ascending
	// and non-overlapping against the companion BarFile — set by
	// attachCalendarRollup, which has to establish exactly that invariant to
	// build the daily index. Range binary-searches only when it holds; a
	// calendar that never got that check (or failed it) keeps the linear
	// scan, so a stale .idx still surfaces ErrIdxOutOfBounds instead of
	// being silently skipped over by a binary search it would break.
	ordered bool
}

// CalendarEntry is the documented §6.3 shape for GET /api/v1/calendar:
// real timestamps resolved from the .idx's bar-index range against the
// BarFile's ts column — not a passthrough of the raw {offset,count} on disk.
type CalendarEntry struct {
	Date    string `json:"date"`
	FirstTs int64  `json:"firstTs"`
	LastTs  int64  `json:"lastTs"`
	Bars    int    `json:"bars"`
}

// loadCalendar parses a .idx file (a JSON object keyed by session date).
func loadCalendar(path string) (*Calendar, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("bars: read idx %s: %w", path, err)
	}
	var raw map[string]idxEntry
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, fmt.Errorf("bars: parse idx %s: %w", path, err)
	}
	dates := make([]string, 0, len(raw))
	for d := range raw {
		dates = append(dates, d)
	}
	sort.Strings(dates)
	return &Calendar{byDate: raw, dates: dates}, nil
}

// Resolve returns the real-timestamp calendar entry for one session date,
// cross-referencing f's ts column.
func (c *Calendar) Resolve(date string, f *BarFile) (CalendarEntry, error) {
	e, ok := c.byDate[date]
	if !ok {
		return CalendarEntry{}, fmt.Errorf("bars: unknown calendar date %q", date)
	}
	if e.Offset < 0 || e.Count <= 0 || e.Offset+e.Count > f.Count() {
		return CalendarEntry{}, fmt.Errorf("%w: date=%s offset=%d count=%d fileCount=%d", ErrIdxOutOfBounds, date, e.Offset, e.Count, f.Count())
	}
	return CalendarEntry{
		Date:    date,
		FirstTs: f.TsAt(e.Offset),
		LastTs:  f.TsAt(e.Offset + e.Count - 1),
		Bars:    e.Count,
	}, nil
}

// Range returns resolved calendar entries for every session day whose
// bars overlap [fromTs,toTs] (inclusive, epoch seconds — matching the
// unix-timestamp from/to query params documented for GET
// /api/v1/calendar).
//
// Session bar ranges ascend with their dates, so the overlapping days are
// contiguous and both ends are binary-searchable — worth doing even for a
// low-QPS endpoint, because 16 years of NQ is ~4,200 sessions and the eval
// setup screen asks for a handful of months out of them.
func (c *Calendar) Range(fromTs, toTs int64, f *BarFile) ([]CalendarEntry, error) {
	dates := c.dates
	if c.ordered {
		lo := sort.Search(len(dates), func(i int) bool {
			e := c.byDate[dates[i]]
			return f.TsAt(e.Offset+e.Count-1) >= fromTs
		})
		hi := lo + sort.Search(len(dates)-lo, func(i int) bool {
			return f.TsAt(c.byDate[dates[lo+i]].Offset) > toTs
		})
		dates = dates[lo:hi]
	}
	out := make([]CalendarEntry, 0, len(dates))
	for _, d := range dates {
		entry, err := c.Resolve(d, f)
		if err != nil {
			return nil, err
		}
		if entry.LastTs < fromTs || entry.FirstTs > toTs {
			continue
		}
		out = append(out, entry)
	}
	return out, nil
}
