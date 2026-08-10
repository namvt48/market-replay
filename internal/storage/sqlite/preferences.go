package sqlite

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// preferencesSchema is the durable home for workspace customization —
// chart appearance, pane layouts, saved layouts, timeframe preferences,
// drawing favourites and drawing templates.
//
// All of it used to live only in the browser's localStorage, which meant a
// different browser, a cleared site, or a second machine started from
// defaults while the far smaller watchlist was already persisted
// server-side. One opaque-payload table covers every one of those settings
// rather than a table per kind: the server has no reason to understand the
// shape of a chart colour scheme, only to hand back exactly what it was
// given. (This also replaces the drawing_templates table, which had a
// schema but never had a Store method or a route.)
const preferencesSchema = `
CREATE TABLE IF NOT EXISTS preferences (
	key TEXT PRIMARY KEY,
	payload TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);
`

// ListPreferences returns every stored preference, keyed by name. Payloads
// are returned as raw JSON so the server never re-encodes a document it
// does not interpret.
func (s *Store) ListPreferences(ctx context.Context) (map[string]json.RawMessage, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT key, payload FROM preferences`)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list preferences: %w", err)
	}
	defer rows.Close()

	out := make(map[string]json.RawMessage)
	for rows.Next() {
		var key, payload string
		if err := rows.Scan(&key, &payload); err != nil {
			return nil, fmt.Errorf("sqlite: scan preference: %w", err)
		}
		out[key] = json.RawMessage(payload)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlite: iterate preferences: %w", err)
	}
	return out, nil
}

// SetPreference stores payload verbatim under key, replacing any previous
// value. Callers validate that payload is well-formed JSON at the HTTP
// boundary; storing it as text keeps the row readable with plain sqlite3.
func (s *Store) SetPreference(ctx context.Context, key string, payload json.RawMessage) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO preferences (key, payload, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
	`, key, string(payload), time.Now().Unix())
	if err != nil {
		return fmt.Errorf("sqlite: set preference %s: %w", key, err)
	}
	return nil
}

// DeletePreference removes key. Absent keys are not an error — the client
// clearing a setting it never synced is a no-op, not a failure.
func (s *Store) DeletePreference(ctx context.Context, key string) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM preferences WHERE key = ?`, key); err != nil {
		return fmt.Errorf("sqlite: delete preference %s: %w", key, err)
	}
	return nil
}
