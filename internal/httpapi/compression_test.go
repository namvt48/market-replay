package httpapi

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"market-replay/internal/bars"
)

func TestWithCompression_GzipsJSONWhenAccepted(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/symbols", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if got := rec.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Errorf("Vary = %q, want Accept-Encoding", got)
	}
	if rec.Header().Get("Content-Length") != "" {
		t.Errorf("Content-Length = %q, want unset once compressed (size changed)", rec.Header().Get("Content-Length"))
	}

	reader, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatalf("response body is not valid gzip: %v", err)
	}
	defer reader.Close()
	decoded, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("decompress: %v", err)
	}
	if !bytes.Contains(decoded, []byte(`"symbol":"NQ"`)) {
		t.Errorf("decompressed body missing expected content: %s", decoded)
	}
}

func TestWithCompression_SkipsWhenNotAccepted(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/symbols", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("Content-Encoding = %q, want unset when client sent no Accept-Encoding", got)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"symbol":"NQ"`)) {
		t.Errorf("body missing expected content: %s", rec.Body.String())
	}
}

// TestWithCompression_DoesNotDoubleCompressPreEncoded exercises the same
// header-ordering a pre-encoded handler relies on (Content-Encoding set before
// WriteHeader) without needing a real .bin.zst fixture on disk: any
// handler that picks its own encoding first must pass through untouched.
func TestWithCompression_DoesNotDoubleCompressPreEncoded(t *testing.T) {
	preEncoded := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Encoding", "zstd")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("already-compressed-bytes"))
	})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	withCompression(preEncoded).ServeHTTP(rec, req)

	if got := rec.Header().Get("Content-Encoding"); got != "zstd" {
		t.Fatalf("Content-Encoding = %q, want zstd (must not be overwritten/re-gzipped)", got)
	}
	if rec.Body.String() != "already-compressed-bytes" {
		t.Fatalf("body = %q, want passthrough unchanged", rec.Body.String())
	}
}

func TestWithCompression_NoContentEncodingOnEmptyBodyStatus(t *testing.T) {
	s := newTestServer(t)
	body := `{"symbol":"NQ","tf":"1m","startTs":1600000000,"config":{}}`
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewBufferString(body))
	createRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(createRec, createReq)
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/sessions/"+created.ID, nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding = %q, want unset on a 204 (no body to encode)", got)
	}
}

func TestWithStaticCacheControl_AssetsAreImmutableRestIsNoCache(t *testing.T) {
	fsys := fstest.MapFS{
		"index.html":      {Data: []byte("<html>app shell</html>")},
		"assets/index.js": {Data: []byte("console.log(1)")},
		"favicon.svg":     {Data: []byte("<svg/>")},
	}
	s := &Server{WebFS: fsys}

	for path, want := range map[string]string{
		"/":                "no-cache",
		"/favicon.svg":     "no-cache",
		"/assets/index.js": "public, max-age=31536000, immutable",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		if got := rec.Header().Get("Cache-Control"); got != want {
			t.Errorf("%s: Cache-Control = %q, want %q", path, got, want)
		}
	}
}

func TestHandleSPA_NoCache(t *testing.T) {
	fsys := fstest.MapFS{"index.html": {Data: []byte("<html>eval shell</html>")}}
	s := &Server{WebFS: fsys}
	req := httptest.NewRequest(http.MethodGet, "/start/eval", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache", got)
	}
}

// TestCompressionLevelByContentType pins the level routing: the RBR1 bar
// frame gets the cheap level (it is int32 columns fetched on every seek),
// everything else keeps the ratio-optimised default.
func TestCompressionLevelByContentType(t *testing.T) {
	if got := poolForContentType(bars.ContentType); got != &gzipBinaryPool {
		t.Errorf("bar frame routed to the text pool")
	}
	for _, contentType := range []string{"application/json", "text/html; charset=utf-8", "text/css", ""} {
		if got := poolForContentType(contentType); got != &gzipTextPool {
			t.Errorf("%q routed to the binary pool", contentType)
		}
	}
}
