package indicators

import (
	"container/list"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
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

	cacheMu  sync.Mutex
	cache    map[runCacheKey]*runCacheEntry
	cacheLRU list.List

	// sessions are suspended Runtimes, keyed by the stream of runs each may
	// serve. They are the second layer under `cache`: the result cache
	// answers an exactly-repeated request, a session answers the far more
	// common "same stream, cursor moved forward" one. See session.go.
	sessionMu  sync.Mutex
	sessions   map[sessionKey]*runSession
	sessionLRU list.List

	// executions counts actual goja executions, excluding cache hits. It is
	// intentionally internal; tests use it to prove deduplication rather
	// than relying on timing assertions.
	executions atomic.Int64
}

func NewEngine() *Engine {
	return &Engine{
		scripts:  make(map[string]*Script),
		cache:    make(map[runCacheKey]*runCacheEntry),
		sessions: make(map[sessionKey]*runSession),
	}
}

// maxCachedRunResults is a var, not a const, so ApplyLimits can override it
// from config.yaml's limits.indicator_cache_size at startup.
var maxCachedRunResults = 64

// ApplyLimits overrides the engine's LRU cache size and per-run wall-clock
// budget from startup config (cmd/server, from config.yaml's
// limits.indicator_cache_size / limits.indicator_run_timeout_seconds). Call
// once before NewEngine/RegisterBuiltins — see runTimeout's own doc above
// for why both are vars, not consts.
func ApplyLimits(cacheSize int, timeout time.Duration) {
	if cacheSize > 0 {
		maxCachedRunResults = cacheSize
	}
	if timeout > 0 {
		runTimeout = timeout
	}
}

type runCacheKey struct {
	script       *Script
	sourceFile   *bars.BarFile
	dailyFile    *bars.BarFile
	calendar     *bars.Calendar
	window       bars.Window
	seriesDigest [sha256.Size]byte
	configDigest [sha256.Size]byte
}

type runCacheEntry struct {
	done    chan struct{}
	cancel  context.CancelFunc
	waiters int
	ready   bool
	result  RunResult
	err     error
	element *list.Element
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
	ctx := newRunContext(nil, nil, nil, model.SymbolMeta{}, bars.Window{}, nil)
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
func clampWindow(file barSeries, at int64, before, after int, maxTs int64) bars.Window {
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
	// Snap the start to a block boundary so consecutive cursors share one
	// anchor and can be served from a suspended Runtime — see
	// runWindowAnchorDivisor. It only ever moves From backwards, so
	// To >= From still holds.
	//
	// The From >= block guard keeps the snap from reaching the front of the
	// file. Without it a short window near the start of history has its
	// anchor pulled all the way to bar 0, quietly turning "the last N bars"
	// into "everything"; requiring the anchor to be at least one block in
	// bounds the widening by its own distance from the start.
	if block := before / runWindowAnchorDivisor; block > 1 && window.From >= block {
		window.From -= window.From % block
	}
	return window
}

// Run executes a registered script over a bounded bar window in a fresh
// Runtime — the module-level `let` state a script accumulates across
// onTick calls lives only in that Runtime's heap, so it can never leak
// into another request's Run. calendar is nilable — bars.AggregateChartWindow
// degrades to a slower raw-bar-scan path without one; only the dailyRange
// binding (used by the ipda-ranges script) actually needs it.
func (e *Engine) Run(requestCtx context.Context, id string, file *bars.BarFile, calendar *bars.Calendar, meta model.SymbolMeta, params RunParams) (result RunResult, err error) {
	return e.run(requestCtx, id, fileSeries{file: file}, file, calendar, meta, params)
}

// RunChart executes a script on display-timeframe bars while retaining the
// canonical 1m file for higher-timeframe bindings such as dailyRange.
func (e *Engine) RunChart(requestCtx context.Context, id string, chartBars []bars.ChartBar, dailyFile *bars.BarFile, calendar *bars.Calendar, meta model.SymbolMeta, params RunParams) (result RunResult, err error) {
	return e.run(requestCtx, id, chartSeries{items: chartBars}, dailyFile, calendar, meta, params)
}

func (e *Engine) run(requestCtx context.Context, id string, series barSeries, dailyFile *bars.BarFile, calendar *bars.Calendar, meta model.SymbolMeta, params RunParams) (result RunResult, err error) {
	if err := requestCtx.Err(); err != nil {
		return RunResult{}, err
	}
	e.mu.RLock()
	script, ok := e.scripts[id]
	e.mu.RUnlock()
	if !ok {
		return RunResult{}, fmt.Errorf("%w: %s", ErrUnknownScript, id)
	}
	window := clampWindow(series, params.At, params.Before, params.After, params.MaxTs)
	key, cacheable := makeRunCacheKey(script, series, dailyFile, calendar, meta, params.Overrides, window)
	compute := func(sharedCtx context.Context) (RunResult, error) {
		return e.executeRun(sharedCtx, script, series, dailyFile, calendar, meta, params, window)
	}
	if !cacheable {
		return compute(requestCtx)
	}
	return e.cachedRun(requestCtx, key, compute)
}

// executeRun produces one run's result, preferring a suspended Runtime
// already positioned inside this window over building a new one.
//
// The session path is limited to a file-backed series on purpose. Its bars
// are the same mmap'd bytes across requests and its indices only ever extend,
// so "continue from bar N" is exactly equivalent to replaying from the start.
// A chart series is re-aggregated per request and its newest bucket is still
// forming, so it has no stable prefix to continue from — that path instead
// gets its repeat-hit from quantizing the request to the last closed bucket
// (see httpapi.quantizeToClosedBucket), which the result cache then serves.
func (e *Engine) executeRun(requestCtx context.Context, script *Script, series barSeries, dailyFile *bars.BarFile, calendar *bars.Calendar, meta model.SymbolMeta, params RunParams, window bars.Window) (result RunResult, err error) {
	// Guards the Go glue below that runs outside any goja call (window
	// math, result assembly) — script-execution panics (a JS throw, an
	// Interrupt, a panicking host binding) are already converted to plain
	// errors by goja's own call boundary inside AssertFunction.
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("%w: %v", ErrScriptFailed, r)
		}
	}()

	if source, ok := series.(fileSeries); ok {
		if result, handled, err := e.continueRun(requestCtx, script, source, dailyFile, calendar, meta, params, window); handled {
			return result, err
		}
	}
	return e.freshRun(requestCtx, script, series, dailyFile, calendar, meta, params, window)
}

// freshRun builds a throwaway Runtime, replays the whole window into it and
// discards it — the behaviour every run had before sessions existed, still
// used for chart series and for a rewind the session path declines.
func (e *Engine) freshRun(requestCtx context.Context, script *Script, series barSeries, dailyFile *bars.BarFile, calendar *bars.Calendar, meta model.SymbolMeta, params RunParams, window bars.Window) (RunResult, error) {
	e.executions.Add(1)

	session := &runSession{}
	if err := session.initialize(script, series, dailyFile, calendar, meta, window, params.Overrides); err != nil {
		return RunResult{}, err
	}
	if err := session.advance(requestCtx, window.To); err != nil {
		return RunResult{}, err
	}
	return session.ctx.result(), nil
}

// configDigest fingerprints everything about a run that is neither the script
// nor the bars: the symbol's metadata and the caller's input overrides.
// ok is false for overrides JSON cannot represent, which both callers treat
// as "not cacheable" rather than an error — Run's own validation still gets
// to reject the value with its existing message.
func configDigest(meta model.SymbolMeta, overrides map[string]any) ([sha256.Size]byte, bool) {
	config, err := json.Marshal(struct {
		Meta      model.SymbolMeta `json:"meta"`
		Overrides map[string]any   `json:"overrides"`
	}{Meta: meta, Overrides: overrides})
	if err != nil {
		return [sha256.Size]byte{}, false
	}
	return sha256.Sum256(config), true
}

func makeRunCacheKey(script *Script, series barSeries, dailyFile *bars.BarFile, calendar *bars.Calendar, meta model.SymbolMeta, overrides map[string]any, window bars.Window) (runCacheKey, bool) {
	digest, ok := configDigest(meta, overrides)
	if !ok {
		return runCacheKey{}, false
	}
	key := runCacheKey{
		script:       script,
		dailyFile:    dailyFile,
		calendar:     calendar,
		window:       window,
		configDigest: digest,
	}
	switch source := series.(type) {
	case fileSeries:
		key.sourceFile = source.file
	case chartSeries:
		key.seriesDigest = digestChartBars(source.items)
	default:
		return runCacheKey{}, false
	}
	return key, true
}

func digestChartBars(items []bars.ChartBar) [sha256.Size]byte {
	hash := sha256.New()
	var encoded [32]byte
	for _, item := range items {
		binary.LittleEndian.PutUint64(encoded[0:8], uint64(item.Time))
		binary.LittleEndian.PutUint32(encoded[8:12], uint32(item.OpenTicks))
		binary.LittleEndian.PutUint32(encoded[12:16], uint32(item.HighTicks))
		binary.LittleEndian.PutUint32(encoded[16:20], uint32(item.LowTicks))
		binary.LittleEndian.PutUint32(encoded[20:24], uint32(item.CloseTicks))
		binary.LittleEndian.PutUint64(encoded[24:32], item.Volume)
		_, _ = hash.Write(encoded[:])
	}
	var digest [sha256.Size]byte
	copy(digest[:], hash.Sum(nil))
	return digest
}

// cachedRun combines a bounded result cache with cancellation-aware
// singleflight. Every caller may leave independently; the shared work is
// canceled only when its last waiter has gone away.
func (e *Engine) cachedRun(requestCtx context.Context, key runCacheKey, compute func(context.Context) (RunResult, error)) (RunResult, error) {
	if err := requestCtx.Err(); err != nil {
		return RunResult{}, err
	}

	e.cacheMu.Lock()
	entry, found := e.cache[key]
	if found && entry.ready {
		e.cacheLRU.MoveToFront(entry.element)
		result, err := entry.result, entry.err
		e.cacheMu.Unlock()
		return cloneRunResult(result), err
	}
	if found {
		entry.waiters++
		e.cacheMu.Unlock()
		return e.awaitCachedRun(requestCtx, key, entry)
	}

	workCtx, cancel := context.WithCancel(context.Background())
	entry = &runCacheEntry{done: make(chan struct{}), cancel: cancel, waiters: 1}
	e.cache[key] = entry
	e.cacheMu.Unlock()

	go e.finishCachedRun(workCtx, key, entry, compute)
	return e.awaitCachedRun(requestCtx, key, entry)
}

func (e *Engine) finishCachedRun(workCtx context.Context, key runCacheKey, entry *runCacheEntry, compute func(context.Context) (RunResult, error)) {
	result, err := compute(workCtx)
	entry.cancel()

	e.cacheMu.Lock()
	entry.result = result
	entry.err = err
	entry.ready = true
	if current, ok := e.cache[key]; ok && current == entry {
		if err != nil {
			delete(e.cache, key)
		} else {
			entry.element = e.cacheLRU.PushFront(key)
			for e.cacheLRU.Len() > maxCachedRunResults {
				oldest := e.cacheLRU.Back()
				oldKey := oldest.Value.(runCacheKey)
				e.cacheLRU.Remove(oldest)
				delete(e.cache, oldKey)
			}
		}
	}
	close(entry.done)
	e.cacheMu.Unlock()
}

func (e *Engine) awaitCachedRun(requestCtx context.Context, key runCacheKey, entry *runCacheEntry) (RunResult, error) {
	select {
	case <-entry.done:
		if err := requestCtx.Err(); err != nil {
			return RunResult{}, err
		}
		return cloneRunResult(entry.result), entry.err
	case <-requestCtx.Done():
		e.cacheMu.Lock()
		if current, ok := e.cache[key]; ok && current == entry && !entry.ready {
			entry.waiters--
			if entry.waiters == 0 {
				delete(e.cache, key)
				entry.cancel()
			}
		}
		e.cacheMu.Unlock()
		return RunResult{}, requestCtx.Err()
	}
}

func (e *Engine) cacheWaiters(key runCacheKey) int {
	e.cacheMu.Lock()
	defer e.cacheMu.Unlock()
	if entry := e.cache[key]; entry != nil && !entry.ready {
		return entry.waiters
	}
	return 0
}

func cloneRunResult(result RunResult) RunResult {
	cloned := RunResult{
		Draws: make([]DrawIntent, len(result.Draws)),
		Plots: append([]PlotPoint(nil), result.Plots...),
	}
	for i, draw := range result.Draws {
		cloned.Draws[i] = draw
		cloned.Draws[i].Style = cloneStringMap(draw.Style)
	}
	return cloned
}

func cloneStringMap(source map[string]any) map[string]any {
	if source == nil {
		return nil
	}
	cloned := make(map[string]any, len(source))
	for key, value := range source {
		cloned[key] = cloneJSONValue(value)
	}
	return cloned
}

func cloneJSONValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneStringMap(typed)
	case []any:
		cloned := make([]any, len(typed))
		for i := range typed {
			cloned[i] = cloneJSONValue(typed[i])
		}
		return cloned
	default:
		return value
	}
}

func classifyRunError(err error) error {
	var interrupted *goja.InterruptedError
	if errors.As(err, &interrupted) {
		if cause, ok := interrupted.Value().(error); ok && (errors.Is(cause, context.Canceled) || errors.Is(cause, context.DeadlineExceeded)) {
			return cause
		}
	}
	return fmt.Errorf("%w: %v", ErrScriptFailed, err)
}
