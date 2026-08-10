// Package sqlite implements storage.Store using modernc.org/sqlite (pure
// Go, no cgo) — matching gex-dashboard's exact rationale: a single-user,
// low-write app gains nothing from mattn/go-sqlite3's cgo performance
// edge, and loses the static-binary/zero-toolchain deploy property that
// docs §8 depends on.
package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"

	"market-replay/internal/storage"
)

// Store is a storage.Store backed by a single SQLite file.
type Store struct {
	db *sql.DB
}

var _ storage.Store = (*Store)(nil)

// Open opens (creating if absent) the SQLite file at path. Callers must
// call Init before first use and Close when done.
//
// MaxOpenConns is pinned to 1: PRAGMA settings (journal_mode, foreign_keys
// in schema.go) are per-connection in SQLite, not persistent database
// state. database/sql pools connections transparently, so without this a
// pragma set during Init could silently stop applying the moment a query
// lands on a different pooled connection. One connection is also simply
// correct for this app's write pattern — a single user's sessions/trades
// writes never need real concurrency.
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("sqlite: open %s: %w", path, err)
	}
	db.SetMaxOpenConns(1)
	return &Store{db: db}, nil
}

// Init creates every table (sessions/trades/watchlist from schema.go,
// drawings from drawings.go, preferences from preferences.go) and enables
// WAL mode. Safe to call on every startup — every statement is
// CREATE ... IF NOT EXISTS.
func (s *Store) Init(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("sqlite: init schema: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, drawingsSchema); err != nil {
		return fmt.Errorf("sqlite: init drawings schema: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, preferencesSchema); err != nil {
		return fmt.Errorf("sqlite: init preferences schema: %w", err)
	}
	// A process restart is a hard replay boundary. Preserve every journal,
	// but require an explicit Resume before it can accept more trades.
	if _, err := s.db.ExecContext(ctx, `UPDATE sessions SET status = ? WHERE status = ?`, "paused", "active"); err != nil {
		return fmt.Errorf("sqlite: pause active sessions on startup: %w", err)
	}
	return nil
}

func (s *Store) Close() error {
	return s.db.Close()
}
