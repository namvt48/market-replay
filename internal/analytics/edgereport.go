package analytics

import (
	"context"
	"fmt"

	"market-replay/internal/model"
)

// DecisionIntelligenceCalculationVersion identifies the formula/contract
// version behind both the Edge and Execution & Discipline reports — a
// stable string a test or the FE can pin against, per the doc's
// requirement that responses "identify their own data/formula version".
const DecisionIntelligenceCalculationVersion = "decision-intelligence-v1"

// DecisionSourceSummary is the "source" envelope shared by the Edge and
// Execution & Discipline reports — id/type/title/tradeCount, distinct
// from both SourceSummary (Performance: adds subtitle/status/balance) and
// SimSourceSummary (Simulations: no title).
type DecisionSourceSummary struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	Title      string `json:"title"`
	TradeCount int    `json:"tradeCount"`
}

// BuildDecisionSourceSummary builds the shared "source" field.
func BuildDecisionSourceSummary(sess model.Session, trades []model.Trade) DecisionSourceSummary {
	sorted := sortClosedTrades(trades)
	return DecisionSourceSummary{
		ID: sess.ID, Type: string(SourceTypeForKind(sess.Kind)),
		Title: formatSourceTitle(sess), TradeCount: len(sorted),
	}
}

// EdgeAudit is the Edge report's eligibility audit. EligibleExcursionTrades
// and MarketDataCoverageTrades are the same number by construction: a
// trade needs both a valid initial risk AND market-data bar coverage to
// enter the walk-forward sensitivity re-walk (prepareSimTrades filters on
// both simultaneously), so "eligible for the excursion/sensitivity
// analysis" and "has market-data coverage" describe the identical subset
// here.
type EdgeAudit struct {
	TotalTrades              int      `json:"totalTrades"`
	EligibleRTrades          int      `json:"eligibleRTrades"`
	ExcludedNoRMultiple      int      `json:"excludedNoRMultiple"`
	EligibleExcursionTrades  int      `json:"eligibleExcursionTrades"`
	ExcludedNoInitialRisk    int      `json:"excludedNoInitialRisk"`
	MarketDataCoverageTrades int      `json:"marketDataCoverageTrades"`
	Warnings                 []string `json:"warnings,omitempty"`
}

// EdgeReportRequest is one "Edge" tab computation over a single source's
// closed trades — bundles the 5 modules the tab needs (edge verdict,
// bootstrap CI, decomposition, walk-forward robustness, Kelly sizing).
type EdgeReportRequest struct {
	Session           model.Session
	Trades            []model.Trade
	MarketData        MarketData
	Seed              int64
	BootstrapOptions  BootstrapOptions
	WalkForwardConfig WalkForwardConfig
	KellyOptions      KellyOptions
	DecompositionTopN int
}

// EdgeReport is BuildEdgeReport's result — the full GET
// /api/v1/analytics/edge payload. Sizing is nil until EdgeStats' verdict is
// "edge" AND the walk-forward out-of-sample expectancy is non-negative
// (CalculateKellySizing enforces the first guardrail; this function
// enforces the second, since Kelly itself has no walk-forward knowledge).
type EdgeReport struct {
	Source             DecisionSourceSummary `json:"source"`
	CalculationVersion string                `json:"calculationVersion"`
	Audit              EdgeAudit             `json:"audit"`
	Edge               EdgeStats             `json:"edge"`
	Bootstrap          BootstrapResult       `json:"bootstrap"`
	Decomposition      EdgeDecomposition     `json:"decomposition"`
	WalkForward        WalkForwardResult     `json:"walkForward"`
	Sizing             *KellySizing          `json:"sizing"`
}

const defaultDecompositionTopN = 5

// BuildEdgeReport computes every "Edge" tab module for one source's closed
// trades. Trades need not be pre-sorted or pre-filtered — TradeRValues
// derives the (r, exitTs) pair every R-based module needs, in stable
// closed-trade order.
func BuildEdgeReport(ctx context.Context, req EdgeReportRequest) (EdgeReport, error) {
	if err := ctx.Err(); err != nil {
		return EdgeReport{}, err
	}

	sorted := sortClosedTrades(req.Trades)
	r, exitTs := TradeRValues(req.Trades)
	edge := CalculateEdgeStats(r, EdgeStatsOverrides{})

	bootstrapOptions := req.BootstrapOptions
	bootstrapOptions.Seed = req.Seed
	bootstrap, err := BootstrapAnalytics(ctx, r, bootstrapOptions)
	if err != nil {
		return EdgeReport{}, err
	}

	topN := req.DecompositionTopN
	if topN <= 0 {
		topN = defaultDecompositionTopN
	}
	decomposition := DecomposeEdge(req.Trades, topN)

	walkForward, wfAudit, err := AnalyzeWalkForward(ctx, WalkForwardRequest{
		R: r, ExitTs: exitTs, Trades: req.Trades, Timeframe: req.Session.Tf,
		MarketData: req.MarketData, Config: req.WalkForwardConfig,
	})
	if err != nil {
		return EdgeReport{}, err
	}

	sizing := CalculateKellySizing(edge, req.KellyOptions)
	if sizing != nil && walkForward.OutOfSample.ExpectancyR < 0 {
		sizing = nil
	}

	totalTrades := len(sorted)
	eligibleRTrades := len(r)
	eligibleExcursionTrades := totalTrades - wfAudit.NoInitialStop - wfAudit.InvalidRisk - wfAudit.MissingMarketData
	if eligibleExcursionTrades < 0 {
		eligibleExcursionTrades = 0
	}

	var warnings []string
	if edge.TStatNote != "" {
		warnings = append(warnings, edge.TStatNote)
	}
	for _, sym := range wfAudit.SmallSymbolGroups {
		warnings = append(warnings, fmt.Sprintf("smallSymbolGroup:%s", sym))
	}

	audit := EdgeAudit{
		TotalTrades:              totalTrades,
		EligibleRTrades:          eligibleRTrades,
		ExcludedNoRMultiple:      totalTrades - eligibleRTrades,
		EligibleExcursionTrades:  eligibleExcursionTrades,
		ExcludedNoInitialRisk:    wfAudit.NoInitialStop + wfAudit.InvalidRisk,
		MarketDataCoverageTrades: eligibleExcursionTrades,
		Warnings:                 warnings,
	}

	return EdgeReport{
		Source:             BuildDecisionSourceSummary(req.Session, req.Trades),
		CalculationVersion: DecisionIntelligenceCalculationVersion,
		Audit:              audit,
		Edge:               edge,
		Bootstrap:          bootstrap,
		Decomposition:      decomposition,
		WalkForward:        walkForward,
		Sizing:             sizing,
	}, nil
}
