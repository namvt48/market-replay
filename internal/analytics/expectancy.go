package analytics

// buildExpectancy computes rules 8-9. ProfitFactor is nil with a reason
// instead of +Inf when there are no losing (or no) trades — the spec asks
// explicitly for this to be a typed convention, not a magic float.
func buildExpectancy(stats []*tradeStat) Expectancy {
	total := len(stats)
	var wins, losses int
	var sumWinCents, sumLossCents int64        // sumLossCents accumulates negative
	var grossProfitCents, grossLossCents int64 // grossLossCents is a positive magnitude

	for _, st := range stats {
		switch st.result {
		case resultWinner:
			wins++
			sumWinCents += st.netPnlCents
			grossProfitCents += st.netPnlCents
		case resultLoser:
			losses++
			sumLossCents += st.netPnlCents
			grossLossCents += -st.netPnlCents
		}
	}

	var avgWin, avgLoss float64
	if wins > 0 {
		avgWin = centsToDollars(sumWinCents) / float64(wins)
	}
	if losses > 0 {
		avgLoss = centsToDollars(sumLossCents) / float64(losses)
	}

	var value float64
	if total > 0 {
		winRateDecimal := float64(wins) / float64(total)
		lossRateDecimal := float64(losses) / float64(total)
		value = winRateDecimal*avgWin + lossRateDecimal*avgLoss
	}

	var profitFactor *float64
	var note string
	switch {
	case total == 0:
		note = "no_trades"
	case grossLossCents == 0:
		note = "no_losses"
	default:
		pf := float64(grossProfitCents) / float64(grossLossCents)
		profitFactor = &pf
	}

	return Expectancy{
		Value:            value,
		AverageWin:       avgWin,
		AverageLoss:      avgLoss,
		ProfitFactor:     profitFactor,
		ProfitFactorNote: note,
	}
}
