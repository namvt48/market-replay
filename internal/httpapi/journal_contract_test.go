package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The journal is the one piece of state the client cannot recompute: the
// replay cursor and the chart come back from the dataset, but a closed trade
// exists only because someone traded it. These tests pin the rules that keep
// the stored journal and the client's own agreeing.

func serve(t *testing.T, s *Server, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func tradeJSON(id string, exitTs int64) string {
	return fmt.Sprintf(`{"id":%q,"symbol":"NQ","side":"long","qty":1,"entryTs":%d,"entryPriceTicks":80000,"exitTs":%d,"exitPriceTicks":80100,"realizedCents":500,"feesCents":10,"mfeTicks":5,"maeTicks":2,"rMultiple":null,"createdAt":%d}`,
		id, exitTs-60, exitTs, exitTs)
}

// listExits reads the stored journal keyed by exit timestamp — the field the
// client owns and that identifies a trade across a rewind. Stored ids are
// server-assigned, so they are not a stable handle for assertions.
func listExits(t *testing.T, s *Server, sessionID string) []int64 {
	t.Helper()
	rec := serve(t, s, http.MethodGet, "/api/v1/sessions/"+sessionID+"/trades", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list trades = %d (%s)", rec.Code, rec.Body.String())
	}
	var trades []struct {
		ID     string `json:"id"`
		ExitTs int64  `json:"exitTs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &trades); err != nil {
		t.Fatalf("decode trades: %v (%s)", err, rec.Body.String())
	}
	exits := make([]int64, 0, len(trades))
	for _, trade := range trades {
		if trade.ID == "" {
			t.Fatalf("stored trade has no id: %s", rec.Body.String())
		}
		exits = append(exits, trade.ExitTs)
	}
	return exits
}

// TestJournalWriteSurvivesAPausedSession — the client checkpoints a session by
// firing the status patch and the journal write together. Requiring "active"
// on the journal write meant that whenever the patch won the race the write
// was rejected, and because the client swallows checkpoint errors the
// session's final journal simply went missing.
func TestJournalWriteSurvivesAPausedSession(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)

	if rec := serve(t, s, http.MethodPatch, "/api/v1/sessions/"+id, `{"status":"paused"}`); rec.Code != http.StatusOK {
		t.Fatalf("patch status = %d", rec.Code)
	}
	if rec := serve(t, s, http.MethodPut, "/api/v1/sessions/"+id+"/trades", "["+tradeJSON("trade-1", 1_000)+"]"); rec.Code != http.StatusOK {
		t.Fatalf("journal write to a paused session = %d (%s)", rec.Code, rec.Body.String())
	}
	if got := listExits(t, s, id); len(got) != 1 || got[0] != 1_000 {
		t.Fatalf("stored journal = %v, want the one trade that closed at 1000", got)
	}
}

// TestJournalIsBoundedByTheReplayCursor — a trade cannot have closed after the
// cursor. Rewinding therefore has to un-happen the trades past the new cursor,
// on both the write and the read path: the write keeps the table honest, the
// read guarantees a resume can never be handed a trade from the future even if
// the client's debounced shortening write was lost to a crash.
func TestJournalIsBoundedByTheReplayCursor(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)

	journal := "[" + tradeJSON("trade-1", 1_000) + "," + tradeJSON("trade-2", 2_000) + "]"
	if rec := serve(t, s, http.MethodPut, "/api/v1/sessions/"+id+"/trades", journal); rec.Code != http.StatusOK {
		t.Fatalf("seed journal = %d (%s)", rec.Code, rec.Body.String())
	}
	if rec := serve(t, s, http.MethodPatch, "/api/v1/sessions/"+id, `{"cursorTs":2100}`); rec.Code != http.StatusOK {
		t.Fatalf("advance cursor = %d", rec.Code)
	}
	if got := listExits(t, s, id); len(got) != 2 {
		t.Fatalf("with the cursor at 2100 the journal = %v, want both trades", got)
	}

	// Rewind past trade-2's exit, the way step-back does.
	if rec := serve(t, s, http.MethodPatch, "/api/v1/sessions/"+id, `{"cursorTs":1500}`); rec.Code != http.StatusOK {
		t.Fatalf("rewind cursor = %d", rec.Code)
	}
	if got := listExits(t, s, id); len(got) != 1 || got[0] != 1_000 {
		t.Fatalf("after rewinding to 1500 the journal = %v, want only the trade that closed at 1000", got)
	}

	// And it is gone from the table, not merely hidden: advancing the cursor
	// again must not resurrect it.
	if rec := serve(t, s, http.MethodPatch, "/api/v1/sessions/"+id, `{"cursorTs":3000}`); rec.Code != http.StatusOK {
		t.Fatalf("re-advance cursor = %d", rec.Code)
	}
	if got := listExits(t, s, id); len(got) != 1 || got[0] != 1_000 {
		t.Fatalf("journal = %v after re-advancing; a pruned trade came back", got)
	}
}

// TestJournalRejectsMalformedTrades — the client reads the journal back
// through a strict schema, and its resume path swallows a parse failure. A row
// the server accepted but the client cannot parse therefore empties the whole
// journal with no error shown, so the write is where it has to be caught.
func TestJournalRejectsMalformedTrades(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)

	cases := map[string]string{
		"no symbol":           `[{"id":"t1","side":"long","qty":1,"entryTs":1,"exitTs":2,"createdAt":2}]`,
		"unknown side":        `[{"id":"t1","symbol":"NQ","side":"banana","qty":1,"entryTs":1,"exitTs":2,"createdAt":2}]`,
		"zero quantity":       `[{"id":"t1","symbol":"NQ","side":"long","qty":0,"entryTs":1,"exitTs":2,"createdAt":2}]`,
		"negative quantity":   `[{"id":"t1","symbol":"NQ","side":"long","qty":-3,"entryTs":1,"exitTs":2,"createdAt":2}]`,
		"negative time":       `[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":-5,"exitTs":2,"createdAt":2}]`,
		"exit before entry":   `[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":900,"exitTs":100,"createdAt":100}]`,
		"invalid exit reason": `[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":1,"exitTs":2,"exitReason":"liquidated","createdAt":2}]`,
		"invalid adjustment":  `[{"id":"t1","symbol":"NQ","side":"long","qty":1,"entryTs":1,"exitTs":2,"protectionAdjustments":[{"role":"stopLoss","ts":3,"priceTicks":10}],"createdAt":2}]`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			rec := serve(t, s, http.MethodPut, "/api/v1/sessions/"+id+"/trades", body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
			}
		})
	}

	// A rejected write must leave the stored journal untouched.
	if got := listExits(t, s, id); len(got) != 0 {
		t.Fatalf("stored journal = %v after only invalid writes, want empty", got)
	}
}

// TestDeleteEmptySessionsReachesRealSessions — the cleanup action has to be
// able to delete a session created and abandoned exactly the way the app
// creates one. It could not: the predicate also required zero equity and an
// empty config, and starting a replay immediately patches both, so the action
// always reported zero deletions.
func TestDeleteEmptySessionsReachesRealSessions(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	if rec := serve(t, s, http.MethodPatch, "/api/v1/sessions/"+id,
		`{"equityCents":1000000,"status":"active","config":{"version":1,"fill":{"position":null,"orders":[],"realizedCents":0,"equityCents":1000000,"lastTs":900,"sequence":0}}}`); rec.Code != http.StatusOK {
		t.Fatalf("initial patch = %d", rec.Code)
	}
	if rec := serve(t, s, http.MethodPatch, "/api/v1/sessions/"+id, `{"status":"paused"}`); rec.Code != http.StatusOK {
		t.Fatalf("pause = %d", rec.Code)
	}

	rec := serve(t, s, http.MethodDelete, "/api/v1/sessions?empty=true", "")
	var result map[string]int64
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result["deleted"] != 1 {
		t.Fatalf("deleted = %d, want 1", result["deleted"])
	}
}

// TestDeleteEmptySessionsKeepsSessionsWithContent guards the other side: the
// looser predicate must not reach a session that actually holds something.
func TestDeleteEmptySessionsKeepsSessionsWithContent(t *testing.T) {
	s := newTestServer(t)

	traded := createTestSession(t, s)
	if rec := serve(t, s, http.MethodPut, "/api/v1/sessions/"+traded+"/trades", "["+tradeJSON("trade-1", 1_000)+"]"); rec.Code != http.StatusOK {
		t.Fatalf("seed journal = %d (%s)", rec.Code, rec.Body.String())
	}
	if rec := serve(t, s, http.MethodPatch, "/api/v1/sessions/"+traded, `{"status":"paused"}`); rec.Code != http.StatusOK {
		t.Fatalf("pause = %d", rec.Code)
	}

	advanced := createTestSession(t, s)
	if rec := serve(t, s, http.MethodPatch, "/api/v1/sessions/"+advanced, `{"cursorTs":9999,"status":"paused"}`); rec.Code != http.StatusOK {
		t.Fatalf("advance = %d", rec.Code)
	}

	annotated := createTestSession(t, s)
	if rec := serve(t, s, http.MethodPost, "/api/v1/drawings",
		fmt.Sprintf(`[{"id":"d1","bucket":"session:%s","symbol":"NQ","anchorTs":1000,"createdAtCursor":1000,"createdTf":"1m","payload":"{}","deleted":false,"updatedAt":1}]`, annotated)); rec.Code != http.StatusOK {
		t.Fatalf("upsert drawing = %d (%s)", rec.Code, rec.Body.String())
	}
	if rec := serve(t, s, http.MethodPatch, "/api/v1/sessions/"+annotated, `{"status":"paused"}`); rec.Code != http.StatusOK {
		t.Fatalf("pause = %d", rec.Code)
	}

	rec := serve(t, s, http.MethodDelete, "/api/v1/sessions?empty=true", "")
	var result map[string]int64
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result["deleted"] != 0 {
		t.Fatalf("deleted = %d, want 0 — a traded, advanced or annotated session is not empty", result["deleted"])
	}
}

// TestConcurrentSessionPatchesKeepBothFields — UpdateSession reads the row,
// applies the patch in Go and writes every column back. With the read outside
// the transaction, two concurrent patches both saw the old row and the second
// write discarded the first one's field: a cursor checkpoint could erase an
// equity checkpoint the client had already been told succeeded.
func TestConcurrentSessionPatchesKeepBothFields(t *testing.T) {
	s := newTestServer(t)
	id := createTestSession(t, s)
	handler := s.Handler()

	for round := 0; round < 60; round++ {
		cursor := int64(1_000 + round)
		equity := int64(500_000 + round)
		done := make(chan struct{}, 2)
		for _, body := range []string{
			fmt.Sprintf(`{"cursorTs":%d}`, cursor),
			fmt.Sprintf(`{"equityCents":%d}`, equity),
		} {
			go func(payload string) {
				handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+id, bytes.NewBufferString(payload)))
				done <- struct{}{}
			}(body)
		}
		<-done
		<-done

		rec := serve(t, s, http.MethodGet, "/api/v1/sessions", "")
		var sessions []struct {
			CursorTs    int64 `json:"cursorTs"`
			EquityCents int64 `json:"equityCents"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &sessions); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(sessions) != 1 {
			t.Fatalf("len(sessions) = %d", len(sessions))
		}
		if sessions[0].CursorTs != cursor || sessions[0].EquityCents != equity {
			t.Fatalf("round %d lost a field: cursorTs = %d (want %d), equityCents = %d (want %d)",
				round, sessions[0].CursorTs, cursor, sessions[0].EquityCents, equity)
		}
	}
}

// TestJournalWritesAcrossSessionsReusingClientIds is the regression for the
// defect that made journal persistence collapse after the very first session.
// The client numbers trades per session, so every session's first closed trade
// is "trade-1"; stored against a table-wide primary key, the second session's
// journal write failed outright and nothing was ever persisted from then on.
// Unit tests missed it because each used a single fresh session.
func TestJournalWritesAcrossSessionsReusingClientIds(t *testing.T) {
	s := newTestServer(t)
	journal := "[" + tradeJSON("trade-1", 1_000) + "," + tradeJSON("trade-2", 2_000) + "]"

	ids := make([]string, 0, 3)
	for round := 0; round < 3; round++ {
		id := createTestSession(t, s)
		ids = append(ids, id)
		if rec := serve(t, s, http.MethodPut, "/api/v1/sessions/"+id+"/trades", journal); rec.Code != http.StatusOK {
			t.Fatalf("session %d journal write = %d (%s)", round, rec.Code, rec.Body.String())
		}
		if rec := serve(t, s, http.MethodPatch, "/api/v1/sessions/"+id, `{"cursorTs":2500}`); rec.Code != http.StatusOK {
			t.Fatalf("session %d cursor patch = %d", round, rec.Code)
		}
	}
	for round, id := range ids {
		if got := listExits(t, s, id); len(got) != 2 {
			t.Fatalf("session %d journal = %v, want both trades", round, got)
		}
	}
}

// TestConcurrentCheckpointKeepsTheJournal reproduces the client's checkpoint as
// it actually happens: the status patch and the journal write are in flight at
// the same time, and the client swallows whatever either of them returns. The
// journal has to be there afterwards regardless of which one lands first.
func TestConcurrentCheckpointKeepsTheJournal(t *testing.T) {
	s := newTestServer(t)
	handler := s.Handler()

	for round := 0; round < 25; round++ {
		id := createTestSession(t, s)
		exit := int64(1_000 + round*10)
		done := make(chan struct{}, 2)
		go func() {
			body := fmt.Sprintf(`{"cursorTs":%d,"equityCents":1000500,"status":"paused"}`, exit)
			handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+id, bytes.NewBufferString(body)))
			done <- struct{}{}
		}()
		go func() {
			handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPut, "/api/v1/sessions/"+id+"/trades", bytes.NewBufferString("["+tradeJSON("trade-1", exit)+"]")))
			done <- struct{}{}
		}()
		<-done
		<-done

		if got := listExits(t, s, id); len(got) != 1 || got[0] != exit {
			t.Fatalf("round %d: journal = %v, want one trade closing at %d", round, got, exit)
		}
	}
}
