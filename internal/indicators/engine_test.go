package indicators

import (
	"errors"
	"testing"
	"time"

	"market-replay/internal/model"
)

// minimalScript exercises one input of each numeric-ish kind used
// elsewhere, plus a draw and a plot, without any session-time logic —
// enough to test the engine's own plumbing independent of the real sample
// script's complexity.
const minimalScript = `
init = () => {
  indicator({onMainPanel: true, format: 'inherit'});
  input.int('Count', 5, 'count', 0, 100, 1, 'tip', 'group');
};
onTick = (length, _moment, _, ta, inputs) => {
  const t0 = time(0);
  const c = closeC(0);
  plot('close', c);
  if (inputs.count > 0) {
    horizontalRay(t0, c, {linecolor: 'x'}, 'L');
  }
};
`

const noOnTickScript = `
init = () => { indicator({onMainPanel: true}); };
`

var testMeta = model.SymbolMeta{TickSize: 1, PointValue: 1, SessionTz: "UTC"}

const vlineMarkerScript = `
init = () => { indicator({onMainPanel: true}); };
onTick = (length, _moment, _, ta, inputs) => {
  const t0 = time(0);
  verticalLine(t0, {linecolor: 'x'});
  marker(t0, high(0), '^', {color: 'y'});
};
`

func TestEngine_VerticalLineAndMarkerBindings(t *testing.T) {
	e := NewEngine()
	if err := e.Register("vm", "VM", 1, []byte(vlineMarkerScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	specs := linearSpecs(1_700_000_000, 3)
	file := openFixtureFile(t, "NQ", "1m", specs, testMeta)
	result, err := e.Run("vm", file, nil, testMeta, RunParams{At: specs[2].ts, Before: 3, MaxTs: specs[2].ts})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := countKind(result.Draws, "vline"); got != 3 {
		t.Fatalf("vline count: got %d, want 3", got)
	}
	if got := countKind(result.Draws, "marker"); got != 3 {
		t.Fatalf("marker count: got %d, want 3", got)
	}
	first := result.Draws[0]
	if first.Kind != "vline" || first.T0 != specs[0].ts {
		t.Fatalf("first draw: got %+v", first)
	}
	second := result.Draws[1]
	if second.Kind != "marker" || second.T0 != specs[0].ts || !approxEqual(second.Y0, float64(specs[0].high)) {
		t.Fatalf("marker draw: got %+v, want t0=%d y0=%v", second, specs[0].ts, float64(specs[0].high))
	}
}

func TestEngine_RegisterRejectsSyntaxError(t *testing.T) {
	e := NewEngine()
	if err := e.Register("bad", "Bad", 1, []byte(`const x = ;`)); err == nil {
		t.Fatal("want compile error, got nil")
	}
}

func TestEngine_RegisterRejectsMissingOnTick(t *testing.T) {
	e := NewEngine()
	if err := e.Register("no-ontick", "No OnTick", 1, []byte(noOnTickScript)); err != nil {
		// Register itself doesn't call onTick, so this succeeds — the
		// failure must surface at Run time instead. Assert that here.
		t.Fatalf("Register: %v", err)
	}
	file := openFixtureFile(t, "NQ", "1m", linearSpecs(1_700_000_000, 5), testMeta)
	e2 := NewEngine()
	if err := e2.Register("no-ontick", "No OnTick", 1, []byte(noOnTickScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	_, err := e2.Run("no-ontick", file, nil, testMeta, RunParams{At: 1_700_000_000 + 240, Before: 5, MaxTs: 1_700_000_000 + 240})
	if !errors.Is(err, ErrScriptFailed) {
		t.Fatalf("want ErrScriptFailed, got %v", err)
	}
}

func TestEngine_DescribeAndRunUnknownScript(t *testing.T) {
	e := NewEngine()
	if _, err := e.Describe("nope"); !errors.Is(err, ErrUnknownScript) {
		t.Fatalf("Describe: want ErrUnknownScript, got %v", err)
	}
	file := openFixtureFile(t, "NQ", "1m", linearSpecs(1_700_000_000, 5), testMeta)
	if _, err := e.Run("nope", file, nil, testMeta, RunParams{At: 1_700_000_000, Before: 1, MaxTs: 1_700_000_000}); !errors.Is(err, ErrUnknownScript) {
		t.Fatalf("Run: want ErrUnknownScript, got %v", err)
	}
}

func TestEngine_ListAndDescribeExposeDeclaredInputs(t *testing.T) {
	e := NewEngine()
	if err := e.Register("minimal", "Minimal", 1, []byte(minimalScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	list := e.List()
	if len(list) != 1 || list[0].ID != "minimal" {
		t.Fatalf("List: got %+v", list)
	}
	desc, err := e.Describe("minimal")
	if err != nil {
		t.Fatalf("Describe: %v", err)
	}
	if len(desc.Inputs) != 1 || desc.Inputs[0].Key != "count" || desc.Inputs[0].Kind != InputInt {
		t.Fatalf("Describe inputs: got %+v", desc.Inputs)
	}
	if desc.Inputs[0].Default != 5 {
		t.Fatalf("Describe default: got %v", desc.Inputs[0].Default)
	}
}

func TestEngine_RunRejectsInvalidOverride(t *testing.T) {
	e := NewEngine()
	if err := e.Register("minimal", "Minimal", 1, []byte(minimalScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	file := openFixtureFile(t, "NQ", "1m", linearSpecs(1_700_000_000, 5), testMeta)

	_, err := e.Run("minimal", file, nil, testMeta, RunParams{
		At: 1_700_000_000 + 240, Before: 5, MaxTs: 1_700_000_000 + 240,
		Overrides: map[string]any{"count": "not-a-number"},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("want ErrInvalidInput, got %v", err)
	}

	_, err = e.Run("minimal", file, nil, testMeta, RunParams{
		At: 1_700_000_000 + 240, Before: 5, MaxTs: 1_700_000_000 + 240,
		Overrides: map[string]any{"count": 1000.0}, // above declared max 100
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("want ErrInvalidInput for out-of-range, got %v", err)
	}
}

func TestEngine_RunAppliesValidOverride(t *testing.T) {
	e := NewEngine()
	if err := e.Register("minimal", "Minimal", 1, []byte(minimalScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	file := openFixtureFile(t, "NQ", "1m", linearSpecs(1_700_000_000, 3), testMeta)

	// count=0 makes the script's own `if (inputs.count > 0)` guard skip
	// every horizontalRay call — proves the override actually reaches the
	// script, not just that it validates.
	result, err := e.Run("minimal", file, nil, testMeta, RunParams{
		At: 1_700_000_000 + 120, Before: 3, MaxTs: 1_700_000_000 + 120,
		Overrides: map[string]any{"count": 0.0},
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Draws) != 0 {
		t.Fatalf("want 0 draws with count=0 override, got %d", len(result.Draws))
	}
	if len(result.Plots) != 3 {
		t.Fatalf("want 3 plots (one per bar), got %d", len(result.Plots))
	}
}

func TestEngine_RunRespectsMaxTsReplaySafety(t *testing.T) {
	e := NewEngine()
	if err := e.Register("minimal", "Minimal", 1, []byte(minimalScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	start := int64(1_700_000_000)
	specs := linearSpecs(start, 20)
	file := openFixtureFile(t, "NQ", "1m", specs, testMeta)

	maxTs := start + 10*60 // the 11th bar (index 10)
	result, err := e.Run("minimal", file, nil, testMeta, RunParams{
		At: start + 19*60, Before: 20, After: 0, MaxTs: maxTs,
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Plots) != 11 {
		t.Fatalf("want 11 plots (bars 0..10), got %d", len(result.Plots))
	}
	last := result.Plots[len(result.Plots)-1]
	if last.Time != maxTs {
		t.Fatalf("last plot time: got %d, want %d (maxTs)", last.Time, maxTs)
	}
	for _, p := range result.Plots {
		if p.Time > maxTs {
			t.Fatalf("plot at %d exceeds maxTs %d — replay-safety boundary leaked", p.Time, maxTs)
		}
	}
}

func TestEngine_RunInterruptsRunawayScript(t *testing.T) {
	const infiniteLoopScript = `
init = () => { indicator({onMainPanel: true}); };
onTick = (length, _moment, _, ta, inputs) => { while (true) {} };
`
	original := runTimeout
	runTimeout = 100 * time.Millisecond
	defer func() { runTimeout = original }()

	e := NewEngine()
	if err := e.Register("infinite", "Infinite", 1, []byte(infiniteLoopScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	file := openFixtureFile(t, "NQ", "1m", linearSpecs(1_700_000_000, 2), testMeta)

	started := time.Now()
	_, err := e.Run("infinite", file, nil, testMeta, RunParams{At: 1_700_000_000, Before: 1, MaxTs: 1_700_000_000})
	elapsed := time.Since(started)
	if !errors.Is(err, ErrScriptFailed) {
		t.Fatalf("want ErrScriptFailed, got %v", err)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("interrupt took too long: %v", elapsed)
	}
}
