package sqlite

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"market-replay/internal/model"
	"market-replay/internal/storage"
)

func TestCreateSession_DefaultsAndRoundTrip(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	created, err := s.CreateSession(ctx, model.Session{
		Symbol: "NQ", Tf: "1m", StartTs: 1000,
		Config: json.RawMessage(`{"maxContracts":5}`),
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if created.ID == "" {
		t.Fatal("CreateSession did not assign an id")
	}
	if created.Status != model.SessionActive {
		t.Errorf("Status = %q, want %q", created.Status, model.SessionActive)
	}
	if created.EquityCents != 0 {
		t.Errorf("EquityCents = %d, want 0 (default)", created.EquityCents)
	}
	if created.CursorTs != created.StartTs {
		t.Errorf("CursorTs = %d, want %d (== StartTs at creation)", created.CursorTs, created.StartTs)
	}

	got, err := s.GetSession(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got.Symbol != "NQ" || string(got.Config) != `{"maxContracts":5}` {
		t.Errorf("GetSession = %+v, unexpected", got)
	}
}

func TestCreateSession_DefaultConfig(t *testing.T) {
	s := openTestStore(t)
	created, err := s.CreateSession(context.Background(), model.Session{Symbol: "NQ", Tf: "1m", StartTs: 1000})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if string(created.Config) != "{}" {
		t.Errorf("Config = %s, want {} when none provided", created.Config)
	}
}

func TestCreateSession_PausesPreviouslyActiveSession(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	first, err := s.CreateSession(ctx, model.Session{Symbol: "NQ", Tf: "1m", StartTs: 1000})
	if err != nil {
		t.Fatalf("CreateSession first: %v", err)
	}
	second, err := s.CreateSession(ctx, model.Session{Symbol: "ES", Tf: "5m", StartTs: 2000})
	if err != nil {
		t.Fatalf("CreateSession second: %v", err)
	}
	old, err := s.GetSession(ctx, first.ID)
	if err != nil {
		t.Fatalf("GetSession first: %v", err)
	}
	current, err := s.GetSession(ctx, second.ID)
	if err != nil {
		t.Fatalf("GetSession second: %v", err)
	}
	if old.Status != model.SessionPaused || current.Status != model.SessionActive {
		t.Fatalf("statuses = %s, %s; want paused, active", old.Status, current.Status)
	}
}

func TestInit_PausesActiveSessionAfterRestart(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	created, err := s.CreateSession(ctx, model.Session{Symbol: "NQ", Tf: "1m", StartTs: 1000})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if err := s.Init(ctx); err != nil {
		t.Fatalf("Init: %v", err)
	}
	got, err := s.GetSession(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got.Status != model.SessionPaused {
		t.Fatalf("status = %s, want paused", got.Status)
	}
}

func TestGetSession_NotFound(t *testing.T) {
	s := openTestStore(t)
	if _, err := s.GetSession(context.Background(), "nope"); !errors.Is(err, storage.ErrSessionNotFound) {
		t.Fatalf("err = %v, want storage.ErrSessionNotFound", err)
	}
}

func TestUpdateSession_PartialPatch(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	created, err := s.CreateSession(ctx, model.Session{Symbol: "NQ", Tf: "1m", StartTs: 1000})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	cursor := int64(2000)
	if err := s.UpdateSession(ctx, created.ID, model.SessionPatch{CursorTs: &cursor}); err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	got, err := s.GetSession(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got.CursorTs != 2000 {
		t.Errorf("CursorTs = %d, want 2000", got.CursorTs)
	}
	// Untouched fields must survive the partial patch.
	if got.EquityCents != 0 || got.Status != model.SessionActive {
		t.Errorf("untouched fields changed: equity=%d status=%s", got.EquityCents, got.Status)
	}

	equity := int64(150000)
	status := model.SessionPaused
	config := json.RawMessage(`{"runtime":{"sequence":7}}`)
	if err := s.UpdateSession(ctx, created.ID, model.SessionPatch{EquityCents: &equity, Status: &status, Config: &config}); err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}
	got2, err := s.GetSession(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got2.EquityCents != 150000 || got2.Status != model.SessionPaused || got2.CursorTs != 2000 || string(got2.Config) != string(config) {
		t.Errorf("second patch = %+v, unexpected", got2)
	}
}

func TestUpdateSession_NotFound(t *testing.T) {
	s := openTestStore(t)
	cursor := int64(1)
	err := s.UpdateSession(context.Background(), "nope", model.SessionPatch{CursorTs: &cursor})
	if !errors.Is(err, storage.ErrSessionNotFound) {
		t.Fatalf("err = %v, want storage.ErrSessionNotFound", err)
	}
}

func TestDeleteSession_RemovesSessionAndTrades(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	created, err := s.CreateSession(ctx, model.Session{Symbol: "NQ", Tf: "1m", StartTs: 1000})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if err := s.ReplaceTrades(ctx, created.ID, []model.Trade{{ID: "trade-1", Symbol: "NQ", Side: "long", Qty: 1}}); err != nil {
		t.Fatalf("ReplaceTrades: %v", err)
	}
	if err := s.DeleteSession(ctx, created.ID); err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}
	if _, err := s.GetSession(ctx, created.ID); !errors.Is(err, storage.ErrSessionNotFound) {
		t.Fatalf("GetSession error = %v, want not found", err)
	}
	trades, err := s.ListTrades(ctx, created.ID)
	if err != nil {
		t.Fatalf("ListTrades: %v", err)
	}
	if len(trades) != 0 {
		t.Fatalf("len(trades) = %d, want 0", len(trades))
	}
}

func TestDeleteEmptySessions_RemovesOnlyInactiveLegacyShells(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	empty, err := s.CreateSession(ctx, model.Session{Symbol: "NQ", Tf: "1m", StartTs: 1000})
	if err != nil {
		t.Fatalf("CreateSession empty: %v", err)
	}
	progressed, err := s.CreateSession(ctx, model.Session{Symbol: "NQ", Tf: "1m", StartTs: 2000})
	if err != nil {
		t.Fatalf("CreateSession progressed: %v", err)
	}
	cursor := int64(2060)
	paused := model.SessionPaused
	if err := s.UpdateSession(ctx, progressed.ID, model.SessionPatch{CursorTs: &cursor, Status: &paused}); err != nil {
		t.Fatalf("UpdateSession progressed: %v", err)
	}
	deleted, err := s.DeleteEmptySessions(ctx)
	if err != nil {
		t.Fatalf("DeleteEmptySessions: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("deleted = %d, want 1", deleted)
	}
	if _, err := s.GetSession(ctx, empty.ID); !errors.Is(err, storage.ErrSessionNotFound) {
		t.Fatalf("empty session error = %v, want not found", err)
	}
	if _, err := s.GetSession(ctx, progressed.ID); err != nil {
		t.Fatalf("progressed session was removed: %v", err)
	}
}

func TestListSessions_OrderedNewestFirst(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	first, err := s.CreateSession(ctx, model.Session{Symbol: "NQ", Tf: "1m", StartTs: 1})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	second, err := s.CreateSession(ctx, model.Session{Symbol: "ES", Tf: "1m", StartTs: 2})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	list, err := s.ListSessions(ctx)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("len(list) = %d, want 2", len(list))
	}
	ids := map[string]bool{first.ID: true, second.ID: true}
	if !ids[list[0].ID] || !ids[list[1].ID] {
		t.Errorf("list = %+v, missing expected ids", list)
	}
}
