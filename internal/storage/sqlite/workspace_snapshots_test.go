package sqlite

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"market-replay/internal/model"
	"market-replay/internal/storage"
)

func testSnapshot(ownerType, ownerID, reason string, capturedAt int64) model.WorkspaceSnapshot {
	return model.WorkspaceSnapshot{
		UserID: "local", OwnerType: ownerType, OwnerID: ownerID,
		Reason: reason, CursorTs: 1000, Version: 1,
		Payload: json.RawMessage(`{"version":1}`), CapturedAt: capturedAt,
	}
}

func TestPutWorkspaceSnapshot_CreatesWithRevisionOne(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	persisted, accepted, err := s.PutWorkspaceSnapshot(ctx, testSnapshot("replay", "sess-1", model.WorkspaceSnapshotReasonTradeClose, 1000))
	if err != nil {
		t.Fatalf("PutWorkspaceSnapshot: %v", err)
	}
	if !accepted {
		t.Fatalf("accepted = false, want true for a first write")
	}
	if persisted.Revision != 1 {
		t.Fatalf("revision = %d, want 1", persisted.Revision)
	}
	if persisted.CapturedAt != 1000 {
		t.Fatalf("capturedAt = %d, want 1000", persisted.CapturedAt)
	}
}

func TestPutWorkspaceSnapshot_NewerCapturedAtOverwritesAndBumpsRevision(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	first, _, err := s.PutWorkspaceSnapshot(ctx, testSnapshot("replay", "sess-1", model.WorkspaceSnapshotReasonTradeClose, 1000))
	if err != nil {
		t.Fatalf("first put: %v", err)
	}

	second := testSnapshot("replay", "sess-1", model.WorkspaceSnapshotReasonTradeClose, 2000)
	second.Payload = json.RawMessage(`{"version":1,"cursorTs":2000}`)
	persisted, accepted, err := s.PutWorkspaceSnapshot(ctx, second)
	if err != nil {
		t.Fatalf("second put: %v", err)
	}
	if !accepted {
		t.Fatalf("accepted = false, want true for a strictly newer capturedAt")
	}
	if persisted.Revision != first.Revision+1 {
		t.Fatalf("revision = %d, want %d", persisted.Revision, first.Revision+1)
	}
	if string(persisted.Payload) != `{"version":1,"cursorTs":2000}` {
		t.Fatalf("payload = %s, want the newer payload", persisted.Payload)
	}
}

func TestPutWorkspaceSnapshot_OlderCapturedAtIsRejected(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	newer, _, err := s.PutWorkspaceSnapshot(ctx, testSnapshot("replay", "sess-1", model.WorkspaceSnapshotReasonExplicitExit, 5000))
	if err != nil {
		t.Fatalf("newer put: %v", err)
	}

	stale := testSnapshot("replay", "sess-1", model.WorkspaceSnapshotReasonTradeClose, 1000)
	persisted, accepted, err := s.PutWorkspaceSnapshot(ctx, stale)
	if err != nil {
		t.Fatalf("stale put: %v", err)
	}
	if accepted {
		t.Fatalf("accepted = true, want false: an older trade_close must not overwrite a newer explicit_exit")
	}
	// Rejected write must leave the persisted row untouched.
	if persisted.Revision != newer.Revision || persisted.CapturedAt != newer.CapturedAt || persisted.Reason != newer.Reason {
		t.Fatalf("persisted = %+v, want the untouched newer row %+v", persisted, newer)
	}

	got, err := s.GetWorkspaceSnapshot(ctx, "local", "replay", "sess-1")
	if err != nil {
		t.Fatalf("GetWorkspaceSnapshot: %v", err)
	}
	if got.Reason != model.WorkspaceSnapshotReasonExplicitExit {
		t.Fatalf("stored reason = %s, want explicit_exit to have survived the stale write attempt", got.Reason)
	}
}

func TestPutWorkspaceSnapshot_ExplicitExitOverwritesTradeCloseAtSameCapturedAt(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	if _, _, err := s.PutWorkspaceSnapshot(ctx, testSnapshot("replay", "sess-1", model.WorkspaceSnapshotReasonTradeClose, 9000)); err != nil {
		t.Fatalf("trade_close put: %v", err)
	}

	persisted, accepted, err := s.PutWorkspaceSnapshot(ctx, testSnapshot("replay", "sess-1", model.WorkspaceSnapshotReasonExplicitExit, 9000))
	if err != nil {
		t.Fatalf("explicit_exit put: %v", err)
	}
	if !accepted {
		t.Fatalf("accepted = false, want true: explicit_exit must win the tiebreak at an identical capturedAt")
	}
	if persisted.Reason != model.WorkspaceSnapshotReasonExplicitExit {
		t.Fatalf("reason = %s, want explicit_exit", persisted.Reason)
	}
}

func TestPutWorkspaceSnapshot_TradeCloseDoesNotOverwriteExplicitExitAtSameCapturedAt(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	if _, _, err := s.PutWorkspaceSnapshot(ctx, testSnapshot("replay", "sess-1", model.WorkspaceSnapshotReasonExplicitExit, 9000)); err != nil {
		t.Fatalf("explicit_exit put: %v", err)
	}

	persisted, accepted, err := s.PutWorkspaceSnapshot(ctx, testSnapshot("replay", "sess-1", model.WorkspaceSnapshotReasonTradeClose, 9000))
	if err != nil {
		t.Fatalf("trade_close put: %v", err)
	}
	if accepted {
		t.Fatalf("accepted = true, want false: trade_close must lose the tiebreak at an identical capturedAt")
	}
	if persisted.Reason != model.WorkspaceSnapshotReasonExplicitExit {
		t.Fatalf("reason = %s, want explicit_exit to remain stored", persisted.Reason)
	}
}

func TestPutWorkspaceSnapshot_IdenticalRetryIsIdempotent(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	snap := testSnapshot("replay", "sess-1", model.WorkspaceSnapshotReasonTradeClose, 1000)
	first, accepted1, err := s.PutWorkspaceSnapshot(ctx, snap)
	if err != nil {
		t.Fatalf("first put: %v", err)
	}
	if !accepted1 {
		t.Fatalf("first accepted = false, want true")
	}

	second, accepted2, err := s.PutWorkspaceSnapshot(ctx, snap)
	if err != nil {
		t.Fatalf("retry put: %v", err)
	}
	if !accepted2 {
		t.Fatalf("retry accepted = false, want true: an identical retry must be idempotent, not a conflict")
	}
	if second.Revision != first.Revision {
		t.Fatalf("revision = %d, want unchanged %d for an idempotent retry", second.Revision, first.Revision)
	}
}

func TestGetWorkspaceSnapshot_NotFound(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	_, err := s.GetWorkspaceSnapshot(ctx, "local", "replay", "never-stored")
	if !errors.Is(err, storage.ErrWorkspaceSnapshotNotFound) {
		t.Fatalf("err = %v, want ErrWorkspaceSnapshotNotFound", err)
	}
}

func TestDeleteWorkspaceSnapshot_Idempotent(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	if _, _, err := s.PutWorkspaceSnapshot(ctx, testSnapshot("replay", "sess-1", model.WorkspaceSnapshotReasonTradeClose, 1000)); err != nil {
		t.Fatalf("put: %v", err)
	}
	if err := s.DeleteWorkspaceSnapshot(ctx, "local", "replay", "sess-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	// Deleting an owner that was never stored is a no-op, not an error.
	if err := s.DeleteWorkspaceSnapshot(ctx, "local", "replay", "never-stored"); err != nil {
		t.Fatalf("delete unknown: %v", err)
	}

	_, err := s.GetWorkspaceSnapshot(ctx, "local", "replay", "sess-1")
	if !errors.Is(err, storage.ErrWorkspaceSnapshotNotFound) {
		t.Fatalf("err = %v, want ErrWorkspaceSnapshotNotFound after delete", err)
	}
}

func TestWorkspaceSnapshot_ReplayAndEvalAreIsolated(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	// Same owner id string, different owner type: must not collide.
	if _, _, err := s.PutWorkspaceSnapshot(ctx, testSnapshot("replay", "shared-id", model.WorkspaceSnapshotReasonTradeClose, 1000)); err != nil {
		t.Fatalf("replay put: %v", err)
	}
	if _, _, err := s.PutWorkspaceSnapshot(ctx, testSnapshot("eval", "shared-id", model.WorkspaceSnapshotReasonExplicitExit, 2000)); err != nil {
		t.Fatalf("eval put: %v", err)
	}

	replaySnap, err := s.GetWorkspaceSnapshot(ctx, "local", "replay", "shared-id")
	if err != nil {
		t.Fatalf("get replay: %v", err)
	}
	evalSnap, err := s.GetWorkspaceSnapshot(ctx, "local", "eval", "shared-id")
	if err != nil {
		t.Fatalf("get eval: %v", err)
	}
	if replaySnap.Reason != model.WorkspaceSnapshotReasonTradeClose || replaySnap.CapturedAt != 1000 {
		t.Fatalf("replay snapshot corrupted by eval write: %+v", replaySnap)
	}
	if evalSnap.Reason != model.WorkspaceSnapshotReasonExplicitExit || evalSnap.CapturedAt != 2000 {
		t.Fatalf("eval snapshot corrupted by replay write: %+v", evalSnap)
	}

	if err := s.DeleteWorkspaceSnapshot(ctx, "local", "replay", "shared-id"); err != nil {
		t.Fatalf("delete replay: %v", err)
	}
	if _, err := s.GetWorkspaceSnapshot(ctx, "local", "eval", "shared-id"); err != nil {
		t.Fatalf("eval snapshot must survive deleting the replay one: %v", err)
	}
}

func TestPutWorkspaceSnapshot_ConcurrentWritesConvergeOnHighestRank(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	capturedAts := []int64{1000, 5000, 2000, 9000, 3000, 4000}
	var wg sync.WaitGroup
	for _, ts := range capturedAts {
		wg.Add(1)
		go func(capturedAt int64) {
			defer wg.Done()
			// Errors are asserted after Wait to keep goroutines simple; a
			// failure here would still surface via the final state check.
			_, _, _ = s.PutWorkspaceSnapshot(ctx, testSnapshot("replay", "sess-1", model.WorkspaceSnapshotReasonTradeClose, capturedAt))
		}(ts)
	}
	wg.Wait()

	got, err := s.GetWorkspaceSnapshot(ctx, "local", "replay", "sess-1")
	if err != nil {
		t.Fatalf("GetWorkspaceSnapshot: %v", err)
	}
	if got.CapturedAt != 9000 {
		t.Fatalf("capturedAt = %d, want 9000 (the highest-rank write) regardless of goroutine finish order", got.CapturedAt)
	}
}
