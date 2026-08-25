import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LwcAdapter } from './lwc-adapter'
import type { IndicatorDrawIntent, IndicatorPlotPoint, SymbolMeta } from '../api/types'
import type { IndicatorRenderResult } from './chart-adapter'

// A dedicated mock rather than lwc-adapter.test.ts's: that file's addSeries
// returns one shared `spacer` object for every LineSeries call, so two
// indicator series would be indistinguishable from each other. Here every
// LineSeries call gets a fresh spy object recorded alongside the options it
// was created with, which is what lets these tests assert per-series.
interface FakeLineSeries {
  kind: string
  options: Record<string, unknown>
  setData: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  pop: ReturnType<typeof vi.fn>
  applyPrimitive: ReturnType<typeof vi.fn>
}

const chartMocks = vi.hoisted(() => ({
  series: [] as Array<{
    kind: string
    options: Record<string, unknown>
    setData: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }>,
  addSeries: vi.fn(),
  removeSeries: vi.fn(),
}))

vi.mock('lightweight-charts-drawing', () => ({
  DrawingManager: class {
    attach(): void {}
    detach(): void {}
    setActiveTool(): void {}
    deselectAll(): void {}
    getSelectedDrawing(): null { return null }
    getAllDrawings(): [] { return [] }
    getDrawing(): undefined { return undefined }
    hitTest(): null { return null }
    hitTestAnchor(): null { return null }
    clearAll(): void {}
    importDrawings(): void {}
    addDrawing(): void {}
    removeDrawing(): void {}
    selectDrawing(): void {}
    on(): () => void { return () => undefined }
  },
  getToolRegistry: () => ({
    get: () => ({ type: 'trend-line', name: 'Trend Line', category: 'line', requiredAnchors: 2 }),
    getAll: () => [],
    createDrawing: () => ({}),
  }),
}))

vi.mock('lightweight-charts', () => {
  const timeScale = {
    width: () => 600,
    coordinateToTime: (x: number) => Math.round(x),
    coordinateToLogical: (x: number) => x,
    getVisibleRange: () => ({ from: 0, to: 100 }),
    getVisibleLogicalRange: () => ({ from: 10, to: 20 }),
    fitContent: vi.fn(), setVisibleLogicalRange: vi.fn(), setVisibleRange: vi.fn(),
    subscribeVisibleTimeRangeChange: vi.fn(), unsubscribeVisibleTimeRangeChange: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn(),
    applyOptions: vi.fn(), timeToIndex: (time: number) => time, timeToCoordinate: (time: number) => time,
  }
  const pane = { getHeight: () => 100, setHeight: vi.fn() }
  const makeSeries = (kind: string, options: Record<string, unknown>): FakeLineSeries => ({
    kind, options,
    setData: vi.fn(), update: vi.fn(), pop: vi.fn(), applyPrimitive: vi.fn(),
  })
  chartMocks.addSeries.mockImplementation((kind: string, options: Record<string, unknown> = {}) => {
    const series = makeSeries(kind, options)
    const api = {
      ...series,
      attachPrimitive: vi.fn(),
      applyOptions: vi.fn(),
      coordinateToPrice: (y: number) => y,
      priceToCoordinate: (price: number) => price,
      getPane: () => pane,
      priceScale: () => ({
        applyOptions: vi.fn(), getVisibleRange: () => ({ from: 90, to: 110 }),
        options: () => ({ autoScale: true, invertScale: false, mode: 0 }),
        setAutoScale: vi.fn(), setVisibleRange: vi.fn(),
      }),
    }
    chartMocks.series.push(api)
    return api
  })
  const chart = {
    addSeries: chartMocks.addSeries,
    removeSeries: chartMocks.removeSeries,
    panes: () => [pane, pane],
    timeScale: () => timeScale,
    applyOptions: vi.fn(), resize: vi.fn(), remove: vi.fn(),
    subscribeCrosshairMove: vi.fn(), unsubscribeCrosshairMove: vi.fn(),
    setCrosshairPosition: vi.fn(), clearCrosshairPosition: vi.fn(), takeScreenshot: vi.fn(),
  }
  return {
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries', LineSeries: 'LineSeries',
    ColorType: { Solid: 'solid' }, CrosshairMode: { Normal: 0 }, LineStyle: { Dashed: 2 },
    PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2 },
    createChart: (element: HTMLElement) => {
      element.appendChild(document.createElement('div'))
      return chart
    },
    createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
  }
})

const symbol: SymbolMeta = {
  symbol: 'ES', name: 'E-mini S&P', kind: 'future', tickSize: 0.25, pointValue: 50,
  currency: 'USD', priceDecimals: 2, sessionTz: 'America/New_York', rollRule: '',
  commissionPerSide: 0, defaultSlippageTicks: 0, ranges: {},
}

/** Every LineSeries created after the adapter's own internal spacer. */
function indicatorSeries(): typeof chartMocks.series {
  return chartMocks.series.filter((series) => series.kind === 'LineSeries').slice(1)
}

function plots(key: string, count: number, startTime = 1_700_000_000, startValue = 100): IndicatorPlotPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    key, time: startTime + index * 60, value: startValue + index,
  }))
}

function ray(id: number, y0: number, style: Record<string, unknown> = { linecolor: 'x' }): IndicatorDrawIntent {
  return { id, kind: 'ray', t0: 1_700_000_000, y0, style }
}

function result(indicatorId: string, points: IndicatorPlotPoint[], draws: IndicatorDrawIntent[] = []): IndicatorRenderResult {
  return { indicatorId, plots: points, draws }
}

/** Structurally equal, reference-distinct — what a fresh HTTP response is. */
function refreshed(results: IndicatorRenderResult[]): IndicatorRenderResult[] {
  return JSON.parse(JSON.stringify(results)) as IndicatorRenderResult[]
}

async function mount(): Promise<LwcAdapter> {
  const container = document.createElement('div')
  container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
  const adapter = new LwcAdapter()
  await adapter.init(container, symbol, '1m')
  return adapter
}

beforeAll(() => {
  class ResizeObserverStub { observe(): void {}; disconnect(): void {} }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

beforeEach(() => {
  vi.clearAllMocks()
  chartMocks.series.length = 0
})

describe('LwcAdapter.setIndicators', () => {
  it('creates one line series per indicator and plot key, in ascending time order', async () => {
    const adapter = await mount()
    adapter.setIndicators([result('rsi', [...plots('fast', 3), ...plots('slow', 3, 1_700_000_000, 50)])])

    const series = indicatorSeries()
    expect(series).toHaveLength(2)
    expect(series[0].setData).toHaveBeenCalledTimes(1)
    const data = series[0].setData.mock.calls[0][0] as Array<{ time: number; value: number }>
    expect(data.map((point) => point.time)).toEqual([1_700_000_000, 1_700_000_060, 1_700_000_120])
  })

  it('does nothing at all when a refresh carries the same content in new objects', async () => {
    const adapter = await mount()
    const setDraws = vi.spyOn(adapter.indicatorDrawingsPrimitive, 'setDraws')
    const first = [result('rsi', plots('fast', 5), [ray(1, 100)])]
    adapter.setIndicators(first)
    const created = indicatorSeries()
    created.forEach((series) => { series.setData.mockClear(); series.update.mockClear() })
    chartMocks.addSeries.mockClear()
    chartMocks.removeSeries.mockClear()
    setDraws.mockClear()

    adapter.setIndicators(refreshed(first))

    expect(chartMocks.addSeries).not.toHaveBeenCalled()
    expect(chartMocks.removeSeries).not.toHaveBeenCalled()
    expect(setDraws).not.toHaveBeenCalled()
    created.forEach((series) => {
      expect(series.setData).not.toHaveBeenCalled()
      expect(series.update).not.toHaveBeenCalled()
    })
  })

  it('does nothing when the very same array is published again', async () => {
    const adapter = await mount()
    const setDraws = vi.spyOn(adapter.indicatorDrawingsPrimitive, 'setDraws')
    const results = [result('rsi', plots('fast', 4), [ray(1, 100)])]
    adapter.setIndicators(results)
    const created = indicatorSeries()
    created.forEach((series) => series.setData.mockClear())
    setDraws.mockClear()

    adapter.setIndicators(results)

    expect(setDraws).not.toHaveBeenCalled()
    created.forEach((series) => expect(series.setData).not.toHaveBeenCalled())
  })

  it('appends a short suffix with update() instead of replacing the series', async () => {
    const adapter = await mount()
    adapter.setIndicators([result('rsi', plots('fast', 5))])
    const series = indicatorSeries()[0]
    series.setData.mockClear()

    adapter.setIndicators([result('rsi', plots('fast', 8))])

    expect(series.update).toHaveBeenCalledTimes(3)
    expect(series.setData).not.toHaveBeenCalled()
    expect(series.update.mock.calls.map((call) => (call[0] as { time: number }).time))
      .toEqual([1_700_000_300, 1_700_000_360, 1_700_000_420])
  })

  it('replaces the series in one setData when the suffix reaches the bulk threshold', async () => {
    const adapter = await mount()
    adapter.setIndicators([result('rsi', plots('fast', 5))])
    const series = indicatorSeries()[0]
    series.setData.mockClear()

    adapter.setIndicators([result('rsi', plots('fast', 45))])

    expect(series.setData).toHaveBeenCalledTimes(1)
    expect(series.update).not.toHaveBeenCalled()
  })

  it('never hands update() a timestamp older than the rendered tail', async () => {
    const adapter = await mount()
    adapter.setIndicators([result('rsi', plots('fast', 5))])
    const series = indicatorSeries()[0]
    series.setData.mockClear()

    // Same length prefix, then a point that predates the rendered tail.
    adapter.setIndicators([result('rsi', [...plots('fast', 5), { key: 'fast', time: 1_600_000_000, value: 7 }])])

    expect(series.update).not.toHaveBeenCalled()
    expect(series.setData).toHaveBeenCalledTimes(1)
  })

  it('replaces rather than appends when the stream got shorter', async () => {
    const adapter = await mount()
    adapter.setIndicators([result('rsi', plots('fast', 8))])
    const series = indicatorSeries()[0]
    series.setData.mockClear()

    adapter.setIndicators([result('rsi', plots('fast', 3))])

    expect(series.setData).toHaveBeenCalledTimes(1)
    expect(series.update).not.toHaveBeenCalled()
  })

  it('replaces when a mid-series value moved but the first and last points match', async () => {
    const adapter = await mount()
    const before = plots('fast', 5)
    adapter.setIndicators([result('rsi', before)])
    const series = indicatorSeries()[0]
    series.setData.mockClear()

    const after = before.map((point, index) => (index === 2 ? { ...point, value: point.value + 999 } : { ...point }))
    adapter.setIndicators([result('rsi', after)])

    expect(series.setData).toHaveBeenCalledTimes(1)
    expect(series.update).not.toHaveBeenCalled()
  })

  it('keeps each plot on its own color across a hide and re-show cycle', async () => {
    const adapter = await mount()
    const both = [result('a', plots('fast', 3)), result('b', plots('fast', 3))]
    adapter.setIndicators(both)
    const [seriesA, seriesB] = indicatorSeries()
    const colorA = seriesA.options.color
    const colorB = seriesB.options.color
    expect(colorA).not.toBe(colorB)

    adapter.setIndicators([result('b', plots('fast', 3))])
    expect(chartMocks.removeSeries).toHaveBeenCalledTimes(1)

    adapter.setIndicators(both)
    const recreated = indicatorSeries().at(-1)
    expect(recreated?.options.color).toBe(colorA)
    // b was never torn down, so it keeps the colour it was born with.
    expect(seriesB.options.color).toBe(colorB)
  })

  it('repaints the drawings without touching any series when only geometry moved', async () => {
    const adapter = await mount()
    const setDraws = vi.spyOn(adapter.indicatorDrawingsPrimitive, 'setDraws')
    const points = plots('fast', 5)
    adapter.setIndicators([result('rsi', points, [ray(1, 100)])])
    const series = indicatorSeries()[0]
    series.setData.mockClear()
    setDraws.mockClear()

    adapter.setIndicators([result('rsi', points.map((point) => ({ ...point })), [ray(1, 250)])])

    expect(setDraws).toHaveBeenCalledTimes(1)
    expect(series.setData).not.toHaveBeenCalled()
    expect(series.update).not.toHaveBeenCalled()
  })

  it('repaints when a painted style key changes', async () => {
    const adapter = await mount()
    const setDraws = vi.spyOn(adapter.indicatorDrawingsPrimitive, 'setDraws')
    const points = plots('fast', 3)
    adapter.setIndicators([result('rsi', points, [ray(1, 100, { linecolor: { r: 1, g: 2, b: 3, a: 1 } })])])
    setDraws.mockClear()

    adapter.setIndicators([result('rsi', points, [ray(1, 100, { linecolor: { r: 9, g: 2, b: 3, a: 1 } })])])

    expect(setDraws).toHaveBeenCalledTimes(1)
  })

  it('ignores style keys the renderer does not paint with', async () => {
    const adapter = await mount()
    const setDraws = vi.spyOn(adapter.indicatorDrawingsPrimitive, 'setDraws')
    const points = plots('fast', 3)
    adapter.setIndicators([result('rsi', points, [ray(1, 100, { linecolor: 'x' })])])
    setDraws.mockClear()

    adapter.setIndicators([result('rsi', points, [ray(1, 100, { linecolor: 'x', somethingUnpainted: 'changed' })])])

    expect(setDraws).not.toHaveBeenCalled()
  })

  it('removes every series and clears the drawings when the indicator list empties', async () => {
    const adapter = await mount()
    const setDraws = vi.spyOn(adapter.indicatorDrawingsPrimitive, 'setDraws')
    adapter.setIndicators([result('rsi', [...plots('fast', 3), ...plots('slow', 3)], [ray(1, 100)])])
    chartMocks.removeSeries.mockClear()
    setDraws.mockClear()

    adapter.setIndicators([])

    expect(chartMocks.removeSeries).toHaveBeenCalledTimes(2)
    expect(setDraws).toHaveBeenCalledWith([])
  })

  it('rebuilds every series after a destroy and re-init, even for unchanged content', async () => {
    const adapter = await mount()
    const results = [result('rsi', plots('fast', 4))]
    adapter.setIndicators(results)
    expect(indicatorSeries()).toHaveLength(1)

    adapter.destroy()
    chartMocks.series.length = 0
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    await adapter.init(container, symbol, '1m')

    adapter.setIndicators(results)

    const rebuilt = indicatorSeries()
    expect(rebuilt).toHaveLength(1)
    expect(rebuilt[0].setData).toHaveBeenCalledTimes(1)
  })
})
