/// <reference types="node" />

import { CandlestickSeries, HistogramSeries, LineSeries, PriceScaleMode, type IChartApi, type Time } from 'lightweight-charts'
import type { SymbolMeta } from '../api/types'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { DEFAULT_CHART_APPEARANCE } from './chart-settings'
import type { DisplayBar } from './chart-adapter'
import type { SerializedDrawing } from 'lightweight-charts-drawing'
import { RustChartAdapter } from './rust-chart-adapter'
import { RustChartEngine } from './rust-chart-engine'
import { createRustChart } from './rust-chart-runtime'

const TEST_SYMBOL: SymbolMeta = {
  symbol: 'NQ', name: 'E-mini Nasdaq-100', kind: 'future', tickSize: 0.25, pointValue: 20,
  currency: 'USD', priceDecimals: 2, sessionTz: 'America/New_York', rollRule: 'volume',
  commissionPerSide: 2.09, defaultSlippageTicks: 1, ranges: {},
}

const TEST_HISTORY: DisplayBar[] = Array.from({ length: 6_000 }, (_, index) => {
  const open = 2_000 + index * 0.01 + index % 11
  const close = open + (index % 2 === 0 ? 0.5 : -0.5)
  return {
    time: 1_700_000_000 + index * 60,
    open,
    high: Math.max(open, close) + 0.25,
    low: Math.min(open, close) - 0.25,
    close,
    volume: 100 + index % 50,
  }
})

interface RecordedContext {
  context: CanvasRenderingContext2D
  strokes: Array<{ color: string; points: Array<[number, number]> }>
  fills: string[]
}

function createRecordingContext(): RecordedContext {
  const strokes: RecordedContext['strokes'] = []
  const fills: string[] = []
  let points: Array<[number, number]> = []
  let context: CanvasRenderingContext2D
  const target = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    save() {},
    restore() {},
    setTransform() {},
    clearRect() {},
    fillRect() { fills.push(String(context.fillStyle)) },
    strokeRect() {},
    beginPath() { points = [] },
    moveTo(x: number, y: number) { points.push([x, y]) },
    lineTo(x: number, y: number) { points.push([x, y]) },
    rect() {},
    closePath() {},
    arc() {},
    clip() {},
    setLineDash() {},
    fillText() {},
    measureText: (text: string) => ({ width: text.length * 6 }),
    stroke() { strokes.push({ color: String(context.strokeStyle), points: [...points] }) },
    fill() { fills.push(String(context.fillStyle)) },
  }
  context = new Proxy(target, {
    get(source, property, receiver) {
      const value = Reflect.get(source, property, receiver)
      if (value !== undefined) return value
      return typeof property === 'string' && /^(bezier|quadratic|roundRect|translate|rotate|scale|draw|stroke|fill|put|clear|reset|transform)/.test(property)
        ? () => undefined
        : undefined
    },
  }) as unknown as CanvasRenderingContext2D
  return { context, strokes, fills }
}

function makeCandles(): Array<{ time: Time; open: number; high: number; low: number; close: number }> {
  return [
    { time: 1_700_000_000 as Time, open: 10, high: 14, low: 9, close: 13 },
    { time: 1_700_000_060 as Time, open: 13, high: 15, low: 11, close: 12 },
    { time: 1_700_000_120 as Time, open: 12, high: 16, low: 11, close: 15 },
  ]
}

beforeAll(async () => {
  const artifact = await readFile(resolve(process.cwd(), 'src/replay/chart-engine.wasm'))
  const bytes = Uint8Array.from(artifact).buffer
  const response = { ok: true, status: 200, arrayBuffer: async () => bytes } as Response
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})
function makePointerEvent(type: string, pointerId: number, pointerType: string, x: number, y: number): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: pointerType } })
  return event
}
async function mountInteractiveChart() {
  vi.useFakeTimers()
  const paint = createRecordingContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(paint.context)
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { value: 800 })
  Object.defineProperty(container, 'clientHeight', { value: 600 })
  document.body.appendChild(container)
  const chart = await createRustChart(container, {
    handleScroll: { pressedMouseMove: true, horzTouchDrag: true, mouseWheel: true },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  })
  const canvas = container.querySelector('canvas')
  if (!canvas) throw new Error('Rust chart canvas was not mounted')
  Object.defineProperties(canvas, {
    clientWidth: { configurable: true, get: () => 800 },
    clientHeight: { configurable: true, get: () => 600 },
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  })
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
  chart.resize(800, 600)
  const candles = chart.addSeries(CandlestickSeries)
  candles.setData(TEST_HISTORY.map(({ time, open, high, low, close }) => ({ time: time as Time, open, high, low, close })))
  await vi.runAllTimersAsync()
  return {
    chart, canvas, candles,
    async cleanup() {
      chart.remove()
      await vi.runAllTimersAsync()
      container.remove()
      vi.restoreAllMocks()
      vi.useRealTimers()
    },
  }
}

afterAll(() => vi.unstubAllGlobals())


it('keeps main price inversion independent and autoscale on percentage mode', async () => {
  const { candles, cleanup } = await mountInteractiveChart()
  try {
    const scale = candles.priceScale()
    const initialRange = scale.getVisibleRange()
    expect(initialRange).not.toBeNull()
    scale.setVisibleRange({ from: initialRange!.from - 10, to: initialRange!.to + 10 })
    expect(scale.options().autoScale).toBe(false)

    scale.applyOptions({ mode: PriceScaleMode.Percentage })
    expect(scale.options().autoScale).toBe(true)
    scale.applyOptions({ mode: PriceScaleMode.Logarithmic })
    const value = TEST_HISTORY.at(-1)!.close
    const normalY = candles.priceToCoordinate(value)
    scale.applyOptions({ invertScale: true })

    expect(scale.options().mode).toBe(PriceScaleMode.Logarithmic)
    expect(scale.options().invertScale).toBe(true)
    expect(candles.priceToCoordinate(value)).not.toBe(normalY)
  } finally {
    await cleanup()
  }
})

it('uses Rust scale coordinates for negative-price autoscale and wheel zoom', async () => {
  const fixture = await mountInteractiveChart()
  try {
    fixture.candles.setData(TEST_HISTORY.slice(-3).map((bar, index) => ({
      time: bar.time as Time,
      open: -10 - index,
      high: -8 - index,
      low: -12 - index,
      close: -11 - index,
    })))
    await vi.runAllTimersAsync()
    const scale = fixture.candles.priceScale()

    for (const mode of [PriceScaleMode.Percentage, PriceScaleMode.Logarithmic]) {
      scale.applyOptions({ mode })
      await vi.runAllTimersAsync()
      const y = fixture.candles.priceToCoordinate(-12)
      expect(y).not.toBeNull()
      expect(fixture.candles.coordinateToPrice(y!)).toBeCloseTo(-12)

      scale.setVisibleRange({ from: -16, to: -7 })
      const before = scale.getVisibleRange()!
      fixture.canvas.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, clientX: 790, clientY: 300, deltaY: -50,
      }))
      await vi.runAllTimersAsync()
      const after = scale.getVisibleRange()!
      expect(Number.isFinite(after.from)).toBe(true)
      expect(Number.isFinite(after.to)).toBe(true)
      expect(after.from).toBeLessThan(after.to)
      expect(after).not.toEqual(before)
    }
  } finally {
    await fixture.cleanup()
  }
})

it('keeps main price coordinates visible with a zero percentage base', async () => {
  const fixture = await mountInteractiveChart()
  try {
    const times = TEST_HISTORY.slice(-2)
    fixture.candles.setData([
      { time: times[0]!.time as Time, open: -1, high: 1, low: -2, close: 0 },
      { time: times[1]!.time as Time, open: 1, high: 3, low: 0, close: 2 },
    ])
    await vi.runAllTimersAsync()
    fixture.candles.priceScale().applyOptions({ mode: PriceScaleMode.Percentage })
    await vi.runAllTimersAsync()
    const y = fixture.candles.priceToCoordinate(2)
    expect(y).not.toBeNull()
    expect(fixture.candles.coordinateToPrice(y!)).toBeCloseTo(2)
  } finally {
    await fixture.cleanup()
  }
})
it('keeps price geometry when switching the active runtime series', async () => {
  vi.useFakeTimers()
  const paint = createRecordingContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(paint.context)

  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { value: 800 })
  Object.defineProperty(container, 'clientHeight', { value: 600 })
  document.body.appendChild(container)

  let chart: IChartApi | null = null
  try {
    chart = await createRustChart(container, {})
    const canvas = container.querySelector('canvas')
    if (!canvas) throw new Error('Rust chart canvas was not mounted')
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, get: () => 800 })
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, get: () => 600 })
    chart.resize(800, 600)
    const candles = makeCandles()
    const line = chart.addSeries(LineSeries, { color: DEFAULT_CHART_APPEARANCE.upColor, visible: true })
    const candle = chart.addSeries(CandlestickSeries, { visible: false })
    line.setData(candles.map(({ time, close }) => ({ time, value: close })))
    await vi.runAllTimersAsync()
    expect(paint.strokes.some((stroke) => stroke.color === DEFAULT_CHART_APPEARANCE.upColor)).toBe(true)

    paint.strokes.length = 0
    paint.fills.length = 0
    line.applyOptions({ visible: false })
    line.setData([])
    candle.setData(candles)
    candle.applyOptions({ visible: true })
    await vi.runAllTimersAsync()

    expect(chart.timeScale().getVisibleLogicalRange()).not.toBeNull()
    expect(paint.fills).toContain(DEFAULT_CHART_APPEARANCE.upColor)
    expect(paint.fills).toContain(DEFAULT_CHART_APPEARANCE.downColor)
  } finally {
    chart?.remove()
    container.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  }
})
it('reports pane-local coordinates for clicks in a secondary indicator pane', async () => {
  vi.useFakeTimers()
  const paint = createRecordingContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(paint.context)
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { value: 800 })
  Object.defineProperty(container, 'clientHeight', { value: 600 })
  document.body.appendChild(container)

  let chart: IChartApi | null = null
  try {
    chart = await createRustChart(container, {})
    const canvas = container.querySelector('canvas')
    if (!canvas) throw new Error('Rust chart canvas was not mounted')
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, get: () => 800 })
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, get: () => 600 })
    chart.resize(800, 600)
    const candles = makeCandles()
    chart.addSeries(CandlestickSeries, {}, 0).setData(candles)
    chart.addSeries(HistogramSeries, {}, 1).setData(candles.map(({ time }, index) => ({ time, value: index + 10 })))
    const oscillator = chart.addSeries(LineSeries, { color: '#5b8cff' }, 2)
    oscillator.getPane().setHeight(120)
    oscillator.setData(candles.map(({ time }, index) => ({ time, value: index + 30 })))
    await vi.runAllTimersAsync()

    let paneIndex = -1
    let panePointY = -1
    chart.subscribeClick((params) => {
      paneIndex = params.paneIndex ?? -1
      panePointY = params.point?.y ?? -1
    })
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 400, clientY: 500, bubbles: true }))

    expect(paneIndex).toBe(2)
    expect(panePointY).toBeCloseTo(48)
  } finally {
    chart?.remove()
    container.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  }
})

it('keeps the chart visible with future spacers when switching line and candle series', async () => {
  vi.useFakeTimers()
  const paint = createRecordingContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(paint.context)

  const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'clientWidth')
  const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'clientHeight')
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })

  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { value: 800 })
  Object.defineProperty(container, 'clientHeight', { value: 600 })
  document.body.appendChild(container)
  const adapter = new RustChartAdapter()
  try {
    adapter.applyAppearance({ ...DEFAULT_CHART_APPEARANCE, chartType: 'line' })
    await adapter.init(container, TEST_SYMBOL, '1m')
    adapter.syncContainerSize()
    adapter.setHistory(TEST_HISTORY)
    const markerBar = TEST_HISTORY.at(-5)!
    adapter.setTradeMarkers([{
      time: markerBar.time, price: markerBar.close, text: 'Trade', color: '#ffffff', shape: 'arrowUp',
    }])
    const latestTime = TEST_HISTORY.at(-1)!.time
    adapter.setSpacerTimes(Array.from({ length: 192 }, (_, index) => latestTime + (index + 1) * 60))
    adapter.setIndicators([{
      indicatorId: 'runtime-oscillator',
      draws: [],
      onMainPanel: false,
      plots: TEST_HISTORY.slice(-100).map((bar, index) => ({
        key: 'oscillator',
        time: bar.time,
        value: 35 + index % 30,
      })),
    }])
    const drawingColor = '#2962ff'
    const drawing: SerializedDrawing = {
      id: 'runtime-trend-line',
      type: 'trend-line',
      anchors: [
        { time: TEST_HISTORY.at(-50)!.time as Time, price: TEST_HISTORY.at(-50)!.low },
        { time: TEST_HISTORY.at(-20)!.time as Time, price: TEST_HISTORY.at(-20)!.high },
      ],
      style: { lineColor: drawingColor, lineWidth: 2 },
      options: {},
    }
    adapter.loadDrawings([drawing])
    await vi.runAllTimersAsync()
    expect(paint.strokes.some((stroke) => stroke.color === '#5b8cff' && stroke.points.length > 1)).toBe(true)
    expect(paint.strokes.some((stroke) => stroke.color === drawingColor)).toBe(true)
    expect(adapter.getDrawings()).toHaveLength(1)
    expect(adapter.getDrawings()[0]).toMatchObject({
      id: drawing.id, type: drawing.type, anchors: drawing.anchors, style: { lineColor: drawingColor },
    })
    expect(paint.strokes.some((stroke) => stroke.color === drawingColor)).toBe(true)
    paint.fills.length = 0
    paint.strokes.length = 0
    adapter.applyAppearance({ ...DEFAULT_CHART_APPEARANCE, chartType: 'candles' })
    await vi.runAllTimersAsync()
    expect(paint.fills).toContain(DEFAULT_CHART_APPEARANCE.upColor)
    expect(paint.fills).toContain(DEFAULT_CHART_APPEARANCE.downColor)
    expect(adapter.getDrawings()).toHaveLength(1)
    expect(paint.strokes.some((stroke) => stroke.color === drawingColor)).toBe(true)

    paint.fills.length = 0
    adapter.applyAppearance({ ...DEFAULT_CHART_APPEARANCE, chartType: 'candles' })
    await vi.runAllTimersAsync()

    expect(paint.fills).toContain(DEFAULT_CHART_APPEARANCE.upColor)
    expect(paint.fills).toContain(DEFAULT_CHART_APPEARANCE.downColor)
  } finally {
    adapter.destroy()
    await vi.runAllTimersAsync()
    container.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
    if (widthDescriptor) Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', widthDescriptor)
    else Reflect.deleteProperty(HTMLCanvasElement.prototype, 'clientWidth')
    if (heightDescriptor) Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', heightDescriptor)
    else Reflect.deleteProperty(HTMLCanvasElement.prototype, 'clientHeight')
  }
})
it('renders trading overlays through the Rust host', async () => {
  vi.useFakeTimers()
  const paint = createRecordingContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(paint.context)
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { value: 800 })
  Object.defineProperty(container, 'clientHeight', { value: 600 })
  document.body.appendChild(container)

  const adapter = new RustChartAdapter()
  try {
    await adapter.init(container, TEST_SYMBOL, '1m')
    const canvas = container.querySelector('canvas')
    if (!canvas) throw new Error('Rust chart canvas was not mounted')
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, get: () => 800 })
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, get: () => 600 })
    adapter.syncContainerSize()
    adapter.setHistory(TEST_HISTORY)
    const entry = TEST_HISTORY.at(-35)!
    const exit = TEST_HISTORY.at(-5)!
    adapter.setOrderLines([{
      id: 'working-limit',
      price: entry.close,
      label: 'Buy 1',
      color: '#ff00ff',
      kind: 'limit',
      editable: true,
      role: 'entry',
      stage: 'working',
      qty: 1,
      priceLabel: entry.close.toFixed(2),
    }])
    expect(adapter.orderPrimitive.lines).toHaveLength(1)
    expect(adapter.orderPrimitive.coordinate(entry.close)).not.toBeNull()
    adapter.setTradeConnections([{
      entryTime: entry.time,
      entryPrice: entry.close,
      exitTime: exit.time,
      exitPrice: exit.close,
      side: 'long',
      initialStop: entry.low,
      initialTakeProfit: entry.high,
      exitReason: 'takeProfit',
    }])
    adapter.setEconomicEventMarkers([{
      id: 'runtime-event',
      time: exit.time,
      country: 'US',
      currency: 'USD',
      title: 'CPI',
      importance: 'high',
      state: 'next',
    }])
    adapter.setReplaySelection({ mode: 'active', timestamp: exit.time })
    await vi.runAllTimersAsync()

    expect(paint.strokes.some((stroke) => stroke.color === '#ff00ff')).toBe(true)
    expect(paint.strokes.some((stroke) => stroke.color === '#000000')).toBe(true)
    expect(paint.strokes.some((stroke) => stroke.color === '#2962ff')).toBe(true)
    expect(paint.fills).toContain('rgba(8, 153, 129, 0.22)')
    expect(paint.fills).toContain('rgba(242, 54, 69, 0.18)')
  } finally {
    adapter.destroy()
    await vi.runAllTimersAsync()
    container.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  }
})
it('coalesces marker invalidations across incremental bar batches', async () => {
  vi.useFakeTimers()
  const paint = createRecordingContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(paint.context)
  const pushBars = vi.spyOn(RustChartEngine.prototype, 'pushBars')
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { value: 800 })
  Object.defineProperty(container, 'clientHeight', { value: 600 })
  document.body.appendChild(container)
  const adapter = new RustChartAdapter()
  try {
    await adapter.init(container, TEST_SYMBOL, '1m')
    const canvas = container.querySelector('canvas')
    if (!canvas) throw new Error('Rust chart canvas was not mounted')
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, get: () => 800 })
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, get: () => 600 })
    adapter.syncContainerSize()
    adapter.setHistory(TEST_HISTORY)
    const last = TEST_HISTORY.at(-1)!
    adapter.setTradeMarkers([{
      time: last.time, price: last.close, text: 'Trade', color: '#ffffff', shape: 'arrowUp',
    }])
    await vi.runAllTimersAsync()
    pushBars.mockClear()
    const additions = Array.from({ length: 16 }, (_, index) => {
      const open = last.close + (index + 1) * 0.25
      const close = open + (index % 2 === 0 ? 0.25 : -0.25)
      return {
        time: last.time + (index + 1) * 60,
        open,
        high: Math.max(open, close) + 0.25,
        low: Math.min(open, close) - 0.25,
        close,
        volume: 100 + index,
      }
    })
    adapter.pushBars(additions)
    await vi.runAllTimersAsync()

    expect(pushBars).toHaveBeenCalledTimes(1)
    expect(pushBars.mock.calls[0]?.[0]).toHaveLength(16)
  } finally {
    adapter.destroy()
    await vi.runAllTimersAsync()
    container.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  }
})
it('supports mouse drag pan and wheel zoom', async () => {
  const fixture = await mountInteractiveChart()
  try {
    const timeScale = fixture.chart.timeScale()
    const initial = timeScale.getVisibleLogicalRange()!
    fixture.canvas.dispatchEvent(makePointerEvent('pointerdown', 1, 'mouse', 200, 100))
    fixture.canvas.dispatchEvent(makePointerEvent('pointermove', 1, 'mouse', 240, 100))
    fixture.canvas.dispatchEvent(makePointerEvent('pointerup', 1, 'mouse', 240, 100))
    await vi.runAllTimersAsync()
    const panned = timeScale.getVisibleLogicalRange()!
    expect(panned.from).not.toBe(initial.from)
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: 200, clientY: 100 })
    fixture.canvas.dispatchEvent(wheel)
    await vi.runAllTimersAsync()
    const zoomed = timeScale.getVisibleLogicalRange()!
    expect(wheel.defaultPrevented).toBe(true)
    expect(zoomed.to - zoomed.from).not.toBe(panned.to - panned.from)
  } finally {
    await fixture.cleanup()
  }
})

it('supports touch pinch and manual price-axis scaling', async () => {
  const fixture = await mountInteractiveChart()
  try {
    const scale = fixture.candles.priceScale()
    const beforePrice = scale.getVisibleRange()!
    fixture.canvas.dispatchEvent(makePointerEvent('pointerdown', 1, 'mouse', 790, 200))
    fixture.canvas.dispatchEvent(makePointerEvent('pointermove', 1, 'mouse', 790, 220))
    fixture.canvas.dispatchEvent(makePointerEvent('pointerup', 1, 'mouse', 790, 220))
    expect(scale.options().autoScale).toBe(false)
    expect(scale.getVisibleRange()?.from).not.toBe(beforePrice.from)
    const timeScale = fixture.chart.timeScale()
    const beforePinch = timeScale.getVisibleLogicalRange()!
    fixture.canvas.dispatchEvent(makePointerEvent('pointerdown', 2, 'touch', 100, 100))
    fixture.canvas.dispatchEvent(makePointerEvent('pointerdown', 3, 'touch', 200, 100))
    fixture.canvas.dispatchEvent(makePointerEvent('pointermove', 3, 'touch', 300, 100))
    fixture.canvas.dispatchEvent(makePointerEvent('pointerup', 3, 'touch', 300, 100))
    fixture.canvas.dispatchEvent(makePointerEvent('pointerup', 2, 'touch', 100, 100))
    await vi.runAllTimersAsync()
    const pinched = timeScale.getVisibleLogicalRange()!
    expect(pinched.to - pinched.from).not.toBe(beforePinch.to - beforePinch.from)
  } finally {
    await fixture.cleanup()
  }
})
it('zooms and restores the selected area through Rust chart coordinates', async () => {
  vi.useFakeTimers()
  const paint = createRecordingContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(paint.context)
  const container = document.createElement('div')
  Object.defineProperties(container, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 600 },
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  })
  container.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
  document.body.appendChild(container)
  const adapter = new RustChartAdapter()
  try {
    await adapter.init(container, TEST_SYMBOL, '1m')
    const canvas = container.querySelector('canvas')
    if (!canvas) throw new Error('Rust chart canvas was not mounted')
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, get: () => 800 },
      clientHeight: { configurable: true, get: () => 600 },
    })
    adapter.syncContainerSize()
    adapter.setHistory(TEST_HISTORY)
    const lastTime = TEST_HISTORY.at(-1)!.time
    adapter.setSpacerTimes(Array.from({ length: 192 }, (_, index) => lastTime + (index + 1) * 60))
    await vi.runAllTimersAsync()
    const initial = adapter.visibleRange()
    adapter.beginAreaZoom()
    container.dispatchEvent(makePointerEvent('pointerdown', 1, 'mouse', 200, 180))
    container.dispatchEvent(makePointerEvent('pointermove', 1, 'mouse', 520, 360))
    container.dispatchEvent(makePointerEvent('pointerup', 1, 'mouse', 520, 360))
    await vi.runAllTimersAsync()
    expect(adapter.areaZoomState()).toEqual({ selecting: false, zoomed: true })
    expect(adapter.visibleRange().to - adapter.visibleRange().from).toBeLessThan(initial.to - initial.from)
    adapter.resetAreaZoom()
    await vi.runAllTimersAsync()
    expect(adapter.areaZoomState()).toEqual({ selecting: false, zoomed: false })
    expect(adapter.visibleRange().from).toBeCloseTo(initial.from, 0)
  } finally {
    adapter.destroy()
    await vi.runAllTimersAsync()
    container.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  }
})
it('pans and zooms from a secondary indicator pane', async () => {
  const fixture = await mountInteractiveChart()
  try {
    const indicator = fixture.chart.addSeries(LineSeries, { priceLineVisible: false }, 2)
    indicator.setData(TEST_HISTORY.slice(-100).map(({ time, close }) => ({ time: time as Time, value: close })))
    fixture.chart.panes()[2].setHeight(120)
    await vi.runAllTimersAsync()
    const timeScale = fixture.chart.timeScale()
    const initial = timeScale.getVisibleLogicalRange()!
    fixture.canvas.dispatchEvent(makePointerEvent('pointerdown', 1, 'mouse', 200, 500))
    fixture.canvas.dispatchEvent(makePointerEvent('pointermove', 1, 'mouse', 240, 500))
    fixture.canvas.dispatchEvent(makePointerEvent('pointerup', 1, 'mouse', 240, 500))
    await vi.runAllTimersAsync()
    const panned = timeScale.getVisibleLogicalRange()!
    expect(panned.from).not.toBe(initial.from)
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, clientX: 200, clientY: 500 })
    fixture.canvas.dispatchEvent(wheel)
    await vi.runAllTimersAsync()
    const zoomed = timeScale.getVisibleLogicalRange()!
    expect(wheel.defaultPrevented).toBe(true)
    expect(zoomed.to - zoomed.from).not.toBe(panned.to - panned.from)
  } finally {
    await fixture.cleanup()
  }
})
it('maps secondary indicator values and scales only their pane', async () => {
  const fixture = await mountInteractiveChart()
  try {
    const indicator = fixture.chart.addSeries(LineSeries, { priceLineVisible: false }, 2)
    indicator.setData(TEST_HISTORY.slice(-100).map(({ time }, index) => ({ time: time as Time, value: index })))
    fixture.chart.panes()[2].setHeight(120)
    await vi.runAllTimersAsync()
    const scale = indicator.priceScale()
    const mainRange = fixture.candles.priceScale().getVisibleRange()!
    const automatic = scale.getVisibleRange()!
    expect(automatic.from).toBeLessThan(25)
    expect(automatic.to).toBeGreaterThan(25)
    scale.applyOptions({ mode: 1 })
    const logarithmicY = indicator.priceToCoordinate(25)!
    expect(indicator.coordinateToPrice(logarithmicY)).toBeCloseTo(25)
    expect(scale.options().mode).toBe(1)
    scale.applyOptions({ mode: 2 })
    const percentageY = indicator.priceToCoordinate(25)!
    expect(indicator.coordinateToPrice(percentageY)).toBeCloseTo(25)
    expect(scale.options().mode).toBe(2)
    scale.applyOptions({ mode: 0 })
    const normalY = indicator.priceToCoordinate(25)!
    expect(indicator.coordinateToPrice(normalY)).toBeCloseTo(25)
    scale.setVisibleRange({ from: 20, to: 40 })
    expect(scale.options().autoScale).toBe(false)
    expect(fixture.candles.priceScale().getVisibleRange()).toEqual(mainRange)
    scale.applyOptions({ invertScale: true })
    const invertedY = indicator.priceToCoordinate(25)!
    expect(invertedY).toBeLessThan(normalY)
    expect(indicator.coordinateToPrice(invertedY)).toBeCloseTo(25)
    fixture.canvas.dispatchEvent(makePointerEvent('pointerdown', 1, 'mouse', 790, 500))
    fixture.canvas.dispatchEvent(makePointerEvent('pointermove', 1, 'mouse', 790, 520))
    fixture.canvas.dispatchEvent(makePointerEvent('pointerup', 1, 'mouse', 790, 520))
    const draggedRange = scale.getVisibleRange()!
    expect(draggedRange.from).not.toBe(20)
    fixture.canvas.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, clientX: 790, clientY: 500,
    }))
    expect(scale.options().autoScale).toBe(true)
    scale.setVisibleRange({ from: 20, to: 40 })
    fixture.chart.removeSeries(indicator)
    const replacement = fixture.chart.addSeries(LineSeries, { priceLineVisible: false }, 2)
    replacement.setData([{ time: TEST_HISTORY.at(-1)!.time as Time, value: 50 }])
    await vi.runAllTimersAsync()
    expect(replacement.priceScale().options()).toEqual({ autoScale: true, invertScale: false, mode: 0 })
  } finally {
    await fixture.cleanup()
  }
})
