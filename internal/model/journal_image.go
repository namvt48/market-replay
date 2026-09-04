package model

import "time"

// JournalImage is a screenshot attached to a live-journal session. The
// bytes are stored as a SQLite BLOB server-side; Data is excluded from
// JSON responses in list views (set to nil by the list query).
type JournalImage struct {
	ID        string    `json:"id"`
	SessionID string    `json:"sessionId"`
	Mime      string    `json:"mime"`
	Size      int64     `json:"size"`
	Data      []byte    `json:"-"`
	Caption   string    `json:"caption"`
	CreatedAt time.Time `json:"createdAt"`
}
