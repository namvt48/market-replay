package sqlite

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestOpenAppliesConnectionPragmasAfterReconnect(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.Init(ctx); err != nil {
		t.Fatalf("Init: %v", err)
	}

	// Drop the connection Init configured through schema PRAGMAs. The next
	// connection must receive every connection-scoped setting from the DSN.
	store.db.SetMaxIdleConns(0)
	conn, err := store.db.Conn(ctx)
	if err != nil {
		t.Fatalf("reconnect: %v", err)
	}
	defer conn.Close()

	for _, tc := range []struct {
		pragma string
		want   int
	}{
		{pragma: "foreign_keys", want: 1},
		{pragma: "synchronous", want: 1}, // NORMAL
		{pragma: "busy_timeout", want: 5_000},
	} {
		var got int
		if err := conn.QueryRowContext(ctx, "PRAGMA "+tc.pragma).Scan(&got); err != nil {
			t.Fatalf("PRAGMA %s: %v", tc.pragma, err)
		}
		if got != tc.want {
			t.Errorf("PRAGMA %s = %d, want %d after reconnect", tc.pragma, got, tc.want)
		}
	}

	_, err = conn.ExecContext(ctx, `
		INSERT INTO trades (
			id, session_id, symbol, side, qty,
			entry_ts, entry_price_ticks, exit_ts, exit_price_ticks,
			realized_cents, fees_cents, mfe_ticks, mae_ticks, created_at
		) VALUES ('orphan', 'missing-session', 'NQ', 'long', 1, 1, 1, 2, 2, 0, 0, 0, 0, 2)
	`)
	if err == nil {
		t.Fatal("orphan trade insert succeeded after reconnect; foreign key was not enforced")
	}
}

func TestOpenEscapesDatabasePath(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "replay # phiên?.db")
	store, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := store.Init(context.Background()); err != nil {
		_ = store.Close()
		t.Fatalf("Init: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("database was not created at the exact configured path %q: %v", path, err)
	}
}
