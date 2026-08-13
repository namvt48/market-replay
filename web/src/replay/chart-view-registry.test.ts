import { describe, expect, it, vi } from 'vitest'
import type { SymbolMeta, Timeframe } from '../api/types'
import type { Bar1m } from '../fill-engine/types'
import type { ChartAdapter } from './chart-adapter'
import { DEFAULT_CHART_PANE_SETTINGS } from './chart-settings-store'
import { ChartViewController } from './chart-view-controller'
import { ChartViewRegistry } from './chart-view-registry'
import { HoverBarStore } from './hover-bar-store'

const symbol: SymbolMeta = { symbol: 'NQ', name: 'Nasdaq', kind: 'future', tickSize: 0.25, pointValue: 20, currency: 'USD', priceDecimals: 2, sessionTz: 'America/New_York', rollRule: '', commissionPerSide: 0, defaultSlippageTicks: 0, ranges: {} }
const bars: Bar1m[] = Array.from({ length: 6 }, (_, index) => ({ ts: index * 60, openTicks: 400 + index, highTicks: 404 + index, lowTicks: 396 + index, closeTicks: 402 + index, volume: 10 }))

function adapter() {
  return {
    init: vi.fn().mockResolvedValue(undefined), setSymbol: vi.fn(), applyAppearance: vi.fn(), setDisplayTimezone: vi.fn(),
    setHistory: vi.fn(), pushBars: vi.fn(), setSpacerTimes: vi.fn(), setOrderLines: vi.fn(), setTradeMarkers: vi.fn(), setEconomicEventMarkers: vi.fn(), setTradeConnections: vi.fn(), destroy: vi.fn(),
    setCrosshairSync: vi.fn(), setViewportSync: vi.fn(),
  }
}

function controller(id: string, timeframe: Timeframe) {
  const mock = adapter()
  return { mock, view: new ChartViewController({ id, timeframe, adapter: mock as unknown as ChartAdapter, element: document.createElement('div'), settings: DEFAULT_CHART_PANE_SETTINGS, marketSession: 'eth', hoverStore: new HoverBarStore() }) }
}

describe('ChartViewRegistry', () => {
  it('initializes and independently aggregates four panes from one raw broadcast', async () => {
    const registry = new ChartViewRegistry()
    const views = [controller('a', '1m'), controller('b', '2m'), controller('c', '3m'), controller('d', '1h')]
    views.forEach(({ view }) => registry.register(view))
    await registry.initializeAll(symbol)
    registry.rebuildAll(bars.slice(0, 5), symbol)
    registry.pushRawBars([bars[5]], symbol.symbol)
    expect(views.every(({ mock }) => mock.init.mock.calls.length === 1)).toBe(true)
    expect(views.map(({ mock }) => mock.setHistory.mock.calls[0]?.[0].length)).toEqual([5, 3, 2, 1])
    expect(views.every(({ mock }) => mock.pushBars.mock.calls.length === 1)).toBe(true)
  })

  it('routes active view and unregisters listeners/resources cleanly', () => {
    const registry = new ChartViewRegistry()
    const first = controller('a', '1m')
    const second = controller('b', '5m')
    registry.register(first.view)
    registry.register(second.view)
    expect(registry.activate('b')).toBe(true)
    expect(registry.active()?.id).toBe('b')
    registry.unregister('b')
    expect(second.mock.destroy).toHaveBeenCalledTimes(1)
    expect(registry.active()?.id).toBe('a')
  })

  it('does not let stale effect cleanup destroy a newer chart registered with the same pane id', () => {
    const registry = new ChartViewRegistry()
    const detached = controller('a', '1m')
    const restored = controller('a', '1m')
    registry.register(detached.view)
    registry.register(restored.view)

    registry.unregister('a', detached.view.adapter)

    expect(registry.get('a')).toBe(restored.view)
    expect(restored.mock.destroy).not.toHaveBeenCalled()
    registry.unregister('a', restored.view.adapter)
    expect(restored.mock.destroy).toHaveBeenCalledOnce()
  })

  it('fans one canonical epoch viewport and crosshair out to every sibling pane', () => {
    const registry = new ChartViewRegistry()
    const oneMinute = controller('a', '1m')
    const oneHour = controller('b', '1h')
    registry.register(oneMinute.view)
    registry.register(oneHour.view)

    const viewport = { time: { from: 1_700_000_000, to: 1_700_003_600 } }
    registry.syncViewport('a', viewport)
    registry.syncCrosshair('a', { time: 1_700_001_800, price: 18_240.25 })

    expect(oneMinute.mock.setViewportSync).not.toHaveBeenCalled()
    expect(oneMinute.mock.setCrosshairSync).not.toHaveBeenCalled()
    expect(oneHour.mock.setViewportSync).toHaveBeenCalledWith(viewport)
    expect(oneHour.mock.setCrosshairSync).toHaveBeenCalledWith({ time: 1_700_001_800, price: 18_240.25 })
  })

  it('projects a synchronized crosshair into the containing candle of a larger timeframe', () => {
    const registry = new ChartViewRegistry()
    const oneMinute = controller('a', '1m')
    const oneHour = controller('b', '1h')
    registry.register(oneMinute.view)
    registry.register(oneHour.view)
    oneHour.view.rebuild(bars, symbol)

    registry.syncCrosshair('a', { time: 180, price: 101.25 })

    expect(oneHour.mock.setCrosshairSync).toHaveBeenCalledWith({ time: 0, price: 101.25 })
  })

  it('changes timeframe without recreating the chart adapter', async () => {
    const target = controller('a', '1m')
    await target.view.initialize(symbol)
    target.view.rebuild(bars, symbol)

    await target.view.changeTimeframe('5m', symbol, bars)

    expect(target.mock.init).toHaveBeenCalledTimes(1)
    expect(target.mock.destroy).not.toHaveBeenCalled()
    expect(target.mock.setHistory.mock.calls.at(-1)?.[0]).toHaveLength(2)
    expect(target.mock.setHistory.mock.calls.at(-1)?.[1]).toEqual({ preserveViewport: false, resetView: true })
  })

  it('merges a historical viewport page without replacing the replay-current candles', () => {
    const target = controller('a', '1m')
    const current = bars.slice(4)
    target.view.rebuild(current, symbol)

    target.view.mergeViewportPage(bars.slice(0, 4).map((bar) => ({
      time: bar.ts,
      open: bar.openTicks * symbol.tickSize,
      high: bar.highTicks * symbol.tickSize,
      low: bar.lowTicks * symbol.tickSize,
      close: bar.closeTicks * symbol.tickSize,
      volume: bar.volume,
    })), 'before')

    const history = target.mock.setHistory.mock.calls.at(-1)?.[0] as Array<{ time: number; close: number }>
    expect(history.map((bar) => bar.time)).toEqual([0, 60, 120, 180, 240, 300])
    expect(history.at(-1)).toMatchObject({ time: 300, close: 101.75 })
    expect(target.mock.setHistory.mock.calls.at(-1)?.[1]).toEqual({ preserveViewport: true })
  })

  it('shifts a full display cache backward and forward without exceeding its cap', () => {
    const target = controller('a', '1m')
    const display = (from: number, to: number) => Array.from({ length: to - from }, (_, offset) => ({
      time: from + offset, open: 100, high: 101, low: 99, close: 100, volume: 1,
    }))
    target.view.rebuild(bars, symbol, false, display(240, 6_240))

    target.view.mergeViewportPage(display(0, 240), 'before')
    let history = target.mock.setHistory.mock.calls.at(-1)?.[0] as Array<{ time: number }>
    expect(history).toHaveLength(6_000)
    expect([history[0]?.time, history.at(-1)?.time]).toEqual([0, 5_999])

    target.view.mergeViewportPage(display(5_999, 6_240), 'after')
    history = target.mock.setHistory.mock.calls.at(-1)?.[0] as Array<{ time: number }>
    expect(history).toHaveLength(6_000)
    expect([history[0]?.time, history.at(-1)?.time]).toEqual([240, 6_239])
  })

  it('round-robins high-speed chart work and flushes every pending view', () => {
    const registry = new ChartViewRegistry()
    const views = [controller('a', '1m'), controller('b', '1m'), controller('c', '1m'), controller('d', '1m')]
    views.forEach(({ view }) => registry.register(view))
    registry.rebuildAll(bars.slice(0, 5), symbol)

    registry.pushRawBars([bars[5]], symbol.symbol, 1)
    expect(views.map(({ mock }) => mock.pushBars.mock.calls.length)).toEqual([1, 0, 0, 0])

    registry.flushRawBars()
    expect(views.every(({ mock }) => mock.pushBars.mock.calls.length === 1)).toBe(true)
  })
})
