package analytics

// MarketData resolves Ideal RR forward windows and tick value. The one
// production implementation adapts bars.Registry
// (internal/httpapi/analytics_marketdata.go); nil is a valid Request field —
// every risk-valid trade then reports as missing market data instead of
// panicking or fabricating a number.
type MarketData interface {
	// TickValueCents returns cents-per-tick-per-contract for symbol
	// (TickSize * PointValue * 100, rounded), ok=false if the symbol is
	// unknown to the market-data store.
	TickValueCents(symbol string) (cents float64, ok bool)
	// ForwardExtremesBatch answers every window in one call, so the
	// production adapter opens the underlying (symbol,timeframe) dataset
	// exactly once per report regardless of trade count — never once per
	// trade. windows and the returned slice are index-aligned and the same
	// length.
	ForwardExtremesBatch(symbol, timeframe string, windows []TimeWindow) []ForwardExtreme
	// PriceBarsBatch answers every window in one call (same batching
	// discipline as ForwardExtremesBatch), returning each window's raw bars
	// in ascending timestamp order so a caller can walk them itself (e.g.
	// the stop-loss/RR simulators' bar-by-bar stop/target touch detection).
	// Only High/Low/Ts are exposed — Open/Close are never needed to detect
	// whether a price level was touched. windows and the returned slice are
	// index-aligned and the same length.
	PriceBarsBatch(symbol, timeframe string, windows []TimeWindow) []PriceWindow
}

// PriceBar is one bar's high/low (in ticks) at a timestamp, used to walk a
// trade's [EntryTs, ExitTs] window bar-by-bar for stop/target simulation.
type PriceBar struct {
	Ts                  int64
	HighTicks, LowTicks int64
}

// PriceWindow is one TimeWindow's bars, in ascending Ts order. Found is
// false if the dataset doesn't exist or held no bars in that window —
// callers must exclude the trade, never simulate against an empty window.
type PriceWindow struct {
	Bars  []PriceBar
	Found bool
}

// TimeWindow is an inclusive [FromTs,ToTs] epoch-second range.
type TimeWindow struct {
	FromTs, ToTs int64
}

// ForwardExtreme is the highest high / lowest low, in ticks, found within
// one TimeWindow. Found is false if the dataset doesn't exist or held no
// bars in that window — callers must exclude the trade, never treat the
// zero value as a real extreme.
type ForwardExtreme struct {
	HighTicks, LowTicks int64
	Found               bool
}

// computeIdealRR fills idealRiskValid trades' initialRiskAmountCents, mfeR,
// and (given market-data coverage) idealValid/idealR. mfeR only needs tick
// value — MFE is already recorded per-trade by the client, no bar lookup
// required — so it is set even when the forward-window lookup below finds
// no coverage.
//
// Grouped by each tradeStat's own symbol (already carried per-trade —
// computeTradeStats sets it from model.Trade.Symbol) rather than trusting a
// single request-level symbol: Trade.Symbol is client-supplied per trade
// and never validated against its session's own symbol (see
// internal/httpapi/sessions.go's validateJournal), so a source's trades are
// not guaranteed to share one. The common case (every trade shares one
// symbol) makes exactly the same TickValueCents/ForwardExtremesBatch calls
// as a single-symbol implementation would.
func computeIdealRR(stats []*tradeStat, timeframe string, md MarketData) {
	if md == nil {
		return
	}

	bySymbol := make(map[string][]int)
	var symbolOrder []string
	for i, st := range stats {
		if !st.idealRiskValid {
			continue
		}
		if _, seen := bySymbol[st.symbol]; !seen {
			symbolOrder = append(symbolOrder, st.symbol)
		}
		bySymbol[st.symbol] = append(bySymbol[st.symbol], i)
	}

	for _, sym := range symbolOrder {
		tickValueCents, ok := md.TickValueCents(sym)
		if !ok {
			continue
		}

		var idx []int
		var windows []TimeWindow
		for _, i := range bySymbol[sym] {
			st := stats[i]
			st.initialRiskAmountCents = float64(st.riskTicks) * float64(st.qty) * tickValueCents
			if st.initialRiskAmountCents == 0 {
				// riskTicks > 0 guarantees this only if qty or tickValueCents
				// is zero, which would make every R-multiple undefined; treat
				// as not risk-valid after all rather than divide by zero
				// below.
				continue
			}
			st.mfeR = float64(st.mfeTicks) * float64(st.qty) * tickValueCents / st.initialRiskAmountCents
			idx = append(idx, i)
			windows = append(windows, TimeWindow{FromTs: st.entryTs, ToTs: st.entryTs + sevenDaysSeconds})
		}
		if len(windows) == 0 {
			continue
		}

		extremes := md.ForwardExtremesBatch(sym, timeframe, windows)
		for j, i := range idx {
			if j >= len(extremes) {
				break
			}
			ext := extremes[j]
			if !ext.Found {
				continue
			}
			st := stats[i]
			var excursionTicks int64
			if st.side == "long" {
				excursionTicks = ext.HighTicks - st.entryPriceTicks
			} else {
				excursionTicks = st.entryPriceTicks - ext.LowTicks
			}
			st.idealR = float64(excursionTicks) * tickValueCents * float64(st.qty) / st.initialRiskAmountCents
			st.idealValid = true
		}
	}
}
