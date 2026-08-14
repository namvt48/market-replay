import { describe, expect, it, vi } from 'vitest'
import type { SymbolMeta, Timeframe } from '../api/types'
import type { Bar1m } from '../fill-engine/types'
import type { ChartAdapter, DisplayBar } from './chart-adapter'
import { DEFAULT_CHART_PANE_SETTINGS } from './chart-settings-store'
import { ChartViewController } from './chart-view-controller'
import { HoverBarStore } from './hover-bar-store'
import type { MarketSession } from './market-session'
import { MAX_VIEWPORT_DISPLAY_BARS } from './viewport-data'

const symbol: SymbolMeta = {
  symbol: 'NQ', name: 'Nasdaq', kind: 'future', tickSize: 0.25, pointValue: 20, currency: 'USD',
  priceDecimals: 2, sessionTz: 'America/New_York', rollRule: '', commissionPerSide: 0, defaultSlippageTicks: 0, ranges: {},
}

function bar1m(index: number): Bar1m {
  return { ts: index * 60, openTicks: 400 + index, highTicks: 404 + index, lowTicks: 396 + index, closeTicks: 402 + index, volume: 10 }
}

function adapterMock() {
  return {
    init: vi.fn().mockResolvedValue(undefined), setSymbol: vi.fn(), applyAppearance: vi.fn(), setDisplayTimezone: vi.fn(),
    setHistory: vi.fn(), pushBars: vi.fn(), setSpacerTimes: vi.fn(), setOrderLines: vi.fn(), setTradeMarkers: vi.fn(), setEconomicEventMarkers: vi.fn(), setTradeConnections: vi.fn(), destroy: vi.fn(),
    setCrosshairSync: vi.fn(), setViewportSync: vi.fn(), resetView: vi.fn(), setReplaySelection: vi.fn(),
  }
}

function makeController(timeframe: Timeframe = '1m', marketSession: MarketSession = 'eth') {
  const mock = adapterMock()
  const view = new ChartViewController({
    id: 'a', timeframe, adapter: mock as unknown as ChartAdapter,
    element: document.createElement('div'), settings: DEFAULT_CHART_PANE_SETTINGS, marketSession, hoverStore: new HoverBarStore(),
  })
  return { mock, view }
}

/** Reads the controller's current displayHistory via the mergeViewportPage->setHistory side channel, without touching private state. */
function currentHistory(mock: ReturnType<typeof adapterMock>, view: ChartViewController): DisplayBar[] {
  mock.setHistory.mockClear()
  view.mergeViewportPage([], 'after')
  return mock.setHistory.mock.calls.at(-1)?.[0] ?? []
}

describe('ChartViewController.pushRawBars', () => {
  it('projects economic releases into the containing display candle', () => {
    const { mock, view } = makeController('5m')
    view.rebuild(Array.from({ length: 7 }, (_, index) => bar1m(index)), symbol)

    view.syncEconomicEventMarkers([{
      id: 'cpi', time: 260, country: 'US', currency: 'USD', title: 'CPI', importance: 'high', state: 'next',
    }])

    expect(mock.setEconomicEventMarkers).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'cpi', time: 0, state: 'next' }),
    ])
  })

  it('adds distant following-week releases to the sparse spacer series', async () => {
    const { mock, view } = makeController('1m')
    await view.initialize(symbol)
    view.rebuild([bar1m(0), bar1m(1), bar1m(2)], symbol)
    const followingWeek = 7 * 86_400
    mock.setSpacerTimes.mockClear()

    view.syncEconomicEventMarkers([{
      id: 'next-week-cpi', time: followingWeek, country: 'US', title: 'CPI', importance: 'high', state: 'scheduled',
    }])

    expect(mock.setSpacerTimes.mock.calls.at(-1)?.[0]).toContain(followingWeek)
  })

  it('preserves releases projected into the same candle so the canvas can cluster by zoom', () => {
    const { mock, view } = makeController('5m')
    view.rebuild(Array.from({ length: 7 }, (_, index) => bar1m(index)), symbol)

    view.syncEconomicEventMarkers([
      { id: 'jobs', time: 60, country: 'US', title: 'Jobs', importance: 'medium', state: 'scheduled' },
      { id: 'cpi', time: 240, country: 'US', title: 'CPI', importance: 'high', state: 'next' },
    ])

    expect(mock.setEconomicEventMarkers).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'cpi', time: 0, state: 'next', importance: 'high' }),
      expect.objectContaining({ id: 'jobs', time: 0, state: 'scheduled', importance: 'medium' }),
    ])
  })

  it('projects trade connectors into each timeframe candle while preserving every partial exit', () => {
    const { mock, view } = makeController('5m')
    view.rebuild(Array.from({ length: 7 }, (_, index) => bar1m(index)), symbol)

    view.syncTrading([], [], [
      {
        entryTime: 60, entryPrice: 100, exitTime: 300, exitPrice: 101,
        protectionAdjustments: [{ role: 'stopLoss', time: 180, price: 99 }],
      },
      { entryTime: 60, entryPrice: 100, exitTime: 360, exitPrice: 102 },
    ])

    expect(mock.setTradeConnections).toHaveBeenLastCalledWith([
      {
        entryTime: 0, entryPrice: 100, exitTime: 300, exitPrice: 101,
        protectionAdjustments: [{ role: 'stopLoss', time: 0, price: 99 }],
      },
      { entryTime: 0, entryPrice: 100, exitTime: 300, exitPrice: 102 },
    ])
  })

  it('projects future timestamps so drawing previews keep following the cursor in right-side whitespace', async () => {
    const { mock, view } = makeController('1m')
    await view.initialize(symbol)

    view.rebuild([bar1m(0), bar1m(1), bar1m(2)], symbol)

    const spacerTimes = mock.setSpacerTimes.mock.calls.at(-1)?.[0] as number[] | undefined
    expect(spacerTimes?.length).toBeGreaterThanOrEqual(160)
    expect(spacerTimes?.[0]).toBe(180)
    expect(spacerTimes?.at(-1)).toBeGreaterThan(180)
  })

  it('keeps a future-time reserve without rebuilding the spacer series on every replay bar', async () => {
    const { mock, view } = makeController('1m')
    await view.initialize(symbol)
    view.rebuild([bar1m(0), bar1m(1), bar1m(2)], symbol)
    mock.setSpacerTimes.mockClear()

    view.pushRawBars([bar1m(3)])

    expect(mock.setSpacerTimes).not.toHaveBeenCalled()
  })

  it('appends in-order raw bars across multiple frames without duplicating or reordering', async () => {
    const { mock, view } = makeController('1m')
    await view.initialize(symbol)
    view.rebuild([bar1m(0), bar1m(1), bar1m(2)], symbol)

    view.pushRawBars([bar1m(3)])
    view.pushRawBars([bar1m(4), bar1m(5)])

    const history = currentHistory(mock, view)
    expect(history.map((bar) => bar.time)).toEqual([0, 60, 120, 180, 240, 300])
    // Strictly increasing — the fast path must never leave the history unsorted.
    for (let i = 1; i < history.length; i += 1) expect(history[i].time).toBeGreaterThan(history[i - 1].time)
  })

  it('updates the forming (still-open) bucket in place instead of duplicating it', async () => {
    const { mock, view } = makeController('5m')
    await view.initialize(symbol)
    view.rebuild([bar1m(0)], symbol) // opens the 0-299s bucket

    // Three more 1m bars land inside the same 5m bucket (index 1..3, ts 60/120/180).
    view.pushRawBars([bar1m(1)])
    view.pushRawBars([bar1m(2)])
    view.pushRawBars([bar1m(3)])

    const history = currentHistory(mock, view)
    expect(history).toHaveLength(1)
    expect(history[0].time).toBe(0)
    expect(history[0].close).toBe(bar1m(3).closeTicks * symbol.tickSize)
    expect(mock.pushBars).toHaveBeenCalledTimes(3)
  })

  it('caps history at MAX_VIEWPORT_DISPLAY_BARS as bars keep arriving', async () => {
    const { mock, view } = makeController('1m')
    await view.initialize(symbol)
    view.rebuild([bar1m(0)], symbol)

    const overflow = MAX_VIEWPORT_DISPLAY_BARS + 50
    for (let i = 1; i <= overflow; i += 1) view.pushRawBars([bar1m(i)])

    const history = currentHistory(mock, view)
    expect(history.length).toBeLessThanOrEqual(MAX_VIEWPORT_DISPLAY_BARS)
    expect(history.at(-1)?.time).toBe(overflow * 60)
  })

  it('keeps replay moving while omitting bars outside RTH', async () => {
    const { mock, view } = makeController('1m', 'rth')
    await view.initialize(symbol)
    const at = (iso: string, index: number): Bar1m => ({ ...bar1m(index), ts: Date.parse(iso) / 1000 })
    view.rebuild([
      at('2026-08-10T13:29:00Z', 0),
      at('2026-08-10T13:30:00Z', 1),
      at('2026-08-10T19:59:00Z', 2),
    ], symbol)
    mock.pushBars.mockClear()

    view.pushRawBars([at('2026-08-10T20:00:00Z', 3)])
    expect(mock.pushBars).not.toHaveBeenCalled()

    view.pushRawBars([at('2026-08-11T13:30:00Z', 4)])
    expect(currentHistory(mock, view).map((bar) => bar.time)).toEqual([
      Date.parse('2026-08-10T13:30:00Z') / 1000,
      Date.parse('2026-08-10T19:59:00Z') / 1000,
      Date.parse('2026-08-11T13:30:00Z') / 1000,
    ])
  })

  it('hydrates a full server page for a large RTH timeframe instead of showing only the short raw replay window', () => {
    const { mock, view } = makeController('1h', 'rth')
    const remoteHistory = Array.from({ length: 240 }, (_, index) => ({
      time: Date.parse('2025-08-11T13:30:00Z') / 1000 + index * 86_400,
      open: 20_000 + index,
      high: 20_010 + index,
      low: 19_990 + index,
      close: 20_005 + index,
      volume: 100,
    }))

    view.rebuild([bar1m(0), bar1m(1), bar1m(2)], symbol, false, remoteHistory)

    expect(currentHistory(mock, view)).toHaveLength(240)
  })
})
