package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"market-replay/internal/indicators"
	"market-replay/internal/model"
)

// runIndicatorBody issues one indicator run and returns the response body,
// failing the test on any non-200.
func runIndicatorBody(t *testing.T, s *Server, script, tf string, at int64) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, testRunURL("NQ", script, at, "&tf="+tf), nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("tf=%s at=%d: status = %d, body = %s", tf, at, rec.Code, rec.Body.String())
	}
	return rec.Body.String()
}

// TestRunIndicatorIsStableWithinADisplayBucket is the observable half of
// quantizeToClosedBucket: on a display timeframe every cursor inside one
// still-forming bucket has to produce the same answer, because that is what
// makes the run cacheable for the whole bucket instead of recomputed on every
// replayed minute. The next bucket must still differ, or the test would pass
// just as well against a handler that ignored `at` entirely.
//
// Only these two scripts are exercised because they are the only builtins the
// shared fixture can drive: its 20 bars are a monotonic ramp inside a single
// NY morning, which gives fractals no swing to find, day-separator and
// ipda-ranges no day boundary to cross, and gb69-cbmor no completed session.
func TestRunIndicatorIsStableWithinADisplayBucket(t *testing.T) {
	s := newTestServer(t)
	// The fixture's bars are 1m apart from 1_600_000_000, so on a 15m grid
	// (bucket = ts/900*900) bars 4..18 all sit inside [1600000200,1600001100)
	// and bar 19 opens the next one.
	bar := func(index int) int64 { return int64(testFixtureStart) + int64(index)*60 }

	for _, script := range []string{"killzones", "open-price-markers"} {
		t.Run(script, func(t *testing.T) {
			early := runIndicatorBody(t, s, script, "15m", bar(6))
			late := runIndicatorBody(t, s, script, "15m", bar(17))
			if early != late {
				t.Fatalf("two cursors inside one 15m bucket returned different results\nearly=%s\n late=%s", early, late)
			}
			next := runIndicatorBody(t, s, script, "15m", bar(19))
			if next == early {
				t.Fatalf("crossing into the next 15m bucket did not change the result (%s); `at` is being ignored", next)
			}
		})
	}
}

// TestRunIndicatorOneMinuteIsNotQuantized pins the deliberate asymmetry: on
// 1m the display bar is the replay bar, so quantizing would drop the cursor's
// own bar for no cacheability gain — consecutive cursors must still differ.
func TestRunIndicatorOneMinuteIsNotQuantized(t *testing.T) {
	s := newTestServer(t)
	bar := func(index int) int64 { return int64(testFixtureStart) + int64(index)*60 }

	first := runIndicatorBody(t, s, "killzones", "1m", bar(12))
	second := runIndicatorBody(t, s, "killzones", "1m", bar(13))
	if first == second {
		t.Fatalf("consecutive 1m cursors returned identical results (%s); 1m must not be quantized", first)
	}
}

func TestQuantizeToClosedBucket(t *testing.T) {
	meta := model.SymbolMeta{Symbol: "NQ", TickSize: 0.25, PointValue: 20}
	// 1_600_000_600 is 12:36:40Z; its 15m bucket opens at 1_600_000_200.
	const cursor = int64(1_600_000_600)
	const bucketStart = int64(1_600_000_200)

	got, err := quantizeToClosedBucket(meta, "15m", indicators.RunParams{At: cursor, MaxTs: cursor, Before: 1500})
	if err != nil {
		t.Fatalf("quantizeToClosedBucket: %v", err)
	}
	if got.At != bucketStart-1 {
		t.Fatalf("At = %d, want %d (one second before the forming bucket opened)", got.At, bucketStart-1)
	}
	if got.MaxTs != bucketStart-1 {
		t.Fatalf("MaxTs = %d, want %d — the spoiler bound must move with the cursor", got.MaxTs, bucketStart-1)
	}
	if got.Before != 1500 {
		t.Fatalf("Before = %d, want it untouched at 1500", got.Before)
	}
}

// TestQuantizeToClosedBucketNeverAdvancesTheSpoilerBound is the safety half:
// quantizing may only ever show less than the caller allowed, never more.
func TestQuantizeToClosedBucketNeverAdvancesTheSpoilerBound(t *testing.T) {
	meta := model.SymbolMeta{Symbol: "NQ", TickSize: 0.25, PointValue: 20}
	for _, cursor := range []int64{1_600_000_000, 1_600_000_200, 1_600_000_201, 1_600_001_099, 1_600_001_100} {
		for _, tf := range []string{"5m", "15m", "1h", "1d"} {
			params := indicators.RunParams{At: cursor, MaxTs: cursor, Before: 1500}
			got, err := quantizeToClosedBucket(meta, tf, params)
			if err != nil {
				t.Fatalf("tf=%s cursor=%d: %v", tf, cursor, err)
			}
			if got.At > params.At {
				t.Fatalf("tf=%s cursor=%d: At advanced from %d to %d", tf, cursor, params.At, got.At)
			}
			if got.MaxTs > params.MaxTs {
				t.Fatalf("tf=%s cursor=%d: MaxTs advanced from %d to %d — a replay spoiler", tf, cursor, params.MaxTs, got.MaxTs)
			}
		}
	}
}
