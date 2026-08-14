package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"market-replay/internal/model"
)

func putDrawingTemplate(t *testing.T, s *Server, id, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/drawing-templates/"+id, bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func TestDrawingTemplates_RoundTripAndOverwrite(t *testing.T) {
	s := newTestServer(t)

	body := `{"toolType":"trend-line","name":"My Line","appearance":{"strokeColor":"#ff0000"},"createdAt":1000,"updatedAt":1000}`
	if rec := putDrawingTemplate(t, s, "t1", body); rec.Code != http.StatusNoContent {
		t.Fatalf("put status = %d, body = %s", rec.Code, rec.Body.String())
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/drawing-templates", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got []model.DrawingTemplate
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode list: %v (body %s)", err, rec.Body.String())
	}
	if len(got) != 1 || got[0].ID != "t1" || got[0].Name != "My Line" {
		t.Fatalf("got = %+v, unexpected", got)
	}

	overwrite := `{"toolType":"trend-line","name":"Renamed","appearance":{"strokeColor":"#00ff00"},"createdAt":1000,"updatedAt":2000}`
	if rec := putDrawingTemplate(t, s, "t1", overwrite); rec.Code != http.StatusNoContent {
		t.Fatalf("overwrite status = %d, body = %s", rec.Code, rec.Body.String())
	}
	rec2 := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/api/v1/drawing-templates", nil))
	if err := json.Unmarshal(rec2.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(got) != 1 || got[0].Name != "Renamed" {
		t.Fatalf("overwrite lost or duplicated: %+v", got)
	}
}

func TestDrawingTemplates_Delete(t *testing.T) {
	s := newTestServer(t)
	putDrawingTemplate(t, s, "t1", `{"toolType":"trend-line","name":"My Line","appearance":{},"createdAt":1,"updatedAt":1}`)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/drawing-templates/t1", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, body = %s", rec.Code, rec.Body.String())
	}
	// Deleting an id that was never stored is a no-op, not a 404.
	rec2 := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec2, httptest.NewRequest(http.MethodDelete, "/api/v1/drawing-templates/never-stored", nil))
	if rec2.Code != http.StatusNoContent {
		t.Fatalf("delete unknown status = %d", rec2.Code)
	}

	listRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(listRec, httptest.NewRequest(http.MethodGet, "/api/v1/drawing-templates", nil))
	if strings.Contains(listRec.Body.String(), "My Line") {
		t.Errorf("deleted template still listed: %s", listRec.Body.String())
	}
}

func TestDrawingTemplates_RejectsBadInput(t *testing.T) {
	s := newTestServer(t)

	if rec := putDrawingTemplate(t, s, "t1", `{"toolType":"trend-line"`); rec.Code != http.StatusBadRequest {
		t.Errorf("malformed JSON status = %d, want 400", rec.Code)
	}
	if rec := putDrawingTemplate(t, s, "t1", `{"toolType":"","name":"x","appearance":{}}`); rec.Code != http.StatusBadRequest {
		t.Errorf("missing toolType status = %d, want 400", rec.Code)
	}
	if rec := putDrawingTemplate(t, s, "t1", `{"toolType":"trend-line","name":"  ","appearance":{}}`); rec.Code != http.StatusBadRequest {
		t.Errorf("blank name status = %d, want 400", rec.Code)
	}
	if rec := putDrawingTemplate(t, s, "t1", `{"toolType":"trend-line","name":"x"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("missing appearance status = %d, want 400", rec.Code)
	}
}

func TestDrawingTemplates_DuplicateNamePerToolIs400(t *testing.T) {
	s := newTestServer(t)

	if rec := putDrawingTemplate(t, s, "t1", `{"toolType":"trend-line","name":"Same","appearance":{},"createdAt":1,"updatedAt":1}`); rec.Code != http.StatusNoContent {
		t.Fatalf("first put status = %d", rec.Code)
	}
	rec := putDrawingTemplate(t, s, "t2", `{"toolType":"trend-line","name":"Same","appearance":{},"createdAt":2,"updatedAt":2}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("duplicate name status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestDrawingTemplates_EmptyListIsAnArray(t *testing.T) {
	s := newTestServer(t)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/drawing-templates", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != "[]" {
		t.Errorf("body = %s, want []", got)
	}
}
