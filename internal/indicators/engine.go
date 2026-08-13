package indicators

import (
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/dop251/goja"

	"market-replay/internal/bars"
	"market-replay/internal/model"
)

// runTimeout bounds one script's wall-clock execution. A pathological
// script (an accidental infinite loop, a pathologically large window)
// interrupts cleanly into ErrScriptFailed instead of hanging the request
// goroutine forever. Placeholder value — no measured data behind it yet.
// A var, not a const, so tests can shrink it rather than run for real.
var runTimeout = 5 * time.Second

// Script is one compiled, registered indicator: the parsed program (shared,
// safe to run concurrently in independent Runtimes) plus the Descriptor
// harvested once at Register time.
type Script struct {
	id, name string
	version  int
	program  *goja.Program
	describe Descriptor
}

// Engine holds every registered Script. Safe for concurrent use.
type Engine struct {
	mu      sync.RWMutex
	scripts map[string]*Script
}

func NewEngine() *Engine {
	return &Engine{scripts: make(map[string]*Script)}
}

// Register compiles source and harvests its Descriptor by running init()
// once in a throwaway Runtime. Fails fast, mirroring bars.NewRegistry: a
// script that won't compile or won't init() cleanly never becomes
// selectable, rather than failing later on its first real Run.
func (e *Engine) Register(id, name string, version int, source []byte) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("indicators: register %s: %v", id, r)
		}
	}()

	program, err := goja.Compile(id, string(source), false)
	if err != nil {
		return fmt.Errorf("indicators: compile %s: %w", id, err)
	}

	rt := goja.New()
	rt.SetFieldNameMapper(goja.UncapFieldNameMapper())
	ctx := newRunContext(nil, nil, model.SymbolMeta{}, bars.Window{}, nil)
	bindHost(rt, ctx)
	if _, err := rt.RunProgram(program); err != nil {
		return fmt.Errorf("indicators: load %s: %w", id, err)
	}
	if err := callInit(rt, ctx); err != nil {
		return fmt.Errorf("indicators: init %s: %w", id, err)
	}

	descriptors := append(make([]InputDescriptor, 0, len(ctx.descriptors)), ctx.descriptors...)
	e.mu.Lock()
	defer e.mu.Unlock()
	e.scripts[id] = &Script{
		id: id, name: name, version: version, program: program,
		describe: Descriptor{ID: id, Name: name, Version: version, Meta: ctx.meta, Inputs: descriptors},
	}
	return nil
}

// callInit resolves and calls the script's init(), which is where every
// input.*() declaration lives. Scripts assign `init = () => {...}` as a
// bare global (sloppy-mode auto-global, hence goja.Compile's strict=false),
// not a declared function statement, so it must be looked up dynamically
// after RunProgram rather than assumed present beforehand.
func callInit(rt *goja.Runtime, ctx *runContext) error {
	init, ok := goja.AssertFunction(rt.Get("init"))
	if !ok {
		return errors.New("script has no init() function")
	}
	_, err := init(goja.Undefined())
	return err
}

// List returns every registered Descriptor, sorted by id for a stable
// response.
func (e *Engine) List() []Descriptor {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := make([]Descriptor, 0, len(e.scripts))
	for _, s := range e.scripts {
		out = append(out, s.describe)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Describe returns one registered script's Descriptor.
func (e *Engine) Describe(id string) (Descriptor, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	s, ok := e.scripts[id]
	if !ok {
		return Descriptor{}, fmt.Errorf("%w: %s", ErrUnknownScript, id)
	}
	return s.describe, nil
}

// clampWindow resolves the bar window for a run: bars.BarFile.SeekWindow
// bounded by before/after around at, then clamped so nothing at or after
// the replay-safety boundary maxTs is ever visible — the same idiom
// bars.AggregateChartWindow/aggregateRTHChartWindow already apply, since
// SeekWindow itself has no notion of maxTs.
func clampWindow(file *bars.BarFile, at int64, before, after int, maxTs int64) bars.Window {
	if maxTs < at {
		at = maxTs
	}
	window := file.SeekWindow(at, before, after)
	if lastAllowed := file.IndexAtOrBefore(maxTs); lastAllowed >= 0 && window.To > lastAllowed+1 {
		window.To = lastAllowed + 1
	}
	if window.To < window.From {
		window.To = window.From
	}
	return window
}

// Run executes a registered script over a bounded bar window in a fresh
// Runtime — the module-level `let` state a script accumulates across
// onTick calls lives only in that Runtime's heap, so it can never leak
// into another request's Run. calendar is nilable — bars.AggregateChartWindow
// degrades to a slower raw-bar-scan path without one; only the dailyRange
// binding (used by the ipda-ranges script) actually needs it.
func (e *Engine) Run(id string, file *bars.BarFile, calendar *bars.Calendar, meta model.SymbolMeta, params RunParams) (result RunResult, err error) {
	e.mu.RLock()
	script, ok := e.scripts[id]
	e.mu.RUnlock()
	if !ok {
		return RunResult{}, fmt.Errorf("%w: %s", ErrUnknownScript, id)
	}

	// Guards the Go glue below that runs outside any goja call (window
	// math, result assembly) — script-execution panics (a JS throw, an
	// Interrupt, a panicking host binding) are already converted to plain
	// errors by goja's own call boundary inside AssertFunction.
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("%w: %v", ErrScriptFailed, r)
		}
	}()

	window := clampWindow(file, params.At, params.Before, params.After, params.MaxTs)

	rt := goja.New()
	rt.SetFieldNameMapper(goja.UncapFieldNameMapper())
	timer := time.AfterFunc(runTimeout, func() { rt.Interrupt("indicators: run exceeded time budget") })
	defer timer.Stop()

	ctx := newRunContext(file, calendar, meta, window, params.Overrides)
	bindHost(rt, ctx)
	if _, err := rt.RunProgram(script.program); err != nil {
		return RunResult{}, fmt.Errorf("%w: %v", ErrScriptFailed, err)
	}
	if err := callInit(rt, ctx); err != nil {
		if errors.Is(err, ErrInvalidInput) {
			return RunResult{}, err
		}
		return RunResult{}, fmt.Errorf("%w: %v", ErrScriptFailed, err)
	}

	onTick, ok := goja.AssertFunction(rt.Get("onTick"))
	if !ok {
		return RunResult{}, fmt.Errorf("%w: script has no onTick function", ErrScriptFailed)
	}

	momentCtor := rt.ToValue(func(ts int64) *momentValue { return newMomentValue(ts) })
	taObj := rt.NewObject()
	inputsObj := rt.ToValue(ctx.effective)

	for idx := window.From; idx < window.To; idx++ {
		ctx.cursor = idx
		length := idx - window.From + 1
		if _, err := onTick(goja.Undefined(), rt.ToValue(length), momentCtor, goja.Undefined(), taObj, inputsObj); err != nil {
			return RunResult{}, fmt.Errorf("%w: %v", ErrScriptFailed, err)
		}
	}

	return ctx.result(), nil
}
