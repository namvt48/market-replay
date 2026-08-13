package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"market-replay/internal/bars"
	"market-replay/internal/indicators"
)

// maxIndicatorRunPayload bounds the run request body — input overrides are
// scalars and small {r,g,b,a} color objects, never the size a saved chart
// layout can reach, so this is far smaller than preferences.go's own limit.
const maxIndicatorRunPayload = 64 << 10

type runIndicatorRequest struct {
	Inputs map[string]any `json:"inputs"`
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
	symbol, err := requiredParam(r, "symbol")
	if err != nil {
		writeError(w, err)
		return
	}
	scriptID, err := requiredParam(r, "script")
	if err != nil {
		writeError(w, err)
		return
	}
	tf := r.URL.Query().Get("tf")
	if tf == "" {
		tf = "1m"
	}
	at, err := parseInt64Required(r, "at")
	if err != nil {
		writeError(w, err)
		return
	}
	before, err := parseIntClamped(r, "before", 1500, 0, 20000)
	if err != nil {
		writeError(w, err)
		return
	}
	after, err := parseIntClamped(r, "after", 0, 0, 20000)
	if err != nil {
		writeError(w, err)
		return
	}
	maxTs, err := parseInt64(r, "to", at)
	if err != nil {
		writeError(w, err)
		return
	}

	var body runIndicatorRequest
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxIndicatorRunPayload+1))
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

	var result indicators.RunResult
	err = s.Registry.WithDataset(symbol, tf, func(file *bars.BarFile, cal *bars.Calendar, _ string) error {
		var runErr error
		result, runErr = s.Indicators.Run(scriptID, file, cal, meta, indicators.RunParams{
			At: at, Before: before, After: after, MaxTs: maxTs, Overrides: body.Inputs,
		})
		return runErr
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
