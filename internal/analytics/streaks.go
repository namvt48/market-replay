package analytics

// resultPercent expresses a trade's net PnL as a percentage of the
// account's initial balance — the same basis Overview.PnlPercent uses,
// applied per trade for the winners/losers "best/worst/average percent"
// fields (the spec doesn't say what the percentage is relative to; account
// size is the one basis consistent with every other percent in this
// report).
func resultPercent(netPnlCents, initialBalanceCents int64) float64 {
	if initialBalanceCents == 0 {
		return 0
	}
	return float64(netPnlCents) / float64(initialBalanceCents) * 100
}

// consecutiveRuns splits stats (already in stable closed-trade order) into
// runs of consecutive trades matching result, and reports the longest run
// and the mean run length. A breakeven trade interrupts both a winner run
// and a loser run — it is its own outcome, not a continuation of either.
func consecutiveRuns(stats []*tradeStat, result string) (max int, average float64) {
	var runs []int
	current := 0
	for _, st := range stats {
		if st.result == result {
			current++
			continue
		}
		if current > 0 {
			runs = append(runs, current)
		}
		current = 0
	}
	if current > 0 {
		runs = append(runs, current)
	}
	if len(runs) == 0 {
		return 0, 0
	}
	sum := 0
	for _, r := range runs {
		if r > max {
			max = r
		}
		sum += r
	}
	return max, float64(sum) / float64(len(runs))
}

// buildWinnersStats and buildLosersStats compute rule 10.
func buildWinnersStats(stats []*tradeStat, initialBalanceCents int64) WinnersStats {
	var total int
	var sumPercent, best float64
	var haveBest bool
	var sumDuration float64
	for _, st := range stats {
		if st.result != resultWinner {
			continue
		}
		total++
		percent := resultPercent(st.netPnlCents, initialBalanceCents)
		sumPercent += percent
		if !haveBest || percent > best {
			best = percent
			haveBest = true
		}
		sumDuration += st.durationSeconds
	}
	var avgPercent, avgDuration float64
	if total > 0 {
		avgPercent = sumPercent / float64(total)
		avgDuration = sumDuration / float64(total)
	}
	maxConsecutive, avgConsecutive := consecutiveRuns(stats, resultWinner)
	return WinnersStats{
		Total:                  total,
		BestWinPercent:         best,
		AverageWinPercent:      avgPercent,
		AverageDurationSeconds: avgDuration,
		MaxConsecutive:         maxConsecutive,
		AverageConsecutive:     avgConsecutive,
	}
}

func buildLosersStats(stats []*tradeStat, initialBalanceCents int64) LosersStats {
	var total int
	var sumPercent, worst float64
	var haveWorst bool
	var sumDuration float64
	for _, st := range stats {
		if st.result != resultLoser {
			continue
		}
		total++
		percent := resultPercent(st.netPnlCents, initialBalanceCents)
		sumPercent += percent
		if !haveWorst || percent < worst {
			worst = percent
			haveWorst = true
		}
		sumDuration += st.durationSeconds
	}
	var avgPercent, avgDuration float64
	if total > 0 {
		avgPercent = sumPercent / float64(total)
		avgDuration = sumDuration / float64(total)
	}
	maxConsecutive, avgConsecutive := consecutiveRuns(stats, resultLoser)
	return LosersStats{
		Total:                  total,
		WorstLossPercent:       worst,
		AverageLossPercent:     avgPercent,
		AverageDurationSeconds: avgDuration,
		MaxConsecutive:         maxConsecutive,
		AverageConsecutive:     avgConsecutive,
	}
}
