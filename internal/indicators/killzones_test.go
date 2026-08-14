package indicators

import (
	"context"
	"testing"
	"time"

	"market-replay/internal/model"
)

func TestKillzones_NYAMBoxMatchesSessionHighLow(t *testing.T) {
	nyLoc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}
	start := time.Date(2024, 1, 15, 8, 29, 0, 0, nyLoc)
	// 08:29 before session; 08:30-08:32 inside NY AM (0830-1100).
	rows := []barSpec{
		{open: 100, high: 100, low: 90, close: 100, volume: 1}, // 08:29 — outside
		{open: 100, high: 110, low: 95, close: 105, volume: 1}, // 08:30 — session start
		{open: 105, high: 105, low: 85, close: 100, volume: 1}, // 08:31
		{open: 100, high: 108, low: 92, close: 104, volume: 1}, // 08:32 — last in-session bar
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
	result, err := e.Run(context.Background(), "killzones", file, nil, meta, RunParams{
		At: last, Before: len(specs), MaxTs: last,
		Overrides: map[string]any{"show_asia": false, "show_london": false, "show_nypm": false},
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Draws) != 1 {
		t.Fatalf("want exactly 1 surviving box (NY AM only), got %d: %+v", len(result.Draws), result.Draws)
	}
	d := result.Draws[0]
	wantHigh, wantLow := 110.0, 85.0 // max/min across 08:30-08:32
	if d.Kind != "rectangle" || d.T0 != specs[1].ts || d.T1 != specs[3].ts || !approxEqual(d.Y0, wantHigh) || !approxEqual(d.Y1, wantLow) {
		t.Fatalf("NY AM box: got %+v, want t0=%d t1=%d y0=%v y1=%v", d, specs[1].ts, specs[3].ts, wantHigh, wantLow)
	}
}
