package model

import "encoding/json"

// Reason values for WorkspaceSnapshot — the DB/API canonical spelling.
// The frontend's own SessionWorkspaceSnapshot type spells these with
// hyphens ("trade-close"/"explicit-exit"); the httpapi layer translates at
// the boundary.
const (
	WorkspaceSnapshotReasonTradeClose   = "trade_close"
	WorkspaceSnapshotReasonExplicitExit = "explicit_exit"
)

// WorkspaceSnapshot is the durable, one-per-owner recovery point for a
// replay or eval session's full workspace state (chart layout, drawings,
// fills, indicators — see the frontend's SessionWorkspaceSnapshot, which
// this opaquely wraps as Payload). OwnerType is "replay" | "eval"; for
// "replay" OwnerID is a sessions.id, for "eval" it is the frontend's
// locally-generated eval account id (no server-side eval account table
// exists to validate against).
//
// UserID is always "local" for now — this is a single-user product
// (PRODUCT.md) with no auth. The column exists so a later multi-user
// pivot is "add auth + populate this for real", not a schema migration.
type WorkspaceSnapshot struct {
	UserID     string          `json:"userId"`
	OwnerType  string          `json:"ownerType"`
	OwnerID    string          `json:"ownerId"`
	Reason     string          `json:"reason"`
	CursorTs   int64           `json:"cursorTs"`
	Version    int             `json:"version"`
	Payload    json.RawMessage `json:"payload"`
	Revision   int             `json:"revision"`
	CapturedAt int64           `json:"capturedAt"`
}
