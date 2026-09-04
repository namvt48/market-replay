package httpapi

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"market-replay/internal/model"
)

// maxJournalImageBytes caps one uploaded journal screenshot. 10 MB is
// generous for a canvas capture (a 4K PNG is ~2-3 MB) while bounding what a
// single request can push into the journal_images BLOB table. A const, not
// a Limits var: the screenshot cap is a storage-shape decision, not a
// per-install tuning knob.
const maxJournalImageBytes = 10 << 20

// journalImageContentTypes is the raster-only allowlist for uploads. The
// gate is an allowlist, not an image/* prefix check, because image/* admits
// image/svg+xml, which can carry scripts and would be served back
// same-origin by the GET handler (stored XSS). Screenshots only ever need
// raster types, so the accepted set is closed.
var journalImageContentTypes = []string{"image/png", "image/jpeg", "image/gif", "image/webp"}

func isJournalImageContentType(contentType string) bool {
	for _, allowed := range journalImageContentTypes {
		// Exact match on the declared value (case-insensitive): parameters
		// are not stripped, since none of the allowed types takes one and a
		// suffixed value is no longer an exact declaration.
		if strings.EqualFold(contentType, allowed) {
			return true
		}
	}
	return false
}

// handleUploadJournalImage serves POST /api/v1/sessions/{id}/images: a
// multipart form whose "image" part holds one screenshot. An upload to an
// unknown session id is a 404 — the existence check runs first, so the
// session_id FK failure never surfaces as a 500. Returns
// {"id": ...} — the server assigns the id (uuid, the codebase's single id
// generator; storage/sqlite's CreateSession uses the same, and v4 is 16
// crypto/rand bytes rendered as hex), so clients never choose identity,
// matching the create-session contract.
func (s *Server) handleUploadJournalImage(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")
	if _, err := s.Store.GetSession(r.Context(), sessionID); err != nil {
		writeError(w, err)
		return
	}
	// ParseMultipartForm spools parts larger than its in-memory threshold to
	// temp files, so without this cap the handler would only reject AFTER the
	// full (unbounded) body was consumed and spooled — and the server sets no
	// ReadTimeout/WriteTimeout, so a slow client could pin connections and
	// exhaust disk. MaxBytesReader fails the read at the cap instead.
	r.Body = http.MaxBytesReader(w, r.Body, maxJournalImageBytes+1<<20)
	if err := r.ParseMultipartForm(maxJournalImageBytes + 1<<20); err != nil {
		writeError(w, fmt.Errorf("%w: invalid multipart body: %v", errBadRequest, err))
		return
	}
	file, header, err := r.FormFile("image")
	if err != nil {
		writeError(w, fmt.Errorf("%w: missing \"image\" file part: %v", errBadRequest, err))
		return
	}
	defer file.Close()

	// The part header carries the client's declared file type (browser
	// FormData stamps image/png from File.type). Clients that don't declare
	// one — including multipart.Writer.CreateFormFile, the harness the
	// upload flow's tests use — send the generic application/octet-stream,
	// which declares nothing, so treat it like an empty value and fall back
	// to the X-Upload-Content-Type header sent alongside the request. The
	// raster allowlist below applies to whichever source wins; this fallback
	// never widens what is accepted.
	contentType := header.Header.Get("Content-Type")
	if contentType == "" || strings.EqualFold(contentType, "application/octet-stream") {
		contentType = r.Header.Get("X-Upload-Content-Type")
	}
	if !isJournalImageContentType(contentType) {
		writeError(w, fmt.Errorf("%w: content type %q, want one of %s", errBadRequest, contentType, strings.Join(journalImageContentTypes, ", ")))
		return
	}

	// Both checks stay even though header.Size alone looks sufficient: Size
	// comes from the multipart parser's own accounting, while the
	// LimitReader bounds what this handler actually allocates, so a part
	// that misreports its size still cannot overrun the cap.
	if header.Size > maxJournalImageBytes {
		writeError(w, fmt.Errorf("%w: image exceeds %d bytes", errBadRequest, maxJournalImageBytes))
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, maxJournalImageBytes+1))
	if err != nil {
		writeError(w, fmt.Errorf("%w: could not read image part: %v", errBadRequest, err))
		return
	}
	if len(data) > maxJournalImageBytes {
		writeError(w, fmt.Errorf("%w: image exceeds %d bytes", errBadRequest, maxJournalImageBytes))
		return
	}

	img := model.JournalImage{
		ID:        "img_" + uuid.NewString(),
		SessionID: sessionID,
		Mime:      contentType,
		Size:      int64(len(data)),
		Data:      data,
		CreatedAt: time.Now(),
	}
	if err := s.Store.SaveJournalImage(r.Context(), img); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": img.ID})
}

// handleGetJournalImage serves GET /api/v1/images/{id}: the raw BLOB under
// its stored mime type. A missing id is a 404 — storage.ErrJournalImageNotFound
// is mapped by respond.go's sentinel table. Cache-Control is private —
// screenshots belong to one trader's journal, so shared caches must never
// store them.
func (s *Server) handleGetJournalImage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	img, err := s.Store.GetJournalImage(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", img.Mime)
	w.Header().Set("Content-Length", strconv.Itoa(len(img.Data)))
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(img.Data)
}

// handleListJournalImages serves GET /api/v1/sessions/{id}/images: metadata
// only, oldest-first (the store's ORDER BY created_at, id contract — the id
// tie-break keeps same-millisecond uploads deterministic). The list query
// never loads BLOB bytes, and model.JournalImage.Data is json:"-", so raw
// image data cannot reach the response.
func (s *Server) handleListJournalImages(w http.ResponseWriter, r *http.Request) {
	imgs, err := s.Store.ListJournalImages(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, imgs)
}

// handleDeleteJournalImage serves DELETE /api/v1/images/{id} ->
// {"deleted": id}; deleting an id that does not exist is a 404, not a
// silent success (storage.ErrJournalImageNotFound via writeError).
func (s *Server) handleDeleteJournalImage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.Store.DeleteJournalImage(r.Context(), id); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"deleted": id})
}
