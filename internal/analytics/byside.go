package analytics

// buildBySide computes rule 11. model.Trade.Side is "long"|"short"; the
// spec's mock used buy/sell language, so that's the mapping applied here —
// nothing is renamed at the storage layer.
func buildBySide(stats []*tradeStat) BySide {
	var buy, sell SideStats
	total := len(stats)
	for _, st := range stats {
		switch st.side {
		case "long":
			buy.Trades++
			if st.result == resultWinner {
				buy.Wins++
			}
		case "short":
			sell.Trades++
			if st.result == resultWinner {
				sell.Wins++
			}
		}
	}
	if total > 0 {
		buy.TradePercent = float64(buy.Trades) / float64(total) * 100
		sell.TradePercent = float64(sell.Trades) / float64(total) * 100
	}
	if buy.Trades > 0 {
		buy.WinRate = float64(buy.Wins) / float64(buy.Trades) * 100
	}
	if sell.Trades > 0 {
		sell.WinRate = float64(sell.Wins) / float64(sell.Trades) * 100
	}
	return BySide{Buy: buy, Sell: sell}
}
