package analytics

import (
	"context"
	"fmt"

	"market-replay/internal/model"
)

// DrawdownPoint is one point on the equity drawdown curve — the same
// equity curve as the performance report's, annotated with the running
// peak and the resulting drawdown at that point.
type DrawdownPoint struct {
	TradeIndex      int     `json:"tradeIndex"`
	TradeID         *string `json:"tradeId"`
	ClosedAt        *string `json:"closedAt"`
	Equity          float64 `json:"equity"`
	PeakEquity      float64 `json:"peakEquity"`
	DrawdownAmount  float64 `json:"drawdownAmount"`
	DrawdownPercent float64 `json:"drawdownPercent"`
}

// EquityDrawdown holds the drawdown curve plus its aggregates. A drawdown
// episode starts at the first point strictly below the running peak and
// ends at the first later point that reaches (or exceeds) that same peak
// again — DrawdownFrequency counts every episode that started, including
// one still open at the series' end (OpenEpisode), but
// AverageRecoveryDays only averages episodes that actually recovered.
type EquityDrawdown struct {
	Points                 []DrawdownPoint `json:"points"`
	MaxDrawdownAmount      float64         `json:"maxDrawdownAmount"`
	MaxDrawdownPercent     float64         `json:"maxDrawdownPercent"`
	AverageDrawdownAmount  float64         `json:"averageDrawdownAmount"`
	AverageDrawdownPercent float64         `json:"averageDrawdownPercent"`
	AverageRecoveryDays    float64         `json:"averageRecoveryDays"`
	DrawdownFrequency      int             `json:"drawdownFrequency"`
	CompletedEpisodes      int             `json:"completedEpisodes"`
	OpenEpisode            bool            `json:"openEpisode"`
}

// MaeHistogramBin is one [FromInclusive,ToExclusive) bucket of the winning
// trades' MAE-in-R histogram. ToExclusive is nil for the catch-all final
// bucket ("everything >= FromInclusive").
type MaeHistogramBin struct {
	FromInclusive float64  `json:"fromInclusive"`
	ToExclusive   *float64 `json:"toExclusive"`
	Label         string   `json:"label"`
	Count         int      `json:"count"`
}

// WinningMaeStats summarizes MAE-in-R across winning trades with a valid
// initial risk. MissingMarketDataTrades is 0 unless a winning trade's
// symbol has no known tick value at all — this implementation trusts
// persisted Trade.MaeTicks unconditionally (see BuildDrawdownReport's
// doc-comment) rather than re-deriving MAE from a market-data bar scan, so
// this field does not (yet) count a "persisted MAE looked unreliable"
// case; there is no such signal available in model.Trade today.
type WinningMaeStats struct {
	AverageMaeR             float64 `json:"averageMaeR"`
	MinMaeR                 float64 `json:"minMaeR"`
	MaxMaeR                 float64 `json:"maxMaeR"`
	IncludedTrades          int     `json:"includedTrades"`
	ExcludedNoInitialRisk   int     `json:"excludedNoInitialRisk"`
	MissingMarketDataTrades int     `json:"missingMarketDataTrades"`
}

// MaximumAdverseExcursion is the winning-trades MAE report — Unit is
// always "R" (MAE expressed as a multiple of the trade's initial risk).
type MaximumAdverseExcursion struct {
	Unit          string            `json:"unit"`
	Histogram     []MaeHistogramBin `json:"histogram"`
	WinningTrades WinningMaeStats   `json:"winningTrades"`
}

// DrawdownReport is the full GET /api/v1/analytics/drawdown payload, minus
// the "source" envelope (built separately by format.go, same as Report).
type DrawdownReport struct {
	EquityDrawdown          EquityDrawdown          `json:"equityDrawdown"`
	MaximumAdverseExcursion MaximumAdverseExcursion `json:"maximumAdverseExcursion"`
}

// BuildDrawdownReport computes the equity drawdown curve/episodes and the
// winning-trades MAE histogram for one source's closed trades.
//
// It deliberately does not use computeTradeStats/computeIdealRR — this
// report needs neither Ideal RR nor MFE-R, so running that pipeline would
// cost an unnecessary forward-window market-data batch fetch. The only
// market-data need here is TickValueCents, called directly.
func BuildDrawdownReport(ctx context.Context, req Request) (DrawdownReport, error) {
	if err := ctx.Err(); err != nil {
		return DrawdownReport{}, err
	}

	sorted := sortClosedTrades(req.Trades)
	stats := buildDrawdownTradeStats(sorted)
	equityPoints := buildEquityCurve(stats, req.InitialBalanceCents)

	return DrawdownReport{
		EquityDrawdown:          buildEquityDrawdown(equityPoints, sorted),
		MaximumAdverseExcursion: buildMaximumAdverseExcursion(sorted, req.MarketData),
	}, nil
}

// buildDrawdownTradeStats builds the minimal []*tradeStat buildEquityCurve
// needs (index/id/exitTs/netPnlCents) without computeTradeStats' Ideal
// RR/MFE-R work, which this report never reads.
func buildDrawdownTradeStats(sorted []model.Trade) []*tradeStat {
	stats := make([]*tradeStat, len(sorted))
	for i, t := range sorted {
		stats[i] = &tradeStat{
			index:       i + 1,
			id:          t.ID,
			exitTs:      t.ExitTs,
			netPnlCents: t.RealizedCents,
		}
	}
	return stats
}

// buildEquityDrawdown derives the drawdown curve from the equity curve's
// balance series (drawdownSeries), then walks it once more to find
// episodes. sorted is index-aligned with points[1:] (points[0] is the
// synthetic pre-trade point) and supplies the real ExitTs each episode's
// start/recovery needs for AverageRecoveryDays.
func buildEquityDrawdown(points []EquityPoint, sorted []model.Trade) EquityDrawdown {
	values := make([]float64, len(points))
	for i, p := range points {
		values[i] = p.Balance
	}
	peak, amount, percent := drawdownSeries(values)

	ddPoints := make([]DrawdownPoint, len(points))
	var maxAmount, maxPercent float64
	for i, p := range points {
		ddPoints[i] = DrawdownPoint{
			TradeIndex:      p.TradeIndex,
			TradeID:         p.TradeID,
			ClosedAt:        p.ClosedAt,
			Equity:          p.Balance,
			PeakEquity:      peak[i],
			DrawdownAmount:  amount[i],
			DrawdownPercent: percent[i],
		}
		if amount[i] < maxAmount {
			maxAmount = amount[i]
		}
		if percent[i] < maxPercent {
			maxPercent = percent[i]
		}
	}

	var frequency, completed int
	var recoveryDaysSum float64
	inEpisode := false
	open := false
	var episodeStartIdx int
	for i := range points {
		if !inEpisode {
			if amount[i] < 0 {
				inEpisode = true
				episodeStartIdx = i
				frequency++
			}
			continue
		}
		if amount[i] == 0 {
			completed++
			startExitTs := sorted[episodeStartIdx-1].ExitTs
			recoveryExitTs := sorted[i-1].ExitTs
			recoveryDaysSum += float64(recoveryExitTs-startExitTs) / 86400
			inEpisode = false
		}
	}
	if inEpisode {
		open = true
	}

	var avgRecoveryDays float64
	if completed > 0 {
		avgRecoveryDays = recoveryDaysSum / float64(completed)
	}

	return EquityDrawdown{
		Points:                 ddPoints,
		MaxDrawdownAmount:      maxAmount,
		MaxDrawdownPercent:     maxPercent,
		AverageDrawdownAmount:  averageNegative(amount),
		AverageDrawdownPercent: averageNegative(percent),
		AverageRecoveryDays:    avgRecoveryDays,
		DrawdownFrequency:      frequency,
		CompletedEpisodes:      completed,
		OpenEpisode:            open,
	}
}

// maeBinWidth and maeBinCatchAllFrom implement rule: 0.1R-wide buckets
// from 0.0 up to (not including) 1.1R, then one ">=1.1" catch-all.
const (
	maeBinWidth         = 0.1
	maeBinCatchAllFrom  = 1.1
	maeRegularBinsCount = 11 // [0.0,0.1) .. [1.0,1.1)
)

func newMaeHistogram() []MaeHistogramBin {
	bins := make([]MaeHistogramBin, 0, maeRegularBinsCount+1)
	for i := 0; i < maeRegularBinsCount; i++ {
		from := float64(i) * maeBinWidth
		to := from + maeBinWidth
		bins = append(bins, MaeHistogramBin{
			FromInclusive: from,
			ToExclusive:   &to,
			Label:         fmt.Sprintf("%.1f", from),
		})
	}
	bins = append(bins, MaeHistogramBin{
		FromInclusive: maeBinCatchAllFrom,
		ToExclusive:   nil,
		Label:         fmt.Sprintf(">=%.1f", maeBinCatchAllFrom),
	})
	return bins
}

// addToMaeHistogram places maeR (always >= 0) into its bucket. The regular
// bins cover [0.0,1.1) contiguously and the final bin is the open-ended
// catch-all, so exactly one bucket always matches.
func addToMaeHistogram(bins []MaeHistogramBin, maeR float64) {
	for i := range bins {
		b := &bins[i]
		if b.ToExclusive == nil {
			if maeR >= b.FromInclusive {
				b.Count++
				return
			}
			continue
		}
		if maeR >= b.FromInclusive && maeR < *b.ToExclusive {
			b.Count++
			return
		}
	}
}

// buildMaximumAdverseExcursion computes rule "MAE trên winning trades":
// winner = positive net realized PnL; risk-valid = a nonzero initial stop
// distance. MAE is read straight from the persisted Trade.MaeTicks (see
// WinningMaeStats' doc-comment for why no market-data fallback exists).
//
// Tick value is resolved per trade's own Symbol (cached per distinct symbol
// seen, to avoid a repeat registry scan for every trade), not a single
// request-level symbol: Trade.Symbol is client-supplied per trade and never
// validated against its session's own (see internal/httpapi/sessions.go's
// validateJournal), so a source's trades are not guaranteed to share one.
func buildMaximumAdverseExcursion(sorted []model.Trade, md MarketData) MaximumAdverseExcursion {
	type tickValueLookup struct {
		cents float64
		ok    bool
	}
	tickValueCache := make(map[string]tickValueLookup)
	resolveTickValue := func(symbol string) tickValueLookup {
		if cached, ok := tickValueCache[symbol]; ok {
			return cached
		}
		v := tickValueLookup{}
		if md != nil {
			v.cents, v.ok = md.TickValueCents(symbol)
		}
		tickValueCache[symbol] = v
		return v
	}

	bins := newMaeHistogram()
	var sumMaeR float64
	var minMaeR, maxMaeR float64
	haveMin, haveMax := false, false
	var included, excludedNoInitialRisk, missingMarketData int

	for _, t := range sorted {
		if t.RealizedCents <= 0 {
			continue
		}
		if t.InitialStopTicks == nil {
			excludedNoInitialRisk++
			continue
		}
		riskTicks := t.EntryPriceTicks - *t.InitialStopTicks
		if riskTicks < 0 {
			riskTicks = -riskTicks
		}
		if riskTicks <= 0 {
			excludedNoInitialRisk++
			continue
		}
		lookup := resolveTickValue(t.Symbol)
		if !lookup.ok {
			missingMarketData++
			continue
		}
		tickValueCents := lookup.cents
		initialRiskAmountCents := float64(riskTicks) * float64(t.Qty) * tickValueCents
		if initialRiskAmountCents == 0 {
			excludedNoInitialRisk++
			continue
		}

		maeTicks := t.MaeTicks
		if maeTicks < 0 {
			maeTicks = -maeTicks
		}
		maeR := float64(maeTicks) * float64(t.Qty) * tickValueCents / initialRiskAmountCents

		included++
		sumMaeR += maeR
		if !haveMin || maeR < minMaeR {
			minMaeR = maeR
			haveMin = true
		}
		if !haveMax || maeR > maxMaeR {
			maxMaeR = maeR
			haveMax = true
		}
		addToMaeHistogram(bins, maeR)
	}

	var avgMaeR float64
	if included > 0 {
		avgMaeR = sumMaeR / float64(included)
	}

	return MaximumAdverseExcursion{
		Unit:      "R",
		Histogram: bins,
		WinningTrades: WinningMaeStats{
			AverageMaeR:             avgMaeR,
			MinMaeR:                 minMaeR,
			MaxMaeR:                 maxMaeR,
			IncludedTrades:          included,
			ExcludedNoInitialRisk:   excludedNoInitialRisk,
			MissingMarketDataTrades: missingMarketData,
		},
	}
}
