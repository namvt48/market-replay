package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"

	"market-replay/internal/model"
)

// maxWorkspaceSnapshotPayload bounds one snapshot's JSON body (after gzip
// decompression, if any — see readLimitedBody). A full chart layout plus
// per-symbol drawings, fills, and indicators is generous but bounded; this
// just keeps a malformed or hostile client from writing an unbounded blob.
const maxWorkspaceSnapshotPayload = 4 << 20

// localUserID is the fixed owner for every row this single-user product
// writes. There is no auth anywhere in this codebase (PRODUCT.md: "This is
// a single-user product... No ... auth ... multi-user behavior... in the
// MVP") — the architecture doc's own multi-user plan
// (.omo/plans/architecture/07-qa-decisions.md) is "add user_id to 3 tables
// + auth middleware" later. This column exists now so that later step is
// additive, not a migration.
const localUserID = "local"

// workspaceSnapshotWire is the subset of the frontend's
// SessionWorkspaceSnapshot (web/src/replay/session-workspace-snapshot.ts)
// the server needs to read — everything else (layout, viewports,
// drawings, fills, indicators, preferences) is opaque and stored verbatim
// as the payload column, the same treatment Drawing.Payload and
// preferences get.
type workspaceSnapshotWire struct {
	Version int `json:"version"`
	Owner   struct {
		Kind string `json:"kind"`
		ID   string `json:"id"`
	} `json:"owner"`
	Reason     string `json:"reason"`
	CapturedAt int64  `json:"capturedAt"`
	CursorTs   int64  `json:"cursorTs"`
}

type workspaceSnapshotAck struct {
	Revision   int   `json:"revision"`
	CapturedAt int64 `json:"capturedAt"`
}

// wireReasonToCanonical translates the frontend's hyphenated reason
// spelling ("trade-close"/"explicit-exit") to the DB/API canonical,
// underscored form the schema was specified with. Returns "", false for
// anything else.
func wireReasonToCanonical(reason string) (string, bool) {
	switch reason {
	case "trade-close":
		return model.WorkspaceSnapshotReasonTradeClose, true
	case "explicit-exit":
		return model.WorkspaceSnapshotReasonExplicitExit, true
	default:
		return "", false
	}
}

// validOwnerID keeps owner ids to the charset this product's ids already
// use (UUIDs for sessions, "eval-<symbol>-<timestamp>" for eval accounts)
// — same shape as preferences.go's validPreferenceKey, kept separate
// since it validates a different concept.
func validOwnerID(id string) bool {
	if id == "" || len(id) > 128 {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == ':' || r == '-' || r == '_' || r == '.':
		default:
			return false
		}
	}
	return true
}

// validateWorkspaceSnapshotOwner checks ownerType/ownerId at the HTTP
// boundary before any storage call. "replay" owners must be a real
// sessions.id (storage.ErrSessionNotFound -> 404); "eval" owners have no
// server-side table to check against (eval accounts are purely
// client-side — web/src/store/eval-store.ts) so only their format is
// validated. This is requirement 4's "ownership" check in a single-user,
// no-auth product: it degrades to "does this owner exist / look real",
// not a cross-user identity check.
func (s *Server) validateWorkspaceSnapshotOwner(r *http.Request, ownerType, ownerID string) error {
	if !validOwnerID(ownerID) {
		return fmt.Errorf("%w: invalid owner id", errBadRequest)
	}
	switch ownerType {
	case "replay":
		if _, err := s.Store.GetSession(r.Context(), ownerID); err != nil {
			return err
		}
		return nil
	case "eval":
		return nil
	default:
		return fmt.Errorf("%w: unknown owner type %q", errBadRequest, ownerType)
	}
}

// handlePutWorkspaceSnapshot serves PUT
// /api/v1/workspace-snapshots/{ownerType}/{ownerId}. The body is the
// frontend's SessionWorkspaceSnapshot object, stored verbatim; only the
// version/owner/reason/capturedAt/cursorTs fields are inspected for
// validation and the optimistic-concurrency rank rule (docs: see
// storage/sqlite/workspace_snapshots.go's compareWorkspaceSnapshotRank).
func (s *Server) handlePutWorkspaceSnapshot(w http.ResponseWriter, r *http.Request) {
	ownerType := r.PathValue("ownerType")
	ownerID := r.PathValue("ownerId")
	if err := s.validateWorkspaceSnapshotOwner(r, ownerType, ownerID); err != nil {
		writeError(w, err)
		return
	}

	body, err := readLimitedBody(r, maxWorkspaceSnapshotPayload)
	if err != nil {
		writeError(w, err)
		return
	}

	var wire workspaceSnapshotWire
	if err := json.Unmarshal(body, &wire); err != nil {
		writeError(w, fmt.Errorf("%w: invalid JSON body: %v", errBadRequest, err))
		return
	}
	if wire.Version != 1 {
		writeError(w, fmt.Errorf("%w: unsupported snapshot version %d", errBadRequest, wire.Version))
		return
	}
	if wire.Owner.Kind != ownerType || wire.Owner.ID != ownerID {
		writeError(w, fmt.Errorf("%w: snapshot owner does not match the request URL", errBadRequest))
		return
	}
	canonicalReason, ok := wireReasonToCanonical(wire.Reason)
	if !ok {
		writeError(w, fmt.Errorf("%w: invalid snapshot reason %q", errBadRequest, wire.Reason))
		return
	}
	if wire.CapturedAt < 0 || wire.CursorTs < 0 {
		writeError(w, fmt.Errorf("%w: capturedAt and cursorTs must be nonnegative", errBadRequest))
		return
	}

	persisted, accepted, err := s.Store.PutWorkspaceSnapshot(r.Context(), model.WorkspaceSnapshot{
		UserID: localUserID, OwnerType: ownerType, OwnerID: ownerID,
		Reason: canonicalReason, CursorTs: wire.CursorTs, Version: wire.Version,
		Payload: json.RawMessage(body), CapturedAt: wire.CapturedAt,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	ack := workspaceSnapshotAck{Revision: persisted.Revision, CapturedAt: persisted.CapturedAt}
	if !accepted {
		writeJSON(w, http.StatusConflict, ack)
		return
	}
	writeJSON(w, http.StatusOK, ack)
}

// handleGetWorkspaceSnapshot serves GET
// /api/v1/workspace-snapshots/{ownerType}/{ownerId}. The response wraps
// the verbatim stored payload with the server-owned revision/capturedAt
// the frontend needs for its local-vs-remote reconciliation — those two
// fields aren't part of the frontend's own SessionWorkspaceSnapshot type,
// so they travel alongside it rather than being injected into it.
func (s *Server) handleGetWorkspaceSnapshot(w http.ResponseWriter, r *http.Request) {
	ownerType := r.PathValue("ownerType")
	ownerID := r.PathValue("ownerId")
	if err := s.validateWorkspaceSnapshotOwner(r, ownerType, ownerID); err != nil {
		writeError(w, err)
		return
	}

	snap, err := s.Store.GetWorkspaceSnapshot(r.Context(), localUserID, ownerType, ownerID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Revision   int             `json:"revision"`
		CapturedAt int64           `json:"capturedAt"`
		Snapshot   json.RawMessage `json:"snapshot"`
	}{Revision: snap.Revision, CapturedAt: snap.CapturedAt, Snapshot: snap.Payload})
}

// handleDeleteWorkspaceSnapshot serves DELETE
// /api/v1/workspace-snapshots/{ownerType}/{ownerId}. Deliberately skips
// the "replay owner must be a real session" existence check the other two
// handlers apply: a snapshot must stay deletable even after its session
// has already been removed, or a client could never clear an orphaned
// row. Format validation on ownerID still applies.
func (s *Server) handleDeleteWorkspaceSnapshot(w http.ResponseWriter, r *http.Request) {
	ownerType := r.PathValue("ownerType")
	ownerID := r.PathValue("ownerId")
	if !validOwnerID(ownerID) {
		writeError(w, fmt.Errorf("%w: invalid owner id", errBadRequest))
		return
	}
	if ownerType != "replay" && ownerType != "eval" {
		writeError(w, fmt.Errorf("%w: unknown owner type %q", errBadRequest, ownerType))
		return
	}
	if err := s.Store.DeleteWorkspaceSnapshot(r.Context(), localUserID, ownerType, ownerID); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
