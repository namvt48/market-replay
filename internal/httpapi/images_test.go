package httpapi

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

func uploadImage(t *testing.T, s *Server, sessionID string, content []byte, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("image", "shot.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write(content); err != nil {
		t.Fatalf("write form content: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/"+sessionID+"/images", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if contentType != "" {
		req.Header.Set("X-Upload-Content-Type", contentType)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func seedLiveSession(t *testing.T, s *Server) string {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"symbol": "LIVE", "tf": "1d", "startTs": 1700000000000, "kind": "live", "name": "Live"})
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewBuffer(body)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("seed live session: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return out.ID
}

func TestUploadGetDeleteJournalImage(t *testing.T) {
	s := newTestServer(t)
	sessionID := seedLiveSession(t, s)

	data := []byte{1, 2, 3, 4}
	rec := uploadImage(t, s, sessionID, data, "image/png")
	if rec.Code != http.StatusOK {
		t.Fatalf("upload = %d, want 200; body: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || out.ID == "" {
		t.Fatalf("upload response: %v body=%s", err, rec.Body.String())
	}

	get := httptest.NewRecorder()
	s.Handler().ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/api/v1/images/"+out.ID, nil))
	if get.Code != http.StatusOK {
		t.Fatalf("get = %d, want 200", get.Code)
	}
	if ct := get.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("content-type = %q, want image/png", ct)
	}
	if cl := get.Header().Get("Content-Length"); cl != strconv.Itoa(len(data)) {
		t.Fatalf("content-length = %q, want %d", cl, len(data))
	}
	if cc := get.Header().Get("Cache-Control"); cc != "private, max-age=86400" {
		t.Fatalf("cache-control = %q, want \"private, max-age=86400\"", cc)
	}
	if !bytes.Equal(get.Body.Bytes(), data) {
		t.Fatal("image bytes mismatch")
	}

	del := httptest.NewRecorder()
	s.Handler().ServeHTTP(del, httptest.NewRequest(http.MethodDelete, "/api/v1/images/"+out.ID, nil))
	if del.Code != http.StatusOK {
		t.Fatalf("delete = %d, want 200", del.Code)
	}
	gone := httptest.NewRecorder()
	s.Handler().ServeHTTP(gone, httptest.NewRequest(http.MethodGet, "/api/v1/images/"+out.ID, nil))
	if gone.Code != http.StatusNotFound {
		t.Fatalf("get after delete = %d, want 404", gone.Code)
	}
}

func TestUploadRejectsNonImage(t *testing.T) {
	s := newTestServer(t)
	sessionID := seedLiveSession(t, s)
	rec := uploadImage(t, s, sessionID, []byte("hello"), "text/plain")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("upload text/plain = %d, want 400", rec.Code)
	}
}

func TestUploadRejectsSVG(t *testing.T) {
	s := newTestServer(t)
	sessionID := seedLiveSession(t, s)
	rec := uploadImage(t, s, sessionID, []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`), "image/svg+xml")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("upload image/svg+xml = %d, want 400; body: %s", rec.Code, rec.Body.String())
	}
}

func TestUploadRejectsMissingContentType(t *testing.T) {
	s := newTestServer(t)
	sessionID := seedLiveSession(t, s)
	rec := uploadImage(t, s, sessionID, []byte{1}, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("upload with no declared content type = %d, want 400; body: %s", rec.Code, rec.Body.String())
	}
}

func TestUploadRejectsOversizedImage(t *testing.T) {
	s := newTestServer(t)
	sessionID := seedLiveSession(t, s)
	rec := uploadImage(t, s, sessionID, bytes.Repeat([]byte{7}, maxJournalImageBytes+1), "image/png")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("upload oversized = %d, want 400; body: %s", rec.Code, rec.Body.String())
	}
}

func TestUploadUnknownSession(t *testing.T) {
	s := newTestServer(t)
	rec := uploadImage(t, s, "missing", []byte{1}, "image/png")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("upload to unknown session = %d, want 404; body: %s", rec.Code, rec.Body.String())
	}
}

func TestListJournalImagesMetadata(t *testing.T) {
	s := newTestServer(t)
	sessionID := seedLiveSession(t, s)
	if rec := uploadImage(t, s, sessionID, []byte{9, 9}, "image/jpeg"); rec.Code != http.StatusOK {
		t.Fatalf("upload = %d, want 200", rec.Code)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+sessionID+"/images", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("list = %d, want 200", rec.Code)
	}
	var list []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("unmarshal list: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("len = %d, want 1", len(list))
	}
	if _, hasData := list[0]["data"]; hasData {
		t.Fatal("list must not include raw data")
	}
}
