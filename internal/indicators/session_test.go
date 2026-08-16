package indicators

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"market-replay/internal/bars"
	"market-replay/internal/model"
)

// statefulScript accumulates module-level state across ticks and emits a
// running total, so any difference between a continued Runtime and a fresh
// one shows up in the output rather than being masked by a stateless script.
const statefulScript = `
init = () => {
  indicator({onMainPanel: true});
  input.int('Step', 1, 'step', 1, 10, 1, 'tip', 'group');
};
let seen = 0;
let total = 0;
let lastId = null;
onTick = (length, _moment, _, ta, inputs) => {
  seen += inputs.step;
  total += closeC(0);
  plot('seen', seen);
  plot('total', total);
  plot('length', length);
  if (lastId !== null) deleteDrawingById(lastId);
  lastId = horizontalRay(time(0), total, {linecolor: 'x'}, 'running');
  marker(time(0), closeC(0), 'tick', {color: 'y'});
};
`

// sessionFixture is deliberately long enough that the anchor block
// (before/runWindowAnchorDivisor) is smaller than the window start, which is
// the only regime in which continuation engages at all.
func sessionFixture(t *testing.T) (*bars.BarFile, model.SymbolMeta) {
	t.Helper()
	specs := linearSpecs(1_700_000_000, 900)
	return openFixtureFile(t, "NQ", "1m", specs, testMeta), testMeta
}

func newStatefulEngine(t *testing.T, source string) *Engine {
	t.Helper()
	e := NewEngine()
	if err := e.Register("stateful", "Stateful", 1, []byte(source)); err != nil {
		t.Fatalf("Register: %v", err)
	}
	return e
}

func runAtIndex(t *testing.T, e *Engine, file *bars.BarFile, meta model.SymbolMeta, index int, overrides map[string]any) RunResult {
	t.Helper()
	at := file.TsAt(index)
	result, err := e.Run(context.Background(), "stateful", file, nil, meta, RunParams{
		At: at, Before: 200, MaxTs: at, Overrides: overrides,
	})
	if err != nil {
		t.Fatalf("Run at index %d: %v", index, err)
	}
	return result
}

// TestSessionContinuationMatchesFreshRun is the correctness gate for the
// whole suspended-Runtime scheme: an engine walked forward one bar at a time
// must produce, at every step, exactly what a never-used engine produces for
// that same step in isolation.
//
// The reference engine is new per step, so its single Run necessarily takes
// the build-and-replay path — there is no session for it to continue from.
func TestSessionContinuationMatchesFreshRun(t *testing.T) {
	file, meta := sessionFixture(t)
	stepping := newStatefulEngine(t, statefulScript)

	// 300 spans several anchor blocks (before=200 -> block=50), so the range
	// covers both continued steps and the rebuilds at block boundaries.
	for index := 300; index < 460; index++ {
		got := runAtIndex(t, stepping, file, meta, index, nil)
		want := runAtIndex(t, newStatefulEngine(t, statefulScript), file, meta, index, nil)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("index %d: continued run diverged from a fresh run\n got=%+v\nwant=%+v", index, got, want)
		}
	}
}

// TestSessionContinuationReusesRuntime proves the previous test is not
// passing simply because nothing is ever reused.
func TestSessionContinuationReusesRuntime(t *testing.T) {
	file, meta := sessionFixture(t)
	e := newStatefulEngine(t, statefulScript)

	before := e.executions.Load()
	for index := 300; index < 340; index++ {
		runAtIndex(t, e, file, meta, index, nil)
	}
	// before=200 -> block=50. Indices 300..339 span the anchors at 100 and
	// 150 (window starts 101..140 snap to 100, 141..189 snap to 150), so at
	// most a handful of Runtimes are built for 40 steps.
	if got := e.executions.Load() - before; got >= 40 {
		t.Fatalf("built %d Runtimes for 40 forward steps; continuation is not engaging", got)
	}
	if got := e.liveSessions(); got == 0 {
		t.Fatal("no session was retained after stepping forward")
	}
}

// TestSessionDeclinesRewind pins the rule that a backwards cursor is served
// by a throwaway run and leaves the suspended Runtime where it was. Without
// it, stepping back and forth across one bar would rebuild on every press.
func TestSessionDeclinesRewind(t *testing.T) {
	file, meta := sessionFixture(t)
	e := newStatefulEngine(t, statefulScript)

	runAtIndex(t, e, file, meta, 420, nil)
	afterForward := e.executions.Load()

	// Backwards, then forwards again to where the session already stood.
	rewound := runAtIndex(t, e, file, meta, 410, nil)
	wantRewound := runAtIndex(t, newStatefulEngine(t, statefulScript), file, meta, 410, nil)
	if !reflect.DeepEqual(rewound, wantRewound) {
		t.Fatalf("rewind produced a different result than a fresh run\n got=%+v\nwant=%+v", rewound, wantRewound)
	}
	builtForRewind := e.executions.Load() - afterForward

	forward := runAtIndex(t, e, file, meta, 421, nil)
	wantForward := runAtIndex(t, newStatefulEngine(t, statefulScript), file, meta, 421, nil)
	if !reflect.DeepEqual(forward, wantForward) {
		t.Fatalf("step after a rewind diverged from a fresh run\n got=%+v\nwant=%+v", forward, wantForward)
	}
	// The rewind cost one throwaway build; the step past it must not have
	// cost another, which is what proves the session survived the rewind.
	if builtForRewind != 1 {
		t.Fatalf("rewind built %d Runtimes, want exactly 1 throwaway", builtForRewind)
	}
	if got := e.executions.Load() - afterForward - builtForRewind; got != 0 {
		t.Fatalf("stepping forward past a rewind rebuilt %d Runtimes, want 0", got)
	}
}

// TestSessionSeparatesOverrides guards the invariant the fresh-Runtime-per-run
// rule used to give for free: two configurations of the same script must
// never share accumulated state.
func TestSessionSeparatesOverrides(t *testing.T) {
	file, meta := sessionFixture(t)
	e := newStatefulEngine(t, statefulScript)

	for index := 300; index < 320; index++ {
		one := runAtIndex(t, e, file, meta, index, map[string]any{"step": 1.0})
		three := runAtIndex(t, e, file, meta, index, map[string]any{"step": 3.0})
		wantOne := runAtIndex(t, newStatefulEngine(t, statefulScript), file, meta, index, map[string]any{"step": 1.0})
		wantThree := runAtIndex(t, newStatefulEngine(t, statefulScript), file, meta, index, map[string]any{"step": 3.0})
		if !reflect.DeepEqual(one, wantOne) || !reflect.DeepEqual(three, wantThree) {
			t.Fatalf("index %d: interleaved override streams contaminated each other", index)
		}
	}
}

// TestSessionSeparatesDatasets covers the same isolation rule across files:
// a reopened dataset must not be answered from the previous file's Runtime.
func TestSessionSeparatesDatasets(t *testing.T) {
	specs := linearSpecs(1_700_000_000, 900)
	first := openFixtureFile(t, "NQ-first", "1m", specs, testMeta)
	shifted := append([]barSpec(nil), specs...)
	for i := range shifted {
		shifted[i].close += 500
	}
	second := openFixtureFile(t, "NQ-second", "1m", shifted, testMeta)

	e := newStatefulEngine(t, statefulScript)
	fromFirst := runAtIndex(t, e, first, testMeta, 400, nil)
	fromSecond := runAtIndex(t, e, second, testMeta, 400, nil)

	firstTotal := plotValue(t, fromFirst, "total")
	secondTotal := plotValue(t, fromSecond, "total")
	if firstTotal == secondTotal {
		t.Fatalf("both datasets returned total=%v; the second reused the first's Runtime", firstTotal)
	}
	want := plotValue(t, runAtIndex(t, newStatefulEngine(t, statefulScript), second, testMeta, 400, nil), "total")
	if secondTotal != want {
		t.Fatalf("second dataset total = %v, want %v", secondTotal, want)
	}
}

func TestSessionEvictionBoundsLiveRuntimes(t *testing.T) {
	file, meta := sessionFixture(t)
	e := newStatefulEngine(t, statefulScript)

	// Each override value is its own stream, so this opens far more streams
	// than the cap allows.
	for step := 1; step <= maxLiveRunSessions+6; step++ {
		runAtIndex(t, e, file, meta, 400, map[string]any{"step": float64(step%10 + 1)})
	}
	if got := e.liveSessions(); got > maxLiveRunSessions {
		t.Fatalf("live sessions = %d, want at most %d", got, maxLiveRunSessions)
	}
}

// TestSessionDroppedAfterFailedAdvance covers the state that would be worst
// to keep: a Runtime interrupted mid-bar. It must be discarded, so the next
// request rebuilds rather than continuing from an indeterminate script state.
func TestSessionDroppedAfterFailedAdvance(t *testing.T) {
	file, meta := sessionFixture(t)
	e := newStatefulEngine(t, statefulScript)

	restore := runTimeout
	runTimeout = time.Nanosecond
	at := file.TsAt(400)
	_, err := e.Run(context.Background(), "stateful", file, nil, meta, RunParams{At: at, Before: 200, MaxTs: at})
	runTimeout = restore
	if err == nil {
		t.Fatal("want a timeout error from a nanosecond budget")
	}
	if !errors.Is(err, ErrScriptFailed) && !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("unexpected error kind: %v", err)
	}
	if got := e.liveSessions(); got != 0 {
		t.Fatalf("live sessions after a failed advance = %d, want 0", got)
	}

	// The engine must still be usable, and correct, afterwards.
	got := runAtIndex(t, e, file, meta, 400, nil)
	want := runAtIndex(t, newStatefulEngine(t, statefulScript), file, meta, 400, nil)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("run after a failed advance diverged from a fresh run\n got=%+v\nwant=%+v", got, want)
	}
}

// TestClampWindowAnchorOnlyExtendsHistory pins the two properties the whole
// scheme rests on: the anchor never truncates the requested history, and it
// holds still while the cursor advances.
func TestClampWindowAnchorOnlyExtendsHistory(t *testing.T) {
	file, _ := sessionFixture(t)
	series := fileSeries{file: file}
	const before = 200

	anchors := map[int]int{}
	for index := 400; index < 460; index++ {
		at := file.TsAt(index)
		window := clampWindow(series, at, before, 0, at)
		unanchored := series.SeekWindow(at, before, 0)
		if window.From > unanchored.From {
			t.Fatalf("index %d: anchored From %d is later than the requested %d — history was truncated", index, window.From, unanchored.From)
		}
		if window.To != unanchored.To {
			t.Fatalf("index %d: anchoring moved To from %d to %d", index, unanchored.To, window.To)
		}
		anchors[window.From]++
	}
	if len(anchors) >= 60 {
		t.Fatalf("60 consecutive cursors produced %d distinct anchors; the window is not standing still", len(anchors))
	}
	for from, hits := range anchors {
		if from%(before/runWindowAnchorDivisor) != 0 {
			t.Fatalf("anchor %d (%d hits) is not on a block boundary", from, hits)
		}
	}
}

// TestClampWindowBoundsWideningBySize guards the regression the anchor nearly
// caused: a caller asking for a handful of bars must not have its window
// silently widened to the whole file. The widening a caller can ever see is
// bounded by its own request, which is the property that makes the anchor
// safe to apply to every caller rather than only the frontend's.
func TestClampWindowBoundsWideningBySize(t *testing.T) {
	file, _ := sessionFixture(t)
	series := fileSeries{file: file}

	for _, before := range []int{1, 2, 4, 8, 40, 200, 1500} {
		for _, index := range []int{3, 10, 40, 400, 899} {
			at := file.TsAt(index)
			window := clampWindow(series, at, before, 0, at)
			requested := series.SeekWindow(at, before, 0)
			block := before / runWindowAnchorDivisor

			if window.To != requested.To {
				t.Fatalf("before=%d index=%d: anchoring moved To from %d to %d", before, index, requested.To, window.To)
			}
			if window.From > requested.From {
				t.Fatalf("before=%d index=%d: From %d is later than the requested %d — history was truncated", before, index, window.From, requested.From)
			}
			if block <= 1 && window.From != requested.From {
				t.Fatalf("before=%d index=%d: window widened to %d despite having no usable anchor block", before, index, window.From)
			}
			if widened := requested.From - window.From; block > 1 && widened >= block {
				t.Fatalf("before=%d index=%d: widened by %d bars, want less than the %d-bar block", before, index, widened, block)
			}
		}
	}
}

func plotValue(t *testing.T, result RunResult, key string) float64 {
	t.Helper()
	for i := len(result.Plots) - 1; i >= 0; i-- {
		if result.Plots[i].Key == key {
			return result.Plots[i].Value
		}
	}
	t.Fatal(fmt.Sprintf("no plot %q in result", key))
	return 0
}
