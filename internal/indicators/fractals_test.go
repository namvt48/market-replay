package indicators

import (
	"testing"

	"market-replay/internal/model"
)

func TestFractals_MarksExactlyOneSwingHigh(t *testing.T) {
	// A symmetric peak at index 2 (high=20), swingLength=2: the pivot's
	// two neighbors on each side (highs 10,15) are both strictly lower.
	// Lows are flat, so no swing low should ever fire.
	rows := []int32{10, 15, 20, 15, 10}
	specs := make([]barSpec, len(rows))
	for i, h := range rows {
		specs[i] = barSpec{ts: 1_700_000_000 + int64(i)*60, open: h, high: h, low: 50, close: h, volume: 1}
	}
	meta := model.SymbolMeta{TickSize: 1, PointValue: 1}
	file := openFixtureFile(t, "NQ", "1m", specs, meta)

	e := NewEngine()
	if err := RegisterBuiltins(e); err != nil {
		t.Fatalf("RegisterBuiltins: %v", err)
	}
	last := specs[len(specs)-1].ts
	result, err := e.Run("fractals", file, nil, meta, RunParams{
		At: last, Before: len(specs), MaxTs: last,
		Overrides: map[string]any{"swingLength": 2.0},
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Draws) != 1 {
		t.Fatalf("want exactly 1 marker, got %d: %+v", len(result.Draws), result.Draws)
	}
	d := result.Draws[0]
	if d.Kind != "marker" || d.T0 != specs[2].ts || !approxEqual(d.Y0, 20) {
		t.Fatalf("swing high marker: got %+v, want t0=%d y0=20", d, specs[2].ts)
	}
}

func TestFractals_DisabledProducesNoMarkers(t *testing.T) {
	rows := []int32{10, 15, 20, 15, 10}
	specs := make([]barSpec, len(rows))
	for i, h := range rows {
		specs[i] = barSpec{ts: 1_700_000_000 + int64(i)*60, open: h, high: h, low: 50, close: h, volume: 1}
	}
	meta := model.SymbolMeta{TickSize: 1, PointValue: 1}
	file := openFixtureFile(t, "NQ", "1m", specs, meta)

	e := NewEngine()
	if err := RegisterBuiltins(e); err != nil {
		t.Fatalf("RegisterBuiltins: %v", err)
	}
	last := specs[len(specs)-1].ts
	result, err := e.Run("fractals", file, nil, meta, RunParams{
		At: last, Before: len(specs), MaxTs: last,
		Overrides: map[string]any{"swingLength": 2.0, "show": false},
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Draws) != 0 {
		t.Fatalf("want 0 markers with show:false, got %d", len(result.Draws))
	}
}
