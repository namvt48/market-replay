package httpapi

import (
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
)

// readLimitedBody reads r's body, transparently decompressing it first if
// the client sent Content-Encoding: gzip, and bounds the DEcompressed size
// to maxSize — bounding the compressed size instead would let a small
// request expand into an unbounded write (a zip bomb) once decompressed.
// No endpoint in this codebase decompresses a request body today (the
// existing compression.go only compresses responses); this is the first.
func readLimitedBody(r *http.Request, maxSize int) ([]byte, error) {
	reader := io.Reader(r.Body)
	if r.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(r.Body)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid gzip body: %v", errBadRequest, err)
		}
		defer gz.Close()
		reader = gz
	}

	body, err := io.ReadAll(io.LimitReader(reader, int64(maxSize)+1))
	if err != nil {
		return nil, fmt.Errorf("%w: could not read body: %v", errBadRequest, err)
	}
	if len(body) > maxSize {
		return nil, fmt.Errorf("%w: request payload exceeds %d bytes", errBadRequest, maxSize)
	}
	return body, nil
}
