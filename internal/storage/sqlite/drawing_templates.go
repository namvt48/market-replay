package sqlite

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"market-replay/internal/model"
	"market-replay/internal/storage"
)

// drawingTemplatesSchema is the dedicated home for named drawing appearance
// presets. This table was originally scoped alongside drawings (docs
// §14.2) but never finished — for a while, templates lived as one opaque
// blob in the generic preferences table instead (see preferences.go). This
// completes the original table; sqlite.go's migrateDrawingTemplatesFromPreferences
// moves any data that only ever made it into that blob.
const drawingTemplatesSchema = `
CREATE TABLE IF NOT EXISTS drawing_templates (
	id TEXT PRIMARY KEY,
	tool_type TEXT NOT NULL,
	name TEXT NOT NULL,
	appearance_json TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE(tool_type, name)
);
CREATE INDEX IF NOT EXISTS idx_drawing_templates_tool ON drawing_templates(tool_type);
`

// initDrawingTemplatesSchema upgrades the table shape that shipped before
// templates gained stable ids and timestamps. CREATE TABLE IF NOT EXISTS is
// insufficient for that database: it leaves (tool, name, payload) in place,
// then the tool_type index fails and prevents the entire server from starting.
func (s *Store) initDrawingTemplatesSchema(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(drawing_templates)`)
	if err != nil {
		return fmt.Errorf("sqlite: inspect drawing templates schema: %w", err)
	}
	columns := make(map[string]bool)
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			rows.Close()
			return fmt.Errorf("sqlite: scan drawing templates schema: %w", err)
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("sqlite: iterate drawing templates schema: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("sqlite: close drawing templates schema rows: %w", err)
	}

	if len(columns) == 0 || columns["tool_type"] {
		if _, err := s.db.ExecContext(ctx, drawingTemplatesSchema); err != nil {
			return fmt.Errorf("sqlite: init drawing templates schema: %w", err)
		}
		return nil
	}
	if !columns["tool"] || !columns["name"] || !columns["payload"] {
		return fmt.Errorf("sqlite: unsupported drawing templates schema: columns %v", columns)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("sqlite: migrate legacy drawing templates: begin tx: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `ALTER TABLE drawing_templates RENAME TO drawing_templates_legacy`); err != nil {
		return fmt.Errorf("sqlite: rename legacy drawing templates: %w", err)
	}
	if _, err := tx.ExecContext(ctx, drawingTemplatesSchema); err != nil {
		return fmt.Errorf("sqlite: create upgraded drawing templates schema: %w", err)
	}

	legacyRows, err := tx.QueryContext(ctx, `SELECT tool, name, payload FROM drawing_templates_legacy`)
	if err != nil {
		return fmt.Errorf("sqlite: read legacy drawing templates: %w", err)
	}
	type legacyTemplate struct{ tool, name, payload string }
	legacy := make([]legacyTemplate, 0)
	for legacyRows.Next() {
		var template legacyTemplate
		if err := legacyRows.Scan(&template.tool, &template.name, &template.payload); err != nil {
			legacyRows.Close()
			return fmt.Errorf("sqlite: scan legacy drawing template: %w", err)
		}
		legacy = append(legacy, template)
	}
	if err := legacyRows.Err(); err != nil {
		legacyRows.Close()
		return fmt.Errorf("sqlite: iterate legacy drawing templates: %w", err)
	}
	if err := legacyRows.Close(); err != nil {
		return fmt.Errorf("sqlite: close legacy drawing templates rows: %w", err)
	}

	for _, template := range legacy {
		digest := sha256.Sum256([]byte(template.tool + "\x00" + template.name))
		id := "legacy-" + hex.EncodeToString(digest[:16])
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO drawing_templates (id, tool_type, name, appearance_json, created_at, updated_at)
			VALUES (?, ?, ?, ?, 0, 0)
		`, id, template.tool, template.name, template.payload); err != nil {
			return fmt.Errorf("sqlite: migrate legacy drawing template %s/%s: %w", template.tool, template.name, err)
		}
	}
	if _, err := tx.ExecContext(ctx, `DROP TABLE drawing_templates_legacy`); err != nil {
		return fmt.Errorf("sqlite: drop legacy drawing templates table: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("sqlite: commit legacy drawing templates migration: %w", err)
	}
	return nil
}

// UpsertDrawingTemplate creates or replaces the template with t.ID — the
// client owns and supplies the id, the same delta-sync ownership model as
// UpsertDrawings. A name already used by a different template for the same
// tool type surfaces as storage.ErrDrawingTemplateNameTaken rather than a
// generic error, so the HTTP layer can report it as a 400.
func (s *Store) UpsertDrawingTemplate(ctx context.Context, t model.DrawingTemplate) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO drawing_templates (id, tool_type, name, appearance_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			tool_type=excluded.tool_type, name=excluded.name,
			appearance_json=excluded.appearance_json, updated_at=excluded.updated_at
	`, t.ID, t.ToolType, t.Name, string(t.Appearance), t.CreatedAt, t.UpdatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return storage.ErrDrawingTemplateNameTaken
		}
		return fmt.Errorf("sqlite: upsert drawing template %s: %w", t.ID, err)
	}
	return nil
}

// DeleteDrawingTemplate removes id. Absent ids are not an error — the
// client deleting a template it already removed locally has nothing to
// apologise for (mirrors DeletePreference).
func (s *Store) DeleteDrawingTemplate(ctx context.Context, id string) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM drawing_templates WHERE id = ?`, id); err != nil {
		return fmt.Errorf("sqlite: delete drawing template %s: %w", id, err)
	}
	return nil
}

// ListDrawingTemplates returns every stored template.
func (s *Store) ListDrawingTemplates(ctx context.Context) ([]model.DrawingTemplate, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, tool_type, name, appearance_json, created_at, updated_at FROM drawing_templates
	`)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list drawing templates: %w", err)
	}
	defer rows.Close()

	out := make([]model.DrawingTemplate, 0)
	for rows.Next() {
		var t model.DrawingTemplate
		var appearance string
		if err := rows.Scan(&t.ID, &t.ToolType, &t.Name, &appearance, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("sqlite: scan drawing template: %w", err)
		}
		t.Appearance = json.RawMessage(appearance)
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlite: iterate drawing templates: %w", err)
	}
	return out, nil
}

// legacyDrawingTemplatesKey is the preferences key drawing templates used
// to be stored under, as one opaque JSON array (docs §14.2 fallback —
// see preferences.go's schema comment).
const legacyDrawingTemplatesKey = "market-replay:drawing-templates:v1"

// migrateDrawingTemplatesFromPreferences moves templates that only ever
// existed inside the generic preferences blob into their own rows, once.
// Idempotent: it deletes the legacy row on success, so a second call finds
// nothing to migrate and is a no-op. A malformed legacy blob is left in
// place rather than dropped, so it isn't silently lost — Init still
// succeeds since the drawing_templates table works fine without it.
func (s *Store) migrateDrawingTemplatesFromPreferences(ctx context.Context) error {
	var payload string
	err := s.db.QueryRowContext(ctx, `SELECT payload FROM preferences WHERE key = ?`, legacyDrawingTemplatesKey).Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("sqlite: read legacy drawing templates: %w", err)
	}

	var legacy []model.DrawingTemplate
	if err := json.Unmarshal([]byte(payload), &legacy); err != nil {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("sqlite: migrate drawing templates: begin tx: %w", err)
	}
	defer tx.Rollback()

	for _, t := range legacy {
		if _, err := tx.ExecContext(ctx, `
			INSERT OR IGNORE INTO drawing_templates (id, tool_type, name, appearance_json, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, t.ID, t.ToolType, t.Name, string(t.Appearance), t.CreatedAt, t.UpdatedAt); err != nil {
			return fmt.Errorf("sqlite: migrate drawing template %s: %w", t.ID, err)
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM preferences WHERE key = ?`, legacyDrawingTemplatesKey); err != nil {
		return fmt.Errorf("sqlite: migrate drawing templates: clear legacy row: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("sqlite: migrate drawing templates: commit: %w", err)
	}
	return nil
}
