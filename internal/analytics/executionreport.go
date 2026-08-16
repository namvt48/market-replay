package analytics

import (
	"context"

	"market-replay/internal/model"
)

// executionCostModelSource is a fixed descriptive string for the response's
// audit.costModelSource — cost tick values always come from the registered
// symbol config (bars.Registry via MarketData), never a client-supplied
// number, so this is a constant, not a computed field.
const executionCostModelSource = "symbol-config"

// ExecutionAudit is the Execution & Discipline report's eligibility audit.
// ExcludedNoCostConfig and UnknownExitReasonTrades are additive beyond the
// doc's illustrative example, per its own instruction that an unresolvable
// symbol and an unrecognized exit reason must each be audited, not silently
// folded into another bucket.
type ExecutionAudit struct {
	TotalTrades               int    `json:"totalTrades"`
	EligibleExecutionTrades   int    `json:"eligibleExecutionTrades"`
	ExcludedNoInitialRisk     int    `json:"excludedNoInitialRisk"`
	ExcludedNoCostConfig      int    `json:"excludedNoCostConfig,omitempty"`
	ProtectionTelemetryTrades int    `json:"protectionTelemetryTrades"`
	CostModelSource           string `json:"costModelSource"`
	MarketDataCoverageTrades  int    `json:"marketDataCoverageTrades"`
	UnknownExitReasonTrades   int    `json:"unknownExitReasonTrades,omitempty"`
}

// ExecutionReportRequest is one "Execution & Discipline" tab computation
// over a single source's closed trades — bundles the 3 modules the tab
// needs (execution quality, decision quality, tilt/psychology).
type ExecutionReportRequest struct {
	Session    model.Session
	Trades     []model.Trade
	MarketData MarketData
	CostModel  ExecutionCostModel
}

// ExecutionReport is BuildExecutionReport's result — the full GET
// /api/v1/analytics/execution-discipline payload.
type ExecutionReport struct {
	Source             DecisionSourceSummary `json:"source"`
	CalculationVersion string                `json:"calculationVersion"`
	Audit              ExecutionAudit        `json:"audit"`
	Execution          ExecutionQuality      `json:"execution"`
	Decision           DecisionQuality       `json:"decision"`
	Psychology         TiltAnalysis          `json:"psychology"`
}

// BuildExecutionReport computes every "Execution & Discipline" tab module
// for one source's closed trades.
func BuildExecutionReport(ctx context.Context, req ExecutionReportRequest) (ExecutionReport, error) {
	if err := ctx.Err(); err != nil {
		return ExecutionReport{}, err
	}

	sorted := sortClosedTrades(req.Trades)

	execution, execAudit := AnalyzeExecutionQuality(req.Trades, req.MarketData, req.CostModel)
	displayTickValueCents := 0.0
	if req.MarketData != nil {
		displayTickValueCents, _ = req.MarketData.TickValueCents(req.Session.Symbol)
	}
	// Assigned field-by-field, not as a struct literal, so it doesn't wipe
	// out TickValueBySymbol — AnalyzeExecutionQuality already populated that
	// from the trades it actually costed.
	execution.CostModel.TickValueCents = displayTickValueCents
	execution.CostModel.SpreadTicks = req.CostModel.SpreadTicks
	execution.CostModel.SlippageTicks = req.CostModel.SlippageTicks
	execution.CostModel.FeesIncluded = true

	// decision-quality's own coverage gap is already surfaced via
	// RuleFollowingDividendR/Cents being nil when insufficient — its
	// SimAuditCounts isn't folded into ExecutionAudit (a different
	// eligibility question: risk-valid trades for cost modeling vs.
	// badLoss trades needing a re-walk counterfactual).
	decision, _, err := AnalyzeDecisionQuality(ctx, req.Trades, req.Session.Tf, req.MarketData)
	if err != nil {
		return ExecutionReport{}, err
	}

	totalTrades := len(sorted)
	eligibleExecutionTrades := totalTrades - execAudit.ExcludedNoInitialRisk - execAudit.ExcludedNoCostConfig
	if eligibleExecutionTrades < 0 {
		eligibleExecutionTrades = 0
	}

	audit := ExecutionAudit{
		TotalTrades:               totalTrades,
		EligibleExecutionTrades:   eligibleExecutionTrades,
		ExcludedNoInitialRisk:     execAudit.ExcludedNoInitialRisk,
		ExcludedNoCostConfig:      execAudit.ExcludedNoCostConfig,
		ProtectionTelemetryTrades: totalTrades, // every trade carries (possibly empty) protection-adjustment telemetry
		CostModelSource:           executionCostModelSource,
		MarketDataCoverageTrades:  eligibleExecutionTrades,
		UnknownExitReasonTrades:   execAudit.UnknownExitReason,
	}

	return ExecutionReport{
		Source:             BuildDecisionSourceSummary(req.Session, req.Trades),
		CalculationVersion: DecisionIntelligenceCalculationVersion,
		Audit:              audit,
		Execution:          execution,
		Decision:           decision,
		Psychology:         AnalyzeTilt(req.Trades),
	}, nil
}
