package analytics

import (
	"context"
	"math"

	"market-replay/internal/model"
)

// DecisionClassification is the 4-box outcome-vs-process verdict.
type DecisionClassification string

const (
	DecisionGoodWin  DecisionClassification = "goodWin"
	DecisionGoodLoss DecisionClassification = "goodLoss"
	DecisionBadWin   DecisionClassification = "badWin"
	DecisionBadLoss  DecisionClassification = "badLoss"
)

// decisionAdjustmentPenaltyPerItem/decisionAdjustmentPenaltyCap/
// decisionHarmfulPenaltyPerItem/decisionHarmfulPenaltyCap/
// decisionAdherenceThreshold are the named, unit-tested constants behind
// scoreDecisionTrade's adherence score — no magic numbers scattered through
// the formula.
const (
	decisionAdjustmentPenaltyPerItem = 7  // points lost per protection adjustment, any direction
	decisionAdjustmentPenaltyCap     = 55 // adjustment-count penalty never exceeds this
	decisionHarmfulPenaltyPerItem    = 25 // points lost per adjustment that moved away from plan
	decisionHarmfulPenaltyCap        = 50 // harmful-adjustment penalty never exceeds this
	decisionAdherenceThreshold       = 70 // minimum score to count as "followed the plan"
)

// decisionDividendMinCoveredBadLoss is the floor on how many badLoss trades
// must have a usable re-walk (valid initial risk + market-data bar coverage)
// before RuleFollowingDividendR/Cents is computed at all. A "dividend"
// averaged over a handful of re-walked trades is noise wearing a metric's
// clothes; below this floor the fields are nil and
// RuleFollowingDividendCoverageNote says why, rather than reporting a
// number nobody should act on.
const decisionDividendMinCoveredBadLoss = 20

// TradeDecisionQuality is one trade's process score.
type TradeDecisionQuality struct {
	TradeID        string                 `json:"tradeId"`
	Classification DecisionClassification `json:"classification"`
	AdherenceScore float64                `json:"adherenceScore"`
	TamperedStop   bool                   `json:"tamperedStop"`
	TamperedTarget bool                   `json:"tamperedTarget"`
}

// DecisionMatrix is the 4-box classification tally.
type DecisionMatrix struct {
	GoodWin  int `json:"goodWin"`
	GoodLoss int `json:"goodLoss"`
	BadWin   int `json:"badWin"`
	BadLoss  int `json:"badLoss"`
}

// DecisionQuality is AnalyzeDecisionQuality's result. RuleFollowingDividendR/
// RuleFollowingDividendCents are nil whenever fewer than
// decisionDividendMinCoveredBadLoss badLoss trades have a usable
// counterfactual (valid initial risk + market-data bar coverage) — never a
// fabricated number computed from too thin a sample.
// RuleFollowingDividendCoverageNote explains why in that case ("insufficient");
// CoveredBadLossTrades/TotalBadLossTrades are always populated so a caller
// can tell "no badLoss trades at all" apart from "badLoss trades exist but
// too few are covered" apart from "well past the floor". When computed, the
// dividend fields average over ALL trades (not just badLoss ones),
// reporting the per-trade cost of undisciplined behavior across the whole
// account, diluted the same way the rest of the account's trades dilute it.
//
// Breakeven policy: a trade with RealizedCents == 0 counts as a non-win
// (same bucket as a loss) for the matrix's win/non-win split — but is
// tallied separately in BreakevenTrades, so a caller can tell "this
// account has real losses" apart from "this account has a lot of
// breakevens diluting the loss buckets".
type DecisionQuality struct {
	Trades                            []TradeDecisionQuality `json:"trades"`
	Matrix                            DecisionMatrix         `json:"matrix"`
	PlanAdherenceScore                float64                `json:"planAdherenceScore"`
	RuleFollowingDividendR            *float64               `json:"ruleFollowingDividendR"`
	RuleFollowingDividendCents        *int64                 `json:"ruleFollowingDividendCents"`
	RuleFollowingDividendCoverageNote string                 `json:"ruleFollowingDividendCoverageNote,omitempty"`
	CoveredBadLossTrades              int                    `json:"coveredBadLossTrades"`
	TotalBadLossTrades                int                    `json:"totalBadLossTrades"`
	BreakevenTrades                   int                    `json:"breakevenTrades"`
}

// movedAwayFromPlan reports whether adjustment moved trade's protection
// level in the direction that INCREASES risk relative to its original plan
// (a stop moved further from entry, or a target moved closer to entry).
func movedAwayFromPlan(t model.Trade, adjustment model.ProtectionAdjustment) bool {
	if adjustment.Role == "stopLoss" && t.InitialStopTicks != nil {
		if t.Side == "long" {
			return adjustment.PriceTicks < *t.InitialStopTicks
		}
		return adjustment.PriceTicks > *t.InitialStopTicks
	}
	if adjustment.Role == "takeProfit" && t.InitialTakeProfitTicks != nil {
		if t.Side == "long" {
			return adjustment.PriceTicks < *t.InitialTakeProfitTicks
		}
		return adjustment.PriceTicks > *t.InitialTakeProfitTicks
	}
	return false
}

func scoreDecisionTrade(t model.Trade) TradeDecisionQuality {
	var harmfulStop, harmfulTarget bool
	var harmfulCount int
	for _, adjustment := range t.ProtectionAdjustments {
		if !movedAwayFromPlan(t, adjustment) {
			continue
		}
		harmfulCount++
		switch adjustment.Role {
		case "stopLoss":
			harmfulStop = true
		case "takeProfit":
			harmfulTarget = true
		}
	}

	adjustmentPenalty := math.Min(decisionAdjustmentPenaltyCap, float64(len(t.ProtectionAdjustments))*decisionAdjustmentPenaltyPerItem)
	harmfulPenalty := math.Min(decisionHarmfulPenaltyCap, float64(harmfulCount)*decisionHarmfulPenaltyPerItem)
	adherenceScore := math.Max(0, 100-adjustmentPenalty-harmfulPenalty)
	followedPlan := adherenceScore >= decisionAdherenceThreshold && !harmfulStop
	// Breakeven (RealizedCents == 0) counts as non-win, same as a loss —
	// see DecisionQuality's doc comment on the breakeven policy.
	won := t.RealizedCents > 0

	var classification DecisionClassification
	switch {
	case followedPlan && won:
		classification = DecisionGoodWin
	case followedPlan && !won:
		classification = DecisionGoodLoss
	case !followedPlan && won:
		classification = DecisionBadWin
	default:
		classification = DecisionBadLoss
	}

	return TradeDecisionQuality{
		TradeID: t.ID, Classification: classification, AdherenceScore: adherenceScore,
		TamperedStop: harmfulStop, TamperedTarget: harmfulTarget,
	}
}

// AnalyzeDecisionQuality scores every trade's process (not outcome) against
// its original plan, then re-walks OHLC bars to estimate the
// "rule-following dividend": for every badLoss trade, what R would have
// resulted from holding to entry's ORIGINAL stop/target (InitialStopTicks/
// InitialTakeProfitTicks — never the tampered/adjusted level) instead of
// the actual outcome, stop-first on same-bar ambiguity — never a naive
// "every bad loss becomes -1R" assumption. A badLoss trade with no valid
// initial risk or no market-data bar coverage is excluded from that
// average and folded into the returned SimAuditCounts; if EVERY badLoss
// trade lacks coverage, the dividend fields are nil rather than a
// fabricated number. timeframe is the source session's own; there is no
// per-trade equivalent to group by, unlike Symbol — prepareSimTrades groups
// the re-walk by each trade's own Symbol instead of trusting a single one.
func AnalyzeDecisionQuality(ctx context.Context, trades []model.Trade, timeframe string, md MarketData) (DecisionQuality, SimAuditCounts, error) {
	if err := ctx.Err(); err != nil {
		return DecisionQuality{}, SimAuditCounts{}, err
	}

	scored := make([]TradeDecisionQuality, len(trades))
	for i, t := range trades {
		scored[i] = scoreDecisionTrade(t)
	}

	var matrix DecisionMatrix
	var breakevenTrades int
	adherenceValues := make([]float64, len(scored))
	for i, s := range scored {
		adherenceValues[i] = s.AdherenceScore
		switch s.Classification {
		case DecisionGoodWin:
			matrix.GoodWin++
		case DecisionGoodLoss:
			matrix.GoodLoss++
		case DecisionBadWin:
			matrix.BadWin++
		case DecisionBadLoss:
			matrix.BadLoss++
		}
		if trades[i].RealizedCents == 0 {
			breakevenTrades++
		}
	}
	planAdherenceScore := average(adherenceValues)

	sorted := sortClosedTrades(trades)
	simTrades, audit := prepareSimTrades(sorted, timeframe, md)
	byID := make(map[string]simTrade, len(simTrades))
	for _, st := range simTrades {
		byID[st.id] = st
	}

	var badLossCount, coveredCount int
	var dividendRSum, dividendCentsSum float64
	for i, quality := range scored {
		if quality.Classification != DecisionBadLoss {
			continue
		}
		badLossCount++
		st, ok := byID[trades[i].ID]
		if !ok {
			continue // excluded; already counted in audit by prepareSimTrades
		}
		actualR := float64(trades[i].RealizedCents) / st.initialRiskAmountCents
		plannedR := sensitivityRewalkR(st, 0, 0) // re-walk against the ORIGINAL stop/target, no shift
		dividendRSum += plannedR - actualR
		dividendCentsSum += (plannedR - actualR) * st.initialRiskAmountCents
		coveredCount++
	}

	var ruleFollowingDividendR *float64
	var ruleFollowingDividendCents *int64
	var coverageNote string
	switch {
	case badLossCount == 0:
		zero := 0.0
		zeroCents := int64(0)
		ruleFollowingDividendR = &zero
		ruleFollowingDividendCents = &zeroCents
	case coveredCount >= decisionDividendMinCoveredBadLoss:
		r := dividendRSum / float64(len(trades))
		c := int64(math.Round(dividendCentsSum / float64(len(trades))))
		ruleFollowingDividendR = &r
		ruleFollowingDividendCents = &c
	default:
		// badLossCount > 0 but fewer than decisionDividendMinCoveredBadLoss
		// had a usable re-walk -> null, not a fabricated/noisy number (see
		// DecisionQuality's doc comment).
		coverageNote = "insufficient"
	}

	return DecisionQuality{
		Trades: scored, Matrix: matrix, PlanAdherenceScore: planAdherenceScore,
		RuleFollowingDividendR: ruleFollowingDividendR, RuleFollowingDividendCents: ruleFollowingDividendCents,
		RuleFollowingDividendCoverageNote: coverageNote,
		CoveredBadLossTrades:              coveredCount,
		TotalBadLossTrades:                badLossCount,
		BreakevenTrades:                   breakevenTrades,
	}, audit, nil
}
