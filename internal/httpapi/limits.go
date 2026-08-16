package httpapi

// Limits collects every request-size and journal cap this package enforces,
// sourced from config.yaml's limits: section (internal/config) by
// cmd/server. Each field mirrors one of this package's own tunable vars —
// see compression.go, preferences.go, indicators.go, drawing_templates.go,
// workspace_snapshots.go, and sessions.go for where each is actually used.
type Limits struct {
	GzipMinBytes                  int
	PreferencePayloadBytes        int
	IndicatorRunPayloadBytes      int
	DrawingTemplatePayloadBytes   int
	WorkspaceSnapshotPayloadBytes int
	SimulationPayloadBytes        int
	MaxJournalTrades              int
}

// ApplyLimits overrides this package's request-size/journal vars from
// startup config. Call once, before Handler() serves its first request —
// nothing here is synchronized, because nothing mutates these afterward.
// A zero field leaves the built-in default (set at each var's declaration)
// untouched, so a config.yaml overriding one limit doesn't zero the rest.
func ApplyLimits(l Limits) {
	if l.GzipMinBytes > 0 {
		minGzipSize = l.GzipMinBytes
	}
	if l.PreferencePayloadBytes > 0 {
		maxPreferencePayload = l.PreferencePayloadBytes
	}
	if l.IndicatorRunPayloadBytes > 0 {
		maxIndicatorRunPayload = l.IndicatorRunPayloadBytes
	}
	if l.DrawingTemplatePayloadBytes > 0 {
		maxDrawingTemplatePayload = l.DrawingTemplatePayloadBytes
	}
	if l.WorkspaceSnapshotPayloadBytes > 0 {
		maxWorkspaceSnapshotPayload = l.WorkspaceSnapshotPayloadBytes
	}
	if l.SimulationPayloadBytes > 0 {
		maxSimulationPayload = l.SimulationPayloadBytes
	}
	if l.MaxJournalTrades > 0 {
		maxJournalTrades = l.MaxJournalTrades
	}
}
