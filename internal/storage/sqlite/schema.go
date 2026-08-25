package sqlite

// schema covers sessions, trades, and watchlist (docs §6.3). The drawings
// table (docs §14.2) is added by drawings.go's own schema fragment, and
// drawing_templates by drawing_templates.go's, both appended to this same
// Init() call.
const schema = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL DEFAULT '',
	symbol TEXT NOT NULL,
	tf TEXT NOT NULL,
	start_ts INTEGER NOT NULL,
	cursor_ts INTEGER NOT NULL,
	equity_cents INTEGER NOT NULL,
	status TEXT NOT NULL,
	-- kind distinguishes a hand-replayed session from a prop-firm-style
	-- evaluation account; both share this same table and the trades table
	-- below so analytics can treat them identically. initial_balance_cents
	-- is nullable because it did not exist before analytics needed it — see
	-- migrateSessionAnalyticsColumns's fallback for pre-existing rows.
	kind TEXT NOT NULL DEFAULT 'replay',
	initial_balance_cents INTEGER,
	config_json TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	deleted_at INTEGER
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
	initial_stop_ticks INTEGER,
	initial_take_profit_ticks INTEGER,
	protection_adjustments_json TEXT NOT NULL DEFAULT '[]',
	exit_reason TEXT NOT NULL DEFAULT 'manual',
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
