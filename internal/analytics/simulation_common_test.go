package analytics

import (
	"fmt"
	"testing"

	"market-replay/internal/model"
)

// multiSymbolMarketData resolves tick value only for the symbols listed in
// tickValue, and answers PriceBarsBatch per-call with the bar the test
// configured for that call's symbol — used to verify prepareSimTrades
// groups by each trade's own Symbol rather than trusting one request-level
// value.
func multiSymbolMarketData(tickValue map[string]float64, barsBySymbol map[string]PriceBar) *fakeMarketData {
	return &fakeMarketData{
		tickValue: tickValue,
		priceBarsFn: func(symbol, _ string, windows []TimeWindow) []PriceWindow {
			out := make([]PriceWindow, len(windows))
			bar, ok := barsBySymbol[symbol]
			if !ok {
				return out // every window Found:false — unknown dataset
			}
			for i := range windows {
				out[i] = PriceWindow{Found: true, Bars: []PriceBar{bar}}
			}
			return out
		},
	}
}

func TestPrepareSimTrades_MultiSymbolOneMissingCoverageDoesNotBlockTheOther(t *testing.T) {
	nq := newTrade("nq-trade", "long", 1000, 1300, 1000, 5_000, withInitialStop(980))
	nq.Symbol = "NQ"
	es := newTrade("es-trade", "long", 2000, 2300, 2000, 5_000, withInitialStop(1980))
	es.Symbol = "ES"

	// Only NQ resolves a tick value; ES has no configured symbol at all —
	// under the old single-symbol design this would have zeroed out BOTH
	// trades (whichever symbol the request-level param happened to name).
	md := multiSymbolMarketData(
		map[string]float64{"NQ": 100},
		map[string]PriceBar{"NQ": {Ts: 1100, LowTicks: 970, HighTicks: 1010}},
	)

	trades, audit := prepareSimTrades([]model.Trade{nq, es}, "1m", md)
	if len(trades) != 1 {
		t.Fatalf("trades = %d, want 1 (only NQ resolves)", len(trades))
	}
	if trades[0].id != "nq-trade" {
		t.Errorf("trades[0].id = %q, want nq-trade", trades[0].id)
	}
	if audit.MissingMarketData != 1 {
		t.Errorf("audit.missingMarketData = %d, want 1 (only the ES trade)", audit.MissingMarketData)
	}
}

func TestPrepareSimTrades_MultiSymbolPreservesChronologicalOrder(t *testing.T) {
	// es-trade closes before nq-trade even though NQ is listed first in the
	// input slice — simTrade.index must follow entryTs/exitTs order (the
	// account's own chronology), not symbol-grouped order.
	nq := newTrade("nq-trade", "long", 3000, 3300, 1000, 5_000, withInitialStop(980))
	nq.Symbol = "NQ"
	es := newTrade("es-trade", "long", 1000, 1300, 2000, 5_000, withInitialStop(1980))
	es.Symbol = "ES"

	md := multiSymbolMarketData(
		map[string]float64{"NQ": 100, "ES": 200},
		map[string]PriceBar{
			"NQ": {Ts: 3100, LowTicks: 970, HighTicks: 1010},
			"ES": {Ts: 1100, LowTicks: 1970, HighTicks: 2010},
		},
	)

	// prepareSimTrades trusts its caller for chronological order (every real
	// caller runs sortClosedTrades first) — mirror that here rather than
	// relying on the input literal's own order.
	sorted := sortClosedTrades([]model.Trade{nq, es})
	trades, audit := prepareSimTrades(sorted, "1m", md)
	if audit.MissingMarketData != 0 {
		t.Fatalf("audit.missingMarketData = %d, want 0", audit.MissingMarketData)
	}
	if len(trades) != 2 {
		t.Fatalf("trades = %d, want 2", len(trades))
	}
	if trades[0].id != "es-trade" || trades[0].index != 1 {
		t.Errorf("trades[0] = %+v, want es-trade at index 1 (chronologically first)", trades[0])
	}
	if trades[1].id != "nq-trade" || trades[1].index != 2 {
		t.Errorf("trades[1] = %+v, want nq-trade at index 2", trades[1])
	}
}

func TestPrepareSimTrades_SmallSymbolGroupIsFlaggedNotExcluded(t *testing.T) {
	// 5 NQ trades (below simSmallSymbolGroupFloor=20) — all still included,
	// just flagged as statistically thin, never nulled out.
	trades := make([]model.Trade, 5)
	for i := range trades {
		ts := int64(i) * daySeconds
		trades[i] = newTrade(fmt.Sprintf("t%d", i), "long", ts, ts+600, 1000, 5_000, withInitialStop(980))
	}
	md := multiSymbolMarketData(
		map[string]float64{"NQ": 100},
		map[string]PriceBar{"NQ": {Ts: 0, LowTicks: 900, HighTicks: 1100}},
	)

	resolved, audit := prepareSimTrades(trades, "1m", md)
	if len(resolved) != 5 {
		t.Fatalf("trades = %d, want 5 (small group still computes, never nulled)", len(resolved))
	}
	if len(audit.SmallSymbolGroups) != 1 || audit.SmallSymbolGroups[0] != "NQ" {
		t.Errorf("smallSymbolGroups = %v, want [NQ]", audit.SmallSymbolGroups)
	}
}

func TestPrepareSimTrades_LargeGroupIsNotFlagged(t *testing.T) {
	const n = simSmallSymbolGroupFloor
	trades := make([]model.Trade, n)
	for i := range trades {
		ts := int64(i) * daySeconds
		trades[i] = newTrade(fmt.Sprintf("t%d", i), "long", ts, ts+600, 1000, 5_000, withInitialStop(980))
	}
	md := multiSymbolMarketData(
		map[string]float64{"NQ": 100},
		map[string]PriceBar{"NQ": {Ts: 0, LowTicks: 900, HighTicks: 1100}},
	)

	resolved, audit := prepareSimTrades(trades, "1m", md)
	if len(resolved) != n {
		t.Fatalf("trades = %d, want %d", len(resolved), n)
	}
	if len(audit.SmallSymbolGroups) != 0 {
		t.Errorf("smallSymbolGroups = %v, want empty (floor met exactly)", audit.SmallSymbolGroups)
	}
}
