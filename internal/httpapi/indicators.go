package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"market-replay/internal/bars"
	"market-replay/internal/indicators"
	"market-replay/internal/model"
)

// maxIndicatorRunPayload bounds the run request body — input overrides are
// scalars and small {r,g,b,a} color objects, never the size a saved chart
// layout can reach, so this is far smaller than preferences.go's own limit.
// A var, not a const, so ApplyLimits (limits.go) can override it from
// config.yaml's limits.indicator_run_payload_bytes at startup.
var maxIndicatorRunPayload = 64 << 10

type runIndicatorRequest struct {
	Inputs map[string]any `json:"inputs"`
}

// quantizeToClosedBucket pulls a display-timeframe run back to the last bar
// that closed before the cursor, instead of the cursor itself.
//
// Two things follow from that, and both are the point. The output stops
// repainting: a script's drawings are derived only from completed bars, which
// is the same guarantee Pine gives by default and the one a trader reading a
// replay actually wants. And the run becomes cacheable: every cursor inside
// one display bucket produces an identical request, so a 15m chart computes
// its indicators once per closed 15m bar rather than once per replayed
// minute — the difference between a ~50 ms recompute on every step and an
// LRU hit.
//
// A run at its own base timeframe (1m, or 5s for a symbol with second data)
// never reaches here — handleRunIndicator returns before the call: there the
// display bar *is* the underlying raw bar, so quantizing would drop the
// cursor's own bar for nothing.
func quantizeToClosedBucket(meta model.SymbolMeta, tf string, params indicators.RunParams) (indicators.RunParams, error) {
	bucketStart, err := bars.ChartBucketStart(meta, tf, params.At)
	if err != nil {
		return params, err
	}
	// The bucket containing At is still forming, so the newest closed bar is
	// whatever ends one second before it opened.
	lastClosed := bucketStart - 1
	if lastClosed < params.At {
		params.At = lastClosed
	}
	if lastClosed < params.MaxTs {
		params.MaxTs = lastClosed
	}
	return params, nil
}

// handleListIndicators serves GET /api/v1/indicators — every registered
// script's id, name, and full input schema, so a client can build a config
// form without a separate describe call per script.
func (s *Server) handleListIndicators(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=60")
	writeJSON(w, http.StatusOK, s.Indicators.List())
}

// handleRunIndicator serves POST /api/v1/indicators/run?symbol=&tf=&script=&at=&before=&after=&to=,
// body {"inputs": {...}} (optional). Params mirror handleChartBarsAt's own
// style; the body is a real JSON document (input overrides can nest color
// objects) rather than query-string-shaped, same reasoning already applied
// to POST /api/v1/drawings.
func (s *Server) handleRunIndicator(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	symbol, err := requiredParam(query, "symbol")
	if err != nil {
		writeError(w, err)
		return
	}
	scriptID, err := requiredParam(query, "script")
	if err != nil {
		writeError(w, err)
		return
	}
	tf := query.Get("tf")
	if tf == "" {
		tf = "1m"
	}
	if !validTimeframe(tf) {
		writeError(w, fmt.Errorf("%w: invalid chart timeframe", errBadRequest))
		return
	}
	at, err := parseInt64Required(query, "at")
	if err != nil {
		writeError(w, err)
		return
	}
	before, err := parseIntClamped(query, "before", 1500, 0, 20000)
	if err != nil {
		writeError(w, err)
		return
	}
	after, err := parseIntClamped(query, "after", 0, 0, 20000)
	if err != nil {
		writeError(w, err)
		return
	}
	maxTs, err := parseInt64(query, "to", at)
	if err != nil {
		writeError(w, err)
		return
	}

	var body runIndicatorRequest
	raw, err := io.ReadAll(io.LimitReader(r.Body, int64(maxIndicatorRunPayload)+1))
	if err != nil {
		writeError(w, fmt.Errorf("%w: could not read body: %v", errBadRequest, err))
		return
	}
	if len(raw) > maxIndicatorRunPayload {
		writeError(w, fmt.Errorf("%w: request body exceeds %d bytes", errBadRequest, maxIndicatorRunPayload))
		return
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			writeError(w, fmt.Errorf("%w: invalid JSON body: %v", errBadRequest, err))
			return
		}
	}

	meta, ok := lookupSymbolMeta(s, symbol)
	if !ok {
		writeError(w, fmt.Errorf("%w: unknown symbol %s", bars.ErrUnknownSymbolTF, symbol))
		return
	}

	baseTf := bars.BaseTimeframe(tf)
	var result indicators.RunResult
	err = s.Registry.WithDataset(symbol, baseTf, func(file *bars.BarFile, cal *bars.Calendar, _ string) error {
		var runErr error
		params := indicators.RunParams{
			At: at, Before: before, After: after, MaxTs: maxTs, Overrides: body.Inputs,
		}
		if tf == baseTf {
			result, runErr = s.Indicators.Run(r.Context(), scriptID, file, cal, meta, params)
			return runErr
		}
		if params, err = quantizeToClosedBucket(meta, tf, params); err != nil {
			return err
		}
		displayBars, err := bars.AggregateChartWindow(file, cal, meta, tf, params.At, params.Before, params.After, params.MaxTs)
		if err != nil {
			return err
		}
		result, runErr = s.Indicators.RunChart(r.Context(), scriptID, displayBars, file, cal, meta, params)
		return runErr
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
