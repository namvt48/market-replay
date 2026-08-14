package indicators

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"market-replay/internal/bars"
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
	result, err := e.Run(context.Background(), "vm", file, nil, testMeta, RunParams{At: specs[2].ts, Before: 3, MaxTs: specs[2].ts})
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
	_, err := e2.Run(context.Background(), "no-ontick", file, nil, testMeta, RunParams{At: 1_700_000_000 + 240, Before: 5, MaxTs: 1_700_000_000 + 240})
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
	if _, err := e.Run(context.Background(), "nope", file, nil, testMeta, RunParams{At: 1_700_000_000, Before: 1, MaxTs: 1_700_000_000}); !errors.Is(err, ErrUnknownScript) {
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

	_, err := e.Run(context.Background(), "minimal", file, nil, testMeta, RunParams{
		At: 1_700_000_000 + 240, Before: 5, MaxTs: 1_700_000_000 + 240,
		Overrides: map[string]any{"count": "not-a-number"},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("want ErrInvalidInput, got %v", err)
	}

	_, err = e.Run(context.Background(), "minimal", file, nil, testMeta, RunParams{
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
	result, err := e.Run(context.Background(), "minimal", file, nil, testMeta, RunParams{
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
	result, err := e.Run(context.Background(), "minimal", file, nil, testMeta, RunParams{
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
	_, err := e.Run(context.Background(), "infinite", file, nil, testMeta, RunParams{At: 1_700_000_000, Before: 1, MaxTs: 1_700_000_000})
	elapsed := time.Since(started)
	if !errors.Is(err, ErrScriptFailed) {
		t.Fatalf("want ErrScriptFailed, got %v", err)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("interrupt took too long: %v", elapsed)
	}
}

func TestEngine_RunStopsWhenContextIsCanceled(t *testing.T) {
	const infiniteLoopScript = `
init = () => { indicator({onMainPanel: true}); };
onTick = (length, _moment, _, ta, inputs) => { while (true) {} };
`

	e := NewEngine()
	if err := e.Register("cancel", "Cancel", 1, []byte(infiniteLoopScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	file := openFixtureFile(t, "NQ", "1m", linearSpecs(1_700_000_000, 2), testMeta)
	ctx, cancel := context.WithCancel(context.Background())
	timer := time.AfterFunc(25*time.Millisecond, cancel)
	defer timer.Stop()

	started := time.Now()
	_, err := e.Run(ctx, "cancel", file, nil, testMeta, RunParams{
		At: 1_700_000_000, Before: 1, MaxTs: 1_700_000_000,
	})
	elapsed := time.Since(started)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("want context.Canceled, got %v", err)
	}
	if elapsed > 500*time.Millisecond {
		t.Fatalf("context cancellation took too long: %v", elapsed)
	}
}

func TestEngine_RunCachesIdenticalResultWithoutSharingMutableState(t *testing.T) {
	e := NewEngine()
	if err := e.Register("minimal", "Minimal", 1, []byte(minimalScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	specs := linearSpecs(1_700_000_000, 8)
	file := openFixtureFile(t, "NQ", "1m", specs, testMeta)
	params := RunParams{At: specs[7].ts, Before: 8, MaxTs: specs[7].ts}
	before := e.executions.Load()

	first, err := e.Run(context.Background(), "minimal", file, nil, testMeta, params)
	if err != nil {
		t.Fatalf("first Run: %v", err)
	}
	first.Plots[0].Value = -999
	first.Draws[0].Style["callerMutation"] = true

	second, err := e.Run(context.Background(), "minimal", file, nil, testMeta, params)
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if got := e.executions.Load() - before; got != 1 {
		t.Fatalf("identical runs executed JS %d times, want 1", got)
	}
	if second.Plots[0].Value == -999 {
		t.Fatal("cached plots share mutable backing storage with the caller")
	}
	if _, ok := second.Draws[0].Style["callerMutation"]; ok {
		t.Fatal("cached drawing style shares mutable state with the caller")
	}
}

func TestEngine_RunCacheSeparatesWindowAndOverrides(t *testing.T) {
	e := NewEngine()
	if err := e.Register("minimal", "Minimal", 1, []byte(minimalScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	specs := linearSpecs(1_700_000_000, 8)
	file := openFixtureFile(t, "NQ", "1m", specs, testMeta)
	before := e.executions.Load()

	cases := []RunParams{
		{At: specs[7].ts, Before: 8, MaxTs: specs[7].ts},
		{At: specs[7].ts, Before: 4, MaxTs: specs[7].ts},
		{At: specs[7].ts, Before: 8, MaxTs: specs[7].ts, Overrides: map[string]any{"count": 0.0}},
	}
	for _, params := range cases {
		if _, err := e.Run(context.Background(), "minimal", file, nil, testMeta, params); err != nil {
			t.Fatalf("Run(%+v): %v", params, err)
		}
	}
	if got := e.executions.Load() - before; got != int64(len(cases)) {
		t.Fatalf("distinct cache inputs executed JS %d times, want %d", got, len(cases))
	}
}

func TestEngine_RunChartCacheIncludesAggregatedBarContent(t *testing.T) {
	e := NewEngine()
	if err := e.Register("minimal", "Minimal", 1, []byte(minimalScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	specs := linearSpecs(1_700_000_000, 2)
	file := openFixtureFile(t, "NQ", "1m", specs, testMeta)
	firstBars := []bars.ChartBar{{Time: specs[0].ts, OpenTicks: 10, HighTicks: 12, LowTicks: 9, CloseTicks: 11, Volume: 5}}
	secondBars := []bars.ChartBar{{Time: specs[0].ts, OpenTicks: 20, HighTicks: 22, LowTicks: 19, CloseTicks: 21, Volume: 5}}
	params := RunParams{At: specs[0].ts, Before: 1, MaxTs: specs[0].ts}
	before := e.executions.Load()

	first, err := e.RunChart(context.Background(), "minimal", firstBars, file, nil, testMeta, params)
	if err != nil {
		t.Fatalf("first RunChart: %v", err)
	}
	second, err := e.RunChart(context.Background(), "minimal", secondBars, file, nil, testMeta, params)
	if err != nil {
		t.Fatalf("second RunChart: %v", err)
	}
	if got := e.executions.Load() - before; got != 2 {
		t.Fatalf("different chart content executed JS %d times, want 2", got)
	}
	if first.Plots[0].Value == second.Plots[0].Value {
		t.Fatalf("different chart content returned the same close: %v", first.Plots[0].Value)
	}
}

func TestEngine_RunCacheInvalidatesWhenScriptIsReregistered(t *testing.T) {
	e := NewEngine()
	const firstSource = `
init = () => { indicator({onMainPanel: true}); };
onTick = () => { plot('value', 1); };
`
	const secondSource = `
init = () => { indicator({onMainPanel: true}); };
onTick = () => { plot('value', 2); };
`
	if err := e.Register("replaceable", "Replaceable", 1, []byte(firstSource)); err != nil {
		t.Fatalf("first Register: %v", err)
	}
	specs := linearSpecs(1_700_000_000, 2)
	file := openFixtureFile(t, "NQ", "1m", specs, testMeta)
	params := RunParams{At: specs[1].ts, Before: 1, MaxTs: specs[1].ts}

	first, err := e.Run(context.Background(), "replaceable", file, nil, testMeta, params)
	if err != nil {
		t.Fatalf("first Run: %v", err)
	}
	if err := e.Register("replaceable", "Replaceable", 2, []byte(secondSource)); err != nil {
		t.Fatalf("second Register: %v", err)
	}
	second, err := e.Run(context.Background(), "replaceable", file, nil, testMeta, params)
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}

	if got := e.executions.Load(); got != 2 {
		t.Fatalf("JS executions = %d, want 2 after script replacement", got)
	}
	if first.Plots[0].Value != 1 || second.Plots[0].Value != 2 {
		t.Fatalf("plots before/after replacement = %v/%v, want 1/2", first.Plots[0].Value, second.Plots[0].Value)
	}
}

func TestEngine_RunCacheInvalidatesWhenDatasetIsReopened(t *testing.T) {
	e := NewEngine()
	if err := e.Register("minimal", "Minimal", 1, []byte(minimalScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	specs := linearSpecs(1_700_000_000, 2)
	firstFile := openFixtureFile(t, "NQ-first", "1m", specs, testMeta)
	secondSpecs := append([]barSpec(nil), specs...)
	secondSpecs[1].close = specs[1].close + 20
	secondFile := openFixtureFile(t, "NQ-second", "1m", secondSpecs, testMeta)
	params := RunParams{At: specs[1].ts, Before: 1, MaxTs: specs[1].ts}

	first, err := e.Run(context.Background(), "minimal", firstFile, nil, testMeta, params)
	if err != nil {
		t.Fatalf("first Run: %v", err)
	}
	second, err := e.Run(context.Background(), "minimal", secondFile, nil, testMeta, params)
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}

	if got := e.executions.Load(); got != 2 {
		t.Fatalf("JS executions = %d, want 2 after dataset reopen", got)
	}
	if first.Plots[0].Value == second.Plots[0].Value {
		t.Fatalf("reopened dataset reused stale value %v", first.Plots[0].Value)
	}
}

func TestEngine_CachedRunCancelsOnlyAfterLastWaiterLeaves(t *testing.T) {
	e := NewEngine()
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int64
	compute := func(ctx context.Context) (RunResult, error) {
		calls.Add(1)
		close(started)
		select {
		case <-release:
			return RunResult{Plots: []PlotPoint{{Key: "ok", Value: 1}}}, nil
		case <-ctx.Done():
			return RunResult{}, ctx.Err()
		}
	}

	firstCtx, cancelFirst := context.WithCancel(context.Background())
	firstResult := make(chan error, 1)
	go func() {
		_, err := e.cachedRun(firstCtx, runCacheKey{}, compute)
		firstResult <- err
	}()
	<-started

	secondResult := make(chan error, 1)
	go func() {
		_, err := e.cachedRun(context.Background(), runCacheKey{}, compute)
		secondResult <- err
	}()
	deadline := time.Now().Add(time.Second)
	for e.cacheWaiters(runCacheKey{}) != 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := e.cacheWaiters(runCacheKey{}); got != 2 {
		t.Fatalf("waiters = %d, want 2", got)
	}

	cancelFirst()
	if err := <-firstResult; !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled waiter: got %v, want context.Canceled", err)
	}
	close(release)
	if err := <-secondResult; err != nil {
		t.Fatalf("remaining waiter lost shared computation: %v", err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("shared computation ran %d times, want 1", got)
	}
}

func TestEngine_RunCacheKeepsSixtyFourMostRecentResults(t *testing.T) {
	e := NewEngine()
	if err := e.Register("minimal", "Minimal", 1, []byte(minimalScript)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	specs := linearSpecs(1_700_000_000, 65)
	file := openFixtureFile(t, "NQ", "1m", specs, testMeta)
	before := e.executions.Load()
	runAt := func(index int) {
		t.Helper()
		if _, err := e.Run(context.Background(), "minimal", file, nil, testMeta, RunParams{
			At: specs[index].ts, Before: 1, MaxTs: specs[index].ts,
		}); err != nil {
			t.Fatalf("Run at index %d: %v", index, err)
		}
	}

	for index := 0; index < 64; index++ {
		runAt(index)
	}
	runAt(0)  // refresh the oldest entry
	runAt(64) // evicts index 1, now the least recently used
	runAt(0)  // still cached
	runAt(1)  // must execute again after eviction

	if got := e.executions.Load() - before; got != 66 {
		t.Fatalf("JS executions = %d, want 66 for a 64-entry LRU", got)
	}
}
