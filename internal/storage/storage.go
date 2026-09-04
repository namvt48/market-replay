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

// ErrDrawingTemplateNameTaken is returned by UpsertDrawingTemplate when a
// different template already uses the same name for the same tool type.
var ErrDrawingTemplateNameTaken = errors.New("storage: drawing template name already used for this tool")

// ErrWorkspaceSnapshotNotFound is returned by GetWorkspaceSnapshot when no
// snapshot exists for the given owner.
var ErrWorkspaceSnapshotNotFound = errors.New("storage: workspace snapshot not found")

// Store persists sessions, their trade journals, the watchlist, and chart
// drawings (docs §6.3, §14.2).
type Store interface {
	Init(ctx context.Context) error

	CreateSession(ctx context.Context, s model.Session) (model.Session, error)
	UpdateSession(ctx context.Context, id string, patch model.SessionPatch) error
	DeleteSession(ctx context.Context, id string) error
	PermanentlyDeleteSession(ctx context.Context, id string) error
	RestoreSession(ctx context.Context, id string) error
	DeleteEmptySessions(ctx context.Context) (int64, error)
	GetSession(ctx context.Context, id string) (model.Session, error)
	ListSessions(ctx context.Context) ([]model.Session, error)
	ListDeletedSessions(ctx context.Context) ([]model.Session, error)

	// ReplaceTrades makes the stored journal for one session exactly equal
	// to trades. The client-side fill engine owns the journal, and a replay
	// rewind (step back) can shorten it — which an append-only endpoint
	// cannot express, so it used to leave rows behind for trades that no
	// longer existed.
	ReplaceTrades(ctx context.Context, sessionID string, trades []model.Trade) error
	ListTrades(ctx context.Context, sessionID string) ([]model.Trade, error)

	// JournalImage methods back the live-trade journal screenshot feature.
	// SaveJournalImage stores a BLOB owned by sessionID (FK-checked).
	SaveJournalImage(ctx context.Context, img model.JournalImage) error
	GetJournalImage(ctx context.Context, id string) (model.JournalImage, error)
	// ListJournalImages returns metadata only (Data is nil) for one session,
	// ordered oldest-first.
	ListJournalImages(ctx context.Context, sessionID string) ([]model.JournalImage, error)
	DeleteJournalImage(ctx context.Context, id string) error

	GetWatchlist(ctx context.Context) ([]string, error)
	SetWatchlist(ctx context.Context, symbols []string) error

	// UpsertDrawings applies a batch of upsert-or-tombstone deltas
	// (docs §14.2) and returns how many were applied.
	UpsertDrawings(ctx context.Context, deltas []model.Drawing) (int, error)
	ListDrawings(ctx context.Context, filter model.DrawingFilter) ([]model.Drawing, error)

	// Workspace customization (chart appearance, layouts, timeframe
	// preferences, drawing favourites) as opaque JSON payloads keyed by
	// name. The server stores and returns them verbatim.
	ListPreferences(ctx context.Context) (map[string]json.RawMessage, error)
	SetPreference(ctx context.Context, key string, payload json.RawMessage) error
	DeletePreference(ctx context.Context, key string) error

	// UpsertDrawingTemplate creates or replaces a named drawing appearance
	// preset. The client owns and supplies the id.
	UpsertDrawingTemplate(ctx context.Context, t model.DrawingTemplate) error
	DeleteDrawingTemplate(ctx context.Context, id string) error
	ListDrawingTemplates(ctx context.Context) ([]model.DrawingTemplate, error)

	// PutWorkspaceSnapshot creates or replaces the one snapshot stored per
	// (UserID, OwnerType, OwnerID), subject to the optimistic-concurrency
	// rank rule (capturedAt, then reason priority). accepted is false when
	// snap is stale — persisted then reflects the untouched existing row.
	PutWorkspaceSnapshot(ctx context.Context, snap model.WorkspaceSnapshot) (persisted model.WorkspaceSnapshot, accepted bool, err error)
	GetWorkspaceSnapshot(ctx context.Context, userID, ownerType, ownerID string) (model.WorkspaceSnapshot, error)
	DeleteWorkspaceSnapshot(ctx context.Context, userID, ownerType, ownerID string) error

	Close() error
}
