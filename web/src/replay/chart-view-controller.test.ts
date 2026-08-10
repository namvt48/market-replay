import { describe, expect, it, vi } from 'vitest'
import type { SymbolMeta, Timeframe } from '../api/types'
import type { Bar1m } from '../fill-engine/types'
import type { ChartAdapter, DisplayBar } from './chart-adapter'
import { DEFAULT_CHART_PANE_SETTINGS } from './chart-settings-store'
import { ChartViewController } from './chart-view-controller'
import { HoverBarStore } from './hover-bar-store'
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
    init: vi.fn().mockResolvedValue(undefined), applyAppearance: vi.fn(), setDisplayTimezone: vi.fn(),
    setHistory: vi.fn(), pushBars: vi.fn(), setSpacerTimes: vi.fn(), setOrderLines: vi.fn(), setTradeMarkers: vi.fn(), destroy: vi.fn(),
    setCrosshairSync: vi.fn(), setViewportSync: vi.fn(), resetView: vi.fn(), setReplaySelection: vi.fn(),
  }
}

function makeController(timeframe: Timeframe = '1m', settings = DEFAULT_CHART_PANE_SETTINGS) {
  const mock = adapterMock()
  const view = new ChartViewController({
    id: 'a', timeframe, adapter: mock as unknown as ChartAdapter,
    element: document.createElement('div'), settings, hoverStore: new HoverBarStore(),
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
    const rthSettings = { ...DEFAULT_CHART_PANE_SETTINGS, marketSession: 'rth' as const }
    const { mock, view } = makeController('1m', rthSettings)
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
})
