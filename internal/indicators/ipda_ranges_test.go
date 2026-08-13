package indicators

import (
	"testing"

	"market-replay/internal/model"
)

func TestIpdaRanges_20DayBoxMatchesDailyRollup(t *testing.T) {
	specs := dailyFixtureSpecs(25) // day 25 is "today"; IPDA20 needs days 5..24
	meta := model.SymbolMeta{TickSize: 1, PointValue: 1, SessionTz: "UTC"}
	file := openFixtureFile(t, "NQ", "1m", specs, meta)

	e := NewEngine()
	if err := RegisterBuiltins(e); err != nil {
		t.Fatalf("RegisterBuiltins: %v", err)
	}
	today := specs[len(specs)-1].ts
	result, err := e.Run("ipda-ranges", file, nil, meta, RunParams{
		At: today, Before: 1, MaxTs: today,
		Overrides: map[string]any{"show40": false, "show60": false},
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Draws) != 3 { // 2 rectangles (premium+discount) + 1 eq ray
		t.Fatalf("want 3 draws (premium/discount/eq), got %d: %+v", len(result.Draws), result.Draws)
	}

	// Mirrors dailyFixtureSpecs' own formula: high=2000+day*10, low=2000-day*5.
	wantHigh, wantLow := 0.0, 1e18
	for day := 5; day <= 24; day++ {
		h, l := float64(2000+day*10), float64(2000-day*5)
		if h > wantHigh {
			wantHigh = h
		}
		if l < wantLow {
			wantLow = l
		}
	}
	wantEq := (wantHigh + wantLow) / 2
	wantTime := dayMidnightUnix(t, 4) // day 5 (0-indexed day 4) is the earliest of the window

	var premium, discount, eq *DrawIntent
	for i := range result.Draws {
		d := &result.Draws[i]
		switch {
		case d.Kind == "rectangle" && approxEqual(d.Y0, wantHigh):
			premium = d
		case d.Kind == "rectangle" && approxEqual(d.Y1, wantLow):
			discount = d
		case d.Kind == "ray":
			eq = d
		}
	}
	if premium == nil || premium.T0 != wantTime || !approxEqual(premium.Y1, wantEq) {
		t.Fatalf("premium box: got %+v, want t0=%d y1(eq)=%v", premium, wantTime, wantEq)
	}
	if discount == nil || discount.T0 != wantTime || !approxEqual(discount.Y0, wantEq) {
		t.Fatalf("discount box: got %+v, want t0=%d y0(eq)=%v", discount, wantTime, wantEq)
	}
	if eq == nil || eq.T0 != wantTime || !approxEqual(eq.Y0, wantEq) {
		t.Fatalf("eq ray: got %+v, want t0=%d y0=%v", eq, wantTime, wantEq)
	}
}

func TestIpdaRanges_InsufficientHistoryProducesNoDraws(t *testing.T) {
	specs := dailyFixtureSpecs(5) // not enough for any of 20/40/60
	meta := model.SymbolMeta{TickSize: 1, PointValue: 1, SessionTz: "UTC"}
	file := openFixtureFile(t, "NQ", "1m", specs, meta)

	e := NewEngine()
	if err := RegisterBuiltins(e); err != nil {
		t.Fatalf("RegisterBuiltins: %v", err)
	}
	today := specs[len(specs)-1].ts
	result, err := e.Run("ipda-ranges", file, nil, meta, RunParams{At: today, Before: 1, MaxTs: today})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Draws) != 0 {
		t.Fatalf("want 0 draws (no period has enough history), got %d: %+v", len(result.Draws), result.Draws)
	}
}
