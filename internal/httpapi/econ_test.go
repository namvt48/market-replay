package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The calendar's whole reason for existing on the server rather than being a
// static file the client fetches is the cursor: a replay may show next
// Thursday's CPI on the schedule but must never show Thursday's number before
// Thursday. These tests pin that, and the shape the client tab depends on.

type econWeekResponse struct {
	WeekStart int64  `json:"weekStart"`
	WeekEnd   int64  `json:"weekEnd"`
	TimeZone  string `json:"timeZone"`
	CursorTs  int64  `json:"cursorTs"`
	Events    []struct {
		ID         string `json:"id"`
		Ts         int64  `json:"ts"`
		Country    string `json:"country"`
		Title      string `json:"title"`
		Importance string `json:"importance"`
		Forecast   string `json:"forecast"`
		Released   bool   `json:"released"`
		Actual     string `json:"actual"`
	} `json:"events"`
}

func getEconWeek(t *testing.T, s *Server, query string) (econWeekResponse, *httptest.ResponseRecorder) {
	t.Helper()
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/econ/week?"+query, nil))
	var week econWeekResponse
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &week); err != nil {
			t.Fatalf("decode week: %v (%s)", err, rec.Body.String())
		}
	}
	return week, rec
}

// mondayNY is the Monday 00:00 America/New_York of a fixed week, used so the
// assertions read as calendar facts rather than magic numbers.
func mondayNY(t *testing.T) int64 {
	t.Helper()
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	return time.Date(2026, time.March, 2, 0, 0, 0, 0, loc).Unix()
}

func econLine(id string, ts int64, importance, country string, extra string) string {
	line := fmt.Sprintf(`{"id":%q,"ts":%d,"country":%q,"title":%q,"importance":%q`, id, ts, country, id, importance)
	if extra != "" {
		line += "," + extra
	}
	return line + "}"
}

// TestEconWeek_WithholdsUnreleasedFigures is the guarantee the endpoint exists
// for. Both events are on the schedule and both are returned; only the one the
// cursor has reached carries a number.
func TestEconWeek_WithholdsUnreleasedFigures(t *testing.T) {
	monday := mondayNY(t)
	past := monday + 10*3600
	future := monday + 3*86400 + 8*3600

	s := newEconTestServer(t,
		econLine("us-cpi", past, "high", "US", `"currency":"USD","forecast":"0.2%","previous":"0.1%","actual":"0.3%"`),
		econLine("us-nfp", future, "high", "US", `"currency":"USD","forecast":"180K","previous":"150K","actual":"250K"`),
	)

	week, rec := getEconWeek(t, s, fmt.Sprintf("at=%d&cursorTs=%d&tz=America/New_York", monday, past+60))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	if len(week.Events) != 2 {
		t.Fatalf("events = %d, want both — a published schedule is not a spoiler", len(week.Events))
	}
	if !week.Events[0].Released || week.Events[0].Actual != "0.3%" {
		t.Errorf("released event = %+v, want its figure", week.Events[0])
	}
	if week.Events[1].Released || week.Events[1].Actual != "" {
		t.Errorf("pending event leaked a figure: %+v", week.Events[1])
	}
	// Consensus is published ahead of the release, so it stays visible.
	if week.Events[1].Forecast != "180K" {
		t.Errorf("pending event lost its forecast: %+v", week.Events[1])
	}
	// Airtight: the number must not be anywhere in the payload.
	if strings.Contains(rec.Body.String(), "250K") {
		t.Fatalf("unreleased figure present in the response: %s", rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store — the answer moves with the cursor", got)
	}
}

// TestEconWeek_TracksTheReplayWeek covers the feature as asked for: as the
// replay cursor moves into a week, that week's calendar is what comes back.
func TestEconWeek_TracksTheReplayWeek(t *testing.T) {
	monday := mondayNY(t)
	thisWeek := monday + 2*86400
	nextWeek := monday + 9*86400

	s := newEconTestServer(t,
		econLine("this-week", thisWeek, "high", "US", `"actual":"1.0%"`),
		econLine("next-week", nextWeek, "high", "US", `"actual":"2.0%"`),
	)

	first, _ := getEconWeek(t, s, fmt.Sprintf("at=%d&cursorTs=%d&tz=America/New_York", thisWeek, thisWeek))
	if len(first.Events) != 1 || first.Events[0].ID != "this-week" {
		t.Fatalf("events = %+v, want only this week's release", first.Events)
	}

	// The response's own exclusive weekEnd is how a client pages forward.
	second, _ := getEconWeek(t, s, fmt.Sprintf("at=%d&cursorTs=%d&tz=America/New_York", first.WeekEnd, nextWeek))
	if len(second.Events) != 1 || second.Events[0].ID != "next-week" {
		t.Fatalf("events = %+v, want next week's release", second.Events)
	}
	if second.WeekStart != first.WeekEnd {
		t.Errorf("weeks are not contiguous: first ends at %d, second starts at %d", first.WeekEnd, second.WeekStart)
	}
}

// TestEconWeek_CursorDefaultsToTheAnchor keeps the common call cheap: a client
// that only ever asks for "the week I am replaying" need not send the cursor
// twice.
func TestEconWeek_CursorDefaultsToTheAnchor(t *testing.T) {
	monday := mondayNY(t)
	release := monday + 2*86400

	s := newEconTestServer(t, econLine("us-cpi", release, "high", "US", `"actual":"0.3%"`))

	atRelease, _ := getEconWeek(t, s, fmt.Sprintf("at=%d&tz=America/New_York", release))
	if len(atRelease.Events) != 1 || !atRelease.Events[0].Released {
		t.Fatalf("events = %+v, want the release visible when the cursor is on it", atRelease.Events)
	}
	if atRelease.CursorTs != release {
		t.Errorf("cursorTs = %d, want it echoed as the anchor %d", atRelease.CursorTs, release)
	}

	earlier, _ := getEconWeek(t, s, fmt.Sprintf("at=%d&tz=America/New_York", monday))
	if len(earlier.Events) != 1 || earlier.Events[0].Released {
		t.Fatalf("events = %+v, want the release still pending on Monday", earlier.Events)
	}
}

func TestEconWeek_Filters(t *testing.T) {
	monday := mondayNY(t)
	s := newEconTestServer(t,
		econLine("holiday", monday+1800, "none", "UK", ""),
		econLine("us-high", monday+3600, "high", "US", ""),
		econLine("us-low", monday+7200, "low", "US", ""),
		econLine("eu-medium", monday+10800, "medium", "EU", ""),
	)
	base := fmt.Sprintf("at=%d&cursorTs=%d&tz=America/New_York", monday, monday+86400)

	ids := func(query string) string {
		t.Helper()
		week, rec := getEconWeek(t, s, query)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
		}
		var out []string
		for _, e := range week.Events {
			out = append(out, e.ID)
		}
		return strings.Join(out, ",")
	}

	if got := ids(base); got != "holiday,us-high,us-low,eu-medium" {
		t.Errorf("unfiltered = %q", got)
	}
	if got := ids(base + "&minImportance=low"); got != "us-high,us-low,eu-medium" {
		t.Errorf("minImportance=low = %q", got)
	}
	if got := ids(base + "&minImportance=medium"); got != "us-high,eu-medium" {
		t.Errorf("minImportance=medium = %q", got)
	}
	if got := ids(base + "&country=US"); got != "us-high,us-low" {
		t.Errorf("country=US = %q", got)
	}
	if got := ids(base + "&country=US&country=EU&minImportance=high"); got != "us-high" {
		t.Errorf("repeated country + minImportance = %q", got)
	}
}

func TestEconWeek_RejectsBadInput(t *testing.T) {
	monday := mondayNY(t)
	s := newEconTestServer(t, econLine("us-cpi", monday+3600, "high", "US", ""))

	for name, query := range map[string]string{
		"missing at":       "cursorTs=1000",
		"at not a number":  "at=soon",
		"bad cursor":       fmt.Sprintf("at=%d&cursorTs=later", monday),
		"unknown timezone": fmt.Sprintf("at=%d&tz=Not/AZone", monday),
		"traversal tz":     fmt.Sprintf("at=%d&tz=../etc/passwd", monday),
		"bad importance":   fmt.Sprintf("at=%d&minImportance=critical", monday),
	} {
		t.Run(name, func(t *testing.T) {
			_, rec := getEconWeek(t, s, query)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestEconMeta_DescribesTheCalendar(t *testing.T) {
	monday := mondayNY(t)
	s := newEconTestServer(t,
		econLine("us-cpi", monday+3600, "high", "US", ""),
		econLine("eu-hicp", monday+7200, "medium", "EU", ""),
		econLine("us-nfp", monday+10800, "high", "US", ""),
	)

	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/econ/meta", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	var meta struct {
		Available bool     `json:"available"`
		Count     int      `json:"count"`
		FirstTs   int64    `json:"firstTs"`
		LastTs    int64    `json:"lastTs"`
		Countries []string `json:"countries"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &meta); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if !meta.Available || meta.Count != 3 {
		t.Fatalf("meta = %+v, want 3 available events", meta)
	}
	if meta.FirstTs != monday+3600 || meta.LastTs != monday+10800 {
		t.Errorf("span = [%d,%d]", meta.FirstTs, meta.LastTs)
	}
	if got := strings.Join(meta.Countries, ","); got != "EU,US" {
		t.Errorf("countries = %q, want deduplicated and sorted", got)
	}
}

// TestEcon_WithoutADatasetStaysUsable — the calendar is optional. An install
// that has never imported one must not see errors: the tab can render the
// right week, empty, and the meta endpoint says so plainly.
func TestEcon_WithoutADatasetStaysUsable(t *testing.T) {
	s := newTestServer(t) // no econ shard written

	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/econ/meta", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("meta status = %d (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"available":false`) {
		t.Errorf("meta = %s, want available:false", rec.Body.String())
	}
	// countries must be [] rather than null, so a client can iterate it.
	if !strings.Contains(rec.Body.String(), `"countries":[]`) {
		t.Errorf("meta = %s, want an empty countries array", rec.Body.String())
	}

	monday := mondayNY(t)
	week, weekRec := getEconWeek(t, s, fmt.Sprintf("at=%d&tz=America/New_York", monday))
	if weekRec.Code != http.StatusOK {
		t.Fatalf("week status = %d (%s)", weekRec.Code, weekRec.Body.String())
	}
	if week.WeekStart != monday || week.WeekEnd <= week.WeekStart {
		t.Errorf("week bounds = [%d,%d), want the real week even with no data", week.WeekStart, week.WeekEnd)
	}
	if len(week.Events) != 0 {
		t.Errorf("events = %+v, want none", week.Events)
	}
	if !strings.Contains(weekRec.Body.String(), `"events":[]`) {
		t.Errorf("week = %s, want an empty events array rather than null", weekRec.Body.String())
	}
}

// TestEcon_ReloadPicksUpNewWeeks — the pipeline appends next week's releases
// beside new bars, and both land on the same SIGHUP.
func TestEcon_ReloadPicksUpNewWeeks(t *testing.T) {
	monday := mondayNY(t)
	s, dataDir := newTestServerWithDataDir(t)
	writeEconFixture(t, dataDir, econLine("us-cpi", monday+3600, "high", "US", ""))
	if err := s.Econ.Reload(); err != nil {
		t.Fatalf("Reload: %v", err)
	}

	week, rec := getEconWeek(t, s, fmt.Sprintf("at=%d&cursorTs=%d&tz=America/New_York", monday, monday+86400))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	if len(week.Events) != 1 || week.Events[0].ID != "us-cpi" {
		t.Fatalf("events = %+v, want the newly imported release", week.Events)
	}
}
