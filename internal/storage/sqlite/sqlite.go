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
	"net/url"

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
// Connection-scoped PRAGMAs live in the DSN so database/sql applies them
// again whenever it replaces the underlying SQLite connection. Building the
// DSN through net/url is load-bearing: DB_PATH is user-configurable and raw
// '#', '?' or non-ASCII bytes must remain part of the filesystem path rather
// than being parsed as URI syntax.
//
// MaxOpenConns is still pinned to 1 because a single user's sessions/trades
// writes do not need concurrent writers, and serialising them avoids
// self-inflicted SQLITE_BUSY failures inside this process.
func Open(path string) (*Store, error) {
	dsn := url.URL{Scheme: "file", Path: path}
	query := url.Values{}
	query.Add("_pragma", "foreign_keys(ON)")
	query.Add("_pragma", "synchronous(NORMAL)")
	query.Add("_pragma", "busy_timeout(5000)")
	dsn.RawQuery = query.Encode()

	db, err := sql.Open("sqlite", dsn.String())
	if err != nil {
		return nil, fmt.Errorf("sqlite: open %s: %w", path, err)
	}
	db.SetMaxOpenConns(1)
	return &Store{db: db}, nil
}

// Init creates every table (sessions/trades/watchlist from schema.go,
// drawings from drawings.go, preferences from preferences.go, drawing
// templates from drawing_templates.go, workspace snapshots from
// workspace_snapshots.go) and enables WAL mode. Safe to call on every
// startup — every statement is CREATE ... IF NOT EXISTS.
func (s *Store) Init(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("sqlite: init schema: %w", err)
	}
	if err := s.migrateTradeVisualColumns(ctx); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, drawingsSchema); err != nil {
		return fmt.Errorf("sqlite: init drawings schema: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, preferencesSchema); err != nil {
		return fmt.Errorf("sqlite: init preferences schema: %w", err)
	}
	if err := s.initDrawingTemplatesSchema(ctx); err != nil {
		return err
	}
	if err := s.migrateDrawingTemplatesFromPreferences(ctx); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, workspaceSnapshotsSchema); err != nil {
		return fmt.Errorf("sqlite: init workspace snapshots schema: %w", err)
	}
	// A process restart is a hard replay boundary. Preserve every journal,
	// but require an explicit Resume before it can accept more trades.
	if _, err := s.db.ExecContext(ctx, `UPDATE sessions SET status = ? WHERE status = ?`, "paused", "active"); err != nil {
		return fmt.Errorf("sqlite: pause active sessions on startup: %w", err)
	}
	return nil
}

// migrateTradeVisualColumns upgrades databases created before closed-position
// visuals were persisted. CREATE TABLE IF NOT EXISTS cannot add columns to an
// existing journal, so keep this small migration explicit and idempotent.
func (s *Store) migrateTradeVisualColumns(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(trades)`)
	if err != nil {
		return fmt.Errorf("sqlite: inspect trades schema: %w", err)
	}
	existing := make(map[string]bool)
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			rows.Close()
			return fmt.Errorf("sqlite: scan trades schema: %w", err)
		}
		existing[name] = true
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("sqlite: iterate trades schema: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("sqlite: close trades schema rows: %w", err)
	}

	columns := []struct {
		name string
		ddl  string
	}{
		{name: "initial_stop_ticks", ddl: `ALTER TABLE trades ADD COLUMN initial_stop_ticks INTEGER`},
		{name: "initial_take_profit_ticks", ddl: `ALTER TABLE trades ADD COLUMN initial_take_profit_ticks INTEGER`},
		{name: "protection_adjustments_json", ddl: `ALTER TABLE trades ADD COLUMN protection_adjustments_json TEXT NOT NULL DEFAULT '[]'`},
		{name: "exit_reason", ddl: `ALTER TABLE trades ADD COLUMN exit_reason TEXT NOT NULL DEFAULT 'manual'`},
	}
	for _, column := range columns {
		if existing[column.name] {
			continue
		}
		if _, err := s.db.ExecContext(ctx, column.ddl); err != nil {
			return fmt.Errorf("sqlite: add trades.%s: %w", column.name, err)
		}
	}
	return nil
}

func (s *Store) Close() error {
	return s.db.Close()
}
