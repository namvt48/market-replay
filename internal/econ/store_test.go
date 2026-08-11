package econ

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// writeShard writes one JSONL shard under dataDir/econ.
func writeShard(t *testing.T, dataDir, name string, lines ...string) {
	t.Helper()
	dir := filepath.Join(dataDir, "econ")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := strings.Join(lines, "\n") + "\n"
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func event(id string, ts int64, importance, country string, extra string) string {
	base := `{"id":"` + id + `","ts":` + itoa(ts) + `,"country":"` + country +
		`","title":"` + id + `","importance":"` + importance + `"`
	if extra != "" {
		base += "," + extra
	}
	return base + "}"
}

func itoa(v int64) string {
	out, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(out)
}

// Monday 2026-03-02 00:00 America/New_York, the week that springs forward.
func nyWeek(t *testing.T) (start, end int64, loc *time.Location) {
	t.Helper()
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	monday := time.Date(2026, time.March, 2, 0, 0, 0, 0, loc)
	return monday.Unix(), monday.AddDate(0, 0, 7).Unix(), loc
}

func TestOpen_MissingDirectoryIsNotAnError(t *testing.T) {
	// An install with no calendar has to keep working exactly as before.
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	meta := store.Meta()
	if meta.Available || meta.Count != 0 {
		t.Fatalf("meta = %+v, want an unavailable, empty calendar", meta)
	}
	week, err := store.Week(WeekRequest{At: 1_700_000_000})
	if err != nil {
		t.Fatalf("Week: %v", err)
	}
	if len(week.Events) != 0 {
		t.Errorf("events = %v, want none", week.Events)
	}
	if week.WeekStart == 0 || week.WeekEnd <= week.WeekStart {
		t.Errorf("week bounds = [%d,%d), want a real week even with no data", week.WeekStart, week.WeekEnd)
	}
}

func TestOpen_MergesShardsAndOrdersByReleaseTime(t *testing.T) {
	dir := t.TempDir()
	writeShard(t, dir, "2026-b.jsonl",
		"# a comment line, and a blank one below",
		"",
		event("late", 2_000, ImportanceLow, "EU", ""),
	)
	writeShard(t, dir, "2026-a.jsonl",
		event("early", 1_000, ImportanceHigh, "US", `"currency":"USD","forecast":"0.2%","previous":"0.1%","actual":"0.3%"`),
		event("middle", 1_500, ImportanceMedium, "JP", ""),
	)

	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	meta := store.Meta()
	if !meta.Available || meta.Count != 3 {
		t.Fatalf("meta = %+v, want 3 available events", meta)
	}
	if meta.FirstTs != 1_000 || meta.LastTs != 2_000 {
		t.Errorf("meta span = [%d,%d], want [1000,2000]", meta.FirstTs, meta.LastTs)
	}
	if got := strings.Join(meta.Countries, ","); got != "EU,JP,US" {
		t.Errorf("countries = %q, want sorted unique EU,JP,US", got)
	}

	// Ordered by release time regardless of which shard held them.
	week, err := store.Week(WeekRequest{At: 1_500, CursorTs: 9_999})
	if err != nil {
		t.Fatalf("Week: %v", err)
	}
	var ids []string
	for _, e := range week.Events {
		ids = append(ids, e.ID)
	}
	if got := strings.Join(ids, ","); got != "early,middle,late" {
		t.Errorf("event order = %q, want early,middle,late", got)
	}
}

func TestOpen_RejectsBadRecordsWithFileAndLine(t *testing.T) {
	cases := map[string]string{
		"no id":                 `{"ts":1000,"country":"US","title":"x","importance":"high"}`,
		"no ts":                 `{"id":"a","country":"US","title":"x","importance":"high"}`,
		"negative ts":           `{"id":"a","ts":-5,"country":"US","title":"x","importance":"high"}`,
		"no country":            `{"id":"a","ts":1000,"title":"x","importance":"high"}`,
		"no title":              `{"id":"a","ts":1000,"country":"US","importance":"high"}`,
		"bad importance":        `{"id":"a","ts":1000,"country":"US","title":"x","importance":"critical"}`,
		"announced after event": `{"id":"a","ts":1000,"country":"US","title":"x","importance":"high","announcedTs":2000}`,
		// A typo in a field name would otherwise load as a silently
		// low-importance event that the trader's own filter then hides.
		"misspelled field": `{"id":"a","ts":1000,"country":"US","title":"x","improtance":"high"}`,
		"not json":         `{oops`,
	}
	for name, line := range cases {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			writeShard(t, dir, "2026.jsonl", event("ok", 500, ImportanceLow, "US", ""), line)
			_, err := Open(dir)
			if err == nil {
				t.Fatal("Open accepted a malformed record")
			}
			if !strings.Contains(err.Error(), "2026.jsonl:2") {
				t.Errorf("error %q does not point at the offending file and line", err)
			}
		})
	}
}

func TestOpen_RejectsDuplicateIdsAcrossShards(t *testing.T) {
	dir := t.TempDir()
	writeShard(t, dir, "2025.jsonl", event("us-cpi", 1_000, ImportanceHigh, "US", ""))
	writeShard(t, dir, "2026.jsonl", event("us-cpi", 2_000, ImportanceHigh, "US", ""))

	_, err := Open(dir)
	if err == nil {
		t.Fatal("Open accepted the same id twice")
	}
	// Both locations, so the operator can see which shard to fix.
	if !strings.Contains(err.Error(), "2026.jsonl:1") || !strings.Contains(err.Error(), "2025.jsonl:1") {
		t.Errorf("error %q does not name both occurrences", err)
	}
}

// TestWeek_WithholdsOutcomesAfterTheCursor is the core guarantee: a trader
// replaying Monday can see that CPI prints on Thursday, because that was on
// the published schedule, but must not be able to read Thursday's number.
func TestWeek_WithholdsOutcomesAfterTheCursor(t *testing.T) {
	start, _, _ := nyWeek(t)
	monday := start + 10*3600
	thursday := start + 3*86400 + 8*3600

	dir := t.TempDir()
	writeShard(t, dir, "2026.jsonl",
		event("past", monday, ImportanceHigh, "US", `"forecast":"0.2%","previous":"0.1%","actual":"0.3%"`),
		event("future", thursday, ImportanceHigh, "US", `"forecast":"0.4%","previous":"0.3%","actual":"0.9%"`),
	)
	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	// Cursor sits between the two releases.
	week, err := store.Week(WeekRequest{At: monday, CursorTs: monday + 3600, TimeZone: "America/New_York"})
	if err != nil {
		t.Fatalf("Week: %v", err)
	}
	if len(week.Events) != 2 {
		t.Fatalf("events = %d, want both — the schedule is public in advance", len(week.Events))
	}

	past, future := week.Events[0], week.Events[1]
	if !past.Released || past.Actual != "0.3%" {
		t.Errorf("past event = %+v, want released with its actual", past)
	}
	if future.Released {
		t.Errorf("future event reported as released: %+v", future)
	}
	if future.Actual != "" {
		t.Errorf("future actual leaked: %q", future.Actual)
	}
	// Forecast and previous are published ahead of the release, so they stay.
	if future.Forecast != "0.4%" || future.Previous != "0.3%" {
		t.Errorf("future event lost its published figures: %+v", future)
	}

	// Airtight check: the serialized form must not carry the key at all. An
	// empty string could be read as "the figure was blank".
	encoded, err := json.Marshal(future)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "actual") {
		t.Errorf("unreleased event serializes an actual key: %s", encoded)
	}
	if strings.Contains(string(encoded), "0.9%") {
		t.Fatalf("unreleased figure present in the payload: %s", encoded)
	}
}

// TestWeek_PagingAheadDoesNotRevealOutcomes covers why At and CursorTs are
// separate parameters: reading next week's schedule is normal, reading next
// week's numbers is not.
func TestWeek_PagingAheadDoesNotRevealOutcomes(t *testing.T) {
	start, end, _ := nyWeek(t)
	nextWeek := end + 2*86400

	dir := t.TempDir()
	writeShard(t, dir, "2026.jsonl", event("next", nextWeek, ImportanceHigh, "US", `"actual":"1.1%"`))
	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	week, err := store.Week(WeekRequest{At: end, CursorTs: start + 3600, TimeZone: "America/New_York"})
	if err != nil {
		t.Fatalf("Week: %v", err)
	}
	if len(week.Events) != 1 {
		t.Fatalf("events = %d, want next week's scheduled release", len(week.Events))
	}
	if week.Events[0].Released || week.Events[0].Actual != "" {
		t.Errorf("paging ahead revealed an outcome: %+v", week.Events[0])
	}
}

// TestWeek_HidesUnscheduledEventsUntilAnnounced — an emergency rate decision
// was not on any schedule, so its mere presence in the calendar before it was
// announced would tell the trader something they could not have known.
func TestWeek_HidesUnscheduledEventsUntilAnnounced(t *testing.T) {
	start, _, _ := nyWeek(t)
	release := start + 4*86400
	announced := start + 3*86400

	dir := t.TempDir()
	writeShard(t, dir, "2026.jsonl",
		event("emergency-cut", release, ImportanceHigh, "US", `"announcedTs":`+itoa(announced)),
	)
	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	before, err := store.Week(WeekRequest{At: start, CursorTs: announced - 1, TimeZone: "America/New_York"})
	if err != nil {
		t.Fatalf("Week: %v", err)
	}
	if len(before.Events) != 0 {
		t.Errorf("an unannounced event is visible: %+v", before.Events)
	}

	after, err := store.Week(WeekRequest{At: start, CursorTs: announced, TimeZone: "America/New_York"})
	if err != nil {
		t.Fatalf("Week: %v", err)
	}
	if len(after.Events) != 1 {
		t.Fatalf("events = %d once announced, want 1", len(after.Events))
	}
	if after.Events[0].Released {
		t.Errorf("announced but not yet released should not be released: %+v", after.Events[0])
	}
}

// TestWeek_BoundsAreMondayToMondayAndSurviveDst — the chart's weekly buckets
// anchor on Monday, so the calendar must too, and a week containing a DST
// change is still exactly seven calendar days rather than 168 fixed hours.
func TestWeek_BoundsAreMondayToMondayAndSurviveDst(t *testing.T) {
	start, end, loc := nyWeek(t)
	dir := t.TempDir()
	writeShard(t, dir, "2026.jsonl",
		event("first-instant", start, ImportanceLow, "US", ""),
		event("sunday-night", end-60, ImportanceLow, "US", ""),
		event("next-monday", end, ImportanceLow, "US", ""),
	)
	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	week, err := store.Week(WeekRequest{At: start + 3*86400, CursorTs: end, TimeZone: "America/New_York"})
	if err != nil {
		t.Fatalf("Week: %v", err)
	}
	if week.WeekStart != start || week.WeekEnd != end {
		t.Fatalf("bounds = [%d,%d), want [%d,%d)", week.WeekStart, week.WeekEnd, start, end)
	}
	if span := week.WeekEnd - week.WeekStart; span != 7*86400-3600 {
		t.Errorf("span = %ds; the spring-forward week is one hour short of 7x86400", span)
	}
	if week.TimeZone != loc.String() {
		t.Errorf("timeZone = %q, want %q", week.TimeZone, loc)
	}

	var ids []string
	for _, e := range week.Events {
		ids = append(ids, e.ID)
	}
	// weekEnd is exclusive: the next Monday's release belongs to next week.
	if got := strings.Join(ids, ","); got != "first-instant,sunday-night" {
		t.Errorf("events = %q, want the week's first instant through Sunday night only", got)
	}
}

func TestWeek_Filters(t *testing.T) {
	start, _, _ := nyWeek(t)
	dir := t.TempDir()
	writeShard(t, dir, "2026.jsonl",
		event("holiday", start+1800, ImportanceNone, "UK", ""),
		event("us-high", start+3600, ImportanceHigh, "US", ""),
		event("us-low", start+7200, ImportanceLow, "US", ""),
		event("eu-medium", start+10800, ImportanceMedium, "EU", ""),
	)
	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	base := WeekRequest{At: start, CursorTs: start + 86400, TimeZone: "America/New_York"}

	ids := func(req WeekRequest) string {
		t.Helper()
		week, err := store.Week(req)
		if err != nil {
			t.Fatalf("Week: %v", err)
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
	low := base
	low.MinImportance = ImportanceLow
	if got := ids(low); got != "us-high,us-low,eu-medium" {
		t.Errorf("minImportance=low = %q, want non-economic rows excluded", got)
	}
	medium := base
	medium.MinImportance = ImportanceMedium
	if got := ids(medium); got != "us-high,eu-medium" {
		t.Errorf("minImportance=medium = %q, want the high and medium ones", got)
	}
	high := base
	high.MinImportance = ImportanceHigh
	if got := ids(high); got != "us-high" {
		t.Errorf("minImportance=high = %q", got)
	}
	byCountry := base
	byCountry.Countries = []string{"eu"} // case-insensitive on purpose
	if got := ids(byCountry); got != "eu-medium" {
		t.Errorf("country=eu = %q", got)
	}
	both := base
	both.Countries = []string{"US"}
	both.MinImportance = ImportanceHigh
	if got := ids(both); got != "us-high" {
		t.Errorf("country=US&minImportance=high = %q", got)
	}
}

func TestWeek_RejectsBadInput(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Week(WeekRequest{At: 1_000, MinImportance: "critical"}); err == nil {
		t.Error("accepted an unknown importance level")
	}
	for _, tz := range []string{"Not/AZone", "../etc/passwd", "/absolute", strings.Repeat("a", 80)} {
		if _, err := store.Week(WeekRequest{At: 1_000, TimeZone: tz}); err == nil {
			t.Errorf("accepted timezone %q", tz)
		}
	}
	if _, err := store.Week(WeekRequest{At: 1_000, TimeZone: ""}); err != nil {
		t.Errorf("empty timezone should default to UTC, got %v", err)
	}
}

func TestReload_KeepsPreviousCalendarOnBadData(t *testing.T) {
	dir := t.TempDir()
	writeShard(t, dir, "2026.jsonl", event("good", 1_000, ImportanceHigh, "US", ""))
	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	writeShard(t, dir, "2026.jsonl", `{"id":"broken"`)
	if err := store.Reload(); err == nil {
		t.Fatal("Reload accepted a malformed shard")
	}
	if meta := store.Meta(); meta.Count != 1 {
		t.Fatalf("count = %d after a failed reload, want the previous calendar kept", meta.Count)
	}

	writeShard(t, dir, "2026.jsonl",
		event("good", 1_000, ImportanceHigh, "US", ""),
		event("added", 2_000, ImportanceLow, "EU", ""),
	)
	if err := store.Reload(); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if meta := store.Meta(); meta.Count != 2 {
		t.Fatalf("count = %d after a good reload, want 2", meta.Count)
	}
}

// TestSampleShardLoads keeps the shipped worked example honest. The sample at
// pipeline/econ.sample.jsonl is the format's documentation; if a change to the
// loader stops it loading, the documentation has silently gone wrong.
func TestSampleShardLoads(t *testing.T) {
	sample, err := os.ReadFile(filepath.Join("..", "..", "pipeline", "econ.sample.jsonl"))
	if err != nil {
		t.Fatalf("read sample: %v", err)
	}
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "econ"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "econ", "sample.jsonl"), sample, 0o644); err != nil {
		t.Fatal(err)
	}

	store, err := Open(dir)
	if err != nil {
		t.Fatalf("the documented sample no longer loads: %v", err)
	}
	meta := store.Meta()
	if !meta.Available || meta.Count == 0 {
		t.Fatalf("meta = %+v, want the sample's events", meta)
	}
	// The sample deliberately includes an unscheduled release, so that the
	// announcedTs rule has a worked example too.
	unscheduled := false
	for _, event := range store.events {
		if event.AnnouncedTs != 0 {
			unscheduled = true
		}
	}
	if !unscheduled {
		t.Error("the sample no longer demonstrates announcedTs")
	}
}
