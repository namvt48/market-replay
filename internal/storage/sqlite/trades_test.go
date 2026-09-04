package sqlite

import (
	"context"
	"path/filepath"
	"testing"

	"market-replay/internal/model"
)

func newTestSession(t *testing.T, s *Store) model.Session {
	t.Helper()
	sess, err := s.CreateSession(context.Background(), model.Session{Symbol: "NQ", Tf: "1m", StartTs: 1000})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	return sess
}

func TestReplaceTrades_RoundTrip(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	sess := newTestSession(t, s)

	r := 1.5
	stop := int64(79900)
	target := int64(80200)
	in := model.Trade{
		ID: "trade-1", Symbol: "NQ", Side: "long", Qty: 2,
		EntryTs: 1000, EntryPriceTicks: 80000,
		ExitTs: 1300, ExitPriceTicks: 80100,
		RealizedCents: 50000, FeesCents: 209,
		MfeTicks: 150, MaeTicks: -20, RMultiple: &r, CreatedAt: 1300,
		InitialStopTicks: &stop, InitialTakeProfitTicks: &target,
		ProtectionAdjustments: []model.ProtectionAdjustment{{Role: "stopLoss", Ts: 1200, PriceTicks: 80020}},
		ExitReason:            "manual",
	}
	if err := s.ReplaceTrades(ctx, sess.ID, []model.Trade{in}); err != nil {
		t.Fatalf("ReplaceTrades: %v", err)
	}
	// The journal is cursor-bounded on read, so the cursor has to have
	// reached the trade's exit for it to be visible at all.
	cursor := int64(1300)
	if err := s.UpdateSession(ctx, sess.ID, model.SessionPatch{CursorTs: &cursor}); err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	trades, err := s.ListTrades(ctx, sess.ID)
	if err != nil {
		t.Fatalf("ListTrades: %v", err)
	}
	if len(trades) != 1 {
		t.Fatalf("len(trades) = %d, want 1", len(trades))
	}
	got := trades[0]
	// Identity is the server's; the client's per-session sequence numbers
	// would collide across sessions on a table-wide primary key.
	if got.ID == "" || got.ID == "trade-1" {
		t.Errorf("id = %q, want a server-assigned id", got.ID)
	}
	if got.SessionID != sess.ID {
		t.Errorf("sessionId = %q, want %q", got.SessionID, sess.ID)
	}
	if got.RealizedCents != 50000 || got.RMultiple == nil || *got.RMultiple != 1.5 {
		t.Errorf("got = %+v, unexpected", got)
	}
	if got.InitialStopTicks == nil || *got.InitialStopTicks != stop || got.InitialTakeProfitTicks == nil || *got.InitialTakeProfitTicks != target {
		t.Errorf("protection levels = (%v, %v), want (%d, %d)", got.InitialStopTicks, got.InitialTakeProfitTicks, stop, target)
	}
	if len(got.ProtectionAdjustments) != 1 || got.ProtectionAdjustments[0].PriceTicks != 80020 || got.ExitReason != "manual" {
		t.Errorf("trade visual metadata = %+v / %q, unexpected", got.ProtectionAdjustments, got.ExitReason)
	}
}

func TestInitMigratesTradeVisualColumns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	ctx := context.Background()
	if _, err := s.db.ExecContext(ctx, `
		CREATE TABLE trades (
			id TEXT PRIMARY KEY, session_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
			qty INTEGER NOT NULL, entry_ts INTEGER NOT NULL, entry_price_ticks INTEGER NOT NULL,
			exit_ts INTEGER NOT NULL, exit_price_ticks INTEGER NOT NULL, realized_cents INTEGER NOT NULL,
			fees_cents INTEGER NOT NULL, mfe_ticks INTEGER NOT NULL, mae_ticks INTEGER NOT NULL,
			r_multiple REAL, created_at INTEGER NOT NULL
		)
	`); err != nil {
		t.Fatalf("create legacy trades: %v", err)
	}
	if err := s.Init(ctx); err != nil {
		t.Fatalf("Init legacy database: %v", err)
	}

	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(trades)`)
	if err != nil {
		t.Fatalf("table info: %v", err)
	}
	defer rows.Close()
	found := make(map[string]bool)
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			t.Fatalf("scan table info: %v", err)
		}
		found[name] = true
	}
	for _, name := range []string{"initial_stop_ticks", "initial_take_profit_ticks", "protection_adjustments_json", "exit_reason"} {
		if !found[name] {
			t.Errorf("missing migrated column %s", name)
		}
	}
}

// TestReplaceTrades_SeparateSessionsReuseClientIds is the regression for the
// bug that made journal persistence collapse after the first session: the
// client numbers trades per session, so every session's first closed trade is
// "trade-1", and storing that against a table-wide primary key failed the
// second session's write with a uniqueness violation.
func TestReplaceTrades_SeparateSessionsReuseClientIds(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	first := newTestSession(t, s)
	second := newTestSession(t, s)

	journal := []model.Trade{
		{ID: "trade-1", Symbol: "NQ", Side: "long", Qty: 1, ExitTs: 100, CreatedAt: 100},
		{ID: "trade-2", Symbol: "NQ", Side: "short", Qty: 1, ExitTs: 200, CreatedAt: 200},
	}
	if err := s.ReplaceTrades(ctx, first.ID, journal); err != nil {
		t.Fatalf("first session: %v", err)
	}
	if err := s.ReplaceTrades(ctx, second.ID, journal); err != nil {
		t.Fatalf("second session reusing the same client ids: %v", err)
	}

	for _, sess := range []string{first.ID, second.ID} {
		trades, err := s.ListTrades(ctx, sess)
		if err != nil {
			t.Fatalf("ListTrades(%s): %v", sess, err)
		}
		if len(trades) != 2 {
			t.Fatalf("session %s has %d trades, want 2", sess, len(trades))
		}
	}
}

func TestReplaceTrades_StampsMissingTimestamp(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	sess := newTestSession(t, s)

	if err := s.ReplaceTrades(ctx, sess.ID, []model.Trade{{ID: "trade-1", Symbol: "NQ", Side: "short", Qty: 1}}); err != nil {
		t.Fatalf("ReplaceTrades: %v", err)
	}
	trades, err := s.ListTrades(ctx, sess.ID)
	if err != nil {
		t.Fatalf("ListTrades: %v", err)
	}
	if len(trades) != 1 || trades[0].RMultiple != nil {
		t.Fatalf("trades = %+v, want one row with RMultiple nil", trades)
	}
	if trades[0].CreatedAt == 0 {
		t.Error("no createdAt assigned for a trade that arrived without one")
	}
}

// TestReplaceTrades_ShortenedJournalDropsRows is the regression this endpoint
// exists for: stepping the replay cursor back discards trades the engine had
// already reported, and the stored journal has to shrink with it. The
// append-only predecessor left those rows behind, so the trade panel showed
// 0 trades while the database still held them.
func TestReplaceTrades_ShortenedJournalDropsRows(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	sess := newTestSession(t, s)

	full := []model.Trade{
		{ID: "trade-1", Symbol: "NQ", Side: "long", Qty: 1, ExitTs: 100, CreatedAt: 100},
		{ID: "trade-3", Symbol: "NQ", Side: "short", Qty: 1, ExitTs: 200, CreatedAt: 200},
	}
	if err := s.ReplaceTrades(ctx, sess.ID, full); err != nil {
		t.Fatalf("ReplaceTrades: %v", err)
	}
	if err := s.ReplaceTrades(ctx, sess.ID, full[:1]); err != nil {
		t.Fatalf("ReplaceTrades (rewound): %v", err)
	}

	trades, err := s.ListTrades(ctx, sess.ID)
	if err != nil {
		t.Fatalf("ListTrades: %v", err)
	}
	if len(trades) != 1 || trades[0].ExitTs != 100 {
		t.Fatalf("trades = %+v, want only the first trade after the rewind", trades)
	}
}

// TestReplaceTrades_IsIdempotent covers the property that removed the
// client's "already persisted" bookkeeping: re-sending the same journal must
// not duplicate rows.
func TestReplaceTrades_IsIdempotent(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	sess := newTestSession(t, s)

	journal := []model.Trade{
		{ID: "trade-1", Symbol: "NQ", Side: "long", Qty: 1, ExitTs: 100, CreatedAt: 100},
		{ID: "trade-2", Symbol: "NQ", Side: "short", Qty: 1, ExitTs: 200, CreatedAt: 200},
	}
	for attempt := 0; attempt < 3; attempt++ {
		if err := s.ReplaceTrades(ctx, sess.ID, journal); err != nil {
			t.Fatalf("ReplaceTrades attempt %d: %v", attempt, err)
		}
	}
	trades, err := s.ListTrades(ctx, sess.ID)
	if err != nil {
		t.Fatalf("ListTrades: %v", err)
	}
	if len(trades) != 2 {
		t.Fatalf("len(trades) = %d after 3 identical writes, want 2", len(trades))
	}
}

func TestListTrades_EmptyIsNotError(t *testing.T) {
	s := openTestStore(t)
	trades, err := s.ListTrades(context.Background(), "no-such-session")
	if err != nil {
		t.Fatalf("ListTrades: %v", err)
	}
	if len(trades) != 0 {
		t.Errorf("len(trades) = %d, want 0", len(trades))
	}
}

// TestListTrades_LiveSessionsBypassCursor is the regression for the live
// journal being invisible end-to-end: hand-entered trades are stamped with
// wall-clock timestamps that always sit past the session cursor (nothing
// advances a live session's cursor — eval sessions advance it as their engine
// ticks), so the cursor bound used to filter every trade out of both the
// panel and analytics.
func TestListTrades_LiveSessionsBypassCursor(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	live, err := s.CreateSession(ctx, model.Session{Symbol: "LIVE", Tf: "1d", StartTs: 1000, Kind: model.SessionKindLive})
	if err != nil {
		t.Fatalf("CreateSession(live): %v", err)
	}
	journal := []model.Trade{
		{ID: "trade-1", Symbol: "AAPL", Side: "long", Qty: 2, ExitTs: 2000, CreatedAt: 2000},
		{ID: "trade-2", Symbol: "MSFT", Side: "short", Qty: 1, ExitTs: 3000, CreatedAt: 3000},
	}
	if err := s.ReplaceTrades(ctx, live.ID, journal); err != nil {
		t.Fatalf("ReplaceTrades: %v", err)
	}
	// Cursor is still at StartTs (1000); both trades exit after it.
	trades, err := s.ListTrades(ctx, live.ID)
	if err != nil {
		t.Fatalf("ListTrades: %v", err)
	}
	if len(trades) != 2 {
		t.Fatalf("live session has %d trades, want 2 (cursor exemption)", len(trades))
	}

	// A replay session with the same cursor must still hide the same trades:
	// the bound exists so a rewind can never hand back a future trade.
	replay := newTestSession(t, s)
	if err := s.ReplaceTrades(ctx, replay.ID, journal); err != nil {
		t.Fatalf("ReplaceTrades (replay): %v", err)
	}
	trades, err = s.ListTrades(ctx, replay.ID)
	if err != nil {
		t.Fatalf("ListTrades (replay): %v", err)
	}
	if len(trades) != 0 {
		t.Fatalf("replay session has %d trades, want 0 (cursor bound still applies)", len(trades))
	}
}

// TestListTrades_PreservesJournalOrder pins the ordering contract the client
// depends on: the journal comes back in the order the engine closed the
// trades, even though a replace writes every row inside one transaction.
func TestListTrades_PreservesJournalOrder(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	sess := newTestSession(t, s)

	journal := []model.Trade{
		{ID: "trade-1", Symbol: "NQ", Side: "long", Qty: 1, ExitTs: 100, CreatedAt: 100},
		{ID: "trade-2", Symbol: "NQ", Side: "short", Qty: 1, ExitTs: 200, CreatedAt: 200},
		{ID: "trade-3", Symbol: "NQ", Side: "long", Qty: 1, ExitTs: 300, CreatedAt: 300},
	}
	if err := s.ReplaceTrades(ctx, sess.ID, journal); err != nil {
		t.Fatalf("ReplaceTrades: %v", err)
	}
	trades, err := s.ListTrades(ctx, sess.ID)
	if err != nil {
		t.Fatalf("ListTrades: %v", err)
	}
	if len(trades) != len(journal) {
		t.Fatalf("len(trades) = %d, want %d", len(trades), len(journal))
	}
	for index, want := range journal {
		if trades[index].ExitTs != want.ExitTs {
			t.Fatalf("trades[%d] exits at %d, want %d (order lost)", index, trades[index].ExitTs, want.ExitTs)
		}
	}
}
