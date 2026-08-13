package indicators

import (
	"fmt"
	"sync"
	"time"
)

// locationCache mirrors bars.cachedLoadLocation's shape but is kept
// private to this package deliberately: sharing a cache with internal/bars
// would mean touching an existing, unrelated file for a minor dedup, which
// is out of proportion to what this feature needs.
var locationCache sync.Map // string -> *time.Location

func loadLocationCached(name string) (*time.Location, error) {
	if cached, ok := locationCache.Load(name); ok {
		return cached.(*time.Location), nil
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, fmt.Errorf("_moment: load location %q: %w", name, err)
	}
	actual, _ := locationCache.LoadOrStore(name, loc)
	return actual.(*time.Location), nil
}

// momentValue is a minimal, Go-backed stand-in for the handful of
// moment-timezone chained calls the DSL scripts use — not a ported JS
// library. It arrives from (and ValueOf returns to) epoch *seconds*,
// matching bars.BarFile.TsAt's own unit rather than real moment.js's
// milliseconds, so a script mixing this with a raw bar timestamp never
// silently misscales by 1000x.
//
// Real tzdata (via time.LoadLocation) makes DST transitions (EST/EDT etc.)
// correct for free — there is deliberately no manual UTC-offset math
// anywhere in this file.
type momentValue struct {
	t   time.Time
	loc *time.Location
}

func newMomentValue(tsSeconds int64) *momentValue {
	return &momentValue{t: time.Unix(tsSeconds, 0).UTC(), loc: time.UTC}
}

// Tz mutates the receiver's zone and returns it, matching real moment.js's
// mutating fluent API. Scripts depend on this being a real mutation: the
// DSL's own getSessionStartTimestamp calls .clone() before any destructive
// chain specifically so the shared instance survives it.
func (m *momentValue) Tz(name string) (*momentValue, error) {
	loc, err := loadLocationCached(name)
	if err != nil {
		return nil, err
	}
	m.loc = loc
	return m, nil
}

func (m *momentValue) Hour() int   { return m.t.In(m.loc).Hour() }
func (m *momentValue) Minute() int { return m.t.In(m.loc).Minute() }

// Clone returns an independent copy — mutating it never affects the
// receiver it was cloned from.
func (m *momentValue) Clone() *momentValue {
	clone := *m
	return &clone
}

// StartOf supports only "day", the one unit the DSL scripts use.
func (m *momentValue) StartOf(unit string) (*momentValue, error) {
	if unit != "day" {
		return nil, fmt.Errorf("_moment: startOf(%q) not supported", unit)
	}
	local := m.t.In(m.loc)
	m.t = time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, m.loc)
	return m, nil
}

// Add supports only "hours" and "minutes", the units the DSL scripts use.
func (m *momentValue) Add(amount float64, unit string) (*momentValue, error) {
	switch unit {
	case "hours":
		m.t = m.t.Add(time.Duration(amount * float64(time.Hour)))
	case "minutes":
		m.t = m.t.Add(time.Duration(amount * float64(time.Minute)))
	default:
		return nil, fmt.Errorf("_moment: add(_, %q) not supported", unit)
	}
	return m, nil
}

// ValueOf returns epoch seconds — see the type doc comment for why this is
// seconds, not real moment.js milliseconds.
func (m *momentValue) ValueOf() int64 { return m.t.Unix() }
