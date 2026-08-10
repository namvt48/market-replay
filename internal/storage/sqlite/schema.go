package sqlite

// schema covers sessions, trades, and watchlist (docs §6.3). The drawings
// and drawing_templates tables (docs §14.2) are added by drawings.go's own
// schema fragment, appended to this same Init() call.
const schema = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	symbol TEXT NOT NULL,
	tf TEXT NOT NULL,
	start_ts INTEGER NOT NULL,
	cursor_ts INTEGER NOT NULL,
	equity_cents INTEGER NOT NULL,
	status TEXT NOT NULL,
	config_json TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

-- Append-only journal of closed trades. Typed columns (not a JSON blob)
-- so future stats (win rate, expectancy — docs P4) are plain SQL, not
-- app-level JSON parsing. r_multiple is nullable: not every trade has a
-- stop distance to compute it from.
CREATE TABLE IF NOT EXISTS trades (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions(id),
	symbol TEXT NOT NULL,
	side TEXT NOT NULL,
	qty INTEGER NOT NULL,
	entry_ts INTEGER NOT NULL,
	entry_price_ticks INTEGER NOT NULL,
	exit_ts INTEGER NOT NULL,
	exit_price_ticks INTEGER NOT NULL,
	realized_cents INTEGER NOT NULL,
	fees_cents INTEGER NOT NULL,
	mfe_ticks INTEGER NOT NULL,
	mae_ticks INTEGER NOT NULL,
	r_multiple REAL,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_session ON trades(session_id, created_at);

-- Single-row-per-symbol table; "position" gives GET its ordering back
-- since SQLite doesn't preserve insertion order across arbitrary queries.
CREATE TABLE IF NOT EXISTS watchlist (
	symbol TEXT PRIMARY KEY,
	position INTEGER NOT NULL
);
`
