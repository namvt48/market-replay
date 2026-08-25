package bars

import (
	"fmt"
	"testing"
	"time"

	"market-replay/internal/model"
)

// everyDisplayTimeframe lists every value validTimeframe accepts, spread
// across all six units and including the multipliers at each unit's edges.
func everyDisplayTimeframe() []string {
	var out []string
	for multiplier := 5; multiplier <= 55; multiplier += 5 {
		out = append(out, fmt.Sprintf("%ds", multiplier))
	}
	for _, multiplier := range []int{1, 2, 3, 5, 10, 15, 30, 45, 60, 120, 240, 720, 1440} {
		out = append(out, fmt.Sprintf("%dm", multiplier))
	}
	for _, multiplier := range []int{1, 2, 3, 4, 6, 8, 12} {
		out = append(out, fmt.Sprintf("%dh", multiplier))
	}
	out = append(out, "1d")
	for _, multiplier := range []int{1, 2, 4, 13, 26, 52} {
		out = append(out, fmt.Sprintf("%dw", multiplier))
	}
	for _, multiplier := range []int{1, 2, 3, 6, 12} {
		out = append(out, fmt.Sprintf("%dM", multiplier))
	}
	return out
}

// TestSubMinuteRollupsUnreachable is the invariant
// rollupsServeDisplayTimeframes rests on: no timeframe that routes to a
// sub-minute base dataset can read a rollup, so building rollups over that
// dataset is provably wasted work.
//
// If someone later teaches rollupFor or rthRollupFor to answer for a
// seconds-unit timeframe, this fails — which is the point. Without it, the
// gate would silently strand that new consumer on the raw-scan path.
func TestSubMinuteRollupsUnreachable(t *testing.T) {
	// Every index non-empty, so "returns nil" can only come from the
	// timeframe switch and never from an index that happens to be empty.
	file := &BarFile{rollups: &rollups{
		hourly:    []rollupBar{{}},
		daily:     []rollupBar{{}},
		rthHourly: []rollupBar{{}},
		rthDaily:  []rollupBar{{}},
	}}
	calendar := &Calendar{}

	timeframes := everyDisplayTimeframe()
	if len(timeframes) < 40 {
		t.Fatalf("only %d timeframes enumerated; the table is not covering the units", len(timeframes))
	}
	sawRollupConsumer := false
	for _, tf := range timeframes {
		parsed, err := parseChartTimeframe(tf)
		if err != nil {
			t.Fatalf("%s: %v", tf, err)
		}
		base := BaseTimeframe(tf)
		if base != "1m" && base != "5s" {
			t.Fatalf("%s routes to unexpected base dataset %q", tf, base)
		}
		usesRollup := rollupFor(file, calendar, parsed) != nil || rthRollupFor(file, parsed) != nil
		if usesRollup {
			sawRollupConsumer = true
		}
		if base != "1m" && usesRollup {
			t.Fatalf("%s routes to base %q and reads a rollup; rollupsServeDisplayTimeframes would starve it", tf, base)
		}
		if usesRollup && !rollupsServeDisplayTimeframes(base) {
			t.Fatalf("%s reads a rollup but its base dataset %q is gated out of building one", tf, base)
		}
	}
	if !sawRollupConsumer {
		t.Fatal("no timeframe in the table reads a rollup; it proves nothing")
	}
}

func TestRollupsServeDisplayTimeframes(t *testing.T) {
	for _, tf := range []string{"5s", "15s", "55s"} {
		if rollupsServeDisplayTimeframes(tf) {
			t.Errorf("%s: want false, seconds datasets have no rollup consumer", tf)
		}
	}
	for _, tf := range []string{"1m", "5m", "60m", "1h", "1d", "1w", "1M"} {
		if !rollupsServeDisplayTimeframes(tf) {
			t.Errorf("%s: want true", tf)
		}
	}
	// An unrecognised dataset timeframe keeps its indexes rather than losing
	// them because of an unexpected filename.
	for _, tf := range []string{"", "1", "7q", "tick"} {
		if !rollupsServeDisplayTimeframes(tf) {
			t.Errorf("%q: want true (unknown timeframes must not be silently unindexed)", tf)
		}
	}
}

// TestIndexSkipsRollupsWithoutPlan pins both halves of the gate: a dataset
// nothing can query gets no rollups, and it still gets everything a request
// against it does need — validated timestamps, a hash, and an ordered
// calendar for GET /api/v1/calendar's binary search.
func TestIndexSkipsRollupsWithoutPlan(t *testing.T) {
	const sessions, barsPerSession = 8, 120
	data := simpleFixture(sessions*barsPerSession, 1_700_000_000, 5)
	file, err := newBarFile(data)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := planFor("5s", model.SymbolMeta{Kind: "future", SessionTz: "America/New_York"})
	if err != nil {
		t.Fatal(err)
	}
	if plan.rollups {
		t.Fatal("planFor(5s) asked for rollups")
	}
	hash, err := file.index(plan)
	if err != nil {
		t.Fatal(err)
	}
	if hash == 0 {
		t.Error("no ts hash from the validate-only pass")
	}
	if got := file.rollups; len(got.hourly) != 0 || len(got.rthHourly) != 0 || len(got.rthDaily) != 0 {
		t.Errorf("built %d hourly, %d rthHourly, %d rthDaily entries nothing can read",
			len(got.hourly), len(got.rthHourly), len(got.rthDaily))
	}

	raw := make(map[string]idxEntry, sessions)
	for i := 0; i < sessions; i++ {
		raw[fmt.Sprintf("2023-11-%02d", 14+i)] = idxEntry{Offset: i * barsPerSession, Count: barsPerSession}
	}
	calendar, err := loadCalendar(writeIdxFixture(t, raw))
	if err != nil {
		t.Fatal(err)
	}
	if rejected := file.attachCalendarRollup(calendar, plan); rejected != "" {
		t.Fatalf("calendar rejected: %s", rejected)
	}
	if len(file.rollups.daily) != 0 {
		t.Errorf("built %d daily entries nothing can read", len(file.rollups.daily))
	}
	if !calendar.ordered {
		t.Error("calendar not marked ordered; GET /api/v1/calendar?tf=5s loses its binary search")
	}
	entries, err := calendar.Range(file.TsAt(0), file.TsAt(file.Count()-1), file)
	if err != nil {
		t.Fatalf("Range: %v", err)
	}
	if len(entries) != sessions {
		t.Errorf("Range returned %d sessions, want %d", len(entries), sessions)
	}
}

// TestIndexTsHashIsPlanIndependent is load-bearing for the .roll cache: the
// validate-only pass and the full indexing pass must agree on the hash, or a
// cache written by one would never be accepted by the other.
func TestIndexTsHashIsPlanIndependent(t *testing.T) {
	data := simpleFixture(5_000, 1_700_000_000, 60)

	scanOnly, err := newBarFile(data)
	if err != nil {
		t.Fatal(err)
	}
	scanHash, err := scanOnly.index(indexPlan{})
	if err != nil {
		t.Fatal(err)
	}

	indexed, err := newBarFile(data)
	if err != nil {
		t.Fatal(err)
	}
	fullHash, err := indexed.index(indexPlan{rollups: true, location: time.UTC})
	if err != nil {
		t.Fatal(err)
	}
	if scanHash != fullHash {
		t.Fatalf("validate-only hash %d != full-index hash %d", scanHash, fullHash)
	}
	if len(indexed.rollups.hourly) == 0 {
		t.Fatal("full pass built no hourly index; the comparison proves nothing")
	}

	// A different timeline must hash differently, or the cache would happily
	// serve rollups derived from bars that no longer exist.
	shifted, err := newBarFile(simpleFixture(5_000, 1_700_000_060, 60))
	if err != nil {
		t.Fatal(err)
	}
	shiftedHash, err := shifted.index(indexPlan{})
	if err != nil {
		t.Fatal(err)
	}
	if shiftedHash == scanHash {
		t.Fatal("shifting every timestamp left the hash unchanged")
	}
}
