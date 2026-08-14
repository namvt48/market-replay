package indicators

import (
	"context"
	"testing"
	"time"

	"market-replay/internal/model"
)

func TestDaySeparator_DrawsExactlyOnMidnightTransition(t *testing.T) {
	nyLoc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}
	// 23:58, 23:59, 00:00, 00:01, 00:02 NY-local — the transition is the
	// single 23:59 -> 00:00 boundary.
	start := time.Date(2024, 1, 15, 23, 58, 0, 0, nyLoc)
	specs := make([]barSpec, 5)
	for i := range specs {
		ts := start.Add(time.Duration(i) * time.Minute).Unix()
		specs[i] = barSpec{ts: ts, open: 100, high: 101, low: 99, close: 100, volume: 1}
	}
	meta := model.SymbolMeta{TickSize: 1, PointValue: 1}
	file := openFixtureFile(t, "NQ", "1m", specs, meta)

	e := NewEngine()
	if err := RegisterBuiltins(e); err != nil {
		t.Fatalf("RegisterBuiltins: %v", err)
	}
	last := specs[len(specs)-1].ts
	result, err := e.Run(context.Background(), "day-separator", file, nil, meta, RunParams{At: last, Before: len(specs), MaxTs: last})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Draws) != 1 {
		t.Fatalf("want exactly 1 vline, got %d: %+v", len(result.Draws), result.Draws)
	}
	d := result.Draws[0]
	if d.Kind != "vline" || d.T0 != specs[2].ts { // index 2 = 00:00 local
		t.Fatalf("vline: got %+v, want t0=%d", d, specs[2].ts)
	}
}

func TestDaySeparator_OverrideDisables(t *testing.T) {
	nyLoc, _ := time.LoadLocation("America/New_York")
	start := time.Date(2024, 1, 15, 23, 58, 0, 0, nyLoc)
	specs := make([]barSpec, 5)
	for i := range specs {
		ts := start.Add(time.Duration(i) * time.Minute).Unix()
		specs[i] = barSpec{ts: ts, open: 100, high: 101, low: 99, close: 100, volume: 1}
	}
	meta := model.SymbolMeta{TickSize: 1, PointValue: 1}
	file := openFixtureFile(t, "NQ", "1m", specs, meta)

	e := NewEngine()
	if err := RegisterBuiltins(e); err != nil {
		t.Fatalf("RegisterBuiltins: %v", err)
	}
	last := specs[len(specs)-1].ts
	result, err := e.Run(context.Background(), "day-separator", file, nil, meta, RunParams{
		At: last, Before: len(specs), MaxTs: last,
		Overrides: map[string]any{"show": false},
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Draws) != 0 {
		t.Fatalf("want 0 draws with show:false, got %d", len(result.Draws))
	}
}
