package httpapi

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func workspaceSnapshotBody(ownerType, ownerID, reason string, capturedAt, cursorTs int64) string {
	return fmt.Sprintf(`{
		"version": 1,
		"owner": {"kind": %q, "id": %q},
		"reason": %q,
		"capturedAt": %d,
		"cursorTs": %d,
		"symbol": "NQ",
		"layout": {},
		"viewports": {},
		"drawings": {},
		"fills": {},
		"indicators": [],
		"preferences": {}
	}`, ownerType, ownerID, reason, capturedAt, cursorTs)
}

func putWorkspaceSnapshot(t *testing.T, s *Server, ownerType, ownerID, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/workspace-snapshots/"+ownerType+"/"+ownerID, bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func gzipBody(t *testing.T, body string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write([]byte(body)); err != nil {
		t.Fatalf("gzip write: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}
	return buf.Bytes()
}

func decodeAck(t *testing.T, rec *httptest.ResponseRecorder) (int, int64) {
	t.Helper()
	var ack struct {
		Revision   int   `json:"revision"`
		CapturedAt int64 `json:"capturedAt"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &ack); err != nil {
		t.Fatalf("decode ack: %v (body %s)", err, rec.Body.String())
	}
	return ack.Revision, ack.CapturedAt
}

func TestWorkspaceSnapshots_PutGetRoundTrip(t *testing.T) {
	s := newTestServer(t)
	sessionID := createTestSession(t, s)

	body := workspaceSnapshotBody("replay", sessionID, "trade-close", 1000, 500)
	rec := putWorkspaceSnapshot(t, s, "replay", sessionID, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("put status = %d, body = %s", rec.Code, rec.Body.String())
	}
	revision, capturedAt := decodeAck(t, rec)
	if revision != 1 || capturedAt != 1000 {
		t.Fatalf("ack = {%d, %d}, want {1, 1000}", revision, capturedAt)
	}

	getRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(getRec, httptest.NewRequest(http.MethodGet, "/api/v1/workspace-snapshots/replay/"+sessionID, nil))
	if getRec.Code != http.StatusOK {
		t.Fatalf("get status = %d, body = %s", getRec.Code, getRec.Body.String())
	}
	var envelope struct {
		Revision   int             `json:"revision"`
		CapturedAt int64           `json:"capturedAt"`
		Snapshot   json.RawMessage `json:"snapshot"`
	}
	if err := json.Unmarshal(getRec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if envelope.Revision != 1 || envelope.CapturedAt != 1000 {
		t.Fatalf("envelope = %+v, unexpected", envelope)
	}
	// The FE payload must round-trip byte-for-byte through the opaque
	// payload column — the server must not reshape what it doesn't
	// interpret (layout/viewports/drawings/fills/indicators/preferences).
	var roundTripped, original map[string]any
	if err := json.Unmarshal(envelope.Snapshot, &roundTripped); err != nil {
		t.Fatalf("decode roundtripped snapshot: %v", err)
	}
	if err := json.Unmarshal([]byte(body), &original); err != nil {
		t.Fatalf("decode original: %v", err)
	}
	if fmt.Sprint(roundTripped) != fmt.Sprint(original) {
		t.Fatalf("snapshot payload changed in transit:\n got  %v\n want %v", roundTripped, original)
	}
}

func TestWorkspaceSnapshots_GetNotFound(t *testing.T) {
	s := newTestServer(t)
	sessionID := createTestSession(t, s)

	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/workspace-snapshots/replay/"+sessionID, nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestWorkspaceSnapshots_ReplayOwnerMustExist(t *testing.T) {
	s := newTestServer(t)

	body := workspaceSnapshotBody("replay", "unknown-session", "trade-close", 1000, 500)
	rec := putWorkspaceSnapshot(t, s, "replay", "unknown-session", body)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("put status = %d, want 404 for an unowned/unknown session, body = %s", rec.Code, rec.Body.String())
	}

	getRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(getRec, httptest.NewRequest(http.MethodGet, "/api/v1/workspace-snapshots/replay/unknown-session", nil))
	if getRec.Code != http.StatusNotFound {
		t.Fatalf("get status = %d, want 404 for an unowned/unknown session", getRec.Code)
	}
}

func TestWorkspaceSnapshots_EvalOwnerIsFormatOnly(t *testing.T) {
	s := newTestServer(t)

	// No server-side eval account table exists; any well-formed id is
	// accepted (eval accounts are purely client-side).
	body := workspaceSnapshotBody("eval", "eval-NQ-1690000000", "trade-close", 1000, 500)
	rec := putWorkspaceSnapshot(t, s, "eval", "eval-NQ-1690000000", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("put status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}

	badBody := workspaceSnapshotBody("eval", "bad@id", "trade-close", 1000, 500)
	badRec := putWorkspaceSnapshot(t, s, "eval", "bad@id", badBody)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("put status = %d, want 400 for a malformed eval owner id", badRec.Code)
	}
}

func TestWorkspaceSnapshots_UnknownOwnerTypeIs400(t *testing.T) {
	s := newTestServer(t)
	rec := putWorkspaceSnapshot(t, s, "portfolio", "x", workspaceSnapshotBody("portfolio", "x", "trade-close", 1000, 500))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for an unknown owner type", rec.Code)
	}
}

func TestWorkspaceSnapshots_StaleWriteRejected(t *testing.T) {
	s := newTestServer(t)
	sessionID := createTestSession(t, s)

	newRec := putWorkspaceSnapshot(t, s, "replay", sessionID, workspaceSnapshotBody("replay", sessionID, "explicit-exit", 5000, 500))
	if newRec.Code != http.StatusOK {
		t.Fatalf("newer put status = %d, body = %s", newRec.Code, newRec.Body.String())
	}
	newRevision, _ := decodeAck(t, newRec)

	staleRec := putWorkspaceSnapshot(t, s, "replay", sessionID, workspaceSnapshotBody("replay", sessionID, "trade-close", 1000, 500))
	if staleRec.Code != http.StatusConflict {
		t.Fatalf("stale put status = %d, want 409, body = %s", staleRec.Code, staleRec.Body.String())
	}
	staleRevision, staleCapturedAt := decodeAck(t, staleRec)
	if staleRevision != newRevision || staleCapturedAt != 5000 {
		t.Fatalf("409 ack = {%d, %d}, want the untouched newer row {%d, 5000}", staleRevision, staleCapturedAt, newRevision)
	}
}

func TestWorkspaceSnapshots_ExplicitExitOverwritesTradeClose(t *testing.T) {
	s := newTestServer(t)
	sessionID := createTestSession(t, s)

	putWorkspaceSnapshot(t, s, "replay", sessionID, workspaceSnapshotBody("replay", sessionID, "trade-close", 1000, 100))
	rec := putWorkspaceSnapshot(t, s, "replay", sessionID, workspaceSnapshotBody("replay", sessionID, "explicit-exit", 2000, 200))
	if rec.Code != http.StatusOK {
		t.Fatalf("explicit-exit put status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}

	getRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(getRec, httptest.NewRequest(http.MethodGet, "/api/v1/workspace-snapshots/replay/"+sessionID, nil))
	if !strings.Contains(getRec.Body.String(), `"explicit-exit"`) {
		t.Fatalf("stored snapshot reason lost: %s", getRec.Body.String())
	}
}

func TestWorkspaceSnapshots_PutIsIdempotent(t *testing.T) {
	s := newTestServer(t)
	sessionID := createTestSession(t, s)
	body := workspaceSnapshotBody("replay", sessionID, "trade-close", 1000, 500)

	first := putWorkspaceSnapshot(t, s, "replay", sessionID, body)
	second := putWorkspaceSnapshot(t, s, "replay", sessionID, body)
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("statuses = %d, %d, want 200, 200", first.Code, second.Code)
	}
	firstRevision, _ := decodeAck(t, first)
	secondRevision, _ := decodeAck(t, second)
	if firstRevision != secondRevision {
		t.Fatalf("revision changed on retry: %d -> %d, want idempotent", firstRevision, secondRevision)
	}
}

func TestWorkspaceSnapshots_RejectsCorruptOrUnsupportedVersion(t *testing.T) {
	s := newTestServer(t)
	sessionID := createTestSession(t, s)

	if rec := putWorkspaceSnapshot(t, s, "replay", sessionID, `{"version":1,"owner":{`); rec.Code != http.StatusBadRequest {
		t.Errorf("corrupt JSON status = %d, want 400", rec.Code)
	}
	if rec := putWorkspaceSnapshot(t, s, "replay", sessionID, workspaceSnapshotBody("replay", sessionID, "trade-close", 1000, 500)); rec.Code != http.StatusOK {
		t.Fatalf("baseline valid put should succeed, status = %d", rec.Code)
	}
	unsupported := strings.Replace(workspaceSnapshotBody("replay", sessionID, "trade-close", 2000, 500), `"version": 1`, `"version": 2`, 1)
	if rec := putWorkspaceSnapshot(t, s, "replay", sessionID, unsupported); rec.Code != http.StatusBadRequest {
		t.Errorf("unsupported version status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
	badReason := strings.Replace(workspaceSnapshotBody("replay", sessionID, "trade-close", 3000, 500), `"trade-close"`, `"something-else"`, 1)
	if rec := putWorkspaceSnapshot(t, s, "replay", sessionID, badReason); rec.Code != http.StatusBadRequest {
		t.Errorf("invalid reason status = %d, want 400", rec.Code)
	}
	mismatchedOwner := workspaceSnapshotBody("replay", "some-other-session", "trade-close", 4000, 500)
	if rec := putWorkspaceSnapshot(t, s, "replay", sessionID, mismatchedOwner); rec.Code != http.StatusBadRequest {
		t.Errorf("owner mismatch status = %d, want 400", rec.Code)
	}
}

func TestWorkspaceSnapshots_RejectsOversizedPayload(t *testing.T) {
	s := newTestServer(t)
	sessionID := createTestSession(t, s)

	huge := workspaceSnapshotBody("replay", sessionID, "trade-close", 1000, 500)
	huge = strings.Replace(huge, `"symbol": "NQ"`, `"symbol": "NQ", "padding": "`+strings.Repeat("x", maxWorkspaceSnapshotPayload)+`"`, 1)
	rec := putWorkspaceSnapshot(t, s, "replay", sessionID, huge)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("oversized plain body status = %d, want 400", rec.Code)
	}
}

func TestWorkspaceSnapshots_RejectsOversizedGzippedPayload(t *testing.T) {
	s := newTestServer(t)
	sessionID := createTestSession(t, s)

	huge := workspaceSnapshotBody("replay", sessionID, "trade-close", 1000, 500)
	huge = strings.Replace(huge, `"symbol": "NQ"`, `"symbol": "NQ", "padding": "`+strings.Repeat("x", maxWorkspaceSnapshotPayload)+`"`, 1)
	compressed := gzipBody(t, huge)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/workspace-snapshots/replay/"+sessionID, bytes.NewReader(compressed))
	req.Header.Set("Content-Encoding", "gzip")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	// The bound applies to the DEcompressed size — a small gzip body that
	// expands past the limit must still be rejected, not accepted just
	// because the wire size was small.
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("oversized gzip body status = %d, want 400", rec.Code)
	}
}

func TestWorkspaceSnapshots_AcceptsGzippedPayload(t *testing.T) {
	s := newTestServer(t)
	sessionID := createTestSession(t, s)
	body := workspaceSnapshotBody("replay", sessionID, "trade-close", 1000, 500)
	compressed := gzipBody(t, body)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/workspace-snapshots/replay/"+sessionID, bytes.NewReader(compressed))
	req.Header.Set("Content-Encoding", "gzip")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("gzip put status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
}

func TestWorkspaceSnapshots_Delete(t *testing.T) {
	s := newTestServer(t)
	sessionID := createTestSession(t, s)
	putWorkspaceSnapshot(t, s, "replay", sessionID, workspaceSnapshotBody("replay", sessionID, "trade-close", 1000, 500))

	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/v1/workspace-snapshots/replay/"+sessionID, nil))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, body = %s", rec.Code, rec.Body.String())
	}
	// Deleting an owner with nothing stored (or an owner that no longer
	// exists as a session) is a no-op, not an error — a snapshot must
	// remain deletable even after its session is gone.
	rec2 := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec2, httptest.NewRequest(http.MethodDelete, "/api/v1/workspace-snapshots/replay/never-existed", nil))
	if rec2.Code != http.StatusNoContent {
		t.Fatalf("delete unknown status = %d", rec2.Code)
	}

	getRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(getRec, httptest.NewRequest(http.MethodGet, "/api/v1/workspace-snapshots/replay/"+sessionID, nil))
	if getRec.Code != http.StatusNotFound {
		t.Fatalf("get after delete status = %d, want 404", getRec.Code)
	}
}

func TestWorkspaceSnapshots_ReplayAndEvalIsolationOverHTTP(t *testing.T) {
	s := newTestServer(t)
	sessionID := createTestSession(t, s)

	putWorkspaceSnapshot(t, s, "replay", sessionID, workspaceSnapshotBody("replay", sessionID, "trade-close", 1000, 500))
	putWorkspaceSnapshot(t, s, "eval", sessionID, workspaceSnapshotBody("eval", sessionID, "explicit-exit", 2000, 900))

	replayRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(replayRec, httptest.NewRequest(http.MethodGet, "/api/v1/workspace-snapshots/replay/"+sessionID, nil))
	if !strings.Contains(replayRec.Body.String(), `"trade-close"`) {
		t.Fatalf("replay snapshot: %s", replayRec.Body.String())
	}

	evalRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(evalRec, httptest.NewRequest(http.MethodGet, "/api/v1/workspace-snapshots/eval/"+sessionID, nil))
	if !strings.Contains(evalRec.Body.String(), `"explicit-exit"`) {
		t.Fatalf("eval snapshot: %s", evalRec.Body.String())
	}
}

func TestWorkspaceSnapshots_ReconnectRetrySameRequestIsIdempotent(t *testing.T) {
	s := newTestServer(t)
	sessionID := createTestSession(t, s)
	body := workspaceSnapshotBody("replay", sessionID, "explicit-exit", 7000, 600)

	// Simulates a client that PUT successfully but never saw the response
	// (e.g. dropped connection) and retries the identical request after
	// reconnecting.
	first := putWorkspaceSnapshot(t, s, "replay", sessionID, body)
	second := putWorkspaceSnapshot(t, s, "replay", sessionID, body)
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("reconnect retry statuses = %d, %d, want 200, 200", first.Code, second.Code)
	}

	getRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(getRec, httptest.NewRequest(http.MethodGet, "/api/v1/workspace-snapshots/replay/"+sessionID, nil))
	var envelope struct {
		Revision int `json:"revision"`
	}
	if err := json.Unmarshal(getRec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Revision != 1 {
		t.Fatalf("revision = %d, want 1 (single logical write, not duplicated)", envelope.Revision)
	}
}
