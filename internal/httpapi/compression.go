package httpapi

import (
	"compress/gzip"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"market-replay/internal/bars"
)

// Two pools, because the right compression level is not the same for every
// response this server serves.
//
// gzipTextPool handles the embedded frontend (JS/CSS, several hundred KB
// that compress 3-4x) and non-chart JSON: served rarely, cached by the
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

// minGzipSize is a var, not a const, so ApplyLimits (limits.go) can override
// it from config.yaml's limits.gzip_min_bytes at startup.
var minGzipSize = 1 << 10

// poolForResponse routes the hot chart-bars JSON endpoint and binary RBR1
// frames to BestSpeed. Unknown/absent types keep the text level: guessing
// "fast" for real frontend assets would cost bandwidth on every load.
func poolForResponse(path, contentType string) *sync.Pool {
	if path == "/api/v1/chart-bars/at" || strings.HasPrefix(contentType, bars.ContentType) {
		return &gzipBinaryPool
	}
	return &gzipTextPool
}

// gzipResponseWriter delays its compression decision until the body crosses
// minGzipSize. It buffers at most that prefix, then streams the rest straight
// into a pooled writer; small responses never acquire a writer or grow from
// gzip headers. Pre-encoded and bodyless responses pass through unchanged.
type gzipResponseWriter struct {
	http.ResponseWriter
	requestPath string
	method      string
	gz          *gzip.Writer
	pool        *sync.Pool
	pending     []byte
	status      int
	wroteHeader bool
	decided     bool
	compress    bool
}

func (g *gzipResponseWriter) WriteHeader(status int) {
	if g.wroteHeader {
		return
	}
	g.wroteHeader = true
	g.status = status
	g.Header().Add("Vary", "Accept-Encoding")
	hasBody := g.method != http.MethodHead && status >= http.StatusOK && status != http.StatusNoContent && status != http.StatusNotModified
	if !hasBody || g.Header().Get("Content-Encoding") != "" {
		g.decided = true
		g.ResponseWriter.WriteHeader(status)
	}
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.wroteHeader {
		g.WriteHeader(http.StatusOK)
	}
	if g.decided {
		if g.compress {
			return g.gz.Write(b)
		}
		return g.ResponseWriter.Write(b)
	}

	prefix := len(g.pending)
	g.pending = append(g.pending, b...)
	if len(g.pending) <= minGzipSize {
		return len(b), nil
	}
	g.startCompression()
	written, err := g.gz.Write(g.pending)
	g.pending = nil
	current := written - prefix
	if current < 0 {
		current = 0
	}
	if current > len(b) {
		current = len(b)
	}
	return current, err
}

func (g *gzipResponseWriter) startCompression() {
	g.decided = true
	g.compress = true
	g.pool = poolForResponse(g.requestPath, g.Header().Get("Content-Type"))
	g.gz = g.pool.Get().(*gzip.Writer)
	g.gz.Reset(g.ResponseWriter)
	g.Header().Del("Content-Length")
	g.Header().Set("Content-Encoding", "gzip")
	g.ResponseWriter.WriteHeader(g.status)
}

func (g *gzipResponseWriter) flushUncompressed() {
	g.decided = true
	g.ResponseWriter.WriteHeader(g.status)
	if len(g.pending) > 0 {
		_, _ = g.ResponseWriter.Write(g.pending)
		g.pending = nil
	}
}

// release flushes and returns the writer. It is a no-op for a response that
// never compressed — which matters: Close() on an unused gzip.Writer still
// emits a valid empty-gzip footer straight to the underlying writer,
// corrupting a passthrough body (pre-encoded content, or a No
// Content/Not Modified status) that never wrote a byte through gz.
func (g *gzipResponseWriter) release() {
	if g.wroteHeader && !g.decided {
		g.flushUncompressed()
	}
	if g.gz == nil {
		return
	}
	_ = g.gz.Close()
	g.pool.Put(g.gz)
	g.gz = nil
}

func acceptsGzip(header string) bool {
	explicitSeen, explicitAccepted := false, false
	wildcardSeen, wildcardAccepted := false, false
	for _, item := range strings.Split(header, ",") {
		parts := strings.Split(item, ";")
		name := strings.ToLower(strings.TrimSpace(parts[0]))
		if name != "gzip" && name != "*" {
			continue
		}
		quality := 1.0
		valid := true
		for _, parameter := range parts[1:] {
			keyValue := strings.SplitN(strings.TrimSpace(parameter), "=", 2)
			if len(keyValue) != 2 || !strings.EqualFold(strings.TrimSpace(keyValue[0]), "q") {
				continue
			}
			parsed, err := strconv.ParseFloat(strings.Trim(strings.TrimSpace(keyValue[1]), `"`), 64)
			if err != nil || parsed < 0 || parsed > 1 {
				valid = false
				break
			}
			quality = parsed
		}
		accepted := valid && quality > 0
		if name == "gzip" {
			explicitSeen = true
			explicitAccepted = accepted
		} else {
			wildcardSeen = true
			wildcardAccepted = accepted
		}
	}
	if explicitSeen {
		return explicitAccepted
	}
	return wildcardSeen && wildcardAccepted
}

// withCompression gzips every response the client says it accepts, unless
// the handler already set its own Content-Encoding.
func withCompression(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !acceptsGzip(r.Header.Get("Accept-Encoding")) {
			next.ServeHTTP(w, r)
			return
		}
		gzw := &gzipResponseWriter{ResponseWriter: w, requestPath: r.URL.Path, method: r.Method}
		defer gzw.release()
		next.ServeHTTP(gzw, r)
	})
}
