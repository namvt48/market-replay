package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const barFramePath = "/api/v1/bars/at?symbol=NQ&tf=1m&at=1600000600&before=5&after=5"

func getBarFrame(t *testing.T, s *Server, ifNoneMatch string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, barFramePath, nil)
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

// TestBarFrameRevalidates — bar frames were sent as
// "public, max-age=31536000, immutable", but SIGHUP reloads a dataset in
// place, so the same URL can legitimately return different bars. With no
// validator a client could never find out, and would keep serving pre-reload
// bars from its own cache indefinitely.
func TestBarFrameRevalidates(t *testing.T) {
	s := newTestServer(t)

	first := getBarFrame(t, s, "")
	if first.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", first.Code, first.Body.String())
	}
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("no ETag on a bar frame")
	}
	if control := first.Header().Get("Cache-Control"); strings.Contains(control, "immutable") {
		t.Errorf("Cache-Control = %q; the bytes behind this URL change on a dataset reload", control)
	}
	if first.Body.Len() == 0 {
		t.Fatal("empty frame body")
	}

	// An unchanged dataset costs the client nothing beyond the round trip.
	again := getBarFrame(t, s, etag)
	if again.Code != http.StatusNotModified {
		t.Fatalf("status = %d with a current validator, want 304 (%s)", again.Code, again.Body.String())
	}
	if again.Body.Len() != 0 {
		t.Errorf("304 carried a %d-byte body", again.Body.Len())
	}

	// The list and wildcard forms of If-None-Match are legal too.
	if rec := getBarFrame(t, s, `W/"nonsense", `+etag); rec.Code != http.StatusNotModified {
		t.Errorf("status = %d for a validator list containing the current tag, want 304", rec.Code)
	}
	if rec := getBarFrame(t, s, "*"); rec.Code != http.StatusNotModified {
		t.Errorf("status = %d for If-None-Match: *, want 304", rec.Code)
	}
	if rec := getBarFrame(t, s, `W/"stale"`); rec.Code != http.StatusOK {
		t.Errorf("status = %d for a stale validator, want 200", rec.Code)
	}
}

// TestBarFrameValidatorChangesAfterReload is the point of the validator: a
// client holding a cached frame has to be told when the dataset underneath it
// was replaced.
func TestBarFrameValidatorChangesAfterReload(t *testing.T) {
	s, dataDir := newTestServerWithDataDir(t)

	before := getBarFrame(t, s, "")
	etag := before.Header().Get("ETag")
	if etag == "" {
		t.Fatal("no ETag before reload")
	}

	// Same window, different bars — a corrected rsync of the dataset.
	writeBinFixture(t, dataDir, "NQ", "1m", testFixtureN+4, testFixtureStart)
	if errs := s.Registry.Reload(); len(errs) != 0 {
		t.Fatalf("reload: %v", errs)
	}

	after := getBarFrame(t, s, etag)
	if after.Code != http.StatusOK {
		t.Fatalf("status = %d after the dataset was replaced, want 200 — the client would keep its stale copy", after.Code)
	}
	if newETag := after.Header().Get("ETag"); newETag == etag {
		t.Fatalf("ETag is still %q after a reload that changed the data", newETag)
	}
}

// TestBarRangeFrameRevalidates covers the other frame endpoint, which shared
// the same immutable header.
func TestBarRangeFrameRevalidates(t *testing.T) {
	s := newTestServer(t)
	path := "/api/v1/bars?symbol=NQ&tf=1m&from=1600000000&to=1600000600"

	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("no ETag on a range frame")
	}

	req2 := httptest.NewRequest(http.MethodGet, path, nil)
	req2.Header.Set("If-None-Match", etag)
	rec2 := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusNotModified {
		t.Fatalf("status = %d with a current validator, want 304", rec2.Code)
	}
}
