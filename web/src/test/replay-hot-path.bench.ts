import { bench, describe } from 'vitest'
import type { SymbolMeta } from '../api/types'
import { buildDisplayHistory, DisplayAggregator } from '../replay/aggregate'
import type { ChartAdapter, DisplayBar } from '../replay/chart-adapter'
import { DEFAULT_CHART_PANE_SETTINGS } from '../replay/chart-settings-store'
import { ChartViewController } from '../replay/chart-view-controller'
import { HoverBarStore } from '../replay/hover-bar-store'
import { createFillEngine, placeOrder, stepFillEngine } from '../fill-engine/engine'
import type { Bar1m } from '../fill-engine/types'
import { calculateTradeStats } from '../fill-engine/stats'

const SYMBOL: SymbolMeta = {
  symbol: 'NQ', name: 'E-mini Nasdaq-100', kind: 'future', tickSize: 0.25, pointValue: 20,
  currency: 'USD', priceDecimals: 2, sessionTz: 'America/New_York', rollRule: 'volume',
  commissionPerSide: 2.09, defaultSlippageTicks: 1, ranges: { '1m': { from: 0, to: 0 } },
}

function makeBars(count: number, startTs = 1_700_000_000): Bar1m[] {
  const bars: Bar1m[] = []
  let price = 60_000
  for (let index = 0; index < count; index += 1) {
    price += ((index * 2_654_435_761) % 17) - 8
    bars.push({
      ts: startTs + index * 60,
      openTicks: price, highTicks: price + 6, lowTicks: price - 6, closeTicks: price + 1,
      volume: 100 + (index % 50),
    })
  }
  return bars
}

const RAW_6K = makeBars(6_000)
const DISPLAY_6K: DisplayBar[] = RAW_6K.map((bar) => ({
  time: bar.ts, open: bar.openTicks * 0.25, high: bar.highTicks * 0.25,
  low: bar.lowTicks * 0.25, close: bar.closeTicks * 0.25, volume: bar.volume,
}))

describe('display aggregation (rebuild: seek, symbol load, timeframe switch)', () => {
  bench('buildDisplayHistory 6000 raw bars -> 5m', () => {
    buildDisplayHistory(RAW_6K, '5m', SYMBOL, SYMBOL.tickSize)
  })

  bench('buildDisplayHistory 6000 raw bars -> 1d (session bucket)', () => {
    buildDisplayHistory(RAW_6K, '1d', SYMBOL, SYMBOL.tickSize)
  })

  bench('DisplayAggregator.push x1000 (replay stream, 5m)', () => {
    const aggregator = new DisplayAggregator('5m', SYMBOL, SYMBOL.tickSize)
    for (let index = 0; index < 1_000; index += 1) aggregator.push(RAW_6K[index])
  })
})

describe('chart view controller (one replay animation frame, per pane)', () => {
  // The real per-frame path: aggregate the frame's raw bars, fold them into
  // the display history, hand the delta to the adapter. 100 iterations is
  // ~1.6 s of replay at 60 fps, for one pane.
  const adapter = {
    setHistory: () => undefined,
    pushBars: () => undefined,
    setSpacerTimes: () => undefined,
    setEconomicEventMarkers: () => undefined,
  } as unknown as ChartAdapter
  const controller = new ChartViewController({
    id: 'bench',
    element: document.createElement('div'),
    adapter,
    timeframe: '1m',
    settings: DEFAULT_CHART_PANE_SETTINGS,
    marketSession: 'eth',
    hoverStore: new HoverBarStore(),
  })
  controller.rebuild(RAW_6K, SYMBOL)
  let nextTs = RAW_6K[RAW_6K.length - 1].ts

  bench('pushRawBars x100 frames onto a 6000-bar display history', () => {
    for (let frame = 0; frame < 100; frame += 1) {
      nextTs += 60
      controller.pushRawBars([{ ...RAW_6K[frame % RAW_6K.length], ts: nextTs }])
    }
  })

  // What the above would cost if it rebuilt the array each frame, as it did
  // before: the same 100 frames, copy-on-write over the display history.
  bench('reference: copy-on-write over a 6000-bar history x100 frames', () => {
    let history = DISPLAY_6K
    for (let frame = 0; frame < 100; frame += 1) {
      const next = [...history]
      next[next.length - 1] = { ...next[next.length - 1], close: next[next.length - 1].close + 0.25 }
      history = next
    }
  })
})

describe('fill engine', () => {
  const flat = createFillEngine({
    symbol: 'NQ', tickValueCents: 500, commissionPerSideCents: 209,
    slippageTicks: 1, maxContracts: 1_000, startingEquityCents: 1_000_000,
  })
  const withOrders = placeOrder(
    placeOrder(flat, { side: 'buy', type: 'limit', qty: 1, priceTicks: 1 }),
    { side: 'sell', type: 'stop', role: 'stopLoss', qty: 1, priceTicks: 999_999 },
  )

  bench('stepFillEngine x10000 bars, no working orders', () => {
    let state = flat
    for (let index = 0; index < 10_000; index += 1) state = stepFillEngine(state, RAW_6K[index % RAW_6K.length])
  })

  bench('stepFillEngine x10000 bars, 2 resting orders', () => {
    let state = withOrders
    for (let index = 0; index < 10_000; index += 1) state = stepFillEngine(state, RAW_6K[index % RAW_6K.length])
  })
})

describe('frame metrics', () => {
  // Mirrors ReplayEngine.recordFrame + flushFrameMetrics: a ring-buffer
  // write per animation frame, with percentiles computed only when the
  // engine actually emits — emits are throttled to 100 ms, so roughly one
  // frame in six at 60 fps.
  bench('recordFrame x1000, percentiles deferred to emit rate', () => {
    const samples = new Float64Array(120)
    const scratch = new Float64Array(120)
    let count = 0
    let cursor = 0
    for (let frame = 0; frame < 1_000; frame += 1) {
      samples[cursor] = (frame * 37) % 19
      cursor = (cursor + 1) % 120
      if (count < 120) count += 1
      if (frame % 6 !== 0) continue
      const sorted = scratch.subarray(0, count)
      sorted.set(samples.subarray(0, count))
      sorted.sort()
      void sorted[Math.floor(count * 0.5)]
      void sorted[Math.floor(count * 0.95)]
    }
  })

  // What that cost when every frame copied and sorted the whole window.
  bench('reference: recordFrame x1000, sorting the window every frame', () => {
    const samples: number[] = []
    for (let frame = 0; frame < 1_000; frame += 1) {
      samples.push((frame * 37) % 19)
      if (samples.length > 120) samples.shift()
      const sorted = [...samples].sort((a, b) => a - b)
      void sorted[Math.floor(sorted.length * 0.5)]
      void sorted[Math.floor(sorted.length * 0.95)]
    }
  })
})

describe('trade stats', () => {
  const state = (() => {
    let engine = createFillEngine({
      symbol: 'NQ', tickValueCents: 500, commissionPerSideCents: 209,
      slippageTicks: 1, maxContracts: 1_000, startingEquityCents: 1_000_000,
    })
    for (let index = 0; index < 200; index += 1) {
      engine = {
        ...engine,
        trades: [...engine.trades, {
          id: `trade-${index}`, symbol: 'NQ', side: index % 2 === 0 ? 'long' : 'short', qty: 1,
          entryTs: index, entryPriceTicks: 100, exitTs: index + 1, exitPriceTicks: 105,
          realizedCents: index % 3 === 0 ? -500 : 700, feesCents: 418,
          mfeTicks: 8, maeTicks: 3, rMultiple: 1.2,
          initialStopTicks: null, initialTakeProfitTicks: null, protectionAdjustments: [], exitReason: 'manual',
        }],
      }
    }
    return engine
  })()

  bench('calculateTradeStats over 200 trades x1000 frames', () => {
    for (let frame = 0; frame < 1_000; frame += 1) calculateTradeStats(state.trades)
  })
})
