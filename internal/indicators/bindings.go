package indicators

import (
	"fmt"
	"math"
	"regexp"
	"slices"

	"github.com/dop251/goja"

	"market-replay/internal/bars"
	"market-replay/internal/model"
)

// sessionPattern matches the "HHMM-HHMM" shape every input.session default
// and override in the DSL scripts uses (e.g. "2000-0200").
var sessionPattern = regexp.MustCompile(`^\d{4}-\d{4}$`)

var aggregateDailyRange = bars.AggregateChartWindowForSession

type dailyRangeCacheKey struct {
	n          int
	sessionDay int64
}

type dailyRangeCacheValue struct {
	time      int64
	high      float64
	low       float64
	available bool
}

// runContext is one Run's (or one Register describe-pass's) complete
// mutable state: the bounded bar window, the current tick cursor, the
// input descriptors/overrides/resolved values harvested during init(),
// and everything a script drew or plotted. A fresh runContext (and a
// fresh goja.Runtime) is created per call — nothing here is shared across
// requests, which is what keeps one script's module-level `let` state
// from leaking between them.
type runContext struct {
	file      barSeries
	dailyFile *bars.BarFile
	calendar  *bars.Calendar // nilable; only the dailyRange binding needs it, degrades to a raw-scan fallback when nil
	symbol    model.SymbolMeta
	window    bars.Window
	tickSize  float64
	cursor    int // absolute bar index into file; valid only during onTick

	overrides map[string]any // caller-supplied; nil during Register's describe pass

	meta        IndicatorMeta
	descriptors []InputDescriptor
	effective   map[string]any // key -> resolved value, built during init()

	nextDrawID  int64
	draws       map[int64]*DrawIntent
	drawOrder   []int64 // insertion order; ids are never reused, deletes just leave a gap
	plots       []PlotPoint
	dailyRanges map[dailyRangeCacheKey]dailyRangeCacheValue
}

func newRunContext(file barSeries, dailyFile *bars.BarFile, calendar *bars.Calendar, symbol model.SymbolMeta, window bars.Window, overrides map[string]any) *runContext {
	return &runContext{
		file: file, dailyFile: dailyFile, calendar: calendar, symbol: symbol, window: window, tickSize: symbol.TickSize,
		overrides:   overrides,
		effective:   make(map[string]any),
		draws:       make(map[int64]*DrawIntent),
		dailyRanges: make(map[dailyRangeCacheKey]dailyRangeCacheValue),
	}
}

func (c *runContext) result() RunResult {
	draws := make([]DrawIntent, 0, len(c.drawOrder))
	for _, id := range c.drawOrder {
		if d, ok := c.draws[id]; ok {
			draws = append(draws, *d)
		}
	}
	plots := c.plots
	if plots == nil {
		// A script that never calls plot() should serialize as an empty
		// JSON array, not null — matching Draws' own always-non-nil
		// convention above.
		plots = []PlotPoint{}
	}
	return RunResult{Draws: draws, Plots: plots}
}

// priceAt resolves bars-back offset n (Pine-style: 0 = current bar) against
// the current cursor, converts through accessor, and scales to a real
// price. Out-of-window (including negative absolute index) returns NaN —
// the DSL's own `na` convention — rather than reading outside the
// requested window or panicking.
func (c *runContext) priceAt(n int, accessor func(int) int32) float64 {
	idx := c.cursor - n
	if idx < c.window.From || idx >= c.window.To {
		return math.NaN()
	}
	return float64(accessor(idx)) * c.tickSize
}

func (c *runContext) timeAt(n int) float64 {
	idx := c.cursor - n
	if idx < c.window.From || idx >= c.window.To {
		return math.NaN()
	}
	return float64(c.file.TsAt(idx))
}

func (c *runContext) volumeAt(n int) float64 {
	idx := c.cursor - n
	if idx < c.window.From || idx >= c.window.To {
		return math.NaN()
	}
	return c.file.VolumeAt(idx)
}

func (c *runContext) currentTime() int64 {
	if c.cursor < c.window.From || c.cursor >= c.window.To {
		return 0
	}
	return c.file.TsAt(c.cursor)
}

// dailyRange returns the high/low across the last n *completed* daily bars
// before the current tick, plus the earliest of those bars' timestamp —
// or nil (the DSL's `na`) when fewer than n+1 daily bars exist yet, rather
// than an error: an early-history run simply has no IPDA range available,
// same as Pine's own na on insufficient history.
//
// Reuses bars.AggregateChartWindowForSession — the same daily-aggregation
// path internal/httpapi/bars.go's handleChartBarsAt already relies on —
// rather than hand-rolling daily bucketing a second time.
func (c *runContext) dailyRange(n int) (map[string]any, error) {
	at := c.currentTime()
	if c.dailyFile == nil || at == 0 {
		return nil, nil
	}
	sessionDay, err := bars.SessionDayStart(at, c.symbol)
	if err != nil {
		return nil, err
	}
	key := dailyRangeCacheKey{n: n, sessionDay: sessionDay}
	if cached, ok := c.dailyRanges[key]; ok {
		if !cached.available {
			return nil, nil
		}
		return map[string]any{"time": cached.time, "high": cached.high, "low": cached.low}, nil
	}

	chartBars, err := aggregateDailyRange(c.dailyFile, c.calendar, c.symbol, "1d", at, n+2, 0, at, "eth")
	if err != nil {
		return nil, err
	}
	// Drop the still-forming "today" bucket — mirrors Pine's own [1]
	// offset on a security() daily request, which always reads the
	// previous *closed* bar, never the one still accumulating, to avoid
	// lookahead/repainting.
	if len(chartBars) > 0 {
		chartBars = chartBars[:len(chartBars)-1]
	}
	if len(chartBars) < n {
		c.dailyRanges[key] = dailyRangeCacheValue{}
		return nil, nil
	}
	window := chartBars[len(chartBars)-n:]
	high, low := window[0].HighTicks, window[0].LowTicks
	for _, bar := range window[1:] {
		if bar.HighTicks > high {
			high = bar.HighTicks
		}
		if bar.LowTicks < low {
			low = bar.LowTicks
		}
	}
	value := dailyRangeCacheValue{
		time: window[0].Time, high: float64(high) * c.tickSize,
		low: float64(low) * c.tickSize, available: true,
	}
	c.dailyRanges[key] = value
	return map[string]any{"time": value.time, "high": value.high, "low": value.low}, nil
}

func (c *runContext) addDraw(kind string, t0 int64, y0 float64, t1 int64, y1 float64, label string, style map[string]any) int64 {
	c.nextDrawID++
	id := c.nextDrawID
	c.draws[id] = &DrawIntent{ID: id, Kind: kind, Label: label, T0: t0, Y0: y0, T1: t1, Y1: y1, Style: style}
	c.drawOrder = append(c.drawOrder, id)
	return id
}

func (c *runContext) deleteDraw(id int64) {
	delete(c.draws, id)
}

// resolveInput records desc for the Descriptor list and computes the
// effective value (an override if one was supplied and validates, else
// desc.Default), storing it under desc.Key for the onTick `inputs` object.
// This is the one place both Register's describe-only pass and Run's real
// pass share: at Register time c.overrides is nil, so every input trivially
// resolves to its own default.
func resolveInput(c *runContext, desc InputDescriptor) (any, error) {
	c.descriptors = append(c.descriptors, desc)
	value := desc.Default
	if raw, ok := c.overrides[desc.Key]; ok {
		validated, err := validateOverride(desc, raw)
		if err != nil {
			return nil, fmt.Errorf("%w: %s: %v", ErrInvalidInput, desc.Key, err)
		}
		value = validated
	}
	c.effective[desc.Key] = value
	return value, nil
}

func asNumber(raw any) (float64, bool) {
	switch v := raw.(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	}
	return 0, false
}

func validateOverride(desc InputDescriptor, raw any) (any, error) {
	switch desc.Kind {
	case InputBool:
		v, ok := raw.(bool)
		if !ok {
			return nil, fmt.Errorf("want bool, got %T", raw)
		}
		return v, nil
	case InputInt:
		f, ok := asNumber(raw)
		if !ok {
			return nil, fmt.Errorf("want number, got %T", raw)
		}
		if desc.Min != nil && f < *desc.Min {
			return nil, fmt.Errorf("%v below min %v", f, *desc.Min)
		}
		if desc.Max != nil && f > *desc.Max {
			return nil, fmt.Errorf("%v above max %v", f, *desc.Max)
		}
		return int(f), nil
	case InputFloat, InputTime:
		f, ok := asNumber(raw)
		if !ok {
			return nil, fmt.Errorf("want number, got %T", raw)
		}
		if desc.Min != nil && f < *desc.Min {
			return nil, fmt.Errorf("%v below min %v", f, *desc.Min)
		}
		if desc.Max != nil && f > *desc.Max {
			return nil, fmt.Errorf("%v above max %v", f, *desc.Max)
		}
		return f, nil
	case InputStr:
		s, ok := raw.(string)
		if !ok {
			return nil, fmt.Errorf("want string, got %T", raw)
		}
		if len(desc.Options) > 0 && !slices.Contains(desc.Options, s) {
			return nil, fmt.Errorf("%q not one of %v", s, desc.Options)
		}
		return s, nil
	case InputSession:
		s, ok := raw.(string)
		if !ok {
			return nil, fmt.Errorf("want string, got %T", raw)
		}
		if !sessionPattern.MatchString(s) {
			return nil, fmt.Errorf("%q is not HHMM-HHMM", s)
		}
		return s, nil
	case InputColor:
		return normalizeColorOverride(raw)
	default:
		return nil, fmt.Errorf("unsupported input kind %q", desc.Kind)
	}
}

func rgbaMap(r, g, b int, a float64) map[string]any {
	return map[string]any{"r": r, "g": g, "b": b, "a": a}
}

// normalizeColorValue coerces a color object (a script literal or one of
// our own color.* presets, both exported by goja as map[string]any) into a
// clean map[string]any with int r/g/b and float64 a, for stable JSON
// serialization in a Descriptor's Default field. Non-map values pass
// through unchanged rather than erroring — a script's own default is
// trusted, only caller overrides are hard-validated (see
// normalizeColorOverride).
func normalizeColorValue(v any) any {
	m, ok := v.(map[string]any)
	if !ok {
		return v
	}
	out := map[string]any{}
	if r, ok := asNumber(m["r"]); ok {
		out["r"] = int(r)
	}
	if g, ok := asNumber(m["g"]); ok {
		out["g"] = int(g)
	}
	if b, ok := asNumber(m["b"]); ok {
		out["b"] = int(b)
	}
	if a, ok := asNumber(m["a"]); ok {
		out["a"] = a
	}
	return out
}

func normalizeColorOverride(raw any) (any, error) {
	m, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("want {r,g,b,a} object, got %T", raw)
	}
	normalized, ok := normalizeColorValue(m).(map[string]any)
	if !ok || normalized["r"] == nil || normalized["g"] == nil || normalized["b"] == nil || normalized["a"] == nil {
		return nil, fmt.Errorf("color override missing r/g/b/a")
	}
	return normalized, nil
}

func optionalString(v goja.Value) string {
	if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
		return ""
	}
	return v.String()
}

// bindHost wires the full DSL host surface (declarative: indicator/input/
// color; per-tick: bar accessors and draw/plot) onto rt, reading and
// mutating ctx. Called once per Runtime — both Register's throwaway
// describe-pass Runtime and Run's real Runtime share this one wiring
// function, so the two never drift apart.
func bindHost(rt *goja.Runtime, ctx *runContext) {
	rt.Set("indicator", func(opts map[string]any) {
		meta := IndicatorMeta{}
		if v, ok := opts["onMainPanel"].(bool); ok {
			meta.OnMainPanel = v
		}
		if v, ok := opts["format"].(string); ok {
			meta.Format = v
		}
		ctx.meta = meta
	})

	inputObj := rt.NewObject()
	_ = inputObj.Set("session", func(label, def, key string, _options goja.Value, group string) (any, error) {
		return resolveInput(ctx, InputDescriptor{Kind: InputSession, Key: key, Label: label, Group: group, Default: def})
	})
	_ = inputObj.Set("time", func(label string, def float64, key string, minV, maxV float64, tooltip, group string) (any, error) {
		min, max := minV, maxV
		return resolveInput(ctx, InputDescriptor{Kind: InputTime, Key: key, Label: label, Group: group, Tooltip: tooltip, Default: def, Min: &min, Max: &max})
	})
	_ = inputObj.Set("str", func(label, def, key string, options []string, tooltip, group string) (any, error) {
		return resolveInput(ctx, InputDescriptor{Kind: InputStr, Key: key, Label: label, Group: group, Tooltip: tooltip, Default: def, Options: options})
	})
	_ = inputObj.Set("float", func(label string, def float64, key string, minV, maxV, stepV float64, tooltip, group string) (any, error) {
		min, max, step := minV, maxV, stepV
		return resolveInput(ctx, InputDescriptor{Kind: InputFloat, Key: key, Label: label, Group: group, Tooltip: tooltip, Default: def, Min: &min, Max: &max, Step: &step})
	})
	_ = inputObj.Set("int", func(label string, def float64, key string, minV, maxV, stepV float64, tooltip, group string) (any, error) {
		min, max, step := minV, maxV, stepV
		return resolveInput(ctx, InputDescriptor{Kind: InputInt, Key: key, Label: label, Group: group, Tooltip: tooltip, Default: int(def), Min: &min, Max: &max, Step: &step})
	})
	_ = inputObj.Set("bool", func(call goja.FunctionCall) goja.Value {
		label := call.Argument(0).String()
		def := call.Argument(1).ToBoolean()
		key := call.Argument(2).String()
		var tooltip, group string
		if len(call.Arguments) >= 5 {
			tooltip = optionalString(call.Argument(3))
			group = optionalString(call.Argument(4))
		} else {
			group = optionalString(call.Argument(3))
		}
		value, err := resolveInput(ctx, InputDescriptor{Kind: InputBool, Key: key, Label: label, Group: group, Tooltip: tooltip, Default: def})
		if err != nil {
			panic(rt.NewGoError(err))
		}
		return rt.ToValue(value)
	})
	_ = inputObj.Set("color", func(label string, def any, key string, group string, tooltip goja.Value) (any, error) {
		return resolveInput(ctx, InputDescriptor{Kind: InputColor, Key: key, Label: label, Group: group, Tooltip: optionalString(tooltip), Default: normalizeColorValue(def)})
	})
	rt.Set("input", inputObj)

	colorObj := rt.NewObject()
	_ = colorObj.Set("gray", rgbaMap(128, 128, 128, 1.0))
	_ = colorObj.Set("black", rgbaMap(0, 0, 0, 1.0))
	rt.Set("color", colorObj)

	rt.Set("time", func(n int) float64 { return ctx.timeAt(n) })
	rt.Set("openC", func(n int) float64 { return ctx.priceAt(n, ctx.file.OpenAt) })
	rt.Set("high", func(n int) float64 { return ctx.priceAt(n, ctx.file.HighAt) })
	rt.Set("low", func(n int) float64 { return ctx.priceAt(n, ctx.file.LowAt) })
	rt.Set("closeC", func(n int) float64 { return ctx.priceAt(n, ctx.file.CloseAt) })
	rt.Set("volume", func(n int) float64 { return ctx.volumeAt(n) })

	rt.Set("horizontalRay", func(t, y float64, style map[string]any, label string) int64 {
		return ctx.addDraw("ray", int64(t), y, 0, 0, label, style)
	})
	rt.Set("rectangle", func(t1, y1, t2, y2 float64, style map[string]any) int64 {
		return ctx.addDraw("rectangle", int64(t1), y1, int64(t2), y2, "", style)
	})
	// verticalLine has no meaningful Y — it spans the full visible price
	// range, a rendering convention the frontend applies for kind:"vline"
	// rather than something this engine has (or needs) an opinion about.
	rt.Set("verticalLine", func(t float64, style map[string]any) int64 {
		return ctx.addDraw("vline", int64(t), 0, 0, 0, "", style)
	})
	// marker is a labeled point (a fractal swing, say) — same shape as a
	// ray's anchor, just never extended into a line.
	rt.Set("marker", func(t, y float64, label string, style map[string]any) int64 {
		return ctx.addDraw("marker", int64(t), y, 0, 0, label, style)
	})
	rt.Set("deleteDrawingById", func(id goja.Value) {
		if id == nil || goja.IsUndefined(id) || goja.IsNull(id) {
			return
		}
		ctx.deleteDraw(id.ToInteger())
	})
	rt.Set("plot", func(key string, value float64) {
		ctx.plots = append(ctx.plots, PlotPoint{Key: key, Time: ctx.currentTime(), Value: value})
	})

	rt.Set("dailyRange", func(n int) (goja.Value, error) {
		result, err := ctx.dailyRange(n)
		if err != nil {
			return nil, err
		}
		if result == nil {
			return goja.Undefined(), nil
		}
		return rt.ToValue(result), nil
	})
}
