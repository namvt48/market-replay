package analytics

import (
	"testing"

	"market-replay/internal/model"
)

func TestIdealRR_Long(t *testing.T) {
	// entry at 1000 ticks, stop at 990 (risk 10 ticks), tick value 5c/contract,
	// qty 1 -> initialRiskAmountCents = 50. Forward high of 1050 -> excursion
	// 50 ticks -> idealR = 50*5/50 = 5.0.
	md := &fakeMarketData{
		tickValue: map[string]float64{"NQ": 5},
		extremesFn: func(symbol, timeframe string, windows []TimeWindow) []ForwardExtreme {
			out := make([]ForwardExtreme, len(windows))
			for i := range out {
				out[i] = ForwardExtreme{HighTicks: 1050, LowTicks: 995, Found: true}
			}
			return out
		},
	}
	trades := []model.Trade{
		newTrade("t1", "long", 0, 10, 1000, 100, withInitialStop(990)),
	}
	stats := computeTradeStats(trades, Request{Symbol: "NQ", Timeframe: "1m", MarketData: md})
	if !stats[0].idealValid {
		t.Fatalf("expected idealValid=true")
	}
	if stats[0].idealR != 5.0 {
		t.Errorf("idealR = %v, want 5.0", stats[0].idealR)
	}
}

func TestIdealRR_Short(t *testing.T) {
	// entry 1000, stop 1010 (risk 10 ticks), forward low of 950 -> excursion
	// entry-low = 50 ticks -> idealR = 50*5/50 = 5.0.
	md := &fakeMarketData{
		tickValue: map[string]float64{"NQ": 5},
		extremesFn: func(symbol, timeframe string, windows []TimeWindow) []ForwardExtreme {
			out := make([]ForwardExtreme, len(windows))
			for i := range out {
				out[i] = ForwardExtreme{HighTicks: 1005, LowTicks: 950, Found: true}
			}
			return out
		},
	}
	trades := []model.Trade{
		newTrade("t1", "short", 0, 10, 1000, 100, withInitialStop(1010)),
	}
	stats := computeTradeStats(trades, Request{Symbol: "NQ", Timeframe: "1m", MarketData: md})
	if !stats[0].idealValid {
		t.Fatalf("expected idealValid=true")
	}
	if stats[0].idealR != 5.0 {
		t.Errorf("idealR = %v, want 5.0", stats[0].idealR)
	}
}

func TestIdealRR_DoesNotLookPastSevenDays(t *testing.T) {
	var gotWindows []TimeWindow
	md := &fakeMarketData{
		tickValue: map[string]float64{"NQ": 5},
		extremesFn: func(symbol, timeframe string, windows []TimeWindow) []ForwardExtreme {
			gotWindows = windows
			return make([]ForwardExtreme, len(windows))
		},
	}
	entryTs := int64(1_700_000_000)
	trades := []model.Trade{
		newTrade("t1", "long", entryTs, entryTs+3600, 1000, 100, withInitialStop(990)),
	}
	computeTradeStats(trades, Request{Symbol: "NQ", Timeframe: "1m", MarketData: md})

	if len(gotWindows) != 1 {
		t.Fatalf("expected exactly one window requested, got %d", len(gotWindows))
	}
	wantTo := entryTs + sevenDaysSeconds
	if gotWindows[0].FromTs != entryTs || gotWindows[0].ToTs != wantTo {
		t.Errorf("window = %+v, want From=%d To=%d", gotWindows[0], entryTs, wantTo)
	}
}

func TestIdealRR_BatchesOneCallPerReport(t *testing.T) {
	md := &fakeMarketData{tickValue: map[string]float64{"NQ": 5}}
	trades := make([]model.Trade, 0, 50)
	for i := 0; i < 50; i++ {
		ts := int64(i) * daySeconds
		trades = append(trades, newTrade(idFor(i), "long", ts, ts+60, 1000, 10, withInitialStop(990)))
	}
	computeTradeStats(trades, Request{Symbol: "NQ", Timeframe: "1m", MarketData: md})
	if md.callCount != 1 {
		t.Fatalf("ForwardExtremesBatch called %d times, want exactly 1 (batched, not per-trade)", md.callCount)
	}
}

func TestIdealRR_MissingMarketDataIsExcludedNotFabricated(t *testing.T) {
	trades := []model.Trade{
		newTrade("t1", "long", 0, 10, 1000, 100, withInitialStop(990)),
	}
	// No MarketData at all.
	stats := computeTradeStats(trades, Request{Symbol: "NQ", Timeframe: "1m", MarketData: nil})
	if stats[0].idealValid {
		t.Fatalf("idealValid should be false when MarketData is nil")
	}
	rr := buildRiskReward(stats)
	if rr.MissingMarketDataTrades != 1 {
		t.Errorf("missingMarketDataTrades = %d, want 1", rr.MissingMarketDataTrades)
	}
	if len(rr.Series.Ideal) != 0 {
		t.Errorf("ideal series should be empty, got %+v", rr.Series.Ideal)
	}
}

func TestIdealRR_MultiSymbolResolvesEachTradesOwnSymbol(t *testing.T) {
	// Two trades, two symbols with different tick values and different
	// forward extremes — each must be costed with ITS OWN symbol, not a
	// single request-level one (model.Trade.Symbol is client-supplied per
	// trade and never validated against Request.Symbol).
	md := &fakeMarketData{
		tickValue: map[string]float64{"NQ": 5, "ES": 10},
		extremesFn: func(symbol, timeframe string, windows []TimeWindow) []ForwardExtreme {
			out := make([]ForwardExtreme, len(windows))
			for i := range out {
				switch symbol {
				case "NQ":
					out[i] = ForwardExtreme{HighTicks: 1050, LowTicks: 995, Found: true}
				case "ES":
					out[i] = ForwardExtreme{HighTicks: 2100, LowTicks: 1990, Found: true}
				}
			}
			return out
		},
	}
	nq := newTrade("nq-trade", "long", 0, 10, 1000, 100, withInitialStop(990))
	nq.Symbol = "NQ"
	es := newTrade("es-trade", "long", 0, 10, 2000, 100, withInitialStop(1990))
	es.Symbol = "ES"

	stats := computeTradeStats([]model.Trade{nq, es}, Request{Symbol: "NQ", Timeframe: "1m", MarketData: md})
	if !stats[0].idealValid || stats[0].idealR != 5.0 {
		t.Errorf("nq-trade: idealValid=%v idealR=%v, want true/5.0 (50 ticks excursion * 5c / 50c risk)", stats[0].idealValid, stats[0].idealR)
	}
	if !stats[1].idealValid || stats[1].idealR != 10.0 {
		t.Errorf("es-trade: idealValid=%v idealR=%v, want true/10.0 (100 ticks excursion * 10c / 100c risk)", stats[1].idealValid, stats[1].idealR)
	}
}

func TestIdealRR_MultiSymbolOneUnresolvedDoesNotBlockTheOther(t *testing.T) {
	md := &fakeMarketData{
		tickValue: map[string]float64{"NQ": 5}, // ES has no configured tick value
		extremesFn: func(symbol, timeframe string, windows []TimeWindow) []ForwardExtreme {
			out := make([]ForwardExtreme, len(windows))
			for i := range out {
				out[i] = ForwardExtreme{HighTicks: 1050, LowTicks: 995, Found: true}
			}
			return out
		},
	}
	nq := newTrade("nq-trade", "long", 0, 10, 1000, 100, withInitialStop(990))
	nq.Symbol = "NQ"
	es := newTrade("es-trade", "long", 0, 10, 2000, 100, withInitialStop(1990))
	es.Symbol = "ES"

	stats := computeTradeStats([]model.Trade{nq, es}, Request{Symbol: "NQ", Timeframe: "1m", MarketData: md})
	if !stats[0].idealValid {
		t.Errorf("nq-trade: idealValid = false, want true (NQ resolves)")
	}
	if stats[1].idealValid {
		t.Errorf("es-trade: idealValid = true, want false (ES has no tick value)")
	}
}

func idFor(i int) string {
	return "t" + string(rune('a'+i%26)) + string(rune('0'+i/26))
}
