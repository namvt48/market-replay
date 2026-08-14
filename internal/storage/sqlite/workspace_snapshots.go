package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"market-replay/internal/model"
	"market-replay/internal/storage"
)

// workspaceSnapshotsSchema holds one durable recovery point per
// (user_id, owner_type, owner_id) — the natural key doubles as the primary
// key, since only the latest snapshot for an owner is ever kept. revision
// is a server-owned monotonic counter, separate from the client-supplied
// captured_at: it is what a client compares to detect whether its own
// write actually landed, immune to any client clock skew.
const workspaceSnapshotsSchema = `
CREATE TABLE IF NOT EXISTS workspace_snapshots (
	user_id TEXT NOT NULL,
	owner_type TEXT NOT NULL,
	owner_id TEXT NOT NULL,
	reason TEXT NOT NULL,
	cursor_ts INTEGER NOT NULL,
	version INTEGER NOT NULL,
	payload TEXT NOT NULL,
	revision INTEGER NOT NULL,
	captured_at INTEGER NOT NULL,
	PRIMARY KEY (user_id, owner_type, owner_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_snapshots_owner ON workspace_snapshots(owner_type, owner_id);
`

// workspaceSnapshotReasonPriority ranks reason for the tiebreak that
// applies only when two writes share the exact same captured_at:
// explicit_exit outranks trade_close, so a session's final, authoritative
// exit snapshot wins over a same-instant autosave.
func workspaceSnapshotReasonPriority(reason string) int {
	if reason == model.WorkspaceSnapshotReasonExplicitExit {
		return 1
	}
	return 0
}

// compareWorkspaceSnapshotRank orders two (reason, capturedAt) pairs.
// Negative means a ranks lower than b (a must not overwrite b); zero means
// they're the same logical snapshot (an idempotent retry); positive means
// a supersedes b.
func compareWorkspaceSnapshotRank(reasonA string, capturedAtA int64, reasonB string, capturedAtB int64) int {
	if capturedAtA != capturedAtB {
		if capturedAtA < capturedAtB {
			return -1
		}
		return 1
	}
	pa, pb := workspaceSnapshotReasonPriority(reasonA), workspaceSnapshotReasonPriority(reasonB)
	return pa - pb
}

// PutWorkspaceSnapshot upserts snap under one transaction: MaxOpenConns(1)
// (sqlite.go) already serialises every write in this process through one
// connection, so a plain SELECT-then-write inside a *sql.Tx is already
// atomic against any other write here — the same pattern
// UpsertDrawingTemplate uses.
func (s *Store) PutWorkspaceSnapshot(ctx context.Context, snap model.WorkspaceSnapshot) (model.WorkspaceSnapshot, bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return model.WorkspaceSnapshot{}, false, fmt.Errorf("sqlite: put workspace snapshot: begin tx: %w", err)
	}
	defer tx.Rollback()

	existing, err := scanWorkspaceSnapshot(tx.QueryRowContext(ctx, `
		SELECT user_id, owner_type, owner_id, reason, cursor_ts, version, payload, revision, captured_at
		FROM workspace_snapshots WHERE user_id = ? AND owner_type = ? AND owner_id = ?
	`, snap.UserID, snap.OwnerType, snap.OwnerID))
	if err != nil && !errors.Is(err, storage.ErrWorkspaceSnapshotNotFound) {
		return model.WorkspaceSnapshot{}, false, fmt.Errorf("sqlite: put workspace snapshot: read existing: %w", err)
	}

	if errors.Is(err, storage.ErrWorkspaceSnapshotNotFound) {
		snap.Revision = 1
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO workspace_snapshots (user_id, owner_type, owner_id, reason, cursor_ts, version, payload, revision, captured_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, snap.UserID, snap.OwnerType, snap.OwnerID, snap.Reason, snap.CursorTs, snap.Version, string(snap.Payload), snap.Revision, snap.CapturedAt); err != nil {
			return model.WorkspaceSnapshot{}, false, fmt.Errorf("sqlite: put workspace snapshot: insert: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return model.WorkspaceSnapshot{}, false, fmt.Errorf("sqlite: put workspace snapshot: commit: %w", err)
		}
		return snap, true, nil
	}

	rank := compareWorkspaceSnapshotRank(snap.Reason, snap.CapturedAt, existing.Reason, existing.CapturedAt)
	if rank < 0 {
		// Stale: leave the existing row untouched and report it back so the
		// caller knows exactly what is actually persisted.
		return existing, false, nil
	}
	if rank == 0 {
		// Idempotent retry of the same logical snapshot: nothing to write.
		return existing, true, nil
	}

	snap.Revision = existing.Revision + 1
	if _, err := tx.ExecContext(ctx, `
		UPDATE workspace_snapshots SET reason = ?, cursor_ts = ?, version = ?, payload = ?, revision = ?, captured_at = ?
		WHERE user_id = ? AND owner_type = ? AND owner_id = ?
	`, snap.Reason, snap.CursorTs, snap.Version, string(snap.Payload), snap.Revision, snap.CapturedAt, snap.UserID, snap.OwnerType, snap.OwnerID); err != nil {
		return model.WorkspaceSnapshot{}, false, fmt.Errorf("sqlite: put workspace snapshot: update: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return model.WorkspaceSnapshot{}, false, fmt.Errorf("sqlite: put workspace snapshot: commit: %w", err)
	}
	return snap, true, nil
}

// GetWorkspaceSnapshot returns the one stored snapshot for the owner, or
// storage.ErrWorkspaceSnapshotNotFound.
func (s *Store) GetWorkspaceSnapshot(ctx context.Context, userID, ownerType, ownerID string) (model.WorkspaceSnapshot, error) {
	return scanWorkspaceSnapshot(s.db.QueryRowContext(ctx, `
		SELECT user_id, owner_type, owner_id, reason, cursor_ts, version, payload, revision, captured_at
		FROM workspace_snapshots WHERE user_id = ? AND owner_type = ? AND owner_id = ?
	`, userID, ownerType, ownerID))
}

// DeleteWorkspaceSnapshot removes the owner's snapshot. Absent owners are
// not an error — a client clearing a snapshot it never synced has nothing
// to apologise for (mirrors DeletePreference/DeleteDrawingTemplate).
func (s *Store) DeleteWorkspaceSnapshot(ctx context.Context, userID, ownerType, ownerID string) error {
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM workspace_snapshots WHERE user_id = ? AND owner_type = ? AND owner_id = ?
	`, userID, ownerType, ownerID); err != nil {
		return fmt.Errorf("sqlite: delete workspace snapshot: %w", err)
	}
	return nil
}

func scanWorkspaceSnapshot(row rowScanner) (model.WorkspaceSnapshot, error) {
	var snap model.WorkspaceSnapshot
	var payload string
	err := row.Scan(&snap.UserID, &snap.OwnerType, &snap.OwnerID, &snap.Reason, &snap.CursorTs, &snap.Version, &payload, &snap.Revision, &snap.CapturedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return model.WorkspaceSnapshot{}, storage.ErrWorkspaceSnapshotNotFound
	}
	if err != nil {
		return model.WorkspaceSnapshot{}, fmt.Errorf("sqlite: scan workspace snapshot: %w", err)
	}
	snap.Payload = json.RawMessage(payload)
	return snap, nil
}
