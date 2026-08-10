package model

// Drawing is one persisted chart annotation (trendline, Fibonacci, etc.).
// Schema per docs §14.2, plus a Deleted tombstone flag: the docs' own prose
// describes the API as "delta: upsert/tombstone" but the literal CREATE
// TABLE in §14.2 has no column to represent that — added here.
type Drawing struct {
	ID              string `json:"id"`
	Bucket          string `json:"bucket"` // "global:<symbol>" | "session:<sessionId>"
	Symbol          string `json:"symbol"`
	AnchorTs        int64  `json:"anchorTs"`
	CreatedAtCursor int64  `json:"createdAtCursor"`
	CreatedTf       string `json:"createdTf"`
	Payload         string `json:"payload"` // JSON state owned by the drawing plugin, opaque to the server
	Deleted         bool   `json:"deleted"`
	UpdatedAt       int64  `json:"updatedAt"`
}

// DrawingFilter selects drawings for GET /api/v1/drawings. CursorTs's
// anti-spoiler filter (anchor_ts <= cursorTs) is applied only when Bucket
// has the "session:" prefix — docs §14.3: "Analysis" (global:*) layer
// always shows regardless of replay cursor, only the "In-replay"
// (session:*) layer is spoiler-sensitive.
type DrawingFilter struct {
	Bucket    string
	Symbol    string
	CreatedTf []string // empty means no filter
	CursorTs  *int64
}
