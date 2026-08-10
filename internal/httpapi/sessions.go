package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"

	"market-replay/internal/model"
)

var timeframePattern = regexp.MustCompile(`^(\d+)(m|h|d|w|M)$`)

func validTimeframe(value string) bool {
	match := timeframePattern.FindStringSubmatch(value)
	if match == nil {
		return false
	}
	multiplier, err := strconv.Atoi(match[1])
	if err != nil || multiplier < 1 {
		return false
	}
	switch match[2] {
	case "m":
		return multiplier <= 1440
	case "h":
		return multiplier <= 12
	case "d":
		return multiplier == 1
	case "w":
		return multiplier <= 52
	case "M":
		return multiplier <= 12
	default:
		return false
	}
}

type createSessionRequest struct {
	Symbol  string          `json:"symbol"`
	Tf      string          `json:"tf"`
	StartTs int64           `json:"startTs"`
	Config  json.RawMessage `json:"config"`
}

// handleCreateSession serves POST /api/v1/sessions -> {id}. The server
// assigns the id and the initial Active/zero-equity state (model.Session
// via storage.Store.CreateSession) — the client never supplies either.
func (s *Server) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	var req createSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, fmt.Errorf("%w: invalid JSON body: %v", errBadRequest, err))
		return
	}
	if req.Symbol == "" || req.Tf == "" {
		writeError(w, fmt.Errorf("%w: symbol and tf are required", errBadRequest))
		return
	}
	if !validTimeframe(req.Tf) {
		writeError(w, fmt.Errorf("%w: tf must be 1-1440m, 1-12h, 1d, 1-52w, or 1-12M", errBadRequest))
		return
	}

	sess, err := s.Store.CreateSession(r.Context(), model.Session{
		Symbol: req.Symbol, Tf: req.Tf, StartTs: req.StartTs, Config: req.Config,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": sess.ID})
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := s.Store.ListSessions(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (s *Server) handleDeleteEmptySessions(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("empty") != "true" {
		writeError(w, fmt.Errorf("%w: empty=true is required", errBadRequest))
		return
	}
	deleted, err := s.Store.DeleteEmptySessions(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"deleted": deleted})
}

func (s *Server) handlePatchSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var patch model.SessionPatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		writeError(w, fmt.Errorf("%w: invalid JSON body: %v", errBadRequest, err))
		return
	}
	if patch.Status != nil && !model.ValidSessionStatus(*patch.Status) {
		writeError(w, fmt.Errorf("%w: status must be active, paused, or stopped", errBadRequest))
		return
	}
	if patch.Config != nil && !json.Valid(*patch.Config) {
		writeError(w, fmt.Errorf("%w: config must be valid JSON", errBadRequest))
		return
	}
	if err := s.Store.UpdateSession(r.Context(), id, patch); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleDeleteSession(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.DeleteSession(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// maxJournalTrades bounds one journal write. A hand-traded replay session
// closes tens of trades, not thousands; the cap exists so a malformed or
// runaway client cannot push an unbounded body through a single transaction.
const maxJournalTrades = 10_000

// validateJournal checks the journal against the same rules the client's own
// schema enforces when it reads the journal back. Ids are not among them: row
// identity is assigned on write (see storage.ReplaceTrades), because the
// client's ids are per-session sequence numbers that repeat across sessions.
//
// This matters more than ordinary input hygiene: the client parses
// GET /trades through a strict schema, so a single row the server accepted
// but the client cannot parse fails the whole array — and the resume path
// swallows that failure, leaving the trader looking at an empty journal with
// no error. Rejecting the write is the only way the problem surfaces where it
// was caused.
func validateJournal(trades []model.Trade) error {
	if len(trades) > maxJournalTrades {
		return fmt.Errorf("%w: journal has %d trades, limit is %d", errBadRequest, len(trades), maxJournalTrades)
	}
	for index, t := range trades {
		switch {
		case t.Symbol == "":
			return fmt.Errorf("%w: trade at index %d has no symbol", errBadRequest, index)
		case t.Side != "long" && t.Side != "short":
			return fmt.Errorf("%w: trade at index %d has side %q, want long or short", errBadRequest, index, t.Side)
		case t.Qty < 1:
			return fmt.Errorf("%w: trade at index %d has quantity %d, want at least 1", errBadRequest, index, t.Qty)
		case t.EntryTs < 0 || t.ExitTs < 0:
			return fmt.Errorf("%w: trade at index %d has a negative timestamp", errBadRequest, index)
		case t.ExitTs < t.EntryTs:
			// Not merely odd: the journal is ordered and cursor-bounded by
			// exit_ts, so a trade that exits before it enters corrupts both.
			return fmt.Errorf("%w: trade at index %d exits at %d, before its entry at %d", errBadRequest, index, t.ExitTs, t.EntryTs)
		}
	}
	return nil
}

// handleReplaceTrades serves PUT /api/v1/sessions/{id}/trades. The body is
// the session's complete journal as the client-side fill engine currently
// holds it, and it replaces whatever was stored.
//
// This used to be an append-only POST per closed trade. That could not
// express a replay rewind: stepping the cursor back discards trades the
// engine had already reported, and the stored journal kept them, so the
// panel and the database disagreed from then on. Sending the whole journal
// is also idempotent, which removes the client-side "already persisted"
// bookkeeping that went with the append endpoint.
//
// Any existing session accepts the write, whatever its status. Requiring
// "active" looked safe but was actively harmful: the client checkpoints by
// firing the status patch and the journal write together, so whenever the
// patch landed first the journal write was rejected — and the client swallows
// checkpoint errors, so a session's final journal simply went missing.
// Whether the replay still accepts new trades is the client's business; the
// server's is to store what its owner sends.
func (s *Server) handleReplaceTrades(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")
	var trades []model.Trade
	if err := json.NewDecoder(r.Body).Decode(&trades); err != nil {
		writeError(w, fmt.Errorf("%w: invalid JSON body: %v", errBadRequest, err))
		return
	}
	if err := validateJournal(trades); err != nil {
		writeError(w, err)
		return
	}
	// Existence still matters: a journal with no session cannot be read back.
	if _, err := s.Store.GetSession(r.Context(), sessionID); err != nil {
		writeError(w, err)
		return
	}

	if err := s.Store.ReplaceTrades(r.Context(), sessionID, trades); err != nil {
		writeError(w, err)
		return
	}
	// Echoes the cursor-bounded view, i.e. what a read would return now — not
	// necessarily every row written, since a journal write can legitimately
	// arrive before the cursor patch that makes its newest trade visible.
	stored, err := s.Store.ListTrades(r.Context(), sessionID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stored)
}

func (s *Server) handleListTrades(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")
	trades, err := s.Store.ListTrades(r.Context(), sessionID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, trades)
}
