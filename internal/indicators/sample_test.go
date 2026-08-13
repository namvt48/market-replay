package indicators

import (
	"fmt"
	"testing"
	"time"

	"market-replay/internal/model"
)

// buildSampleFixtureSpecs builds one minute-by-minute day of bars, in
// America/New_York local time, shaped so the embedded gb69-cbmor script's
// every branch has hand-computable expected output:
//
//   - minute 0 (00:00 local) is the CB-MOR midnight-open anchor bar.
//   - minutes 360..539 (06:00-08:59 local) are the script's default "Base
//     NY Session" — a monotonic price ramp so range-high/range-low come
//     from its first/last bar, with one huge-volume bar in the middle
//     (07:30 local) so the POC (point of control) is unambiguous.
//   - minute 540 (09:00 local) is the first bar *outside* that session,
//     which is exactly where the script fires its projection draw.
//   - every other minute is flat filler; its value never feeds a
//     computation this test asserts on.
func buildSampleFixtureSpecs(day time.Time) []barSpec {
	const totalMinutes = 546 // 00:00 through 09:05 inclusive
	specs := make([]barSpec, totalMinutes)
	for minute := 0; minute < totalMinutes; minute++ {
		ts := day.Add(time.Duration(minute) * time.Minute).Unix()
		if minute >= 360 && minute <= 539 {
			i := int32(minute - 360)
			volume := uint32(10 + i)
			if i == 90 { // 07:30 local — the session's volume spike
				volume = 5090
			}
			specs[minute] = barSpec{
				ts: ts, open: 1000 + i, high: 1005 + i, low: 995 + i, close: 1001 + i, volume: volume,
			}
			continue
		}
		specs[minute] = barSpec{ts: ts, open: 1000, high: 1002, low: 998, close: 1000, volume: 1}
	}
	return specs
}

const approxEps = 1e-6

func approxEqual(a, b float64) bool {
	d := a - b
	if d < 0 {
		d = -d
	}
	return d < approxEps
}

func findByLabel(draws []DrawIntent, label string) (DrawIntent, bool) {
	for _, d := range draws {
		if d.Label == label {
			return d, true
		}
	}
	return DrawIntent{}, false
}

func containsY0(draws []DrawIntent, y float64) bool {
	for _, d := range draws {
		if approxEqual(d.Y0, y) {
			return true
		}
	}
	return false
}

func countKind(draws []DrawIntent, kind string) int {
	n := 0
	for _, d := range draws {
		if d.Kind == kind {
			n++
		}
	}
	return n
}

// gbRangeLevels mirrors drawGbRange's own math (docs formerly at
// docs/gb69-cbmor.txt, now internal/indicators/scripts/gb69-cbmor.js) so
// expected values come from re-deriving the formula, not from
// hand-transcribed decimals that could silently drift from it.
func gbRangeLevels(mEq, po3, shift float64, prefix string, showHighLow, showEq, showGip, showLiq bool) map[string]float64 {
	type level struct {
		rel  float64
		name string
	}
	levels := []level{
		{1.111, "EXIT (1.1111)"}, {1.0, "HIGH (1)"}, {0.89, "LIQ (0.89)"}, {0.83, "GIP (0.83)"},
		{0.5, "EQ"}, {0.17, "GIP (0.17)"}, {0.11, "LIQ (0.11)"}, {0.0, "LOW (0)"}, {-0.111, "EXIT (-1.1111)"},
	}
	center := mEq + shift*po3
	rH := center + po3*0.5
	rL := center - po3*0.5
	out := map[string]float64{}
	for _, lvl := range levels {
		isEq := lvl.rel == 0.5
		isGip := lvl.rel == 0.83 || lvl.rel == 0.17
		isLiq := lvl.rel == 0.89 || lvl.rel == 0.11
		show := showHighLow
		switch {
		case isEq:
			show = showEq
		case isGip:
			show = showGip
		case isLiq:
			show = showLiq
		}
		if !show {
			continue
		}
		out[prefix+"-"+lvl.name] = rL + (rH-rL)*lvl.rel
	}
	return out
}

// cbMorLevels mirrors drawCbMorLevels' own math: up/down price for each
// enabled percentage, keyed here by percent value rather than the script's
// interpolated label text (sidesteps any JS-vs-Go float-to-string
// formatting difference; the price values are what actually matters).
func cbMorLevels(basePrice float64) map[float64][2]float64 {
	out := map[float64][2]float64{}
	for _, pct := range []float64{0.4375, 0.875, 1.75, 3.5, 7.0} {
		out[pct] = [2]float64{basePrice * (1 + pct/100), basePrice * (1 - pct/100)}
	}
	return out
}

func TestSampleScript_Gb69Cbmor_EndToEnd(t *testing.T) {
	nyLoc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}
	day := time.Date(2024, 1, 15, 0, 0, 0, 0, nyLoc) // a Monday, well clear of any DST transition
	specs := buildSampleFixtureSpecs(day)
	meta := model.SymbolMeta{TickSize: 1, PointValue: 1, SessionTz: "America/New_York"}
	file := openFixtureFile(t, "NQ", "1m", specs, meta)

	e := NewEngine()
	if err := RegisterBuiltins(e); err != nil {
		t.Fatalf("RegisterBuiltins: %v", err)
	}

	lastTs := specs[len(specs)-1].ts
	result, err := e.Run("gb69-cbmor", file, nil, meta, RunParams{At: lastTs, Before: len(specs), MaxTs: lastTs})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	// Hand-derived from buildSampleFixtureSpecs' ramp: session spans
	// minute-relative i=0..179, high=1005+i, low=995+i.
	const rangeHigh = 1184.0 // 1005+179
	const rangeLow = 995.0   // 995+0
	const baseRange = rangeHigh - rangeLow
	const mEq = rangeLow + baseRange*0.5 // 1089.5
	sdP05, sdN05 := rangeHigh+baseRange*0.5, rangeLow-baseRange*0.5
	sdP133, sdN133 := rangeHigh+baseRange*1.33, rangeLow-baseRange*1.33
	sdP166, sdN166 := rangeHigh+baseRange*1.66, rangeLow-baseRange*1.66
	// price4 at the volume-spike bar (i=90): open=1090,high=1095,low=1085,close=1091.
	const pocPrice = (1090.0 + 1095.0 + 1085.0 + 1091.0) / 4.0
	const midnightOpen = 1000.0

	sessionStart := time.Date(2024, 1, 15, 6, 0, 0, 0, nyLoc).Unix()
	sessionEnd := time.Date(2024, 1, 15, 9, 0, 0, 0, nyLoc).Unix()

	t.Run("range box rectangle", func(t *testing.T) {
		found := false
		for _, d := range result.Draws {
			if d.Kind == "rectangle" && d.T0 == sessionStart && d.T1 == sessionEnd &&
				approxEqual(d.Y0, rangeHigh) && approxEqual(d.Y1, rangeLow) {
				found = true
			}
		}
		if !found {
			t.Fatalf("range box rectangle [%d,%v]->[%d,%v] not found in %+v", sessionStart, rangeHigh, sessionEnd, rangeLow, result.Draws)
		}
	})

	t.Run("SD 0.5 and 1.33/1.66 box rectangles", func(t *testing.T) {
		want := [][2]float64{{sdP05, rangeHigh}, {rangeLow, sdN05}, {sdP166, sdP133}, {sdN133, sdN166}}
		for _, w := range want {
			found := false
			for _, d := range result.Draws {
				if d.Kind == "rectangle" && d.T0 == sessionEnd && d.T1 == sessionEnd &&
					approxEqual(d.Y0, w[0]) && approxEqual(d.Y1, w[1]) {
					found = true
				}
			}
			if !found {
				t.Fatalf("SD box rectangle y0=%v y1=%v not found", w[0], w[1])
			}
		}
	})

	t.Run("NY EQ ray", func(t *testing.T) {
		d, ok := findByLabel(result.Draws, "NY EQ")
		if !ok {
			t.Fatal("NY EQ ray not found")
		}
		if d.Kind != "ray" || d.T0 != sessionEnd || !approxEqual(d.Y0, mEq) {
			t.Fatalf("NY EQ ray: got %+v, want t0=%d y0=%v", d, sessionEnd, mEq)
		}
	})

	t.Run("POC ray", func(t *testing.T) {
		d, ok := findByLabel(result.Draws, "POC")
		if !ok {
			t.Fatal("POC ray not found")
		}
		if d.Kind != "ray" || d.T0 != sessionEnd || !approxEqual(d.Y0, pocPrice) {
			t.Fatalf("POC ray: got %+v, want t0=%d y0=%v", d, sessionEnd, pocPrice)
		}
	})

	t.Run("CB MOR anchor ray", func(t *testing.T) {
		d, ok := findByLabel(result.Draws, "CB MOR Open (00:00)")
		if !ok {
			t.Fatal("CB MOR anchor ray not found")
		}
		if d.Kind != "ray" || d.T0 != sessionEnd || !approxEqual(d.Y0, midnightOpen) {
			t.Fatalf("CB MOR anchor: got %+v, want t0=%d y0=%v", d, sessionEnd, midnightOpen)
		}
	})

	t.Run("CB MOR percentage levels", func(t *testing.T) {
		for pct, upDown := range cbMorLevels(midnightOpen) {
			if !containsY0(result.Draws, upDown[0]) {
				t.Errorf("CB MOR +%v%% level (%v) not found", pct, upDown[0])
			}
			if !containsY0(result.Draws, upDown[1]) {
				t.Errorf("CB MOR -%v%% level (%v) not found", pct, upDown[1])
			}
		}
	})

	t.Run("Goldbach range 1 and 2 levels", func(t *testing.T) {
		for prefix, po3 := range map[string]float64{"GB1": 243, "GB2": 729} {
			levels := gbRangeLevels(mEq, po3, 0, prefix, true, true, true, false)
			if len(levels) != 7 {
				t.Fatalf("%s: expected 7 visible levels (liq hidden), got %d", prefix, len(levels))
			}
			for label, price := range levels {
				d, ok := findByLabel(result.Draws, label)
				if !ok {
					t.Errorf("%s: ray not found", label)
					continue
				}
				if d.Kind != "ray" || !approxEqual(d.Y0, price) {
					t.Errorf("%s: got %+v, want y0=%v", label, d, price)
				}
			}
		}
	})

	t.Run("total draw count matches every enabled default", func(t *testing.T) {
		// 4 SD-box + 1 range-box rectangles; eq+poc+cbmor-anchor+10 cbmor
		// levels + 7 GB1 + 7 GB2 rays.
		wantRects, wantRays := 5, 27
		if got := countKind(result.Draws, "rectangle"); got != wantRects {
			t.Errorf("rectangles: got %d, want %d", got, wantRects)
		}
		if got := countKind(result.Draws, "ray"); got != wantRays {
			t.Errorf("rays: got %d, want %d", got, wantRays)
		}
	})

	t.Run("override removes exactly the disabled draw", func(t *testing.T) {
		overridden, err := e.Run("gb69-cbmor", file, nil, meta, RunParams{
			At: lastTs, Before: len(specs), MaxTs: lastTs,
			Overrides: map[string]any{"show_range_box": false},
		})
		if err != nil {
			t.Fatalf("Run with override: %v", err)
		}
		if len(overridden.Draws) != len(result.Draws)-1 {
			t.Fatalf("override: got %d draws, want %d (one fewer)", len(overridden.Draws), len(result.Draws)-1)
		}
		for _, d := range overridden.Draws {
			if d.Kind == "rectangle" && d.T0 == sessionStart && d.T1 == sessionEnd && approxEqual(d.Y0, rangeHigh) && approxEqual(d.Y1, rangeLow) {
				t.Fatalf("range box rectangle still present after show_range_box:false override")
			}
		}
	})
}

func TestSampleScript_Gb69Cbmor_InvalidOverrideRejected(t *testing.T) {
	nyLoc, _ := time.LoadLocation("America/New_York")
	day := time.Date(2024, 1, 15, 0, 0, 0, 0, nyLoc)
	specs := buildSampleFixtureSpecs(day)
	meta := model.SymbolMeta{TickSize: 1, PointValue: 1, SessionTz: "America/New_York"}
	file := openFixtureFile(t, "NQ", "1m", specs, meta)

	e := NewEngine()
	if err := RegisterBuiltins(e); err != nil {
		t.Fatalf("RegisterBuiltins: %v", err)
	}
	lastTs := specs[len(specs)-1].ts
	_, err := e.Run("gb69-cbmor", file, nil, meta, RunParams{
		At: lastTs, Before: len(specs), MaxTs: lastTs,
		Overrides: map[string]any{"i_calc_type": "Not A Real Option"},
	})
	if err == nil {
		t.Fatal("want error for invalid i_calc_type option, got nil")
	}
	if got := fmt.Sprintf("%v", err); got == "" {
		t.Fatal("expected a non-empty error message")
	}
}
