package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"market-replay/internal/model"
	"market-replay/internal/storage"
)

// journalImagesSchema is its own fragment (appended to schema in Init), the
// same way drawingsSchema is, to keep each unit's diff self-contained.
const journalImagesSchema = `
CREATE TABLE IF NOT EXISTS journal_images (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions(id),
	mime TEXT NOT NULL,
	size INTEGER NOT NULL,
	data BLOB NOT NULL,
	caption TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ji_session ON journal_images(session_id, created_at);
`

func (s *Store) SaveJournalImage(ctx context.Context, img model.JournalImage) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO journal_images (id, session_id, mime, size, data, caption, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		img.ID, img.SessionID, img.Mime, img.Size, img.Data, img.Caption, img.CreatedAt.UnixMilli())
	if err != nil {
		return fmt.Errorf("sqlite: journal image save %s: %w", img.ID, err)
	}
	return nil
}

func (s *Store) GetJournalImage(ctx context.Context, id string) (model.JournalImage, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, session_id, mime, size, data, caption, created_at FROM journal_images WHERE id = ?`, id)
	var img model.JournalImage
	var createdAt int64
	if err := row.Scan(&img.ID, &img.SessionID, &img.Mime, &img.Size, &img.Data, &img.Caption, &createdAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.JournalImage{}, storage.ErrJournalImageNotFound
		}
		return model.JournalImage{}, fmt.Errorf("sqlite: journal image get %s: %w", id, err)
	}
	img.CreatedAt = time.UnixMilli(createdAt)
	return img, nil
}

func (s *Store) ListJournalImages(ctx context.Context, sessionID string) ([]model.JournalImage, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, session_id, mime, size, caption, created_at FROM journal_images WHERE session_id = ? ORDER BY created_at`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: journal image list %s: %w", sessionID, err)
	}
	defer rows.Close()
	out := []model.JournalImage{}
	for rows.Next() {
		var img model.JournalImage
		var createdAt int64
		if err := rows.Scan(&img.ID, &img.SessionID, &img.Mime, &img.Size, &img.Caption, &createdAt); err != nil {
			return nil, fmt.Errorf("sqlite: scan journal image: %w", err)
		}
		img.CreatedAt = time.UnixMilli(createdAt)
		out = append(out, img)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlite: journal image list %s: %w", sessionID, err)
	}
	return out, nil
}

func (s *Store) DeleteJournalImage(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM journal_images WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("sqlite: journal image delete %s: %w", id, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return storage.ErrJournalImageNotFound
	}
	return nil
}
