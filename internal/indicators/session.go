package indicators

import (
	"container/list"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/dop251/goja"

	"market-replay/internal/bars"
	"market-replay/internal/model"
)

// runWindowAnchorDivisor sets a run's history anchor block as a fraction of
// the history it asked for: a request for N bars is anchored to a multiple of
// N/4.
//
// Some anchor is required for continuation to exist at all. The frontend asks
// for "the last 1,500 bars ending at the cursor", so stepping one bar moves
// the window's start as well as its end, and a script's accumulated state is
// only ever valid for the exact range of bars it consumed. Quantising the
// start makes it stand still, which is what lets consecutive steps share one
// live Runtime.
//
// Making the block a fraction of the request rather than a fixed bar count is
// what keeps the trade honest at both ends. Quantising only extends the
// window backwards, never truncates it, so a script always gets at least the
// history it asked for and at most 25% more — for the frontend's 1,500 bars
// that is 375 bars of extra warm-up, far outside the ~240-bar viewport any of
// it is drawn into. In exchange the anchor holds still for 375 steps, so a
// full rebuild (12-54 ms depending on the script) amortises to well under a
// tenth of a millisecond per step. A fixed block would have meant a caller
// asking for 10 bars of history silently receiving 500.
const runWindowAnchorDivisor = 4

// maxLiveRunSessions bounds how many suspended Runtimes are kept alive.
// Deliberately far smaller than maxCachedRunResults: a cached result is a
// slice of drawings, while a session holds a whole goja heap — the script's
// globals, its accumulated drawing state, and the interpreter itself. Eight
// covers the panes and timeframes one workspace has open at once.
var maxLiveRunSessions = 8

// sessionKey identifies a stream of runs that may share one Runtime. Every
// field is something a script's accumulated state depends on, so a change to
// any of them has to start a fresh Runtime rather than continue this one.
type sessionKey struct {
	script       *Script
	sourceFile   *bars.BarFile
	dailyFile    *bars.BarFile
	calendar     *bars.Calendar
	windowFrom   int
	configDigest [sha256.Size]byte
}

// runSession is one goja Runtime suspended between requests, positioned at
// the bar it has consumed up to.
//
// The Engine's usual guarantee — a fresh Runtime per Run, so one script's
// module-level `let` can never leak into another request — still holds across
// *different* streams, because sessionKey separates them. Within one stream
// the leak is the feature: replaying the same bars into a fresh interpreter
// on every step is exactly the work being avoided.
type runSession struct {
	// mu serialises use of rt. A goja Runtime is not safe for concurrent use,
	// and two panes on the same symbol/timeframe do land here together.
	mu      sync.Mutex
	rt      *goja.Runtime
	ctx     *runContext
	onTick  goja.Callable
	moment  goja.Value
	ta      goja.Value
	inputs  goja.Value
	reached int // next bar index to feed; == the window.To of the last advance
	element *list.Element
}

// initialize loads the script into a fresh Runtime and runs its init(),
// leaving the session positioned at window.From with nothing consumed yet.
func (s *runSession) initialize(script *Script, series barSeries, dailyFile *bars.BarFile, calendar *bars.Calendar, meta model.SymbolMeta, window bars.Window, overrides map[string]any) error {
	rt := goja.New()
	rt.SetFieldNameMapper(goja.UncapFieldNameMapper())
	ctx := newRunContext(series, dailyFile, calendar, meta, window, overrides)
	bindHost(rt, ctx)

	if _, err := rt.RunProgram(script.program); err != nil {
		return classifyRunError(err)
	}
	if err := callInit(rt, ctx); err != nil {
		if errors.Is(err, ErrInvalidInput) {
			return err
		}
		return classifyRunError(err)
	}
	onTick, ok := goja.AssertFunction(rt.Get("onTick"))
	if !ok {
		return fmt.Errorf("%w: script has no onTick function", ErrScriptFailed)
	}

	s.rt = rt
	s.ctx = ctx
	s.onTick = onTick
	// Native signature for the same reason bindHost's per-tick surface uses
	// one: scripts call _moment() several times per tick, and the reflect
	// wrapper would convert its argument on every one of them.
	s.moment = rt.ToValue(func(call goja.FunctionCall) goja.Value {
		return rt.ToValue(newMomentValue(call.Argument(0).ToInteger()))
	})
	s.ta = rt.NewObject()
	s.inputs = rt.ToValue(ctx.effective)
	s.reached = window.From
	return nil
}

// advance feeds bars [reached, to) into the script. On error the session's
// state is indeterminate — it consumed some prefix of the requested range —
// so every caller discards the session rather than reusing it.
func (s *runSession) advance(requestCtx context.Context, to int) error {
	// A previous advance may have been interrupted; goja keeps that flag set
	// until it is cleared, and would otherwise abort this run immediately.
	s.rt.ClearInterrupt()

	stopCancellation := context.AfterFunc(requestCtx, func() { s.rt.Interrupt(requestCtx.Err()) })
	defer stopCancellation()
	timer := time.AfterFunc(runTimeout, func() { s.rt.Interrupt("indicators: run exceeded time budget") })
	defer timer.Stop()

	for idx := s.reached; idx < to; idx++ {
		s.ctx.cursor = idx
		length := idx - s.ctx.window.From + 1
		if _, err := s.onTick(goja.Undefined(), s.rt.ToValue(length), s.moment, goja.Undefined(), s.ta, s.inputs); err != nil {
			s.reached = idx
			return classifyRunError(err)
		}
	}
	s.reached = to
	return nil
}

// continueRun answers params from a suspended Runtime when one is positioned
// at-or-before the requested window end, creating it on first use.
//
// handled reports whether the session path took the request at all. It is
// false for a rewind — a cursor that moved backwards cannot be served by a
// forward-only interpreter, and clobbering the session to serve it would make
// stepping back and forth across one bar rebuild the Runtime every time. The
// caller falls back to a throwaway run and leaves the session where it is.
func (e *Engine) continueRun(
	requestCtx context.Context, script *Script, source fileSeries,
	dailyFile *bars.BarFile, calendar *bars.Calendar, meta model.SymbolMeta,
	params RunParams, window bars.Window,
) (result RunResult, handled bool, err error) {
	digest, ok := configDigest(meta, params.Overrides)
	if !ok {
		return RunResult{}, false, nil
	}
	key := sessionKey{
		script: script, sourceFile: source.file, dailyFile: dailyFile,
		calendar: calendar, windowFrom: window.From, configDigest: digest,
	}

	e.sessionMu.Lock()
	session, existed := e.sessions[key]
	if existed {
		e.sessionLRU.MoveToFront(session.element)
	} else {
		// Published before it is built so a concurrent caller for the same
		// stream waits on this one's mutex instead of building a second
		// Runtime and racing to install it.
		session = &runSession{}
		session.element = e.sessionLRU.PushFront(key)
		e.sessions[key] = session
		e.evictSessionsLocked()
	}
	e.sessionMu.Unlock()

	session.mu.Lock()
	defer session.mu.Unlock()

	if session.rt == nil {
		e.executions.Add(1)
		if err := session.initialize(script, source, dailyFile, calendar, meta, window, params.Overrides); err != nil {
			e.dropSession(key, session)
			return RunResult{}, true, err
		}
	} else if window.To < session.reached {
		return RunResult{}, false, nil
	}

	// The window's end grows with the cursor, and for a file-backed series the
	// bars behind it are the same mmap'd bytes as last time — only the bound
	// moves.
	session.ctx.window = window
	session.ctx.file = source
	if err := session.advance(requestCtx, window.To); err != nil {
		e.dropSession(key, session)
		return RunResult{}, true, err
	}
	// Cloned because the session keeps mutating the state this was read from,
	// and the result outlives the lock.
	return cloneRunResult(session.ctx.result()), true, nil
}

// evictSessionsLocked trims the LRU to maxLiveRunSessions. Callers hold
// sessionMu. An evicted session that some goroutine is still advancing stays
// valid for that goroutine — dropping it from the map only means the next
// request starts fresh.
func (e *Engine) evictSessionsLocked() {
	for e.sessionLRU.Len() > maxLiveRunSessions {
		oldest := e.sessionLRU.Back()
		if oldest == nil {
			return
		}
		e.sessionLRU.Remove(oldest)
		delete(e.sessions, oldest.Value.(sessionKey))
	}
}

// dropSession removes a session whose Runtime can no longer be trusted —
// a failed or interrupted advance leaves the script's state mid-bar. The
// identity check matters: another goroutine may already have replaced this
// entry, and evicting that one would throw away a healthy Runtime.
func (e *Engine) dropSession(key sessionKey, session *runSession) {
	e.sessionMu.Lock()
	defer e.sessionMu.Unlock()
	if current, ok := e.sessions[key]; !ok || current != session {
		return
	}
	delete(e.sessions, key)
	if session.element != nil {
		e.sessionLRU.Remove(session.element)
		session.element = nil
	}
}

// liveSessions reports how many Runtimes are currently suspended. Internal;
// tests use it to prove reuse and eviction rather than relying on timing.
func (e *Engine) liveSessions() int {
	e.sessionMu.Lock()
	defer e.sessionMu.Unlock()
	return len(e.sessions)
}
