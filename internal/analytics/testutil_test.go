package analytics

import (
	"math"

	"market-replay/internal/model"
)

// daySeconds is a readability alias for building test timestamps.
const daySeconds int64 = 24 * 60 * 60

func isNaNOrInf(v float64) bool {
	return math.IsNaN(v) || math.IsInf(v, 0)
}

// tradeOpt is a functional option to keep test fixtures short.
type tradeOpt func(*model.Trade)

func withInitialStop(stopTicks int64) tradeOpt {
	return func(t *model.Trade) { t.InitialStopTicks = &stopTicks }
}

func withInitialTakeProfit(takeProfitTicks int64) tradeOpt {
	return func(t *model.Trade) { t.InitialTakeProfitTicks = &takeProfitTicks }
}

func withRMultiple(v float64) tradeOpt {
	return func(t *model.Trade) { t.RMultiple = &v }
}

func withMfeTicks(v int64) tradeOpt {
	return func(t *model.Trade) { t.MfeTicks = v }
}

func withQty(v int64) tradeOpt {
	return func(t *model.Trade) { t.Qty = v }
}

func withExitReason(reason string) tradeOpt {
	return func(t *model.Trade) { t.ExitReason = reason }
}

func withFeesCents(v int64) tradeOpt {
	return func(t *model.Trade) { t.FeesCents = v }
}

func withProtectionAdjustments(adjustments ...model.ProtectionAdjustment) tradeOpt {
	return func(t *model.Trade) { t.ProtectionAdjustments = adjustments }
}

// newTrade builds a minimal closed trade fixture. entryPriceTicks defaults
// both entry and exit price (callers who need a specific exit price for
// realizedCents math don't need it — RealizedCents is set directly).
func newTrade(id, side string, entryTs, exitTs, entryPriceTicks, realizedCents int64, opts ...tradeOpt) model.Trade {
	t := model.Trade{
		ID:              id,
		SessionID:       "sess-1",
		Symbol:          "NQ",
		Side:            side,
		Qty:             1,
		EntryTs:         entryTs,
		EntryPriceTicks: entryPriceTicks,
		ExitTs:          exitTs,
		ExitPriceTicks:  entryPriceTicks,
		RealizedCents:   realizedCents,
		CreatedAt:       entryTs,
	}
	for _, opt := range opts {
		opt(&t)
	}
	return t
}

// fakeMarketData is a MarketData test double. extremesFn/priceBarsFn are
// each called once per batch invocation (callCount/priceBarsCallCount track
// how many times) so tests can both control the answer and assert batching
// (exactly one call per report, never once per trade).
type fakeMarketData struct {
	tickValue          map[string]float64
	extremesFn         func(symbol, timeframe string, windows []TimeWindow) []ForwardExtreme
	callCount          int
	priceBarsFn        func(symbol, timeframe string, windows []TimeWindow) []PriceWindow
	priceBarsCallCount int
}

func (f *fakeMarketData) TickValueCents(symbol string) (float64, bool) {
	v, ok := f.tickValue[symbol]
	return v, ok
}

func (f *fakeMarketData) ForwardExtremesBatch(symbol, timeframe string, windows []TimeWindow) []ForwardExtreme {
	f.callCount++
	if f.extremesFn != nil {
		return f.extremesFn(symbol, timeframe, windows)
	}
	return make([]ForwardExtreme, len(windows))
}

func (f *fakeMarketData) PriceBarsBatch(symbol, timeframe string, windows []TimeWindow) []PriceWindow {
	f.priceBarsCallCount++
	if f.priceBarsFn != nil {
		return f.priceBarsFn(symbol, timeframe, windows)
	}
	return make([]PriceWindow, len(windows))
}
