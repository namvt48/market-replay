package bars

import (
	"os"
	"testing"
	"time"
)

// realDataDir points at the repo's actual data directory. These tests
// exercise the real NQ fixture already produced by pipeline/compile.py
// (129MB) — they skip gracefully if it isn't present (e.g. a checkout
// without the data/ directory), rather than failing CI on other machines.
const realDataDir = "../../data"

func skipIfNoRealData(t *testing.T) {
	t.Helper()
	if _, err := os.Stat(realDataDir + "/bin/NQ.1m.bin"); err != nil {
		t.Skip("real data/bin/NQ.1m.bin not present, skipping integration test")
	}
}

// openRealNQ opens and indexes the real NQ 1m dataset the way the registry
// does, so these tests see a file in the state a published slot holds:
// timestamps validated, rollups built.
func openRealNQ(t *testing.T) *BarFile {
	t.Helper()
	f, err := openBarFile(realDataDir + "/bin/NQ.1m.bin")
	if err != nil {
		t.Fatalf("openBarFile: %v", err)
	}
	if _, err := f.index(indexPlan{rollups: true, location: newYork(t)}); err != nil {
		f.Close()
		t.Fatalf("index: %v", err)
	}
	return f
}

func newYork(t *testing.T) *time.Location {
	t.Helper()
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	return location
}

// TestIntegration_OpenRealNQFile checks what a real file can be checked for
// without hardcoding facts a re-ingest invalidates. It used to assert two
// literal timestamps, which only tested that nobody had re-ingested the data
// since the test was written — and went red the moment someone did. Whether
// the API advertises this range is TestRegistry_CorrectsAdvertisedRanges'
// job, on fixtures, without reading 8.8 GB.
func TestIntegration_OpenRealNQFile(t *testing.T) {
	skipIfNoRealData(t)
	f := openRealNQ(t)
	defer f.Close()

	if f.Count() == 0 {
		t.Fatal("Count() = 0, want > 0")
	}
	first, last := f.TsAt(0), f.TsAt(f.Count()-1)
	t.Logf("NQ.1m.bin: %d bars, ts %d..%d", f.Count(), first, last)
	if first >= last {
		t.Fatalf("first ts %d is not before last ts %d", first, last)
	}
	if f.TickNum() != 1 || f.TickDen() != 4 {
		t.Errorf("tick ratio = %d/%d, want 1/4 (NQ tick size 0.25)", f.TickNum(), f.TickDen())
	}
	// index() built these from the real file; the aggregator's binary
	// searches assume the hourly index partitions it exactly.
	hourly := f.rollups.hourly
	if len(hourly) == 0 {
		t.Fatal("no hourly index built from the real file")
	}
	if hourly[0].from != 0 || int(hourly[len(hourly)-1].to) != f.Count() {
		t.Errorf("hourly index covers bars [%d,%d), want [0,%d)", hourly[0].from, hourly[len(hourly)-1].to, f.Count())
	}
}

func TestIntegration_OHLCInvariantOnSample(t *testing.T) {
	skipIfNoRealData(t)
	f := openRealNQ(t)
	defer f.Close()

	// Sample every ~50,000th bar rather than all ~5.4M — cheap enough to
	// run every time, dense enough to catch a swapped-column bug that
	// only a real, large file would expose.
	n := f.Count()
	checked := 0
	for i := 0; i < n; i += 50_000 {
		o, h, l, c := f.OpenAt(i), f.HighAt(i), f.LowAt(i), f.CloseAt(i)
		if !(l <= o && l <= c && h >= o && h >= c) {
			t.Errorf("bar %d (ts=%d): OHLC invariant violated o=%d h=%d l=%d c=%d", i, f.TsAt(i), o, h, l, c)
		}
		checked++
	}
	t.Logf("checked %d sampled bars", checked)
}

func TestIntegration_SeekWindowMatchesLinearScan(t *testing.T) {
	skipIfNoRealData(t)
	f := openRealNQ(t)
	defer f.Close()

	// A timestamp roughly in the middle of the real range.
	mid := f.TsAt(f.Count() / 2)
	win := f.SeekWindow(mid, 1500, 0)

	if win.To-1 < 0 || f.TsAt(win.To-1) > mid {
		t.Errorf("SeekWindow last bar ts=%d, want <= at=%d", f.TsAt(win.To-1), mid)
	}
	if win.Len() != 1500 {
		t.Errorf("SeekWindow len = %d, want 1500 (plenty of history before mid-point)", win.Len())
	}
	// Every ts in the window must be strictly increasing (already
	// guaranteed by index()'s validation pass, but confirms the window
	// slicing itself didn't introduce an off-by-one).
	for i := win.From + 1; i < win.To; i++ {
		if f.TsAt(i) <= f.TsAt(i-1) {
			t.Fatalf("window not increasing at index %d", i)
		}
	}
}

func TestIntegration_CalendarMatchesRealIdx(t *testing.T) {
	skipIfNoRealData(t)
	f := openRealNQ(t)
	defer f.Close()

	cal, err := loadCalendar(realDataDir + "/bin/NQ.1m.idx")
	if err != nil {
		t.Fatalf("loadCalendar: %v", err)
	}
	if len(cal.dates) == 0 {
		t.Fatal("NQ.1m.idx holds no sessions")
	}

	// The first session must start at bar 0 and the last must end at the
	// last bar: the .idx and the .bin describe the same history, whichever
	// dates that history happens to cover.
	first, err := cal.Resolve(cal.dates[0], f)
	if err != nil {
		t.Fatalf("Resolve(%s): %v", cal.dates[0], err)
	}
	if first.FirstTs != f.TsAt(0) {
		t.Errorf("session %s starts at ts %d, want %d (TsAt(0))", first.Date, first.FirstTs, f.TsAt(0))
	}
	if first.Bars <= 0 {
		t.Errorf("session %s holds %d bars", first.Date, first.Bars)
	}
	last, err := cal.Resolve(cal.dates[len(cal.dates)-1], f)
	if err != nil {
		t.Fatalf("Resolve(%s): %v", cal.dates[len(cal.dates)-1], err)
	}
	if last.LastTs != f.TsAt(f.Count()-1) {
		t.Errorf("session %s ends at ts %d, want %d (last bar)", last.Date, last.LastTs, f.TsAt(f.Count()-1))
	}
	t.Logf("%d sessions, %s..%s", len(cal.dates), first.Date, last.Date)
}
