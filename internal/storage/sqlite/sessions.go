package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"market-replay/internal/model"
	"market-replay/internal/storage"
)

// CreateSession inserts a new session, generating its id server-side (the
// POST /api/v1/sessions contract returns {id}; it doesn't accept one).
// New sessions start Active with zero equity — the docs don't specify an
// initial value, so the first PATCH is expected to set the real starting
// equity.
func (s *Store) CreateSession(ctx context.Context, in model.Session) (model.Session, error) {
	now := time.Now().Unix()
	kind := in.Kind
	if kind == "" {
		kind = model.SessionKindReplay
	}
	sess := model.Session{
		ID:                  uuid.NewString(),
		Name:                in.Name,
		Symbol:              in.Symbol,
		Tf:                  in.Tf,
		StartTs:             in.StartTs,
		CursorTs:            in.StartTs,
		EquityCents:         0,
		Status:              model.SessionActive,
		Kind:                kind,
		InitialBalanceCents: in.InitialBalanceCents,
		Config:              in.Config,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	if len(sess.Config) == 0 {
		sess.Config = json.RawMessage("{}")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return model.Session{}, fmt.Errorf("sqlite: create session: begin tx: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE sessions SET status = ?, updated_at = ? WHERE status = ?`, model.SessionPaused, now, model.SessionActive); err != nil {
		return model.Session{}, fmt.Errorf("sqlite: create session: pause previous: %w", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO sessions (id, name, symbol, tf, start_ts, cursor_ts, equity_cents, status, kind, initial_balance_cents, config_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, sess.ID, sess.Name, sess.Symbol, sess.Tf, sess.StartTs, sess.CursorTs, sess.EquityCents, sess.Status, sess.Kind, sess.InitialBalanceCents, string(sess.Config), sess.CreatedAt, sess.UpdatedAt)
	if err != nil {
		return model.Session{}, fmt.Errorf("sqlite: create session: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return model.Session{}, fmt.Errorf("sqlite: create session: commit: %w", err)
	}
	return sess, nil
}

// UpdateSession applies patch's non-nil fields to session id.
//
// The row is read inside the transaction, not before it. Reading first and
// then opening a transaction let two concurrent patches both observe the old
// row and write every column back from it, so the second write silently
// discarded the first one's field — a cursor checkpoint could erase an equity
// checkpoint that had already been acknowledged. With one pooled connection,
// keeping the read inside the transaction makes the whole read-modify-write
// indivisible.
func (s *Store) UpdateSession(ctx context.Context, id string, patch model.SessionPatch) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("sqlite: update session %s: begin tx: %w", id, err)
	}
	defer tx.Rollback()

	row := tx.QueryRowContext(ctx, `
		SELECT id, name, symbol, tf, start_ts, cursor_ts, equity_cents, status, kind, initial_balance_cents, config_json, created_at, updated_at
		FROM sessions WHERE id = ?
	`, id)
	current, err := scanSession(row)
	if errors.Is(err, sql.ErrNoRows) {
		return storage.ErrSessionNotFound
	}
	if err != nil {
		return fmt.Errorf("sqlite: update session %s: read: %w", id, err)
	}

	previousCursor := current.CursorTs
	if patch.Name != nil {
		current.Name = *patch.Name
	}
	if patch.CursorTs != nil {
		current.CursorTs = *patch.CursorTs
	}
	if patch.EquityCents != nil {
		current.EquityCents = *patch.EquityCents
	}
	if patch.Status != nil {
		current.Status = *patch.Status
	}
	if patch.Config != nil {
		current.Config = *patch.Config
	}
	current.UpdatedAt = time.Now().Unix()

	if current.Status == model.SessionActive {
		if _, err := tx.ExecContext(ctx, `UPDATE sessions SET status = ?, updated_at = ? WHERE status = ? AND id <> ?`, model.SessionPaused, current.UpdatedAt, model.SessionActive, id); err != nil {
			return fmt.Errorf("sqlite: update session %s: pause previous: %w", id, err)
		}
	}
	// A cursor that moves backwards un-happens every trade that closed after
	// it, so the stored journal has to shrink in the same transaction.
	// Otherwise those rows survive as trades from the future, and the next
	// resume reads them back as real.
	if current.CursorTs < previousCursor {
		if _, err := tx.ExecContext(ctx, `DELETE FROM trades WHERE session_id = ? AND exit_ts > ?`, id, current.CursorTs); err != nil {
			return fmt.Errorf("sqlite: update session %s: prune trades past the cursor: %w", id, err)
		}
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE sessions SET name=?, cursor_ts=?, equity_cents=?, status=?, config_json=?, updated_at=? WHERE id=?
	`, current.Name, current.CursorTs, current.EquityCents, current.Status, string(current.Config), current.UpdatedAt, id); err != nil {
		return fmt.Errorf("sqlite: update session %s: %w", id, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("sqlite: update session %s: commit: %w", id, err)
	}
	return nil
}

// DeleteSession removes one replay session and its private journal/drawings
// atomically. Global symbol drawings are deliberately preserved.
func (s *Store) DeleteSession(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("sqlite: delete session %s: begin tx: %w", id, err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM drawings WHERE bucket = ?`, "session:"+id); err != nil {
		return fmt.Errorf("sqlite: delete session %s drawings: %w", id, err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM trades WHERE session_id = ?`, id); err != nil {
		return fmt.Errorf("sqlite: delete session %s trades: %w", id, err)
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("sqlite: delete session %s: %w", id, err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("sqlite: delete session %s rows affected: %w", id, err)
	}
	if deleted == 0 {
		return storage.ErrSessionNotFound
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("sqlite: delete session %s commit: %w", id, err)
	}
	return nil
}

// DeleteEmptySessions removes inactive sessions where nothing happened: the
// replay cursor never left the starting bar, no trade closed, and no in-replay
// drawing survives.
//
// It used to also require equity_cents = 0 and config_json = '{}'. Neither can
// hold for a session the app actually creates — starting a replay immediately
// patches the session with the starting equity and the serialized fill
// runtime — so the predicate was unsatisfiable and the user-facing cleanup
// action always reported zero deletions. Advancement and content are the
// honest test for "empty"; the accounting columns are set at birth.
func (s *Store) DeleteEmptySessions(ctx context.Context) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("sqlite: delete empty sessions: begin tx: %w", err)
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `
		SELECT id FROM sessions
		WHERE status <> ? AND cursor_ts = start_ts
		AND NOT EXISTS (SELECT 1 FROM trades WHERE trades.session_id = sessions.id)
		AND NOT EXISTS (SELECT 1 FROM drawings WHERE drawings.bucket = 'session:' || sessions.id AND drawings.deleted = 0)
	`, model.SessionActive)
	if err != nil {
		return 0, fmt.Errorf("sqlite: delete empty sessions: list candidates: %w", err)
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, fmt.Errorf("sqlite: delete empty sessions: scan candidate: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Close(); err != nil {
		return 0, fmt.Errorf("sqlite: delete empty sessions: close candidates: %w", err)
	}
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `DELETE FROM drawings WHERE bucket = ?`, "session:"+id); err != nil {
			return 0, fmt.Errorf("sqlite: delete empty session %s drawings: %w", id, err)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, id); err != nil {
			return 0, fmt.Errorf("sqlite: delete empty session %s: %w", id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("sqlite: delete empty sessions: commit: %w", err)
	}
	return int64(len(ids)), nil
}

func (s *Store) GetSession(ctx context.Context, id string) (model.Session, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, name, symbol, tf, start_ts, cursor_ts, equity_cents, status, kind, initial_balance_cents, config_json, created_at, updated_at
		FROM sessions WHERE id = ?
	`, id)
	sess, err := scanSession(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Session{}, storage.ErrSessionNotFound
	}
	if err != nil {
		return model.Session{}, fmt.Errorf("sqlite: get session %s: %w", id, err)
	}
	return sess, nil
}

func (s *Store) ListSessions(ctx context.Context) ([]model.Session, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, symbol, tf, start_ts, cursor_ts, equity_cents, status, kind, initial_balance_cents, config_json, created_at, updated_at
		FROM sessions ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list sessions: %w", err)
	}
	defer rows.Close()

	out := make([]model.Session, 0)
	for rows.Next() {
		sess, err := scanSession(rows)
		if err != nil {
			return nil, fmt.Errorf("sqlite: scan session: %w", err)
		}
		out = append(out, sess)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlite: iterate sessions: %w", err)
	}
	return out, nil
}

// rowScanner abstracts over *sql.Row and *sql.Rows, both of which expose
// Scan with the same signature — lets scanSession serve GetSession and
// ListSessions alike.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanSession(row rowScanner) (model.Session, error) {
	var sess model.Session
	var configJSON string
	var initialBalanceCents sql.NullInt64
	if err := row.Scan(&sess.ID, &sess.Name, &sess.Symbol, &sess.Tf, &sess.StartTs, &sess.CursorTs, &sess.EquityCents, &sess.Status, &sess.Kind, &initialBalanceCents, &configJSON, &sess.CreatedAt, &sess.UpdatedAt); err != nil {
		return model.Session{}, err
	}
	if initialBalanceCents.Valid {
		value := initialBalanceCents.Int64
		sess.InitialBalanceCents = &value
	}
	sess.Config = json.RawMessage(configJSON)
	return sess, nil
}
