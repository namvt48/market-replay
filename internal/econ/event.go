// Package econ serves the economic calendar: scheduled macro releases (CPI,
// FOMC, NFP and friends) that a replay surfaces week by week beside the
// chart.
//
// It is deliberately separate from package bars, because the two fail
// differently. Bars are mandatory, binary and mmap'd; the calendar is
// optional plain text that an install may simply not have, and a missing
// calendar must never stop the server from serving a replay.
//
// # Input format
//
//	dataDir/econ/*.jsonl
//
// One JSON object per line, and every file in the directory is merged.
// Sharding by year (2024.jsonl, 2025.jsonl, …) is the expected layout.
// JSON Lines rather than one big array because the feed is append-only, a
// diff stays one event per line, and a malformed record can be reported with
// its file and line number instead of taking the whole document down.
//
//	{"id":"us-cpi-2026-08-12","ts":1786012200,"country":"US","currency":"USD",
//	 "title":"CPI m/m","importance":"high",
//	 "forecast":"0.2%","previous":"0.1%","actual":"0.3%"}
//
// Fields:
//
//   - id           required, unique across every file. Re-importing the same
//     event must overwrite rather than duplicate it, and the
//     client needs a stable key.
//   - ts           required, epoch seconds UTC — the scheduled release time.
//     Epoch seconds because that is the unit every other
//     timestamp in this system already uses.
//   - country      required. ISO 3166 alpha-2 ("US", "JP") or a region
//     ("EU", "GB").
//   - title        required, as the calendar should display it ("CPI m/m").
//   - importance   required: "low", "medium" or "high".
//   - currency     optional, the currency the release moves ("USD").
//   - forecast     optional, consensus before the release.
//   - previous     optional, the prior period's figure.
//   - actual       optional, the released figure. Withheld from clients
//     until the replay cursor reaches ts — see Event.viewAt.
//   - announcedTs  optional, epoch seconds. When the event became publicly
//     known, for releases that were NOT on the published
//     schedule (an emergency rate decision). Absent means "was
//     always on the schedule".
//   - source       optional provenance tag, for tracing a bad figure back to
//     whatever produced it.
//
// Values are strings, not numbers, on purpose: real releases read "0.3%",
// "215K", "3.75%-4.00%", "-0.1". Forcing them into floats would lose the
// unit and the range forms, and a calendar displays them verbatim anyway.
package econ

import (
	"fmt"
	"sort"
	"strings"
)

// Importance levels, ordered.
const (
	ImportanceLow    = "low"
	ImportanceMedium = "medium"
	ImportanceHigh   = "high"
)

var importanceRank = map[string]int{
	ImportanceLow:    0,
	ImportanceMedium: 1,
	ImportanceHigh:   2,
}

func validImportance(value string) bool {
	_, ok := importanceRank[value]
	return ok
}

// Event is one calendar entry exactly as stored on disk.
//
// Actual is the only field here that is not knowable in advance, which is
// why the wire type is separate (see EventView): a field added to this
// struct stays invisible to clients until somebody deliberately copies it
// across, instead of leaking the moment it is introduced.
type Event struct {
	ID          string  `json:"id"`
	Ts          int64   `json:"ts"`
	Country     string  `json:"country"`
	Currency    string  `json:"currency"`
	Title       string  `json:"title"`
	Importance  string  `json:"importance"`
	Forecast    string  `json:"forecast"`
	Previous    string  `json:"previous"`
	Actual      *string `json:"actual"`
	AnnouncedTs int64   `json:"announcedTs"`
	Source      string  `json:"source"`
}

// EventView is what a client receives. It carries the schedule — which a
// trader legitimately knows in advance — and the released figure only once
// the replay cursor has reached it.
type EventView struct {
	ID         string `json:"id"`
	Ts         int64  `json:"ts"`
	Country    string `json:"country"`
	Currency   string `json:"currency,omitempty"`
	Title      string `json:"title"`
	Importance string `json:"importance"`
	Forecast   string `json:"forecast,omitempty"`
	Previous   string `json:"previous,omitempty"`
	// Released says whether the replay cursor has passed ts. A client can
	// render a pending release without having to compare timestamps itself,
	// and without reading anything into a missing actual.
	Released bool `json:"released"`
	// Actual is present only when Released. Absent, not empty: an empty
	// string is a legitimate stored value, "we are not telling you yet" is
	// not the same thing.
	Actual string `json:"actual,omitempty"`
}

// viewAt projects an event for a client whose replay cursor sits at
// cursorTs, withholding the outcome of anything that has not happened yet.
//
// This is the whole point of the package's read path. A trader replaying
// last March can see that CPI prints on Thursday — that was on the schedule
// — but must not be able to read Thursday's number on Monday.
func (e Event) viewAt(cursorTs int64) EventView {
	view := EventView{
		ID:         e.ID,
		Ts:         e.Ts,
		Country:    e.Country,
		Currency:   e.Currency,
		Title:      e.Title,
		Importance: e.Importance,
		Forecast:   e.Forecast,
		Previous:   e.Previous,
		Released:   e.Ts <= cursorTs,
	}
	if view.Released && e.Actual != nil {
		view.Actual = *e.Actual
	}
	return view
}

// knownAt reports whether the event's existence is public at cursorTs. A
// scheduled release always is; an unscheduled one only becomes so when it is
// announced, and showing it earlier would tell the trader that an emergency
// meeting is coming.
func (e Event) knownAt(cursorTs int64) bool {
	return e.AnnouncedTs == 0 || e.AnnouncedTs <= cursorTs
}

// validate rejects a record that would produce a nonsensical calendar. The
// loader reports the offending file and line, so a bad feed is a fixable
// data problem rather than a mystery in the UI.
func (e Event) validate() error {
	switch {
	case strings.TrimSpace(e.ID) == "":
		return fmt.Errorf("id is required")
	case e.Ts <= 0:
		return fmt.Errorf("ts must be a positive epoch-second timestamp, got %d", e.Ts)
	case strings.TrimSpace(e.Country) == "":
		return fmt.Errorf("country is required")
	case strings.TrimSpace(e.Title) == "":
		return fmt.Errorf("title is required")
	case !validImportance(e.Importance):
		return fmt.Errorf("importance must be low, medium or high, got %q", e.Importance)
	case e.AnnouncedTs < 0:
		return fmt.Errorf("announcedTs must not be negative, got %d", e.AnnouncedTs)
	case e.AnnouncedTs > e.Ts:
		// An event cannot become public after it has already happened; that
		// combination would hide a past release from every cursor.
		return fmt.Errorf("announcedTs %d is after ts %d", e.AnnouncedTs, e.Ts)
	}
	return nil
}

// sortEvents orders by release time, then id, so a week's events come back
// in the order a calendar reads them and the order never depends on which
// file a record happened to live in.
func sortEvents(events []Event) {
	sort.Slice(events, func(i, j int) bool {
		if events[i].Ts != events[j].Ts {
			return events[i].Ts < events[j].Ts
		}
		return events[i].ID < events[j].ID
	})
}
