package sqlite

import (
	"context"
	"testing"
	"time"

	"market-replay/internal/model"
)

func journalImageStore(t *testing.T) (*Store, string) {
	t.Helper()
	store := openTestStore(t)
	// The image table is keyed to a session via FK — seed one. CreateSession
	// assigns its own uuid (sqlite/sessions.go), so the returned ID is the
	// session ID every fixture below must reference. The fields CreateSession
	// generates server-side (ID, CursorTs, EquityCents, Status, timestamps)
	// are deliberately not set here.
	seeded, err := store.CreateSession(context.Background(), model.Session{
		Name: "Live", Symbol: "LIVE", Tf: "1d",
		StartTs:             1700000000000,
		Kind:                model.SessionKindLive,
		InitialBalanceCents: int64Ptr(1000000),
	})
	if err != nil {
		t.Fatalf("seed session: %v", err)
	}
	return store, seeded.ID
}

func int64Ptr(v int64) *int64 { return &v }

func TestSaveAndGetJournalImage(t *testing.T) {
	store, sessionID := journalImageStore(t)
	img := model.JournalImage{
		ID: "img-1", SessionID: sessionID, Mime: "image/png",
		Size: 4, Data: []byte{1, 2, 3, 4}, Caption: "entry", CreatedAt: time.Now(),
	}
	if err := store.SaveJournalImage(context.Background(), img); err != nil {
		t.Fatalf("save: %v", err)
	}
	got, err := store.GetJournalImage(context.Background(), "img-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Mime != "image/png" || len(got.Data) != 4 || got.Caption != "entry" {
		t.Fatalf("got %+v", got)
	}
}

func TestListJournalImagesExcludesOtherSessions(t *testing.T) {
	store, sessionID := journalImageStore(t)
	other, err := store.CreateSession(context.Background(), model.Session{
		Name: "Other", Symbol: "LIVE", Tf: "1d",
		StartTs:             1700000000000,
		Kind:                model.SessionKindLive,
		InitialBalanceCents: int64Ptr(1000000),
	})
	if err != nil {
		t.Fatalf("seed other session: %v", err)
	}
	now := time.Now()
	for _, id := range []string{"img-a", "img-b", "img-other"} {
		sid := sessionID
		if id == "img-other" {
			sid = other.ID
		}
		if err := store.SaveJournalImage(context.Background(), model.JournalImage{ID: id, SessionID: sid, Mime: "image/png", Size: 1, Data: []byte{0}, CreatedAt: now}); err != nil {
			t.Fatalf("save %s: %v", id, err)
		}
	}
	got, err := store.ListJournalImages(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2 (%+v)", len(got), got)
	}
	for _, img := range got {
		if img.SessionID != sessionID {
			t.Fatalf("leaked image %s", img.ID)
		}
	}
}

func TestDeleteJournalImage(t *testing.T) {
	store, sessionID := journalImageStore(t)
	now := time.Now()
	if err := store.SaveJournalImage(context.Background(), model.JournalImage{ID: "img-x", SessionID: sessionID, Mime: "image/png", Size: 1, Data: []byte{1}, CreatedAt: now}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := store.DeleteJournalImage(context.Background(), "img-x"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := store.GetJournalImage(context.Background(), "img-x"); err == nil {
		t.Fatal("get after delete: want error, got nil")
	}
}
