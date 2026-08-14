package indicators

import (
	"context"
	"testing"
	"time"

	"market-replay/internal/model"
)

func TestOpenPriceMarkers_RayFiresAtExactTrigger(t *testing.T) {
	nyLoc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}
	start := time.Date(2024, 1, 15, 8, 29, 0, 0, nyLoc)
	rows := []barSpec{
		{open: 100, high: 101, low: 99, close: 100, volume: 1},  // 08:29
		{open: 150, high: 151, low: 149, close: 150, volume: 1}, // 08:30 — the h2 trigger
		{open: 200, high: 201, low: 199, close: 200, volume: 1}, // 08:31
	}
	specs := make([]barSpec, len(rows))
	for i, r := range rows {
		r.ts = start.Add(time.Duration(i) * time.Minute).Unix()
		specs[i] = r
	}
	meta := model.SymbolMeta{TickSize: 1, PointValue: 1}
	file := openFixtureFile(t, "NQ", "1m", specs, meta)

	e := NewEngine()
	if err := RegisterBuiltins(e); err != nil {
		t.Fatalf("RegisterBuiltins: %v", err)
	}
	last := specs[len(specs)-1].ts
	result, err := e.Run(context.Background(), "open-price-markers", file, nil, meta, RunParams{
		At: last, Before: len(specs), MaxTs: last,
		Overrides: map[string]any{"show_h1": false, "show_h3": false},
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Draws) != 1 {
		t.Fatalf("want exactly 1 ray, got %d: %+v", len(result.Draws), result.Draws)
	}
	d := result.Draws[0]
	if d.Kind != "ray" || d.T0 != specs[1].ts || !approxEqual(d.Y0, 150) {
		t.Fatalf("open-price ray: got %+v, want t0=%d y0=150", d, specs[1].ts)
	}
}

func TestOpenPriceMarkers_KeepsOnlyLastNDays(t *testing.T) {
	nyLoc, _ := time.LoadLocation("America/New_York")
	// 4 consecutive days' 08:30 triggers, maxDays overridden to 2.
	var specs []barSpec
	for day := 0; day < 4; day++ {
		ts := time.Date(2024, 1, 15+day, 8, 30, 0, 0, nyLoc).Unix()
		specs = append(specs, barSpec{ts: ts, open: int32(100 + day), high: 101, low: 99, close: 100, volume: 1})
	}
	meta := model.SymbolMeta{TickSize: 1, PointValue: 1}
	file := openFixtureFile(t, "NQ", "1m", specs, meta)

	e := NewEngine()
	if err := RegisterBuiltins(e); err != nil {
		t.Fatalf("RegisterBuiltins: %v", err)
	}
	last := specs[len(specs)-1].ts
	result, err := e.Run(context.Background(), "open-price-markers", file, nil, meta, RunParams{
		At: last, Before: len(specs), MaxTs: last,
		Overrides: map[string]any{"show_h1": false, "show_h3": false, "maxDays": 2.0},
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Draws) != 2 {
		t.Fatalf("want exactly 2 surviving rays (maxDays=2), got %d: %+v", len(result.Draws), result.Draws)
	}
}
