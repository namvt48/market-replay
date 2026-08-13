// Package indicators runs Pine-Script-like JS indicator scripts against a
// bounded window of a symbol's bars, using an embedded goja VM. A script
// declares typed config in an init() hook and emits drawing primitives
// (horizontalRay/rectangle) and/or numeric plot(key,value) series from an
// onTick() hook called once per bar, with module-level state persisting
// across bars for the duration of one Run.
package indicators

import "errors"

// InputKind is one of the input.*() call kinds a script's init() may use.
type InputKind string

const (
	InputSession InputKind = "session"
	InputTime    InputKind = "time"
	InputStr     InputKind = "str"
	InputFloat   InputKind = "float"
	InputInt     InputKind = "int"
	InputBool    InputKind = "bool"
	InputColor   InputKind = "color"
)

// RGBA mirrors the {r,g,b,a} literal scripts pass for color inputs/style
// fields: r/g/b are 0-255, a is 0-1. Lowercase json tags so it serializes
// the same shape the script itself uses.
type RGBA struct {
	R int     `json:"r"`
	G int     `json:"g"`
	B int     `json:"b"`
	A float64 `json:"a"`
}

// InputDescriptor is one input.*() declaration harvested from a script's
// init(). Kind-specific fields are omitted (via omitempty / nil pointers)
// rather than zero-valued, so a client can tell "not applicable to this
// kind" apart from "zero".
type InputDescriptor struct {
	Kind    InputKind `json:"kind"`
	Key     string    `json:"key"`
	Label   string    `json:"label"`
	Group   string    `json:"group,omitempty"`
	Tooltip string    `json:"tooltip,omitempty"`
	Default any       `json:"default"`
	Min     *float64  `json:"min,omitempty"`
	Max     *float64  `json:"max,omitempty"`
	Step    *float64  `json:"step,omitempty"`
	Options []string  `json:"options,omitempty"`
}

// IndicatorMeta is the options object a script passes to indicator().
type IndicatorMeta struct {
	OnMainPanel bool   `json:"onMainPanel"`
	Format      string `json:"format,omitempty"`
}

// Descriptor is everything a client needs to render a config form and
// call Run: the script's identity plus every input it declared.
type Descriptor struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Version int               `json:"version"`
	Meta    IndicatorMeta     `json:"meta"`
	Inputs  []InputDescriptor `json:"inputs"`
}

// DrawIntent is one surviving horizontalRay/rectangle at the end of a Run
// — a snapshot after every deleteDrawingById has already been applied,
// not an event log of every draw/delete call the script made.
type DrawIntent struct {
	ID    int64          `json:"id"`
	Kind  string         `json:"kind"` // "ray" | "rectangle"
	Label string         `json:"label,omitempty"`
	T0    int64          `json:"t0"`
	Y0    float64        `json:"y0"`
	T1    int64          `json:"t1,omitempty"`
	Y1    float64        `json:"y1,omitempty"`
	Style map[string]any `json:"style"`
}

// PlotPoint is one plot(key, value) call at the current tick.
type PlotPoint struct {
	Key   string  `json:"key"`
	Time  int64   `json:"time"`
	Value float64 `json:"value"`
}

// RunResult is a Run's complete output: every drawing still alive at the
// end of the run, plus every plotted point in call order.
type RunResult struct {
	Draws []DrawIntent `json:"draws"`
	Plots []PlotPoint  `json:"plots"`
}

// RunParams bounds and configures one Run. Before/After mirror
// bars.BarFile.SeekWindow's own parameter names; MaxTs is the replay-safety
// spoiler boundary already used by bars.AggregateChartWindowForSession.
type RunParams struct {
	At        int64
	Before    int
	After     int
	MaxTs     int64
	Overrides map[string]any
}

var (
	// ErrUnknownScript means the requested script id was never registered.
	ErrUnknownScript = errors.New("indicators: unknown script id")
	// ErrInvalidInput means an override in RunParams.Overrides did not
	// match its input's declared kind, range, or options.
	ErrInvalidInput = errors.New("indicators: invalid input override")
	// ErrScriptFailed means a registered, valid script threw, timed out,
	// or otherwise failed during this specific Run.
	ErrScriptFailed = errors.New("indicators: script execution failed")
)
