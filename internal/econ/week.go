package econ

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// ErrUnknownTimeZone is returned for a timezone the runtime cannot resolve.
var ErrUnknownTimeZone = errors.New("econ: unknown timezone")

// locationCache mirrors the one in package bars, for the same reason:
// time.LoadLocation has no cache of its own, so every request would
// otherwise pay a tzdata lookup and parse to resolve one of a handful of
// zone names. Duplicated rather than shared because a ten-line leaf cache is
// not worth coupling the calendar to the bar reader over.
var locationCache sync.Map // string -> *time.Location

func loadLocation(name string) (*time.Location, error) {
	if name == "" {
		return time.UTC, nil
	}
	if cached, ok := locationCache.Load(name); ok {
		return cached.(*time.Location), nil
	}
	// Validate before touching the loader: LoadLocation resolves a name
	// against tzdata, and an unchecked name is user input reaching a lookup.
	if !validTimeZoneName(name) {
		return nil, fmt.Errorf("%w: %q", ErrUnknownTimeZone, name)
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, fmt.Errorf("%w: %q", ErrUnknownTimeZone, name)
	}
	actual, _ := locationCache.LoadOrStore(name, loc)
	return actual.(*time.Location), nil
}

func validTimeZoneName(name string) bool {
	if len(name) > 64 || strings.HasPrefix(name, "/") || strings.Contains(name, "..") {
		return false
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '/' || r == '_' || r == '-' || r == '+':
		default:
			return false
		}
	}
	return name != ""
}

// weekBounds returns the half-open [start,end) epoch-second range of the
// Monday-to-Sunday week containing at, in loc.
//
// Monday start because that is how every economic calendar is laid out, and
// because the chart's own weekly buckets already anchor on Monday — two
// different week definitions in one screen would be its own bug.
//
// The end is computed with AddDate rather than start+7*86400 so a week that
// crosses a DST change is still exactly seven calendar days, 167 or 169 hours
// long, and no Sunday release falls outside its own week.
func weekBounds(at int64, loc *time.Location) (start, end int64) {
	local := time.Unix(at, 0).In(loc)
	daysFromMonday := (int(local.Weekday()) + 6) % 7
	midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	monday := midnight.AddDate(0, 0, -daysFromMonday)
	return monday.Unix(), monday.AddDate(0, 0, 7).Unix()
}
