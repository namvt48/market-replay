package analytics

import (
	"fmt"
	"hash/fnv"
	"strconv"
	"strings"
	"time"

	"market-replay/internal/model"
)

// SourceType is the analytics-facing name for a session's kind — "session"
// for a replay journal, "evaluation" for an evaluation account. Kept
// distinct from model.SessionKindReplay/Eval so the wire vocabulary (which
// the spec fixes) can't accidentally drift if the storage-layer kind names
// ever change.
type SourceType string

const (
	SourceTypeSession    SourceType = "session"
	SourceTypeEvaluation SourceType = "evaluation"
	SourceTypeLive       SourceType = "live"
)

func SourceTypeForKind(kind string) SourceType {
	switch kind {
	case model.SessionKindEval:
		return SourceTypeEvaluation
	case model.SessionKindLive:
		return SourceTypeLive
	default:
		return SourceTypeSession
	}
}

// KindForSourceType is SourceTypeForKind's inverse, used by the httpapi
// handler both to parse the sourceType query param and to check it against
// the session actually found — "don't return another source's data" (the
// spec's validation rule) becomes a plain kind-mismatch check.
func KindForSourceType(sourceType string) (kind string, ok bool) {
	switch sourceType {
	case string(SourceTypeSession):
		return model.SessionKindReplay, true
	case string(SourceTypeEvaluation):
		return model.SessionKindEval, true
	case string(SourceTypeLive):
		return model.SessionKindLive, true
	default:
		return "", false
	}
}

// SourceIdentity is the id/type/title/subtitle/status shared by both the
// sources list and the performance report's "source" field.
type SourceIdentity struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
	Status   string `json:"status"`
}

// SourceListItem is one row of GET /api/v1/analytics/sources.
type SourceListItem struct {
	SourceIdentity
	TradeCount int     `json:"tradeCount"`
	StartedAt  *string `json:"startedAt"`
	EndedAt    *string `json:"endedAt"`
}

// SourceSummary is the "source" field of GET /api/v1/analytics/performance.
type SourceSummary struct {
	SourceIdentity
	InitialBalance float64 `json:"initialBalance"`
}

// ResolveInitialBalanceCents returns the account's nominal starting size.
// Sessions created after this field shipped always have it set explicitly
// (see storage.Store.CreateSession); for older rows the fallback —
// EquityCents minus every realized trade PnL — is exact whenever the
// session is flat (no open position) at its last checkpoint, and is a
// known, documented approximation otherwise.
func ResolveInitialBalanceCents(sess model.Session, trades []model.Trade) int64 {
	if sess.InitialBalanceCents != nil {
		return *sess.InitialBalanceCents
	}
	var totalRealized int64
	for _, t := range trades {
		totalRealized += t.RealizedCents
	}
	fallback := sess.EquityCents - totalRealized
	if fallback < 0 {
		return 0
	}
	return fallback
}

// BuildSourceIdentity, BuildSourceListItem and BuildSourceSummary each sort
// trades themselves (sortClosedTrades) — callers pass raw ListTrades
// results, the same as they'd pass to BuildReport.

func BuildSourceIdentity(sess model.Session, trades []model.Trade) SourceIdentity {
	sorted := sortClosedTrades(trades)
	return SourceIdentity{
		ID:       sess.ID,
		Type:     string(SourceTypeForKind(sess.Kind)),
		Title:    formatSourceTitle(sess),
		Subtitle: formatSourceSubtitle(sorted),
		Status:   sess.Status,
	}
}

func BuildSourceListItem(sess model.Session, trades []model.Trade) SourceListItem {
	sorted := sortClosedTrades(trades)
	return SourceListItem{
		SourceIdentity: BuildSourceIdentity(sess, sorted),
		TradeCount:     len(sorted),
		StartedAt:      firstEntryTimestamp(sorted),
		EndedAt:        lastExitTimestamp(sorted),
	}
}

func BuildSourceSummary(sess model.Session, trades []model.Trade) SourceSummary {
	sorted := sortClosedTrades(trades)
	return SourceSummary{
		SourceIdentity: BuildSourceIdentity(sess, sorted),
		InitialBalance: centsToDollars(ResolveInitialBalanceCents(sess, sorted)),
	}
}

func firstEntryTimestamp(sorted []model.Trade) *string {
	if len(sorted) == 0 {
		return nil
	}
	return formatTimestamp(sorted[0].EntryTs)
}

func lastExitTimestamp(sorted []model.Trade) *string {
	if len(sorted) == 0 {
		return nil
	}
	return formatTimestamp(sorted[len(sorted)-1].ExitTs)
}

// formatSourceTitle/formatSourceSubtitle/formatAccountSize/formatDateRange
// are presentation only — a defensible default convention, not a contract
// the spec pins down to an exact string. The frontend is free to reformat
// these once it consumes the real endpoint instead of the mock.
func formatSourceTitle(sess model.Session) string {
	if name := strings.TrimSpace(sess.Name); name != "" {
		return name
	}
	return "#" + shortSourceHash(sess.ID)
}

func shortSourceHash(id string) string {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(id))
	encoded := strings.ToUpper(strconv.FormatUint(uint64(hash.Sum32()), 36))
	if len(encoded) < 6 {
		encoded = strings.Repeat("0", 6-len(encoded)) + encoded
	}
	return encoded[len(encoded)-6:]
}

func formatAccountSize(sess model.Session) string {
	if sess.InitialBalanceCents == nil {
		return sess.Symbol
	}
	dollars := float64(*sess.InitialBalanceCents) / 100
	if dollars > 0 && dollars == float64(int64(dollars/1000))*1000 {
		return fmt.Sprintf("%dK", int64(dollars/1000))
	}
	return fmt.Sprintf("$%.0f", dollars)
}

func formatSourceSubtitle(sorted []model.Trade) string {
	if len(sorted) == 0 {
		return "No closed trades yet"
	}
	start := time.Unix(sorted[0].EntryTs, 0).UTC()
	end := time.Unix(sorted[len(sorted)-1].ExitTs, 0).UTC()
	return fmt.Sprintf("%s · %d closed trades", formatDateRange(start, end), len(sorted))
}

func formatDateRange(start, end time.Time) string {
	if start.Year() == end.Year() {
		return fmt.Sprintf("%s–%s", start.Format("Jan 02"), end.Format("Jan 02, 2006"))
	}
	return fmt.Sprintf("%s–%s", start.Format("Jan 02, 2006"), end.Format("Jan 02, 2006"))
}
