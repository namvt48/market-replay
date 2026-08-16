package analytics

import (
	"math"
	"sort"

	"market-replay/internal/model"
)

// PsychologyProfile mirrors tilt.ts' PsychologyProfile union.
type PsychologyProfile string

const (
	ProfileComposed    PsychologyProfile = "composed"
	ProfileSizeChaser  PsychologyProfile = "size-chaser"
	ProfileRevengeRisk PsychologyProfile = "revenge-risk"
	ProfilePlanDrifter PsychologyProfile = "plan-drifter"
)

// TiltAnalysis is analyzeTilt's result — a direct port of tilt.ts'
// TiltAnalysis.
type TiltAnalysis struct {
	TiltScore               float64           `json:"tiltScore"`
	SlTamperingScore        float64           `json:"slTamperingScore"`
	SizingConsistency       float64           `json:"sizingConsistency"`
	AntiStreakScore         float64           `json:"antiStreakScore"`
	PostLossSizeEscalations int               `json:"postLossSizeEscalations"`
	RapidReentriesAfterLoss int               `json:"rapidReentriesAfterLoss"`
	Profile                 PsychologyProfile `json:"profile"`
}

// rapidReentryWindowSeconds is the "next entry too soon after a loss"
// threshold — a direct port of tilt.ts' `15 * 60`.
const rapidReentryWindowSeconds = 15 * 60

// stopMovedAway reports whether adjustment moved trade's stop further from
// entry than its original plan — a direct port of tilt.ts' stopMovedAway.
func stopMovedAway(t model.Trade, adjustment model.ProtectionAdjustment) bool {
	if adjustment.Role != "stopLoss" || t.InitialStopTicks == nil {
		return false
	}
	if t.Side == "long" {
		return adjustment.PriceTicks < *t.InitialStopTicks
	}
	return adjustment.PriceTicks > *t.InitialStopTicks
}

func qtyValues(trades []model.Trade) []float64 {
	out := make([]float64, len(trades))
	for i, t := range trades {
		out[i] = float64(t.Qty)
	}
	return out
}

// AnalyzeTilt scores position-sizing consistency, stop tampering, and
// behavior after losing streaks (size escalation, rapid re-entry) into a
// single tilt score and psychology profile — a direct port of tilt.ts'
// analyzeTilt. Trades are re-sorted by EntryTs first, since the
// loss-streak/re-entry logic is inherently chronological.
func AnalyzeTilt(trades []model.Trade) TiltAnalysis {
	ordered := make([]model.Trade, len(trades))
	copy(ordered, trades)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].EntryTs < ordered[j].EntryTs })

	quantities := qtyValues(ordered)
	meanQty := average(quantities)
	var coefficientOfVariation float64
	if meanQty != 0 {
		coefficientOfVariation = sampleStdDev(quantities) / meanQty
	}

	var losingStreak int
	var postLossSizeEscalations, rapidReentriesAfterLoss, tamperedStops, antiStreakEvents int

	for index, trade := range ordered {
		var previous *model.Trade
		if index > 0 {
			previous = &ordered[index-1]
			if previous.RealizedCents < 0 {
				losingStreak++
			} else {
				losingStreak = 0
			}
		}

		windowStart := index - 8
		if windowStart < 0 {
			windowStart = 0
		}
		recentMeanQty := average(qtyValues(ordered[windowStart:index]))
		if recentMeanQty == 0 {
			recentMeanQty = meanQty
		}

		if losingStreak >= 2 && float64(trade.Qty) > recentMeanQty*1.25 {
			postLossSizeEscalations++
		}

		// gapWithinWindow only checks timing; whether antiStreakEvents counts
		// does NOT depend on the previous trade having been a loss (TS:
		// `!previous || entryTs-previous.exitTs > 15*60`) — only
		// rapidReentriesAfterLoss additionally requires previous to be a
		// loss. Conflating the two would wrongly gate antiStreakEvents on
		// the previous trade's outcome.
		gapWithinWindow := previous != nil && trade.EntryTs-previous.ExitTs <= rapidReentryWindowSeconds
		if previous != nil && previous.RealizedCents < 0 && gapWithinWindow {
			rapidReentriesAfterLoss++
		}
		if losingStreak >= 2 && float64(trade.Qty) <= recentMeanQty && !gapWithinWindow {
			antiStreakEvents++
		}

		for _, adjustment := range trade.ProtectionAdjustments {
			if stopMovedAway(trade, adjustment) {
				tamperedStops++
			}
		}
	}

	opportunityCount := len(ordered)
	if opportunityCount < 1 {
		opportunityCount = 1
	}

	sizingConsistency := math.Max(0, 100-coefficientOfVariation*100)
	slTamperingScore := math.Min(100, float64(tamperedStops)/float64(opportunityCount)*400)
	escalationScore := float64(postLossSizeEscalations) / float64(opportunityCount) * 600
	reentryScore := float64(rapidReentriesAfterLoss) / float64(opportunityCount) * 350
	tiltScore := math.Min(100, escalationScore+reentryScore+slTamperingScore*0.25)

	antiStreakDenominator := postLossSizeEscalations + antiStreakEvents
	if antiStreakDenominator < 1 {
		antiStreakDenominator = 1
	}
	antiStreakScore := math.Min(100, 60+float64(antiStreakEvents)/float64(antiStreakDenominator)*40-tiltScore*0.25)

	var profile PsychologyProfile
	switch {
	case slTamperingScore >= 35:
		profile = ProfilePlanDrifter
	case escalationScore >= 30 && reentryScore >= 15:
		profile = ProfileRevengeRisk
	case coefficientOfVariation >= 0.35:
		profile = ProfileSizeChaser
	default:
		profile = ProfileComposed
	}

	return TiltAnalysis{
		TiltScore: tiltScore, SlTamperingScore: slTamperingScore, SizingConsistency: sizingConsistency,
		AntiStreakScore: antiStreakScore, PostLossSizeEscalations: postLossSizeEscalations,
		RapidReentriesAfterLoss: rapidReentriesAfterLoss, Profile: profile,
	}
}
