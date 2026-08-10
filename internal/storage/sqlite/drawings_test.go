package sqlite

import (
	"context"
	"testing"

	"market-replay/internal/model"
)

func TestUpsertDrawings_RoundTrip(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	applied, err := s.UpsertDrawings(ctx, []model.Drawing{
		{ID: "d1", Bucket: "global:NQ", Symbol: "NQ", AnchorTs: 1000, CreatedTf: "1m", Payload: `{"type":"trendline"}`},
	})
	if err != nil {
		t.Fatalf("UpsertDrawings: %v", err)
	}
	if applied != 1 {
		t.Fatalf("applied = %d, want 1", applied)
	}

	got, err := s.ListDrawings(ctx, model.DrawingFilter{Bucket: "global:NQ", Symbol: "NQ"})
	if err != nil {
		t.Fatalf("ListDrawings: %v", err)
	}
	if len(got) != 1 || got[0].ID != "d1" || got[0].UpdatedAt == 0 {
		t.Fatalf("got = %+v, unexpected", got)
	}
}

func TestUpsertDrawings_UpdateInPlace(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	if _, err := s.UpsertDrawings(ctx, []model.Drawing{
		{ID: "d1", Bucket: "global:NQ", Symbol: "NQ", AnchorTs: 1000, CreatedTf: "1m", Payload: "v1"},
	}); err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	if _, err := s.UpsertDrawings(ctx, []model.Drawing{
		{ID: "d1", Bucket: "global:NQ", Symbol: "NQ", AnchorTs: 2000, CreatedTf: "1m", Payload: "v2"},
	}); err != nil {
		t.Fatalf("second upsert: %v", err)
	}

	got, err := s.ListDrawings(ctx, model.DrawingFilter{Bucket: "global:NQ", Symbol: "NQ"})
	if err != nil {
		t.Fatalf("ListDrawings: %v", err)
	}
	if len(got) != 1 || got[0].Payload != "v2" || got[0].AnchorTs != 2000 {
		t.Fatalf("got = %+v, want a single updated row (upsert, not duplicate)", got)
	}
}

func TestUpsertDrawings_Tombstone(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	if _, err := s.UpsertDrawings(ctx, []model.Drawing{
		{ID: "d1", Bucket: "global:NQ", Symbol: "NQ", AnchorTs: 1000, CreatedTf: "1m", Payload: "v1"},
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if _, err := s.UpsertDrawings(ctx, []model.Drawing{
		{ID: "d1", Bucket: "global:NQ", Symbol: "NQ", AnchorTs: 1000, CreatedTf: "1m", Payload: "v1", Deleted: true},
	}); err != nil {
		t.Fatalf("tombstone: %v", err)
	}

	got, err := s.ListDrawings(ctx, model.DrawingFilter{Bucket: "global:NQ", Symbol: "NQ"})
	if err != nil {
		t.Fatalf("ListDrawings: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got = %+v, want empty (tombstoned rows excluded from ListDrawings)", got)
	}
}

func TestListDrawings_AntiSpoilerAppliesOnlyToSessionBucket(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	// Same anchor_ts (2000), one in each bucket type. cursorTs=1000 is
	// BEFORE anchor_ts, so a spoiler-aware filter should exclude it —
	// but only for the session bucket.
	_, err := s.UpsertDrawings(ctx, []model.Drawing{
		{ID: "future-in-session", Bucket: "session:sess1", Symbol: "NQ", AnchorTs: 2000, CreatedTf: "1m", Payload: "x"},
		{ID: "future-in-global", Bucket: "global:NQ", Symbol: "NQ", AnchorTs: 2000, CreatedTf: "1m", Payload: "x"},
	})
	if err != nil {
		t.Fatalf("UpsertDrawings: %v", err)
	}

	cursorTs := int64(1000)

	sessionResult, err := s.ListDrawings(ctx, model.DrawingFilter{Bucket: "session:sess1", Symbol: "NQ", CursorTs: &cursorTs})
	if err != nil {
		t.Fatalf("ListDrawings(session): %v", err)
	}
	if len(sessionResult) != 0 {
		t.Errorf("session bucket result = %+v, want empty (anchor_ts=2000 > cursorTs=1000, must be excluded)", sessionResult)
	}

	globalResult, err := s.ListDrawings(ctx, model.DrawingFilter{Bucket: "global:NQ", Symbol: "NQ", CursorTs: &cursorTs})
	if err != nil {
		t.Fatalf("ListDrawings(global): %v", err)
	}
	if len(globalResult) != 1 {
		t.Errorf("global bucket result = %+v, want the one row (global ignores cursorTs)", globalResult)
	}
}

func TestListDrawings_CreatedTfFilter(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	_, err := s.UpsertDrawings(ctx, []model.Drawing{
		{ID: "d-1m", Bucket: "global:NQ", Symbol: "NQ", AnchorTs: 1000, CreatedTf: "1m", Payload: "x"},
		{ID: "d-1d", Bucket: "global:NQ", Symbol: "NQ", AnchorTs: 1000, CreatedTf: "1d", Payload: "x"},
	})
	if err != nil {
		t.Fatalf("UpsertDrawings: %v", err)
	}

	got, err := s.ListDrawings(ctx, model.DrawingFilter{Bucket: "global:NQ", Symbol: "NQ", CreatedTf: []string{"1m"}})
	if err != nil {
		t.Fatalf("ListDrawings: %v", err)
	}
	if len(got) != 1 || got[0].ID != "d-1m" {
		t.Fatalf("got = %+v, want only the 1m drawing", got)
	}
}
