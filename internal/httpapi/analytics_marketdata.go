package httpapi

import (
	"errors"
	"math"

	"market-replay/internal/analytics"
	"market-replay/internal/bars"
)

// barsMarketData adapts bars.Registry to analytics.MarketData, so the
// analytics package itself never touches the mmap'd bar format or its
// locking.
type barsMarketData struct {
	registry *bars.Registry
}

// withDataset uses the source timeframe when it exists. Replay sessions can
// also use client-side aggregate timeframes (5m, 1h, ...), while the server
// stores raw analytics data at 1m. Falling back to that finer dataset keeps
// intrabar simulations accurate instead of treating every aggregated-source
// trade as uncovered market data.
func (m *barsMarketData) withDataset(symbol, timeframe string, fn func(f *bars.BarFile, cal *bars.Calendar, tag string) error) error {
	err := m.registry.WithDataset(symbol, timeframe, fn)
	if !errors.Is(err, bars.ErrUnknownSymbolTF) || timeframe == "1m" {
		return err
	}
	return m.registry.WithDataset(symbol, "1m", fn)
}

func (m *barsMarketData) TickValueCents(symbol string) (float64, bool) {
	for _, meta := range m.registry.Symbols() {
		if meta.Symbol == symbol {
			return math.Round(meta.TickSize * meta.PointValue * 100), true
		}
	}
	return 0, false
}

// ForwardExtremesBatch opens the (symbol,timeframe) dataset exactly once —
// via one bars.Registry.WithDataset call — and answers every window from
// that single read lock, regardless of how many trades requested it. An
// unknown dataset (WithDataset's ErrUnknownSymbolTF) or a window with no
// bars leaves the corresponding entry at its Found:false zero value.
func (m *barsMarketData) ForwardExtremesBatch(symbol, timeframe string, windows []analytics.TimeWindow) []analytics.ForwardExtreme {
	out := make([]analytics.ForwardExtreme, len(windows))
	_ = m.withDataset(symbol, timeframe, func(f *bars.BarFile, _ *bars.Calendar, _ string) error {
		for i, w := range windows {
			win, _ := f.RangeWindow(w.FromTs, w.ToTs, f.Count())
			if win.Len() == 0 {
				continue
			}
			high := f.HighAt(win.From)
			low := f.LowAt(win.From)
			for j := win.From + 1; j < win.To; j++ {
				if h := f.HighAt(j); h > high {
					high = h
				}
				if l := f.LowAt(j); l < low {
					low = l
				}
			}
			out[i] = analytics.ForwardExtreme{HighTicks: int64(high), LowTicks: int64(low), Found: true}
		}
		return nil
	})
	return out
}

// PriceBarsBatch mirrors ForwardExtremesBatch's batching discipline — one
// bars.Registry.WithDataset call answers every window, regardless of how
// many trades requested one (the stop-loss/RR simulators fetch each
// trade's [EntryTs,ExitTs] window exactly once, then reuse it across every
// scenario). An unknown dataset or an empty window leaves Found:false.
func (m *barsMarketData) PriceBarsBatch(symbol, timeframe string, windows []analytics.TimeWindow) []analytics.PriceWindow {
	out := make([]analytics.PriceWindow, len(windows))
	_ = m.withDataset(symbol, timeframe, func(f *bars.BarFile, _ *bars.Calendar, _ string) error {
		for i, w := range windows {
			win, _ := f.RangeWindow(w.FromTs, w.ToTs, f.Count())
			if win.Len() == 0 {
				continue
			}
			priceBars := make([]analytics.PriceBar, 0, win.Len())
			for j := win.From; j < win.To; j++ {
				priceBars = append(priceBars, analytics.PriceBar{
					Ts:        f.TsAt(j),
					HighTicks: int64(f.HighAt(j)),
					LowTicks:  int64(f.LowAt(j)),
				})
			}
			out[i] = analytics.PriceWindow{Bars: priceBars, Found: true}
		}
		return nil
	})
	return out
}
