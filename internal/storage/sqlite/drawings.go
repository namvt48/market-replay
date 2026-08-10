package sqlite

import (
	"context"
	"fmt"
	"strings"
	"time"

	"market-replay/internal/model"
)

// drawingsSchema covers the drawings table (docs §14.2), kept as its own
// fragment (appended to schema in Init) rather than folded into schema.go,
// to keep each unit's diff self-contained.
//
// deleted is a tombstone column not present in §14.2's literal CREATE
// TABLE — the docs' own prose describes the API as "delta:
// upsert/tombstone", which needs somewhere to record a tombstone.
const drawingsSchema = `
CREATE TABLE IF NOT EXISTS drawings (
	id TEXT PRIMARY KEY,
	bucket TEXT NOT NULL,
	symbol TEXT NOT NULL,
	anchor_ts INTEGER NOT NULL,
	created_at_cursor INTEGER NOT NULL,
	created_tf TEXT NOT NULL,
	payload TEXT NOT NULL,
	deleted INTEGER NOT NULL DEFAULT 0,
	updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dr_window ON drawings(bucket, symbol, anchor_ts);
`

// UpsertDrawings applies a batch of upsert-or-tombstone deltas in one
// transaction. The client (drawing plugin) owns and supplies each
// drawing's id — unlike sessions/trades, this is a delta-sync model where
// the id is how the client tracks what it has already sent. updated_at is
// always server-stamped, never trusted from the client.
func (s *Store) UpsertDrawings(ctx context.Context, deltas []model.Drawing) (int, error) {
	if len(deltas) == 0 {
		return 0, nil
	}
	now := time.Now().Unix()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("sqlite: upsert drawings: begin tx: %w", err)
	}
	defer tx.Rollback()

	for _, d := range deltas {
		deleted := 0
		if d.Deleted {
			deleted = 1
		}
		_, err := tx.ExecContext(ctx, `
			INSERT INTO drawings (id, bucket, symbol, anchor_ts, created_at_cursor, created_tf, payload, deleted, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				bucket=excluded.bucket, symbol=excluded.symbol, anchor_ts=excluded.anchor_ts,
				created_at_cursor=excluded.created_at_cursor, created_tf=excluded.created_tf,
				payload=excluded.payload, deleted=excluded.deleted, updated_at=excluded.updated_at
		`, d.ID, d.Bucket, d.Symbol, d.AnchorTs, d.CreatedAtCursor, d.CreatedTf, d.Payload, deleted, now)
		if err != nil {
			return 0, fmt.Errorf("sqlite: upsert drawing %s: %w", d.ID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("sqlite: upsert drawings: commit: %w", err)
	}
	return len(deltas), nil
}

// ListDrawings returns non-tombstoned drawings matching filter. The
// anti-spoiler anchor_ts<=cursorTs condition is only added when Bucket
// has the "session:" prefix (docs §14.3) — a "global:" bucket ignores
// CursorTs even if the caller passed one.
func (s *Store) ListDrawings(ctx context.Context, filter model.DrawingFilter) ([]model.Drawing, error) {
	query := `
		SELECT id, bucket, symbol, anchor_ts, created_at_cursor, created_tf, payload, deleted, updated_at
		FROM drawings WHERE bucket = ? AND symbol = ? AND deleted = 0
	`
	args := []any{filter.Bucket, filter.Symbol}

	if len(filter.CreatedTf) > 0 {
		placeholders := make([]string, len(filter.CreatedTf))
		for i, tf := range filter.CreatedTf {
			placeholders[i] = "?"
			args = append(args, tf)
		}
		query += " AND created_tf IN (" + strings.Join(placeholders, ",") + ")"
	}

	if filter.CursorTs != nil && strings.HasPrefix(filter.Bucket, "session:") {
		query += " AND anchor_ts <= ?"
		args = append(args, *filter.CursorTs)
	}

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list drawings: %w", err)
	}
	defer rows.Close()

	out := make([]model.Drawing, 0)
	for rows.Next() {
		var d model.Drawing
		var deletedInt int
		if err := rows.Scan(&d.ID, &d.Bucket, &d.Symbol, &d.AnchorTs, &d.CreatedAtCursor, &d.CreatedTf, &d.Payload, &deletedInt, &d.UpdatedAt); err != nil {
			return nil, fmt.Errorf("sqlite: scan drawing: %w", err)
		}
		d.Deleted = deletedInt != 0
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlite: iterate drawings: %w", err)
	}
	return out, nil
}
