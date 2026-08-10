package sqlite

import (
	"context"
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
	in := model.Trade{
		ID: "trade-1", Symbol: "NQ", Side: "long", Qty: 2,
		EntryTs: 1000, EntryPriceTicks: 80000,
		ExitTs: 1300, ExitPriceTicks: 80100,
		RealizedCents: 50000, FeesCents: 209,
		MfeTicks: 150, MaeTicks: -20, RMultiple: &r, CreatedAt: 1300,
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
