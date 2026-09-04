package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"market-replay/internal/model"
)

// ReplaceTrades rewrites one session's journal in a single transaction.
//
// The client-side fill engine is the source of truth for every trade fact and
// for their order; row identity is the server's. Replace rather than append
// because stepping the replay cursor backwards shortens the journal, and an
// append-only table has no way to represent that — it kept rows for trades
// the engine had discarded.
//
// Row ids are assigned here and the id in the request is ignored, because the
// client's ids are per-session sequence numbers: every session's first closed
// trade is "trade-1". Storing those against a table-wide primary key made the
// second session that closed a trade fail its journal write outright with a
// uniqueness violation, so from that session on nothing was ever persisted.
// Nothing reads a stored id back except as a display key, so the server owning
// identity costs the client nothing.
//
// created_at is taken from the client (the trade's exit timestamp, which
// rises monotonically through a session) so ListTrades' ordering survives a
// rewrite; rows written in one transaction would otherwise share a single
// server timestamp and lose their order.
func (s *Store) ReplaceTrades(ctx context.Context, sessionID string, trades []model.Trade) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("sqlite: replace trades for session %s: begin tx: %w", sessionID, err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM trades WHERE session_id = ?`, sessionID); err != nil {
		return fmt.Errorf("sqlite: replace trades for session %s: clear: %w", sessionID, err)
	}
	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO trades (id, session_id, symbol, side, qty, entry_ts, entry_price_ticks, exit_ts, exit_price_ticks, realized_cents, fees_cents, mfe_ticks, mae_ticks, r_multiple, initial_stop_ticks, initial_take_profit_ticks, protection_adjustments_json, exit_reason, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("sqlite: replace trades for session %s: prepare: %w", sessionID, err)
	}
	defer stmt.Close()

	now := time.Now().Unix()
	for _, t := range trades {
		t.ID = uuid.NewString()
		if t.CreatedAt == 0 {
			t.CreatedAt = now
		}
		var rMultiple sql.NullFloat64
		if t.RMultiple != nil {
			rMultiple = sql.NullFloat64{Float64: *t.RMultiple, Valid: true}
		}
		protectionAdjustments := t.ProtectionAdjustments
		if protectionAdjustments == nil {
			protectionAdjustments = []model.ProtectionAdjustment{}
		}
		adjustments, err := json.Marshal(protectionAdjustments)
		if err != nil {
			return fmt.Errorf("sqlite: encode trade %s protection adjustments: %w", t.ID, err)
		}
		exitReason := t.ExitReason
		if exitReason == "" {
			exitReason = "manual"
		}
		if _, err := stmt.ExecContext(ctx, t.ID, sessionID, t.Symbol, t.Side, t.Qty, t.EntryTs, t.EntryPriceTicks, t.ExitTs, t.ExitPriceTicks, t.RealizedCents, t.FeesCents, t.MfeTicks, t.MaeTicks, rMultiple, t.InitialStopTicks, t.InitialTakeProfitTicks, string(adjustments), exitReason, t.CreatedAt); err != nil {
			return fmt.Errorf("sqlite: replace trades for session %s: insert %s: %w", sessionID, t.ID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("sqlite: replace trades for session %s: commit: %w", sessionID, err)
	}
	return nil
}

// ListTrades returns the journal a session can legitimately show: trades
// that closed at or before its replay cursor, in the order the engine closed
// them.
//
// The cursor bound is not cosmetic. A trade cannot have happened after the
// cursor, so anything past it is a spoiler — and it is reachable, because the
// client can rewind the cursor and then lose the debounced write that would
// have shortened the journal (a crash, a closed tab, an offline backend).
// Filtering on read means a resume can never be handed a trade from the
// future, whatever state the write path left behind.
//
// Live sessions are exempt from the bound. A live journal is hand-entered at
// wall-clock time — nothing advances its cursor (eval sessions advance it as
// their engine ticks), so bounding by cursor_ts would hide every trade.
// There is no replay to rewind, hence no spoiler to protect.
//
// The join also keeps ListTrades on an unknown session an empty result rather
// than an error, which is what callers already relied on.
func (s *Store) ListTrades(ctx context.Context, sessionID string) ([]model.Trade, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT t.id, t.session_id, t.symbol, t.side, t.qty, t.entry_ts, t.entry_price_ticks, t.exit_ts, t.exit_price_ticks, t.realized_cents, t.fees_cents, t.mfe_ticks, t.mae_ticks, t.r_multiple, t.initial_stop_ticks, t.initial_take_profit_ticks, t.protection_adjustments_json, t.exit_reason, t.created_at
		FROM trades t JOIN sessions s ON s.id = t.session_id
		WHERE t.session_id = ? AND (s.kind = ? OR t.exit_ts <= s.cursor_ts)
		ORDER BY t.created_at ASC, t.rowid ASC
	`, sessionID, model.SessionKindLive)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list trades for session %s: %w", sessionID, err)
	}
	defer rows.Close()

	out := make([]model.Trade, 0)
	for rows.Next() {
		var t model.Trade
		var rMultiple sql.NullFloat64
		var initialStop, initialTakeProfit sql.NullInt64
		var adjustmentsJSON string
		if err := rows.Scan(&t.ID, &t.SessionID, &t.Symbol, &t.Side, &t.Qty, &t.EntryTs, &t.EntryPriceTicks, &t.ExitTs, &t.ExitPriceTicks, &t.RealizedCents, &t.FeesCents, &t.MfeTicks, &t.MaeTicks, &rMultiple, &initialStop, &initialTakeProfit, &adjustmentsJSON, &t.ExitReason, &t.CreatedAt); err != nil {
			return nil, fmt.Errorf("sqlite: scan trade: %w", err)
		}
		if rMultiple.Valid {
			v := rMultiple.Float64
			t.RMultiple = &v
		}
		if initialStop.Valid {
			value := initialStop.Int64
			t.InitialStopTicks = &value
		}
		if initialTakeProfit.Valid {
			value := initialTakeProfit.Int64
			t.InitialTakeProfitTicks = &value
		}
		if err := json.Unmarshal([]byte(adjustmentsJSON), &t.ProtectionAdjustments); err != nil {
			return nil, fmt.Errorf("sqlite: decode trade %s protection adjustments: %w", t.ID, err)
		}
		if t.ProtectionAdjustments == nil {
			t.ProtectionAdjustments = []model.ProtectionAdjustment{}
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlite: iterate trades: %w", err)
	}
	return out, nil
}
