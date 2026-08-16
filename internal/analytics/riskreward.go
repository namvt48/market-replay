package analytics

// couldHaveThreshold is rule 7's bar: a losing trade whose ideal R or MFE R
// exceeded this counts as "could have been profitable or breakeven".
const couldHaveThreshold = 1.2

// buildRiskReward computes rules 5-7.
func buildRiskReward(stats []*tradeStat) RiskReward {
	var series RrSeries
	var actualSum, idealSum float64
	var actualCount, idealCount int
	var maxActual, maxIdeal float64
	haveMaxActual, haveMaxIdeal := false, false
	var excluded, missingMarketData, couldHave int
	var couldHaveMaxIdeal float64

	for _, st := range stats {
		if st.riskValid {
			actualCount++
			actualSum += st.actualR
			if !haveMaxActual || st.actualR > maxActual {
				maxActual = st.actualR
				haveMaxActual = true
			}
			series.Actual = append(series.Actual, rrPoint(st, st.actualR))
		} else {
			excluded++
		}

		if st.idealRiskValid && !st.idealValid {
			missingMarketData++
		}
		if st.idealValid {
			idealCount++
			idealSum += st.idealR
			if !haveMaxIdeal || st.idealR > maxIdeal {
				maxIdeal = st.idealR
				haveMaxIdeal = true
			}
			series.Ideal = append(series.Ideal, rrPoint(st, st.idealR))
		}

		if st.result == resultLoser && exceedsCouldHaveThreshold(st) {
			couldHave++
			best := st.mfeR
			if st.idealValid {
				best = st.idealR
				if best > couldHaveMaxIdeal {
					couldHaveMaxIdeal = best
				}
			}
			series.Missed = append(series.Missed, rrPoint(st, best))
		}
	}

	var averageRr, averageIdealRr float64
	if actualCount > 0 {
		averageRr = actualSum / float64(actualCount)
	}
	if idealCount > 0 {
		averageIdealRr = idealSum / float64(idealCount)
	}

	return RiskReward{
		AverageRr:                  averageRr,
		MaxRr:                      maxActual,
		IdealAverageRr:             averageIdealRr,
		MaxIdealRr:                 maxIdeal,
		CouldHaveProfitOrBreakeven: couldHave,
		CouldHaveMaxIdealRr:        couldHaveMaxIdeal,
		Series:                     series,
		ExcludedTrades:             excluded,
		MissingMarketDataTrades:    missingMarketData,
	}
}

func rrPoint(st *tradeStat, rr float64) RrPoint {
	return RrPoint{TradeIndex: st.index, TradeID: st.id, ClosedAt: formatTimestamp(st.exitTs), Rr: rr}
}

// exceedsCouldHaveThreshold implements rule 7's "ideal RR hoặc MFE đạt trên
// 1.2R" literally: either metric clearing the bar qualifies the trade,
// independent of which one (or both) actually did.
func exceedsCouldHaveThreshold(st *tradeStat) bool {
	if st.idealValid && st.idealR > couldHaveThreshold {
		return true
	}
	if st.idealRiskValid && st.mfeR > couldHaveThreshold {
		return true
	}
	return false
}
