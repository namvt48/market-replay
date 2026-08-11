package httpapi

import (
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"market-replay/internal/bars"
	"market-replay/internal/model"
)

// barFrameETag wraps a dataset tag as a weak validator. Weak because the
// body is a re-framed slice of the dataset rather than the dataset's own
// bytes: two responses sharing a tag are semantically identical, not
// byte-identical across encodings.
func barFrameETag(tag string) string { return `W/"` + tag + `"` }

// etagMatches implements If-None-Match against a single current validator,
// including the comma-separated list and "*" forms a client may send.
func etagMatches(header, etag string) bool {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if candidate == "*" || candidate == etag {
			return true
		}
	}
	return false
}

// serveBarFrameValidator publishes the dataset's validator and reports
// whether the client's cached copy is still current.
//
// Bar frames used to be sent as "public, max-age=31536000, immutable". They
// are not immutable: SIGHUP reloads a dataset in place, so the same URL can
// legitimately return different bars, and with no validator a client had no
// way to ever find out — it would keep serving pre-reload bars from its own
// cache indefinitely. Revalidation is cheap by comparison, and a 304 still
// saves both the transfer and the compression of a fresh frame.
func serveBarFrameValidator(w http.ResponseWriter, r *http.Request, tag string) (notModified bool) {
	etag := barFrameETag(tag)
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	if !etagMatches(r.Header.Get("If-None-Match"), etag) {
		return false
	}
	w.WriteHeader(http.StatusNotModified)
	return true
}

// handleSymbols serves symbols.json verbatim — the single source of truth
// for tick size, point value, and commission (docs N5).
func (s *Server) handleSymbols(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=3600")
	writeJSON(w, http.StatusOK, s.Registry.Symbols())
}

// handleBars serves GET /api/v1/bars?symbol=&tf=&from=&to=&limit=&fmt=.
// Bars are kept from the start of the range when the range exceeds limit
// (X-Bars-Truncated: 1) — the docs don't specify a truncation direction;
// this supports natural forward pagination (next from = last returned
// ts + tf).
func (s *Server) handleBars(w http.ResponseWriter, r *http.Request) {
	symbol, err := requiredParam(r, "symbol")
	if err != nil {
		writeError(w, err)
		return
	}
	tf, err := requiredParam(r, "tf")
	if err != nil {
		writeError(w, err)
		return
	}
	from, err := parseInt64(r, "from", 0)
	if err != nil {
		writeError(w, err)
		return
	}
	to, err := parseInt64(r, "to", math.MaxInt64)
	if err != nil {
		writeError(w, err)
		return
	}
	if from > to {
		writeError(w, fmt.Errorf("%w: from must be <= to", errBadRequest))
		return
	}
	limit, err := parseIntClamped(r, "limit", 5000, 1, 20000)
	if err != nil {
		writeError(w, err)
		return
	}
	jsonFmt := r.URL.Query().Get("fmt") == "json"

	err = s.Registry.WithDataset(symbol, tf, func(f *bars.BarFile, _ *bars.Calendar, tag string) error {
		if serveBarFrameValidator(w, r, tag) {
			return nil
		}
		win, truncated := f.RangeWindow(from, to, limit)
		if truncated {
			w.Header().Set("X-Bars-Truncated", "1")
		} else {
			w.Header().Set("X-Bars-Truncated", "0")
		}
		if jsonFmt {
			return bars.WriteFrameJSON(w, f, win)
		}
		return bars.WriteFrame(w, f, win)
	})
	if err != nil {
		writeError(w, err)
	}
}

// handleBarsAt serves GET /api/v1/bars/at?symbol=&tf=&at=&before=&after=
// — one call answers one seek (docs §6.3).
func (s *Server) handleBarsAt(w http.ResponseWriter, r *http.Request) {
	symbol, err := requiredParam(r, "symbol")
	if err != nil {
		writeError(w, err)
		return
	}
	tf, err := requiredParam(r, "tf")
	if err != nil {
		writeError(w, err)
		return
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
	jsonFmt := r.URL.Query().Get("fmt") == "json"

	err = s.Registry.WithDataset(symbol, tf, func(f *bars.BarFile, _ *bars.Calendar, tag string) error {
		if serveBarFrameValidator(w, r, tag) {
			return nil
		}
		win := f.SeekWindow(at, before, after)
		if jsonFmt {
			return bars.WriteFrameJSON(w, f, win)
		}
		return bars.WriteFrame(w, f, win)
	})
	if err != nil {
		writeError(w, err)
	}
}

// handleChartBarsAt serves a bounded number of display-timeframe candles
// aggregated directly from the canonical 1m dataset. Large TFs therefore
// never require the browser to download or retain their entire raw history.
func (s *Server) handleChartBarsAt(w http.ResponseWriter, r *http.Request) {
	symbol, err := requiredParam(r, "symbol")
	if err != nil {
		writeError(w, err)
		return
	}
	tf, err := requiredParam(r, "tf")
	if err != nil {
		writeError(w, err)
		return
	}
	if !validTimeframe(tf) {
		writeError(w, fmt.Errorf("%w: invalid chart timeframe", errBadRequest))
		return
	}
	at, err := parseInt64Required(r, "at")
	if err != nil {
		writeError(w, err)
		return
	}
	before, err := parseIntClamped(r, "before", 240, 0, 2000)
	if err != nil {
		writeError(w, err)
		return
	}
	after, err := parseIntClamped(r, "after", 0, 0, 2000)
	if err != nil {
		writeError(w, err)
		return
	}
	maxTs, err := parseInt64(r, "to", at)
	if err != nil {
		writeError(w, err)
		return
	}
	marketSession := r.URL.Query().Get("session")
	if marketSession == "" {
		marketSession = "eth"
	}
	if marketSession != "eth" && marketSession != "rth" {
		writeError(w, fmt.Errorf("%w: invalid market session", errBadRequest))
		return
	}
	var meta *model.SymbolMeta
	for _, candidate := range s.Registry.Symbols() {
		if candidate.Symbol == symbol {
			copy := candidate
			meta = &copy
			break
		}
	}
	if meta == nil {
		writeError(w, fmt.Errorf("%w: unknown symbol %s", bars.ErrUnknownSymbolTF, symbol))
		return
	}
	var output []bars.ChartBar
	err = s.Registry.WithDataset(symbol, "1m", func(file *bars.BarFile, calendar *bars.Calendar, _ string) error {
		var aggregateErr error
		output, aggregateErr = bars.AggregateChartWindowForSession(file, calendar, *meta, tf, at, before, after, maxTs, marketSession)
		return aggregateErr
	})
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=30")
	w.Header().Set("X-Chart-Bars-Count", strconv.Itoa(len(output)))
	writeJSON(w, http.StatusOK, output)
}

// handleCalendar serves GET /api/v1/calendar?symbol=&tf=&from=&to=. `tf`
// defaults to "1m" when omitted — the docs' own example URL for this
// endpoint has no tf param, even though the response is timeframe-
// dependent.
func (s *Server) handleCalendar(w http.ResponseWriter, r *http.Request) {
	symbol, err := requiredParam(r, "symbol")
	if err != nil {
		writeError(w, err)
		return
	}
	tf := r.URL.Query().Get("tf")
	if tf == "" {
		tf = "1m"
	}
	from, err := parseInt64(r, "from", 0)
	if err != nil {
		writeError(w, err)
		return
	}
	to, err := parseInt64(r, "to", math.MaxInt64)
	if err != nil {
		writeError(w, err)
		return
	}

	err = s.Registry.WithDataset(symbol, tf, func(f *bars.BarFile, cal *bars.Calendar, _ string) error {
		if cal == nil {
			writeJSON(w, http.StatusOK, []bars.CalendarEntry{})
			return nil
		}
		entries, err := cal.Range(from, to, f)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, entries)
		return nil
	})
	if err != nil {
		writeError(w, err)
	}
}
