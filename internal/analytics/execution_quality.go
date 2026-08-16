package analytics

import (
	"math"
	"sort"

	"market-replay/internal/model"
)

// ExecutionCostModel is the assumed spread/slippage cost — tick value is
// resolved per-trade via MarketData.TickValueCents(trade.Symbol) (never a
// single flat client-supplied value, and never hard-coded per symbol in
// the handler), since a source's trades are not guaranteed to share one
// symbol. SpreadTicks/SlippageTicks are policy assumptions with no
// persisted source, so callers may override them.
type ExecutionCostModel struct {
	SpreadTicks   float64
	SlippageTicks float64
}

// ExecutionTradeQuality is one trade's exit-location quality.
type ExecutionTradeQuality struct {
	TradeID       string  `json:"tradeId"`
	RealizedR     float64 `json:"realizedR"`
	MfeR          float64 `json:"mfeR"`
	MfePercentile float64 `json:"mfePercentile"`
	CaptureRatio  float64 `json:"captureRatio"`
}

// ExitReasonBreakdown counts each trade's persisted exit reason.
// model.Trade.ExitReason is validated to manual|stopLoss|takeProfit at
// write time (see internal/httpapi/sessions.go's validateJournal), but
// this reads whatever is actually in storage — an unexpected value is
// counted separately, never silently folded into Manual.
type ExitReasonBreakdown struct {
	Manual     int `json:"manual"`
	StopLoss   int `json:"stopLoss"`
	TakeProfit int `json:"takeProfit"`
	Unknown    int `json:"unknown,omitempty"`
}

// mfeHistogramBinWidth/mfeHistogramCatchAllFrom mirror the same
// [from,to)-with-catch-all convention the Drawdown API's MAE histogram
// uses: fixed 0.4R bins from 0 up to (not including) 4.0R, then one
// ">=4.0" catch-all, so the contract's bucket count never changes.
const (
	mfeHistogramBinWidth        = 0.4
	mfeHistogramCatchAllFrom    = 4.0
	mfeHistogramRegularBinCount = 10 // [0,0.4) .. [3.6,4.0)
)

// MfeHistogramBin is one [FromInclusiveR,ToExclusiveR) bucket of the MFE-in-R
// histogram. ToExclusiveR is nil for the catch-all final bucket.
type MfeHistogramBin struct {
	FromInclusiveR float64  `json:"fromInclusiveR"`
	ToExclusiveR   *float64 `json:"toExclusiveR"`
	Count          int      `json:"count"`
}

// ExecutionQuality is AnalyzeExecutionQuality's result.
type ExecutionQuality struct {
	Trades               []ExecutionTradeQuality   `json:"trades"`
	AverageMfePercentile float64                   `json:"averageMfePercentile"`
	AverageCaptureRatio  float64                   `json:"averageCaptureRatio"`
	GrossExpectancyR     float64                   `json:"grossExpectancyR"`
	NetExpectancyR       float64                   `json:"netExpectancyR"`
	NetWinRate           float64                   `json:"netWinRate"`
	EdgeAfterCosts       bool                      `json:"edgeAfterCosts"`
	AverageCostR         float64                   `json:"averageCostR"`
	CostModel            ExecutionCostModelSummary `json:"costModel"`
	MfeHistogram         []MfeHistogramBin         `json:"mfeHistogram"`
	ExitReasonBreakdown  ExitReasonBreakdown       `json:"exitReasonBreakdown"`
}

// ExecutionCostModelSummary is a display-only echo of the cost model
// actually applied. TickValueCents reflects only the source's own primary
// symbol (resolved by the report layer, which has the session; see
// BuildExecutionReport) — kept for backward compatibility, but it is NOT
// necessarily what every trade was costed at: model.Trade.Symbol is
// client-supplied per trade and is never validated against the session's
// own symbol (see internal/httpapi/sessions.go's validateJournal), so a
// source's trades are not guaranteed to share one symbol.
// TickValueBySymbol is the accurate picture: every distinct symbol actually
// present among the trades AnalyzeExecutionQuality costed, mapped to the
// tick value it was resolved to — nil when there were no eligible trades.
type ExecutionCostModelSummary struct {
	TickValueCents    float64            `json:"tickValueCents"`
	TickValueBySymbol map[string]float64 `json:"tickValueBySymbol,omitempty"`
	SpreadTicks       float64            `json:"spreadTicks"`
	SlippageTicks     float64            `json:"slippageTicks"`
	FeesIncluded      bool               `json:"feesIncluded"`
}

// ExecutionAuditCounts is the eligibility audit AnalyzeExecutionQuality
// returns alongside its result.
type ExecutionAuditCounts struct {
	ExcludedNoInitialRisk int
	ExcludedNoCostConfig  int
	UnknownExitReason     int
}

type executionCandidate struct {
	trade          model.Trade
	realizedR      float64
	mfeR           float64
	riskTicks      int64
	tickValueCents float64
}

func newMfeHistogram() []MfeHistogramBin {
	bins := make([]MfeHistogramBin, 0, mfeHistogramRegularBinCount+1)
	for i := 0; i < mfeHistogramRegularBinCount; i++ {
		from := float64(i) * mfeHistogramBinWidth
		to := from + mfeHistogramBinWidth
		bins = append(bins, MfeHistogramBin{FromInclusiveR: from, ToExclusiveR: &to})
	}
	bins = append(bins, MfeHistogramBin{FromInclusiveR: mfeHistogramCatchAllFrom, ToExclusiveR: nil})
	return bins
}

// addToMfeHistogram places mfeR (always >= 0) into its bucket. The regular
// bins cover [0,4.0) contiguously and the final bin is the open-ended
// catch-all, so exactly one bucket always matches.
func addToMfeHistogram(bins []MfeHistogramBin, mfeR float64) {
	for i := range bins {
		b := &bins[i]
		if b.ToExclusiveR == nil {
			if mfeR >= b.FromInclusiveR {
				b.Count++
				return
			}
			continue
		}
		if mfeR >= b.FromInclusiveR && mfeR < *b.ToExclusiveR {
			b.Count++
			return
		}
	}
}

// AnalyzeExecutionQuality measures how much of each trade's available MFE
// was captured (tie policy for the exit percentile: a trade's realized R
// counts every MFE-distribution member <= it, inclusive), then models fees
// + spread + slippage to report expectancy net of costs. Only trades with
// a valid initial risk (the trade's own InitialStopTicks — policy: never a
// market-data-derived risk) and a persisted RMultiple are included; a
// trade whose own symbol has no resolvable tick value is excluded and
// audited rather than silently costed at 0. The returned result's
// CostModel carries only TickValueBySymbol (every symbol this call actually
// resolved); the caller (BuildExecutionReport) fills in the remaining
// display fields (TickValueCents/SpreadTicks/SlippageTicks/FeesIncluded).
func AnalyzeExecutionQuality(trades []model.Trade, md MarketData, costModel ExecutionCostModel) (ExecutionQuality, ExecutionAuditCounts) {
	var candidates []executionCandidate
	var audit ExecutionAuditCounts
	for _, t := range trades {
		risk, ok := tradeRiskTicks(t)
		if !ok || t.RMultiple == nil {
			audit.ExcludedNoInitialRisk++
			continue
		}
		var tickValueCents float64
		var resolved bool
		if md != nil {
			tickValueCents, resolved = md.TickValueCents(t.Symbol)
		}
		if !resolved {
			audit.ExcludedNoCostConfig++
			continue
		}
		mfeR := float64(t.MfeTicks) / float64(risk)
		if mfeR < 0 {
			mfeR = 0
		}
		candidates = append(candidates, executionCandidate{
			trade: t, realizedR: *t.RMultiple, mfeR: mfeR, riskTicks: risk, tickValueCents: tickValueCents,
		})
	}

	mfeDistribution := make([]float64, len(candidates))
	for i, c := range candidates {
		mfeDistribution[i] = c.mfeR
	}
	sort.Float64s(mfeDistribution)

	tradeQuality := make([]ExecutionTradeQuality, len(candidates))
	realizedRs := make([]float64, len(candidates))
	histogram := newMfeHistogram()
	for i, c := range candidates {
		threshold := math.Max(0, c.realizedR)
		var notGreater int
		for _, v := range mfeDistribution {
			if v <= threshold {
				notGreater++
			}
		}
		var percentile float64
		if len(mfeDistribution) > 0 {
			percentile = float64(notGreater) / float64(len(mfeDistribution)) * 100
		}
		var captureRatio float64
		if c.mfeR != 0 {
			captureRatio = c.realizedR / c.mfeR
		}
		tradeQuality[i] = ExecutionTradeQuality{
			TradeID: c.trade.ID, RealizedR: c.realizedR, MfeR: c.mfeR,
			MfePercentile: percentile, CaptureRatio: captureRatio,
		}
		realizedRs[i] = c.realizedR
		addToMfeHistogram(histogram, c.mfeR)
	}

	grossExpectancyR := average(realizedRs)

	costRValues := make([]float64, len(candidates))
	for i, c := range candidates {
		marketCostCents := (math.Max(0, costModel.SpreadTicks) + math.Max(0, costModel.SlippageTicks)) * math.Max(0, c.tickValueCents) * float64(c.trade.Qty)
		riskCents := float64(c.riskTicks) * math.Max(0, c.tickValueCents) * float64(c.trade.Qty)
		if riskCents == 0 {
			continue
		}
		costRValues[i] = (math.Max(0, float64(c.trade.FeesCents)) + marketCostCents) / riskCents
	}
	averageCostR := average(costRValues)
	netExpectancyR := grossExpectancyR - averageCostR

	var wins int
	for _, c := range candidates {
		if c.realizedR-averageCostR > 0 {
			wins++
		}
	}
	var netWinRate float64
	if len(candidates) > 0 {
		netWinRate = float64(wins) / float64(len(candidates)) * 100
	}

	var breakdown ExitReasonBreakdown
	for _, t := range trades {
		switch t.ExitReason {
		case "manual":
			breakdown.Manual++
		case "stopLoss":
			breakdown.StopLoss++
		case "takeProfit":
			breakdown.TakeProfit++
		default:
			breakdown.Unknown++
			audit.UnknownExitReason++
		}
	}

	percentiles := make([]float64, len(tradeQuality))
	captureRatios := make([]float64, len(tradeQuality))
	for i, tq := range tradeQuality {
		percentiles[i] = tq.MfePercentile
		captureRatios[i] = tq.CaptureRatio
	}

	var tickValueBySymbol map[string]float64
	for _, c := range candidates {
		if tickValueBySymbol == nil {
			tickValueBySymbol = make(map[string]float64, len(candidates))
		}
		tickValueBySymbol[c.trade.Symbol] = c.tickValueCents
	}

	return ExecutionQuality{
		Trades:               tradeQuality,
		AverageMfePercentile: average(percentiles),
		AverageCaptureRatio:  average(captureRatios),
		GrossExpectancyR:     grossExpectancyR,
		NetExpectancyR:       netExpectancyR,
		NetWinRate:           netWinRate,
		EdgeAfterCosts:       netExpectancyR > 0,
		AverageCostR:         averageCostR,
		CostModel:            ExecutionCostModelSummary{TickValueBySymbol: tickValueBySymbol},
		MfeHistogram:         histogram,
		ExitReasonBreakdown:  breakdown,
	}, audit
}
