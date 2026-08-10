// Package storage defines the persistence boundary for sessions, trade
// journals, and the watchlist. See storage/sqlite for the one concrete
// implementation. Mirrors gex-dashboard's storage/storage.go split
// (interface here, impl in a subpackage) even though there is currently
// only one implementation — same convention across both of this user's
// Go projects, and it keeps httpapi testable against a fake Store later.
package storage

import (
	"context"
	"encoding/json"
	"errors"

	"market-replay/internal/model"
)

// ErrSessionNotFound is returned by GetSession (and UpdateSession) when no
// session exists with the given id.
var ErrSessionNotFound = errors.New("storage: session not found")

// Store persists sessions, their trade journals, the watchlist, and chart
// drawings (docs §6.3, §14.2).
type Store interface {
	Init(ctx context.Context) error

	CreateSession(ctx context.Context, s model.Session) (model.Session, error)
	UpdateSession(ctx context.Context, id string, patch model.SessionPatch) error
	DeleteSession(ctx context.Context, id string) error
	DeleteEmptySessions(ctx context.Context) (int64, error)
	GetSession(ctx context.Context, id string) (model.Session, error)
	ListSessions(ctx context.Context) ([]model.Session, error)

	// ReplaceTrades makes the stored journal for one session exactly equal
	// to trades. The client-side fill engine owns the journal, and a replay
	// rewind (step back) can shorten it — which an append-only endpoint
	// cannot express, so it used to leave rows behind for trades that no
	// longer existed.
	ReplaceTrades(ctx context.Context, sessionID string, trades []model.Trade) error
	ListTrades(ctx context.Context, sessionID string) ([]model.Trade, error)

	GetWatchlist(ctx context.Context) ([]string, error)
	SetWatchlist(ctx context.Context, symbols []string) error

	// UpsertDrawings applies a batch of upsert-or-tombstone deltas
	// (docs §14.2) and returns how many were applied.
	UpsertDrawings(ctx context.Context, deltas []model.Drawing) (int, error)
	ListDrawings(ctx context.Context, filter model.DrawingFilter) ([]model.Drawing, error)

	// Workspace customization (chart appearance, layouts, timeframe
	// preferences, drawing favourites/templates) as opaque JSON payloads
	// keyed by name. The server stores and returns them verbatim.
	ListPreferences(ctx context.Context) (map[string]json.RawMessage, error)
	SetPreference(ctx context.Context, key string, payload json.RawMessage) error
	DeletePreference(ctx context.Context, key string) error

	Close() error
}
