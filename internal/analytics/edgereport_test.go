package analytics

import (
	"context"
	"testing"

	"market-replay/internal/model"
)

func TestBuildEdgeReport_AuditCounts(t *testing.T) {
	md := &fakeMarketData{
		tickValue: map[string]float64{"NQ": 100},
		priceBarsFn: func(_, _ string, windows []TimeWindow) []PriceWindow {
			out := make([]PriceWindow, len(windows))
			for i := range windows {
				out[i] = PriceWindow{Found: true, Bars: []PriceBar{{Ts: 500, LowTicks: 900, HighTicks: 1100}}}
			}
			return out
		},
	}
	trades := []model.Trade{
		// Has RMultiple + valid risk + coverage -> eligible for both R stats
		// and the excursion/sensitivity re-walk.
		newTrade("full", "long", 0, 1000, 1000, 5_000, withInitialStop(980), withRMultiple(1)),
		// Has RMultiple but no initial stop -> eligible for R stats only.
		newTrade("no-risk", "long", 0, 1000, 1000, 3_000, withRMultiple(0.5)),
		// No RMultiple at all -> excluded from R stats entirely.
		newTrade("no-r", "long", 0, 1000, 1000, 1_000),
	}
	sess := model.Session{ID: "sess-1", Symbol: "NQ", Tf: "1m", Kind: "replay"}
	report, err := BuildEdgeReport(context.Background(), EdgeReportRequest{
		Session: sess, Trades: trades, MarketData: md, Seed: 1,
	})
	if err != nil {
		t.Fatalf("BuildEdgeReport: %v", err)
	}
	if report.CalculationVersion != DecisionIntelligenceCalculationVersion {
		t.Errorf("calculationVersion = %q, want %q", report.CalculationVersion, DecisionIntelligenceCalculationVersion)
	}
	if report.Audit.TotalTrades != 3 {
		t.Errorf("audit.totalTrades = %d, want 3", report.Audit.TotalTrades)
	}
	if report.Audit.EligibleRTrades != 2 {
		t.Errorf("audit.eligibleRTrades = %d, want 2", report.Audit.EligibleRTrades)
	}
	if report.Audit.ExcludedNoRMultiple != 1 {
		t.Errorf("audit.excludedNoRMultiple = %d, want 1", report.Audit.ExcludedNoRMultiple)
	}
	if report.Audit.EligibleExcursionTrades != 1 {
		t.Errorf("audit.eligibleExcursionTrades = %d, want 1 (only 'full' has both risk and coverage)", report.Audit.EligibleExcursionTrades)
	}
	if report.Audit.ExcludedNoInitialRisk != 2 {
		t.Errorf("audit.excludedNoInitialRisk = %d, want 2 ('no-risk' and 'no-r' both lack InitialStopTicks)", report.Audit.ExcludedNoInitialRisk)
	}
	if report.Audit.MarketDataCoverageTrades != report.Audit.EligibleExcursionTrades {
		t.Errorf("marketDataCoverageTrades (%d) should equal eligibleExcursionTrades (%d)", report.Audit.MarketDataCoverageTrades, report.Audit.EligibleExcursionTrades)
	}
	if report.Source.ID != "sess-1" || report.Source.Type != "session" {
		t.Errorf("source = %+v", report.Source)
	}
}

func TestBuildEdgeReport_ZeroVarianceWarning(t *testing.T) {
	trades := make([]model.Trade, 60)
	for i := range trades {
		trades[i] = newTrade("t", "long", 0, int64(i+1), 1000, 1_000, withRMultiple(1))
	}
	sess := model.Session{ID: "sess-1", Symbol: "NQ", Tf: "1m", Kind: "replay"}
	report, err := BuildEdgeReport(context.Background(), EdgeReportRequest{Session: sess, Trades: trades, Seed: 1})
	if err != nil {
		t.Fatalf("BuildEdgeReport: %v", err)
	}
	found := false
	for _, w := range report.Audit.Warnings {
		if w == "zeroVarianceSample" {
			found = true
		}
	}
	if !found {
		t.Errorf("audit.warnings = %v, want to contain zeroVarianceSample", report.Audit.Warnings)
	}
}

func TestBuildEdgeReport_SizingNilWhenOutOfSampleExpectancyNegative(t *testing.T) {
	trades := make([]model.Trade, 60)
	for i := 0; i < 48; i++ {
		trades[i] = newTrade("win", "long", 0, int64(i+1), 1000, 20_000, withRMultiple(2))
	}
	for i := 48; i < 60; i++ {
		trades[i] = newTrade("loss", "long", 0, int64(i+1), 1000, -10_000, withRMultiple(-1))
	}
	sess := model.Session{ID: "sess-1", Symbol: "NQ", Tf: "1m", Kind: "replay"}
	report, err := BuildEdgeReport(context.Background(), EdgeReportRequest{Session: sess, Trades: trades, Seed: 1})
	if err != nil {
		t.Fatalf("BuildEdgeReport: %v", err)
	}
	if report.Edge.Verdict != EdgeVerdictEdge {
		t.Fatalf("edge.verdict = %q, want edge (precondition for this test)", report.Edge.Verdict)
	}
	if report.WalkForward.OutOfSample.ExpectancyR >= 0 {
		t.Fatalf("walkForward.outOfSample.expectancyR = %v, want negative (precondition for this test)", report.WalkForward.OutOfSample.ExpectancyR)
	}
	if report.Sizing != nil {
		t.Errorf("sizing = %+v, want nil (out-of-sample expectancy is negative)", report.Sizing)
	}
}

func TestBuildEdgeReport_CancellationReturnsError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := BuildEdgeReport(ctx, EdgeReportRequest{})
	if err == nil {
		t.Fatal("err = nil, want context.Canceled")
	}
}
