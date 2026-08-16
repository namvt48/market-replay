package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"market-replay/internal/model"
)

// maxDrawingTemplatePayload bounds one template's JSON body. Appearance is
// a few dozen colour/flag/number fields (docs: DrawingTemplateAppearance),
// nowhere near this — it just keeps a malformed or hostile client from
// writing an unbounded blob into SQLite, same reasoning as
// maxPreferencePayload. A var, not a const, so ApplyLimits (limits.go) can
// override it from config.yaml's limits.drawing_template_payload_bytes.
var maxDrawingTemplatePayload = 64 << 10

// handleListDrawingTemplates serves GET /api/v1/drawing-templates.
func (s *Server) handleListDrawingTemplates(w http.ResponseWriter, r *http.Request) {
	templates, err := s.Store.ListDrawingTemplates(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, templates)
}

// handlePutDrawingTemplate serves PUT /api/v1/drawing-templates/{id}: the
// client (drawing toolbar) owns and supplies the id, same ownership model
// as drawings — this both creates a new template and replaces an existing
// one by id.
func (s *Server) handlePutDrawingTemplate(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" || len(id) > 128 {
		writeError(w, fmt.Errorf("%w: invalid drawing template id", errBadRequest))
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, int64(maxDrawingTemplatePayload)+1))
	if err != nil {
		writeError(w, fmt.Errorf("%w: could not read body: %v", errBadRequest, err))
		return
	}
	if len(body) > maxDrawingTemplatePayload {
		writeError(w, fmt.Errorf("%w: drawing template payload exceeds %d bytes", errBadRequest, maxDrawingTemplatePayload))
		return
	}

	var t model.DrawingTemplate
	if err := json.Unmarshal(body, &t); err != nil {
		writeError(w, fmt.Errorf("%w: invalid JSON body: %v", errBadRequest, err))
		return
	}
	t.ID = id
	if t.ToolType == "" || len(t.ToolType) > 64 {
		writeError(w, fmt.Errorf("%w: drawing template needs a toolType", errBadRequest))
		return
	}
	// 80 matches the frontend's own name length cap (drawing-templates.ts).
	if strings.TrimSpace(t.Name) == "" || len(t.Name) > 80 {
		writeError(w, fmt.Errorf("%w: drawing template needs a name", errBadRequest))
		return
	}
	if len(t.Appearance) == 0 || !json.Valid(t.Appearance) {
		writeError(w, fmt.Errorf("%w: drawing template needs a valid appearance object", errBadRequest))
		return
	}

	if err := s.Store.UpsertDrawingTemplate(r.Context(), t); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleDeleteDrawingTemplate serves DELETE /api/v1/drawing-templates/{id}.
func (s *Server) handleDeleteDrawingTemplate(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.DeleteDrawingTemplate(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
