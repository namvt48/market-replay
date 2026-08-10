package httpapi

import (
	"compress/gzip"
	"net/http"
	"strings"
	"sync"

	"market-replay/internal/bars"
)

// Two pools, because the right compression level is not the same for every
// response this server serves.
//
// gzipTextPool handles the embedded frontend (JS/CSS, several hundred KB
// that compress 3-4x) and every JSON body: served rarely, cached by the
// browser afterwards, and dominated by transfer size rather than CPU.
//
// gzipBinaryPool handles the RBR1 bar frame, which is six int32 columns and
// behaves completely differently. Measured on a 20,000-bar /bars/at
// response (480 KB raw): the default level costs 18.6 ms of CPU to reach
// 246 KB, against 0.65 ms to serve it uncompressed. BestSpeed gets most of
// that reduction back for a fraction of the CPU — the right end of the
// trade for a body the replay engine fetches on every seek.
var (
	gzipTextPool   = sync.Pool{New: func() any { return gzip.NewWriter(nil) }}
	gzipBinaryPool = sync.Pool{New: func() any { w, _ := gzip.NewWriterLevel(nil, gzip.BestSpeed); return w }}
)

// poolForContentType routes a response to the pool whose level suits its
// body. Unknown/absent types get the text level: a wrong guess there costs
// CPU on a small body, while guessing "fast" for real text would cost
// bandwidth on every asset.
func poolForContentType(contentType string) *sync.Pool {
	if strings.HasPrefix(contentType, bars.ContentType) {
		return &gzipBinaryPool
	}
	return &gzipTextPool
}

// gzipResponseWriter buffers nothing — it streams straight into a pooled
// gzip.Writer — but must intercept WriteHeader to drop Content-Length
// (compression changes the byte count) and skip wrapping entirely when a
// handler already picked its own encoding. No handler does today; the guard
// stays because re-gzipping an already-encoded body corrupts it, and that
// is not a failure mode worth rediscovering later.
//
// The writer is acquired inside WriteHeader rather than up front because
// that is the first moment Content-Type is known — and therefore the first
// moment the compression level can be chosen. A response that never
// compresses never takes a writer out of a pool at all.
type gzipResponseWriter struct {
	http.ResponseWriter
	gz          *gzip.Writer
	pool        *sync.Pool
	wroteHeader bool
	compress    bool
}

func (g *gzipResponseWriter) WriteHeader(status int) {
	if !g.wroteHeader {
		g.wroteHeader = true
		hasBody := status != http.StatusNoContent && status != http.StatusNotModified
		if hasBody && g.Header().Get("Content-Encoding") == "" {
			g.compress = true
			g.pool = poolForContentType(g.Header().Get("Content-Type"))
			g.gz = g.pool.Get().(*gzip.Writer)
			g.gz.Reset(g.ResponseWriter)
			g.Header().Del("Content-Length")
			g.Header().Set("Content-Encoding", "gzip")
		}
		g.Header().Add("Vary", "Accept-Encoding")
	}
	g.ResponseWriter.WriteHeader(status)
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.wroteHeader {
		g.WriteHeader(http.StatusOK)
	}
	if !g.compress {
		return g.ResponseWriter.Write(b)
	}
	return g.gz.Write(b)
}

// release flushes and returns the writer. It is a no-op for a response that
// never compressed — which matters: Close() on an unused gzip.Writer still
// emits a valid empty-gzip footer straight to the underlying writer,
// corrupting a passthrough body (pre-encoded content, or a No
// Content/Not Modified status) that never wrote a byte through gz.
func (g *gzipResponseWriter) release() {
	if g.gz == nil {
		return
	}
	_ = g.gz.Close()
	g.pool.Put(g.gz)
	g.gz = nil
}

// withCompression gzips every response the client says it accepts, unless
// the handler already set its own Content-Encoding.
func withCompression(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		gzw := &gzipResponseWriter{ResponseWriter: w}
		defer gzw.release()
		next.ServeHTTP(gzw, r)
	})
}
