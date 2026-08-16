package analytics

import (
	"context"
	"testing"

	"market-replay/internal/model"
)

func TestBuildExecutionReport_AuditAndCostModelSummary(t *testing.T) {
	md := &fakeMarketData{tickValue: map[string]float64{"NQ": 500}}
	trades := []model.Trade{
		newTrade("valid", "long", 0, 1000, 1000, 10_000, withInitialStop(980), withRMultiple(1), withMfeTicks(40), withExitReason("takeProfit")),
		newTrade("no-risk", "long", 0, 1000, 1000, -1_000, withExitReason("manual")),
	}
	sess := model.Session{ID: "sess-1", Symbol: "NQ", Tf: "1m", Kind: "replay"}
	report, err := BuildExecutionReport(context.Background(), ExecutionReportRequest{
		Session: sess, Trades: trades, MarketData: md,
		CostModel: ExecutionCostModel{SpreadTicks: 0.25, SlippageTicks: 0.35},
	})
	if err != nil {
		t.Fatalf("BuildExecutionReport: %v", err)
	}
	if report.CalculationVersion != DecisionIntelligenceCalculationVersion {
		t.Errorf("calculationVersion = %q, want %q", report.CalculationVersion, DecisionIntelligenceCalculationVersion)
	}
	if report.Audit.TotalTrades != 2 {
		t.Errorf("audit.totalTrades = %d, want 2", report.Audit.TotalTrades)
	}
	if report.Audit.EligibleExecutionTrades != 1 {
		t.Errorf("audit.eligibleExecutionTrades = %d, want 1", report.Audit.EligibleExecutionTrades)
	}
	if report.Audit.ExcludedNoInitialRisk != 1 {
		t.Errorf("audit.excludedNoInitialRisk = %d, want 1", report.Audit.ExcludedNoInitialRisk)
	}
	if report.Audit.ProtectionTelemetryTrades != 2 {
		t.Errorf("audit.protectionTelemetryTrades = %d, want 2 (every trade)", report.Audit.ProtectionTelemetryTrades)
	}
	if report.Audit.CostModelSource != "symbol-config" {
		t.Errorf("audit.costModelSource = %q, want symbol-config", report.Audit.CostModelSource)
	}
	if report.Execution.CostModel.TickValueCents != 500 {
		t.Errorf("execution.costModel.tickValueCents = %v, want 500", report.Execution.CostModel.TickValueCents)
	}
	if !report.Execution.CostModel.FeesIncluded {
		t.Errorf("execution.costModel.feesIncluded = false, want true")
	}
	if got := report.Execution.CostModel.TickValueBySymbol["NQ"]; got != 500 {
		t.Errorf("execution.costModel.tickValueBySymbol[NQ] = %v, want 500", got)
	}
	if report.Source.ID != "sess-1" {
		t.Errorf("source.id = %q, want sess-1", report.Source.ID)
	}
}

func TestBuildExecutionReport_UnresolvableSymbolAudited(t *testing.T) {
	md := &fakeMarketData{tickValue: map[string]float64{"ES": 1250}} // no "NQ"
	trades := []model.Trade{
		newTrade("t", "long", 0, 1000, 1000, 10_000, withInitialStop(980), withRMultiple(1), withMfeTicks(40)),
	}
	sess := model.Session{ID: "sess-1", Symbol: "NQ", Tf: "1m", Kind: "replay"}
	report, err := BuildExecutionReport(context.Background(), ExecutionReportRequest{
		Session: sess, Trades: trades, MarketData: md,
		CostModel: ExecutionCostModel{SpreadTicks: 0.25, SlippageTicks: 0.35},
	})
	if err != nil {
		t.Fatalf("BuildExecutionReport: %v", err)
	}
	if report.Audit.ExcludedNoCostConfig != 1 {
		t.Errorf("audit.excludedNoCostConfig = %d, want 1", report.Audit.ExcludedNoCostConfig)
	}
	if report.Execution.CostModel.TickValueCents != 0 {
		t.Errorf("execution.costModel.tickValueCents = %v, want 0 (NQ has no config)", report.Execution.CostModel.TickValueCents)
	}
}

func TestBuildExecutionReport_CancellationReturnsError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := BuildExecutionReport(ctx, ExecutionReportRequest{})
	if err == nil {
		t.Fatal("err = nil, want context.Canceled")
	}
}
