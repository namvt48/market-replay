package httpapi

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"market-replay/internal/bars"
)

type chartBarResponse struct {
	Time       int64  `json:"time"`
	OpenTicks  int32  `json:"openTicks"`
	HighTicks  int32  `json:"highTicks"`
	LowTicks   int32  `json:"lowTicks"`
	CloseTicks int32  `json:"closeTicks"`
	Volume     uint64 `json:"volume"`
}

func TestHandleSymbols(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/symbols", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Cache-Control") == "" {
		t.Error("missing Cache-Control header")
	}
}

func TestHandleChartBarsAt_AggregatesRequestedDisplayTimeframe(t *testing.T) {
	s := newTestServer(t)
	at := int64(testFixtureStart) + int64(testFixtureN-1)*60
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/chart-bars/at?symbol=NQ&tf=5m&at=%d&before=3&after=0&to=%d", at, at), nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got []chartBarResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("bars = %d, want 3", len(got))
	}
	if got[len(got)-1].Time > at {
		t.Fatalf("last time = %d, cursor = %d", got[len(got)-1].Time, at)
	}
	if got[len(got)-1].CloseTicks != int32(101+testFixtureN-1) {
		t.Fatalf("last close = %d, want %d", got[len(got)-1].CloseTicks, 101+testFixtureN-1)
	}
}

func TestHandleChartBarsAt_RejectsUnknownMarketSession(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/chart-bars/at?symbol=NQ&tf=5m&at=%d&session=overnight", testFixtureStart), nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleBars_Success(t *testing.T) {
	s := newTestServer(t)
	url := fmt.Sprintf("/api/v1/bars?symbol=NQ&tf=1m&from=%d&to=%d&limit=100", testFixtureStart, testFixtureStart+1200)
	req := httptest.NewRequest(http.MethodGet, url, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != bars.ContentType {
		t.Errorf("Content-Type = %q, want %q", ct, bars.ContentType)
	}
	if rec.Header().Get("X-Bars-Truncated") != "0" {
		t.Errorf("X-Bars-Truncated = %q, want 0", rec.Header().Get("X-Bars-Truncated"))
	}
	n := binary.LittleEndian.Uint32(rec.Body.Bytes()[8:12])
	if n == 0 {
		t.Error("frame has 0 bars, want > 0")
	}
}

func TestHandleBars_Truncated(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/bars?symbol=NQ&tf=1m&from=0&to=9999999999&limit=3", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Bars-Truncated") != "1" {
		t.Errorf("X-Bars-Truncated = %q, want 1 (%d bars available, limit 3)", rec.Header().Get("X-Bars-Truncated"), testFixtureN)
	}
	n := binary.LittleEndian.Uint32(rec.Body.Bytes()[8:12])
	if n != 3 {
		t.Errorf("bar count = %d, want 3", n)
	}
}

func TestHandleBars_JSONFormat(t *testing.T) {
	s := newTestServer(t)
	url := fmt.Sprintf("/api/v1/bars?symbol=NQ&tf=1m&from=%d&to=%d&fmt=json", testFixtureStart, testFixtureStart+60)
	req := httptest.NewRequest(http.MethodGet, url, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
}

func TestHandleBars_MissingParams(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/bars?symbol=NQ", nil) // no tf
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleBars_UnknownSymbol(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/bars?symbol=ZZZ&tf=1m", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleBars_FromAfterTo(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/bars?symbol=NQ&tf=1m&from=100&to=50", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleBarsAt_Seek(t *testing.T) {
	s := newTestServer(t)
	at := testFixtureStart + 600 // 10th bar (0-indexed bar 10)
	url := fmt.Sprintf("/api/v1/bars/at?symbol=NQ&tf=1m&at=%d&before=5&after=2", at)
	req := httptest.NewRequest(http.MethodGet, url, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	n := binary.LittleEndian.Uint32(rec.Body.Bytes()[8:12])
	if n != 7 {
		t.Errorf("bar count = %d, want 7 (5 before + 2 after)", n)
	}
}

func TestHandleBarsAt_MissingAt(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/bars/at?symbol=NQ&tf=1m", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleCalendar_NoIdxFixtureIsEmptyNotError(t *testing.T) {
	s := newTestServer(t)
	// The test fixture has no .idx companion; the handler must return an
	// empty list, not error, and must default tf to "1m" when omitted.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/calendar?symbol=NQ&from=0&to=9999999999", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "[]\n" {
		t.Errorf("body = %q, want empty JSON array", got)
	}
}

func TestHandleHealthz(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
}
