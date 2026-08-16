package analytics

import (
	"context"
	"fmt"
	"math"
	"sort"

	"market-replay/internal/model"
)

// WalkForwardConfig configures the chronological split and rolling-window
// count. Split/Windows are optional overrides of the 0.8/5 defaults.
type WalkForwardConfig struct {
	Split   *float64
	Windows *int
}

// WalkForwardSampleStat is one side (in-sample or out-of-sample) of the
// chronological split.
type WalkForwardSampleStat struct {
	Trades      int     `json:"trades"`
	ExpectancyR float64 `json:"expectancyR"`
}

// WalkForwardWindow is one non-overlapping rolling window's trade count/
// expectancy, in chronological order — window i only ever sees trades that
// closed at or after every trade in window i-1, so no later window's data
// can leak into an earlier one. StartTs/EndTs are nil only for a window
// with zero trades (never happens in practice, since window count is
// capped by entry count, but mirrors a defensive `nil` rather than a
// fabricated 0 timestamp).
type WalkForwardWindow struct {
	Label       string  `json:"label"`
	StartTs     *int64  `json:"startTs"`
	EndTs       *int64  `json:"endTs"`
	Trades      int     `json:"trades"`
	ExpectancyR float64 `json:"expectancyR"`
}

// SensitivityShape classifies the parameter-sensitivity grid's spread.
type SensitivityShape string

const (
	SensitivityPlateau   SensitivityShape = "plateau"
	SensitivityKnifeEdge SensitivityShape = "knife-edge"
)

// SensitivityPoint is one (stopDeltaPercent,targetDeltaPercent) cell of the
// SL/TP sensitivity grid: the average R every risk-valid, market-data
// covered trade would have realized had its stop/target distance been
// shifted by these percentages and then re-walked bar-by-bar from entry to
// actual exit.
type SensitivityPoint struct {
	StopDeltaPercent   float64 `json:"stopDeltaPercent"`
	TargetDeltaPercent float64 `json:"targetDeltaPercent"`
	ExpectancyR        float64 `json:"expectancyR"`
}

// ParameterSensitivity is the sensitivity grid plus its overall range and
// plateau/knife-edge classification. Method is always "ohlc-rewalk" — a
// real bar re-walk, never the noise-formula proxy an earlier iteration of
// this feature used on the frontend.
type ParameterSensitivity struct {
	Method string             `json:"method"`
	Shape  SensitivityShape   `json:"shape"`
	RangeR float64            `json:"rangeR"`
	Points []SensitivityPoint `json:"points"`
}

// WalkForwardResult is AnalyzeWalkForward's result. ParameterSensitivity is
// nil when no trade has both a valid initial risk and market-data bar
// coverage — there is nothing to re-walk, so the field is omitted rather
// than filled with a fabricated grid (see the audit counts AnalyzeWalkForward
// also returns).
type WalkForwardResult struct {
	Split                float64               `json:"split"`
	InSample             WalkForwardSampleStat `json:"inSample"`
	OutOfSample          WalkForwardSampleStat `json:"outOfSample"`
	ExpectancyDeltaR     float64               `json:"expectancyDeltaR"`
	RetentionRatio       float64               `json:"retentionRatio"`
	Windows              []WalkForwardWindow   `json:"windows"`
	ParameterSensitivity *ParameterSensitivity `json:"parameterSensitivity"`
}

// WalkForwardRequest bundles the two eligible sets AnalyzeWalkForward needs:
// R/ExitTs (every trade with a finite RMultiple — the same eligibility as
// EdgeStats) drives the chronological split/windows, while Trades/Timeframe/
// MarketData drive the OHLC re-walk sensitivity grid, which needs the
// smaller risk-valid + bar-covered subset (see prepareSimTrades, which
// groups by each trade's own Symbol rather than trusting a single
// request-level one). These two sets are not the same size in general — a
// trade can have a real RMultiple without ever having had a usable initial
// stop, for instance.
type WalkForwardRequest struct {
	R          []float64
	ExitTs     []int64
	Trades     []model.Trade
	Timeframe  string
	MarketData MarketData
	Config     WalkForwardConfig
}

// walkForwardSensitivityDeltas are the percent deltas the SL/TP sensitivity
// re-walk grid sweeps over both axes (7x7 = 49 points).
var walkForwardSensitivityDeltas = []float64{-20, -10, -5, 0, 5, 10, 20}

// AnalyzeWalkForward splits req.R (paired with req.ExitTs) chronologically
// into an 80/20 (default) in-sample/out-of-sample comparison, buckets it
// into rolling windows, and re-walks a real SL/TP sensitivity grid from
// OHLC bars. It also returns the sensitivity re-walk's own eligibility
// audit (SimAuditCounts), for the caller to fold into the endpoint's
// top-level audit object.
func AnalyzeWalkForward(ctx context.Context, req WalkForwardRequest) (WalkForwardResult, SimAuditCounts, error) {
	if err := ctx.Err(); err != nil {
		return WalkForwardResult{}, SimAuditCounts{}, err
	}

	entries := make([]walkForwardEntry, len(req.R))
	for i, v := range req.R {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			v = 0
		}
		ts := int64(i)
		if i < len(req.ExitTs) {
			ts = req.ExitTs[i]
		}
		entries[i] = walkForwardEntry{r: v, ts: ts}
	}
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].ts < entries[j].ts })

	split := 0.8
	if req.Config.Split != nil {
		split = *req.Config.Split
	}
	if split < 0.5 {
		split = 0.5
	}
	if split > 0.95 {
		split = 0.95
	}
	splitIndex := int(float64(len(entries)) * split)
	if splitIndex < 0 {
		splitIndex = 0
	}
	if splitIndex > len(entries) {
		splitIndex = len(entries)
	}

	inSampleEntries := entries[:splitIndex]
	outOfSampleEntries := entries[splitIndex:]
	inSampleExpectancy := average(walkForwardRs(inSampleEntries))
	outOfSampleExpectancy := average(walkForwardRs(outOfSampleEntries))

	windowCount := 5
	if req.Config.Windows != nil {
		windowCount = *req.Config.Windows
	}
	if windowCount < 2 {
		windowCount = 2
	}
	if windowCount > 12 {
		windowCount = 12
	}
	windowSize := 1
	if len(entries) > 0 {
		windowSize = int(math.Ceil(float64(len(entries)) / float64(windowCount)))
		if windowSize < 1 {
			windowSize = 1
		}
	}

	var windows []WalkForwardWindow
	numWindows := 0
	if windowSize > 0 {
		numWindows = int(math.Ceil(float64(len(entries)) / float64(windowSize)))
	}
	for i := 0; i < numWindows; i++ {
		start := i * windowSize
		end := start + windowSize
		if end > len(entries) {
			end = len(entries)
		}
		items := entries[start:end]
		w := WalkForwardWindow{Label: fmt.Sprintf("W%d", i+1), Trades: len(items), ExpectancyR: average(walkForwardRs(items))}
		if len(items) > 0 {
			startTs := items[0].ts
			endTs := items[len(items)-1].ts
			w.StartTs = &startTs
			w.EndTs = &endTs
		}
		windows = append(windows, w)
	}

	var retentionRatio float64
	if math.Abs(inSampleExpectancy) >= 1e-9 {
		retentionRatio = outOfSampleExpectancy / inSampleExpectancy
	}

	sensitivity, audit, err := walkForwardSensitivity(ctx, req.Trades, req.Timeframe, req.MarketData)
	if err != nil {
		return WalkForwardResult{}, SimAuditCounts{}, err
	}

	return WalkForwardResult{
		Split:                split,
		InSample:             WalkForwardSampleStat{Trades: len(inSampleEntries), ExpectancyR: inSampleExpectancy},
		OutOfSample:          WalkForwardSampleStat{Trades: len(outOfSampleEntries), ExpectancyR: outOfSampleExpectancy},
		ExpectancyDeltaR:     outOfSampleExpectancy - inSampleExpectancy,
		RetentionRatio:       retentionRatio,
		Windows:              windows,
		ParameterSensitivity: sensitivity,
	}, audit, nil
}

type walkForwardEntry struct {
	r  float64
	ts int64
}

func walkForwardRs(entries []walkForwardEntry) []float64 {
	out := make([]float64, len(entries))
	for i, e := range entries {
		out[i] = e.r
	}
	return out
}

// walkForwardSensitivity re-walks every risk-valid, bar-covered trade
// (prepareSimTrades) against the 7x7 stop/target delta grid, real bars,
// stop-first on same-bar ambiguity. Returns (nil, audit, nil) — not an
// error — when zero trades have coverage: there is nothing to re-walk, and
// that is a legitimate, auditable outcome rather than a failure.
func walkForwardSensitivity(ctx context.Context, trades []model.Trade, timeframe string, md MarketData) (*ParameterSensitivity, SimAuditCounts, error) {
	sorted := sortClosedTrades(trades)
	simTrades, audit := prepareSimTrades(sorted, timeframe, md)
	if len(simTrades) == 0 {
		return nil, audit, nil
	}

	points := make([]SensitivityPoint, 0, len(walkForwardSensitivityDeltas)*len(walkForwardSensitivityDeltas))
	rValues := make([]float64, len(simTrades))
	for _, stopDelta := range walkForwardSensitivityDeltas {
		if err := ctx.Err(); err != nil {
			return nil, audit, err
		}
		for _, targetDelta := range walkForwardSensitivityDeltas {
			for i, st := range simTrades {
				rValues[i] = sensitivityRewalkR(st, stopDelta, targetDelta)
			}
			points = append(points, SensitivityPoint{
				StopDeltaPercent: stopDelta, TargetDeltaPercent: targetDelta, ExpectancyR: average(rValues),
			})
		}
	}

	var maxValue, minValue float64
	var base float64
	for _, p := range points {
		if p.ExpectancyR > maxValue {
			maxValue = p.ExpectancyR
		}
		if p.ExpectancyR < minValue {
			minValue = p.ExpectancyR
		}
		if p.StopDeltaPercent == 0 && p.TargetDeltaPercent == 0 {
			base = p.ExpectancyR
		}
	}
	rangeR := maxValue - minValue

	shape := SensitivityPlateau
	if rangeR > math.Max(0.18, math.Abs(base)*0.8) {
		shape = SensitivityKnifeEdge
	}

	return &ParameterSensitivity{Method: "ohlc-rewalk", Shape: shape, RangeR: rangeR, Points: points}, audit, nil
}

// sensitivityRewalkR re-walks one trade with its stop/target distance
// shifted by stopDeltaPercent/targetDeltaPercent (relative to its own
// original distances), returning the resulting R-multiple. A trade with no
// original target (hasTarget false) only has its stop axis re-walked —
// targetDeltaPercent has no effect on it, since there is no original
// target distance to shift. Same-bar ambiguity resolves stop-first;
// touching neither before the actual exit keeps the actual outcome.
func sensitivityRewalkR(t simTrade, stopDeltaPercent, targetDeltaPercent float64) float64 {
	stopDistance := int64(math.Round(float64(t.riskTicks) * (1 + stopDeltaPercent/100)))
	if stopDistance < 1 {
		stopDistance = 1
	}
	stopTicks := stopPriceTicks(t.side, t.entryPriceTicks, stopDistance)

	var targetTicksLevel int64
	if t.hasTarget {
		targetDistance := int64(math.Round(float64(t.targetTicks) * (1 + targetDeltaPercent/100)))
		if targetDistance < 1 {
			targetDistance = 1
		}
		targetTicksLevel = targetPriceTicks(t.side, t.entryPriceTicks, targetDistance)
	}

	for _, bar := range t.bars {
		switch {
		case stopTouched(t.side, bar, stopTicks):
			return float64(simulatedNetPnlCents(t, stopTicks)) / t.initialRiskAmountCents
		case t.hasTarget && targetTouched(t.side, bar, targetTicksLevel):
			return float64(simulatedNetPnlCents(t, targetTicksLevel)) / t.initialRiskAmountCents
		}
	}
	return float64(t.actualNetPnlCents) / t.initialRiskAmountCents
}
