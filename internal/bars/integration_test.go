package bars

import (
	"os"
	"testing"
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

func TestIntegration_OpenRealNQFile(t *testing.T) {
	skipIfNoRealData(t)
	f, err := openBarFile(realDataDir + "/bin/NQ.1m.bin")
	if err != nil {
		t.Fatalf("openBarFile: %v", err)
	}
	defer f.Close()

	if f.Count() == 0 {
		t.Fatal("Count() = 0, want > 0")
	}
	t.Logf("NQ.1m.bin: %d bars", f.Count())

	// From data/meta/symbols.json's ranges.1m (ground truth captured by
	// reading the actual file at plan time).
	const wantFirst, wantLast = 1275861600, 1785974340
	if got := f.TsAt(0); got != wantFirst {
		t.Errorf("TsAt(0) = %d, want %d", got, wantFirst)
	}
	if got := f.TsAt(f.Count() - 1); got != wantLast {
		t.Errorf("TsAt(last) = %d, want %d", got, wantLast)
	}

	if f.TickNum() != 1 || f.TickDen() != 4 {
		t.Errorf("tick ratio = %d/%d, want 1/4 (NQ tick size 0.25)", f.TickNum(), f.TickDen())
	}
}

func TestIntegration_OHLCInvariantOnSample(t *testing.T) {
	skipIfNoRealData(t)
	f, err := openBarFile(realDataDir + "/bin/NQ.1m.bin")
	if err != nil {
		t.Fatalf("openBarFile: %v", err)
	}
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
	f, err := openBarFile(realDataDir + "/bin/NQ.1m.bin")
	if err != nil {
		t.Fatalf("openBarFile: %v", err)
	}
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
	// guaranteed by openBarFile's validation, but confirms the window
	// slicing itself didn't introduce an off-by-one).
	for i := win.From + 1; i < win.To; i++ {
		if f.TsAt(i) <= f.TsAt(i-1) {
			t.Fatalf("window not increasing at index %d", i)
		}
	}
}

func TestIntegration_CalendarMatchesRealIdx(t *testing.T) {
	skipIfNoRealData(t)
	f, err := openBarFile(realDataDir + "/bin/NQ.1m.bin")
	if err != nil {
		t.Fatalf("openBarFile: %v", err)
	}
	defer f.Close()

	cal, err := loadCalendar(realDataDir + "/bin/NQ.1m.idx")
	if err != nil {
		t.Fatalf("loadCalendar: %v", err)
	}

	// The checked-in NQ.1m index starts on the 2010-06-07 trading
	// session at offset 0 with 1368 one-minute bars.
	entry, err := cal.Resolve("2010-06-07", f)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if entry.Bars != 1368 {
		t.Errorf("Bars = %d, want 1368", entry.Bars)
	}
	if entry.FirstTs != f.TsAt(0) {
		t.Errorf("FirstTs = %d, want %d (TsAt(0))", entry.FirstTs, f.TsAt(0))
	}
}
