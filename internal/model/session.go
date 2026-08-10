package model

import "encoding/json"

// Session is one replay/paper-trading session: symbol+timeframe+cursor
// state, persisted so the user can resume across restarts.
type Session struct {
	ID          string          `json:"id"`
	Symbol      string          `json:"symbol"`
	Tf          string          `json:"tf"`
	StartTs     int64           `json:"startTs"`
	CursorTs    int64           `json:"cursorTs"`
	EquityCents int64           `json:"equityCents"`
	Status      string          `json:"status"`
	Config      json.RawMessage `json:"config"`
	CreatedAt   int64           `json:"createdAt"`
	UpdatedAt   int64           `json:"updatedAt"`
}

// SessionPatch carries the mutable subset of Session accepted by
// PATCH /api/v1/sessions/{id}. Pointer fields distinguish "not provided"
// (nil) from "set to the zero value".
type SessionPatch struct {
	CursorTs    *int64           `json:"cursorTs"`
	EquityCents *int64           `json:"equityCents"`
	Status      *string          `json:"status"`
	Config      *json.RawMessage `json:"config"`
}

// Session status values. Not specified by the architecture docs — chosen
// as the minimal set covering pause/resume (flagged in the plan for
// review). New sessions start Active with EquityCents 0; the first PATCH
// sets the real starting equity.
const (
	SessionActive  = "active"
	SessionPaused  = "paused"
	SessionStopped = "stopped"
)

func ValidSessionStatus(status string) bool {
	return status == SessionActive || status == SessionPaused || status == SessionStopped
}
