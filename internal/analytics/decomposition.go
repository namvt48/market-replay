package analytics

import (
	"math"
	"sort"

	"market-replay/internal/model"
)

// TimingFlag/ConcentrationFlag mirror decomposition.ts' TimingFlag/
// ConcentrationFlag unions.
type TimingFlag string

const (
	TimingBalanced  TimingFlag = "balanced"
	TimingExitLeak  TimingFlag = "exit-leak"
	TimingEntryGood TimingFlag = "entry-good"
	TimingEntryRisk TimingFlag = "entry-risk"
)

type ConcentrationFlag string

const (
	ConcentrationDiversified  ConcentrationFlag = "diversified"
	ConcentrationWatch        ConcentrationFlag = "watch"
	ConcentrationConcentrated ConcentrationFlag = "concentrated"
)

// EdgeDecomposition is DecomposeEdge's result. WinRate/AverageWinR/
// AverageLossR are computed (needed for PayoffAsymmetry) but not
// serialized — they duplicate EdgeStats' own fields at the report's top
// level, so the wire contract omits them here rather than repeating them.
type EdgeDecomposition struct {
	WinRate              float64           `json:"-"`
	AverageWinR          float64           `json:"-"`
	AverageLossR         float64           `json:"-"`
	PayoffAsymmetry      float64           `json:"payoffAsymmetry"`
	AverageMfeR          float64           `json:"averageMfeR"`
	AverageMaeR          float64           `json:"averageMaeR"`
	AverageRealizedR     float64           `json:"averageRealizedR"`
	CaptureRatio         float64           `json:"captureRatio"`
	TimingFlag           TimingFlag        `json:"timingFlag"`
	TopN                 int               `json:"topN"`
	TopNConcentrationPct float64           `json:"topNConcentrationPercent"`
	ConcentrationFlag    ConcentrationFlag `json:"concentrationFlag"`
}

// tradeRiskTicks mirrors decomposition.ts' local riskTicks(trade): the
// trade's own initial-stop distance, ok=false when there's no usable stop
// — per policy P1/P3, this always comes from the trade's own persisted
// InitialStopTicks, never a market-data lookup.
func tradeRiskTicks(t model.Trade) (int64, bool) {
	if t.InitialStopTicks == nil {
		return 0, false
	}
	distance := t.EntryPriceTicks - *t.InitialStopTicks
	if distance < 0 {
		distance = -distance
	}
	if distance <= 0 {
		return 0, false
	}
	return distance, true
}

// DecomposeEdge separates edge into hit-rate/payoff, timing (MFE vs MAE vs
// realized R), and profit concentration among the largest topN winners —
// a direct port of decomposition.ts' decomposeEdge. Every ratio uses each
// trade's own persisted rMultiple/mfeTicks/maeTicks (policy P1/P3) — no
// MarketData lookup needed.
func DecomposeEdge(trades []model.Trade, topN int) EdgeDecomposition {
	var rValues []float64
	for _, t := range trades {
		if t.RMultiple != nil && !math.IsNaN(*t.RMultiple) && !math.IsInf(*t.RMultiple, 0) {
			rValues = append(rValues, *t.RMultiple)
		}
	}
	var wins, losses []float64
	for _, v := range rValues {
		switch {
		case v > 0:
			wins = append(wins, v)
		case v < 0:
			losses = append(losses, v)
		}
	}

	var mfeValues, maeValues, realizedValues []float64
	for _, t := range trades {
		risk, ok := tradeRiskTicks(t)
		if !ok {
			continue
		}
		mfe := float64(t.MfeTicks) / float64(risk)
		if mfe < 0 {
			mfe = 0
		}
		mae := float64(t.MaeTicks) / float64(risk)
		if mae < 0 {
			mae = 0
		}
		realized := 0.0
		if t.RMultiple != nil {
			realized = *t.RMultiple
		}
		mfeValues = append(mfeValues, mfe)
		maeValues = append(maeValues, mae)
		realizedValues = append(realizedValues, realized)
	}

	averageWinR := average(wins)
	averageLossR := math.Abs(average(losses))
	averageMfeR := average(mfeValues)
	averageMaeR := average(maeValues)
	averageRealizedR := average(rValues)
	realizedPositive := average(realizedValues)
	if realizedPositive < 0 {
		realizedPositive = 0
	}

	var captureRatio float64
	if averageMfeR != 0 {
		captureRatio = realizedPositive / averageMfeR
	}

	var timing TimingFlag
	switch {
	case averageMfeR > math.Max(0.5, averageRealizedR)*2.1:
		timing = TimingExitLeak
	case averageMaeR <= 0.35 && averageRealizedR > 0:
		timing = TimingEntryGood
	case averageMaeR > 0.8:
		timing = TimingEntryRisk
	default:
		timing = TimingBalanced
	}

	count := int(math.Round(float64(topN)))
	if count < 1 {
		count = 1
	}

	var positiveR []float64
	for _, v := range rValues {
		if v > 0 {
			positiveR = append(positiveR, v)
		}
	}
	sort.Sort(sort.Reverse(sort.Float64Slice(positiveR)))
	largest := positiveR
	if len(largest) > count {
		largest = largest[:count]
	}
	var totalPositive, largestSum float64
	for _, v := range positiveR {
		totalPositive += v
	}
	for _, v := range largest {
		largestSum += v
	}
	var topNConcentrationPct float64
	if totalPositive != 0 {
		topNConcentrationPct = largestSum / totalPositive * 100
	}

	var concentration ConcentrationFlag
	switch {
	case topNConcentrationPct >= 50:
		concentration = ConcentrationConcentrated
	case topNConcentrationPct >= 30:
		concentration = ConcentrationWatch
	default:
		concentration = ConcentrationDiversified
	}

	var winRate float64
	if len(trades) > 0 {
		var winners int
		for _, t := range trades {
			if t.RealizedCents > 0 {
				winners++
			}
		}
		winRate = float64(winners) / float64(len(trades))
	}

	var payoffAsymmetry float64
	if averageLossR != 0 {
		payoffAsymmetry = averageWinR / averageLossR
	}

	return EdgeDecomposition{
		WinRate:              winRate,
		AverageWinR:          averageWinR,
		AverageLossR:         averageLossR,
		PayoffAsymmetry:      payoffAsymmetry,
		AverageMfeR:          averageMfeR,
		AverageMaeR:          averageMaeR,
		AverageRealizedR:     averageRealizedR,
		CaptureRatio:         captureRatio,
		TimingFlag:           timing,
		TopN:                 count,
		TopNConcentrationPct: topNConcentrationPct,
		ConcentrationFlag:    concentration,
	}
}
