package httpapi

import (
	"errors"
	"fmt"
	"net/http"

	"market-replay/internal/econ"
)

// emptyCalendar answers for an install with no calendar dataset. A zero
// econ.Store is a valid empty calendar, so the endpoints can still return
// correct week bounds instead of an error for a feature the owner simply has
// not populated.
var emptyCalendar = &econ.Store{}

// handleEconMeta serves GET /api/v1/econ/meta — what the calendar holds.
//
// Exists so a client can decide whether to offer the calendar at all, and
// populate its country filter, without first downloading a week it might not
// be able to show. `available:false` is the normal answer for an install with
// no calendar data, not an error.
func (s *Server) handleEconMeta(w http.ResponseWriter, _ *http.Request) {
	calendar := s.Econ
	if calendar == nil {
		calendar = emptyCalendar
	}
	// Reloadable under SIGHUP, so never cached.
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, calendar.Meta())
}

// handleEconWeek serves
// GET /api/v1/econ/week?at=&cursorTs=&tz=&minImportance=&country=
//
//   - at            required. Any timestamp inside the wanted week.
//   - cursorTs      optional, defaults to at. Where the replay actually
//     stands. Releases after it come back with released:false
//     and no actual.
//   - tz            optional, defaults to UTC. IANA name; the week runs
//     Monday 00:00 to the next Monday 00:00 in this zone.
//   - minImportance optional: low | medium | high.
//   - country       optional, repeatable.
//
// at and cursorTs are separate because paging to next week's schedule is a
// legitimate thing for a trader to do — schedules are published in advance —
// while next week's numbers are not. Moving `at` alone changes which week is
// shown without moving the line that decides what may be revealed.
func (s *Server) handleEconWeek(w http.ResponseWriter, r *http.Request) {
	at, err := parseInt64Required(r, "at")
	if err != nil {
		writeError(w, err)
		return
	}
	cursorTs, err := parseInt64(r, "cursorTs", at)
	if err != nil {
		writeError(w, err)
		return
	}
	request := econ.WeekRequest{
		At:            at,
		CursorTs:      cursorTs,
		TimeZone:      r.URL.Query().Get("tz"),
		MinImportance: r.URL.Query().Get("minImportance"),
		Countries:     r.URL.Query()["country"],
	}

	// A missing dataset still answers with the week's bounds, so a client can
	// render an empty calendar for the right dates rather than an error.
	calendar := s.Econ
	if calendar == nil {
		calendar = emptyCalendar
	}
	week, err := calendar.Week(request)
	if err != nil {
		writeError(w, econRequestError(err))
		return
	}
	// The response depends on the replay cursor, which moves continuously.
	// Caching it would only ever serve a client its own past.
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, week)
}

// econRequestError maps the calendar's input errors to 400 — a bad timezone
// or importance level is the client asking for something impossible, not a
// server fault.
func econRequestError(err error) error {
	if errors.Is(err, econ.ErrUnknownTimeZone) || errors.Is(err, econ.ErrBadImportance) {
		return fmt.Errorf("%w: %v", errBadRequest, err)
	}
	return err
}
