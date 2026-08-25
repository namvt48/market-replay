import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LwcAdapter } from './lwc-adapter'
import type { SymbolMeta } from '../api/types'
import type { SerializedDrawing } from 'lightweight-charts-drawing'
import type { UTCTimestamp } from 'lightweight-charts'
import type { OrderLine } from './chart-adapter'
import { DEFAULT_DRAWING_METADATA } from './drawing-appearance'

interface FakeAnchor { time: number; price: number }
interface FakeDrawing {
  id: string
  type: string
  anchors: FakeAnchor[]
  style: Record<string, unknown>
  options: Record<string, unknown>
  state: string
  inlineEditing: boolean
  detached: boolean
  attach(): void
  detach(): void
  setAnchors(anchors: FakeAnchor[]): void
  updateStyle(style: Record<string, unknown>): void
  updateOptions(options: Record<string, unknown>): void
  updateAnchor(index: number, anchor: FakeAnchor): void
  setInlineEditing(editing: boolean): void
  toJSON(): Record<string, unknown>
}

const drawingMocks = vi.hoisted(() => {
  const managers: FakeDrawingManager[] = []

  class FakeDrawingManager {
    drawings: FakeDrawing[] = []
    listeners = new Map<string, Set<(event: Record<string, unknown>) => void>>()
    selected: FakeDrawing | null = null
    hitDrawing: FakeDrawing | null = null
    hitAnchorIndex: number | null = null

    constructor() { managers.push(this) }
    attach(): void {}
    detach(): void {}
    setActiveTool(): void {}
    deselectAll(): void {
      const selected = this.selected
      this.selected = null
      if (selected) this.emit('drawing:deselected', { drawingId: selected.id, drawing: selected })
    }
    getSelectedDrawing(): FakeDrawing | null { return this.selected }
    getAllDrawings(): FakeDrawing[] { return this.drawings }
    getDrawing(id: string): FakeDrawing | undefined { return this.drawings.find((drawing) => drawing.id === id) }
    hitTest(): FakeDrawing | null { return this.hitDrawing }
    hitTestAnchor(): number | null { return this.hitAnchorIndex }
    clearAll(): void { this.drawings = []; this.selected = null; this.emit('drawing:cleared', {}) }
    importDrawings(drawings: Array<{ id: string; type: string; anchors: FakeAnchor[]; style: Record<string, unknown>; options: Record<string, unknown> }>, factory: (type: string, data: { id: string; anchors: FakeAnchor[]; style: Record<string, unknown>; options: Record<string, unknown> }) => FakeDrawing): void {
      this.drawings = drawings.map((drawing) => factory(drawing.type, drawing))
    }
    addDrawing(drawing: FakeDrawing): void { this.drawings.push(drawing); this.emit('drawing:added', { drawingId: drawing.id, drawing }) }
    removeDrawing(id: string): void { this.drawings = this.drawings.filter((drawing) => drawing.id !== id); if (this.selected?.id === id) this.selected = null; this.emit('drawing:removed', { drawingId: id }) }
    selectDrawing(id: string): void { this.selected = this.getDrawing(id) ?? null; this.emit('drawing:selected', { drawingId: id, drawing: this.selected }) }
    on(type: string, callback: (event: Record<string, unknown>) => void): () => void {
      const listeners = this.listeners.get(type) ?? new Set()
      listeners.add(callback)
      this.listeners.set(type, listeners)
      return () => listeners.delete(callback)
    }
    private emit(type: string, event: Record<string, unknown>): void {
      this.listeners.get(type)?.forEach((callback) => callback({ type, ...event }))
    }
  }

  function createDrawing(type: string, id: string, anchors: FakeAnchor[], style: Record<string, unknown>, options: Record<string, unknown>): FakeDrawing {
    return {
      id, type, anchors, style, options, state: 'normal', inlineEditing: false, detached: false,
      attach(): void { this.detached = false },
      detach(): void { this.detached = true },
      setAnchors(next): void { this.anchors = next },
      updateStyle(next): void { this.style = { ...this.style, ...next } },
      updateOptions(next): void { this.options = { ...this.options, ...next } },
      updateAnchor(index, anchor): void { this.anchors[index] = anchor },
      setInlineEditing(editing): void { this.inlineEditing = editing },
      toJSON(): Record<string, unknown> { return { id: this.id, type: this.type, anchors: this.anchors, style: this.style, options: this.options } },
    }
  }

  return { managers, FakeDrawingManager, createDrawing }
})

const chartMocks = vi.hoisted(() => {
  const priceScaleState = { autoScale: true, range: { from: 90, to: 110 }, invertScale: false, mode: 0 }
  return {
  chartApplyOptions: vi.fn(),
  chartResize: vi.fn(),
  candleApplyOptions: vi.fn(),
  volumeApplyOptions: vi.fn(),
  paneSetHeight: vi.fn(),
  paneCount: 1,
  addSeries: vi.fn(),
  removeSeries: vi.fn(),
  candleSetData: vi.fn(),
  candleUpdate: vi.fn(),
  volumeSetData: vi.fn(),
  volumeUpdate: vi.fn(),
  candles: null as object | null,
  crosshairHandler: null as ((params: { time?: number; point?: { x: number; y: number } | null; seriesData: Map<object, unknown> }) => void) | null,
  logicalRangeHandler: null as ((range: { from: number; to: number } | null) => void) | null,
  timeRangeHandler: null as ((range: { from: number; to: number } | null) => void) | null,
  setVisibleLogicalRange: vi.fn(),
  setVisibleRange: vi.fn(),
  timeScaleApplyOptions: vi.fn(),
  priceScaleState,
  priceScaleApplyOptions: vi.fn((options: { autoScale?: boolean; invertScale?: boolean; mode?: number }) => {
    if (typeof options.autoScale === 'boolean') priceScaleState.autoScale = options.autoScale
    if (typeof options.invertScale === 'boolean') priceScaleState.invertScale = options.invertScale
    if (typeof options.mode === 'number') priceScaleState.mode = options.mode
  }),
  priceScaleSetAutoScale: vi.fn((enabled: boolean) => { priceScaleState.autoScale = enabled }),
  priceScaleSetVisibleRange: vi.fn((range: { from: number; to: number }) => { priceScaleState.range = range }),
  setCrosshairPosition: vi.fn(),
  clearCrosshairPosition: vi.fn(),
  fitContent: vi.fn(),
  takeScreenshot: vi.fn(),
  createChartOptions: null as Record<string, unknown> | null,
  chartRoot: null as HTMLDivElement | null,
  }
})

vi.mock('lightweight-charts-drawing', () => ({
  DrawingManager: drawingMocks.FakeDrawingManager,
  getToolRegistry: () => ({
    get: (type: string) => ({
      type,
      name: type,
      category: 'line',
      requiredAnchors: type === 'long-position' || type === 'short-position'
        ? 3
        : type === 'curve' ? 3
        : ['text-annotation', 'comment', 'price-label', 'pin', 'table', 'signpost', 'flag-mark'].includes(type) ? 1 : 2,
    }),
    getAll: () => [{ type: 'trend-line', name: 'Trend Line', category: 'line', requiredAnchors: 2 }],
    createDrawing: drawingMocks.createDrawing,
  }),
}))

vi.mock('lightweight-charts', () => {
  const timeScale = {
    width: () => 600,
    coordinateToTime: (x: number) => Math.round(x),
    coordinateToLogical: (x: number) => x,
    getVisibleRange: () => ({ from: 0, to: 100 }), getVisibleLogicalRange: () => ({ from: 10, to: 20 }),
    fitContent: chartMocks.fitContent, setVisibleLogicalRange: chartMocks.setVisibleLogicalRange,
    setVisibleRange: chartMocks.setVisibleRange,
    subscribeVisibleTimeRangeChange: vi.fn((handler: typeof chartMocks.timeRangeHandler) => { chartMocks.timeRangeHandler = handler }),
    unsubscribeVisibleTimeRangeChange: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn((handler: typeof chartMocks.logicalRangeHandler) => { chartMocks.logicalRangeHandler = handler }),
    unsubscribeVisibleLogicalRangeChange: vi.fn(), applyOptions: chartMocks.timeScaleApplyOptions, timeToIndex: (time: number) => time, timeToCoordinate: (time: number) => time,
  }
  const pane = { getHeight: () => 100, setHeight: chartMocks.paneSetHeight }
  const baseSeries = {
    attachPrimitive: vi.fn(), setData: vi.fn(), update: vi.fn(), pop: vi.fn(),
    coordinateToPrice: (y: number) => y,
    priceToCoordinate: (price: number) => price,
    getPane: () => pane,
    priceScale: () => ({
      applyOptions: chartMocks.priceScaleApplyOptions,
      getVisibleRange: () => chartMocks.priceScaleState.range,
      options: () => ({ autoScale: chartMocks.priceScaleState.autoScale, invertScale: chartMocks.priceScaleState.invertScale, mode: chartMocks.priceScaleState.mode }),
      setAutoScale: chartMocks.priceScaleSetAutoScale,
      setVisibleRange: chartMocks.priceScaleSetVisibleRange,
    }),
  }
  const candles = { ...baseSeries, setData: chartMocks.candleSetData, update: chartMocks.candleUpdate, applyOptions: chartMocks.candleApplyOptions }
  const volume = { ...baseSeries, setData: chartMocks.volumeSetData, update: chartMocks.volumeUpdate, applyOptions: chartMocks.volumeApplyOptions }
  const spacer = { ...baseSeries, applyOptions: vi.fn() }
  chartMocks.addSeries.mockImplementation((kind: string) => {
    if (kind === 'HistogramSeries') {
      chartMocks.paneCount = 2
      return volume
    }
    return kind === 'CandlestickSeries' ? candles : spacer
  })
  chartMocks.removeSeries.mockImplementation(() => { chartMocks.paneCount = 1 })
  chartMocks.candles = candles
  const chart = {
    addSeries: chartMocks.addSeries,
    removeSeries: chartMocks.removeSeries,
    panes: () => Array.from({ length: chartMocks.paneCount }),
    timeScale: () => timeScale,
    applyOptions: chartMocks.chartApplyOptions, resize: chartMocks.chartResize, remove: vi.fn(),
    subscribeCrosshairMove: vi.fn((handler: typeof chartMocks.crosshairHandler) => { chartMocks.crosshairHandler = handler }),
    unsubscribeCrosshairMove: vi.fn(),
    setCrosshairPosition: chartMocks.setCrosshairPosition,
    clearCrosshairPosition: chartMocks.clearCrosshairPosition,
    takeScreenshot: chartMocks.takeScreenshot,
  }
  return {
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries', LineSeries: 'LineSeries',
    ColorType: { Solid: 'solid' }, CrosshairMode: { Normal: 0 }, LineStyle: { Dashed: 2 }, PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2 },
    createChart: (element: HTMLElement, options: Record<string, unknown>) => {
      chartMocks.createChartOptions = options
      chartMocks.chartRoot = document.createElement('div')
      element.appendChild(chartMocks.chartRoot)
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

beforeAll(() => {
  class ResizeObserverStub { observe(): void {}; disconnect(): void {} }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

beforeEach(() => {
  drawingMocks.managers.length = 0
  vi.clearAllMocks()
  chartMocks.crosshairHandler = null
  chartMocks.logicalRangeHandler = null
  chartMocks.timeRangeHandler = null
  chartMocks.priceScaleState.autoScale = true
  chartMocks.priceScaleState.range = { from: 90, to: 110 }
  chartMocks.priceScaleState.invertScale = false
  chartMocks.priceScaleState.mode = 0
  chartMocks.paneCount = 1
  chartMocks.createChartOptions = null
  chartMocks.chartRoot = null
  chartMocks.chartResize.mockImplementation((width: number, height: number) => {
    if (!chartMocks.chartRoot) return
    chartMocks.chartRoot.style.width = `${width}px`
    chartMocks.chartRoot.style.height = `${height}px`
  })
})

describe('LwcAdapter lifecycle', () => {
  it('applies cross, dot, arrow, and demonstration cursor visuals', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')

    adapter.setCursorMode('dot')
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 120, clientY: 90 }))
    expect(container).toHaveClass('chart-cursor-dot')
    expect(container.querySelector('.chart-cursor-indicator')).toHaveStyle({ transform: 'translate3d(120px, 90px, 0)' })

    adapter.setCursorMode('arrow')
    expect(container).toHaveClass('chart-cursor-arrow')
    expect(container.querySelector('.chart-cursor-indicator')).toBeNull()

    adapter.setCursorMode('demonstration')
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 75, clientY: 55 }))
    expect(container).toHaveClass('chart-cursor-demonstration')
    expect(container.querySelector('.chart-cursor-indicator')).toHaveStyle({ transform: 'translate3d(75px, 55px, 0)' })

    adapter.setCursorMode('cross')
    expect(container).toHaveClass('chart-cursor-cross')
    expect(container.querySelector('.chart-cursor-indicator')).toBeNull()
  })

  it('erases the drawing under the pointer without selecting or dragging it', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    adapter.loadDrawings([{
      id: 'erasable-line', type: 'trend-line', anchors: [{ time: 0 as UTCTimestamp, price: 100 }, { time: 60 as UTCTimestamp, price: 105 }],
      style: { lineColor: '#2962ff', lineWidth: 2 }, options: { locked: true },
    }])
    const manager = drawingMocks.managers.at(-1)
    manager!.hitDrawing = manager!.drawings[0]

    adapter.setCursorMode('eraser')
    const pointerDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 91, clientX: 30, clientY: 100 })
    container.dispatchEvent(pointerDown)

    expect(pointerDown.defaultPrevented).toBe(true)
    expect(adapter.getDrawings()).toEqual([])
    expect(manager?.getSelectedDrawing()).toBeNull()
  })

  it('keeps resize ownership in the adapter so detached-window cleanup cannot race an internal observer', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')

    expect(chartMocks.createChartOptions).toMatchObject({ autoSize: false })
    adapter.destroy()
  })

  it('shows seconds on sub-minute charts and returns to minute precision for minute history', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '15s')

    expect(chartMocks.createChartOptions).toMatchObject({ timeScale: { secondsVisible: true } })
    adapter.setHistory([
      { time: 0, open: 1, high: 2, low: 0, close: 1, volume: 1 },
      { time: 60, open: 1, high: 2, low: 0, close: 1, volume: 1 },
    ])
    expect(chartMocks.chartApplyOptions).toHaveBeenCalledWith(expect.objectContaining({ timeScale: expect.objectContaining({ secondsVisible: false }) }))
    adapter.destroy()
  })

  it('keeps the chart shell filling a fractional split pane after a snapped resize', async () => {
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 531 },
      clientHeight: { configurable: true, value: 480 },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    chartMocks.chartResize.mockClear()

    adapter.syncContainerSize()

    expect(chartMocks.chartResize).toHaveBeenCalledWith(531, 480, true)
    expect(chartMocks.chartRoot).toHaveStyle({ width: '100%', height: '100%' })
    adapter.destroy()
  })
})

describe('LwcAdapter drawing preview', () => {
  it('locks chart pan and scale while an order leg is being dragged', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    const primitive = adapter.orderPrimitive
    primitive.attached({
      series: { priceToCoordinate: (price: number) => price, coordinateToPrice: (coordinate: number) => coordinate },
      requestUpdate: vi.fn(), chart: {},
    } as never)
    const line: OrderLine = {
      id: 'order-1', price: 100, label: 'Buy Limit', color: '#2962ff', kind: 'limit', editable: true,
      role: 'entry', stage: 'working', qty: 2, priceLabel: '100.00', maxQuantity: 1_000,
    }
    adapter.setOrderLines([line])
    const moved = vi.fn()
    const dragStarted = vi.fn()
    adapter.onOrderLineMove(moved)
    adapter.onOrderLineDragStart(dragStarted)
    chartMocks.chartApplyOptions.mockClear()

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7, clientX: 300, clientY: 100 }))
    expect(dragStarted).toHaveBeenCalledWith('order-1')
    expect(chartMocks.chartApplyOptions).toHaveBeenLastCalledWith({ handleScroll: false, handleScale: false })
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 7, clientX: 300, clientY: 110 }))
    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: 300, clientY: 110 }))
    expect(moved).toHaveBeenCalledWith('order-1', 110)
    expect(chartMocks.chartApplyOptions).toHaveBeenLastCalledWith({ handleScroll: true, handleScale: true })
  })

  it('keeps the locally dragged protection price when replay sync arrives mid-drag', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    const primitive = adapter.orderPrimitive
    primitive.attached({
      series: { priceToCoordinate: (price: number) => price, coordinateToPrice: (coordinate: number) => coordinate },
      requestUpdate: vi.fn(), chart: {},
    } as never)
    const takeProfit: OrderLine = {
      id: 'take-profit-1', price: 100, label: 'Take Profit', color: '#089981', kind: 'takeProfit', editable: true,
      role: 'takeProfit', stage: 'working', qty: 2, priceLabel: '100.00', maxQuantity: 1_000,
    }
    adapter.setOrderLines([takeProfit])

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 11, clientX: 300, clientY: 100 }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 11, clientX: 300, clientY: 110 }))
    expect(primitive.lines[0]?.price).toBe(110)

    // Replay advances while the pointer is held and broadcasts the last
    // committed fill state. That stale projection must not snap the line
    // back underneath the cursor before pointerup commits the new price.
    adapter.setOrderLines([takeProfit])

    expect(primitive.lines[0]?.price).toBe(110)
    expect(primitive.lines[0]?.priceLabel).toBe('110.00')
  })

  it('does not redraw an order line while pointer movement stays on the same tick', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    const requestUpdate = vi.fn()
    adapter.orderPrimitive.attached({
      series: { priceToCoordinate: (price: number) => price, coordinateToPrice: (coordinate: number) => coordinate },
      requestUpdate, chart: {},
    } as never)
    const stopLoss: OrderLine = {
      id: 'stop-loss-1', price: 100, label: 'Stop Loss', color: '#ff9800', kind: 'stopLoss', editable: true,
      role: 'stopLoss', stage: 'working', qty: 2, priceLabel: '100.00', maxQuantity: 1_000,
    }
    adapter.setOrderLines([stopLoss])
    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 12, clientX: 300, clientY: 100 }))
    requestUpdate.mockClear()

    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 12, clientX: 300, clientY: 100.1 }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 12, clientX: 300, clientY: 100.12 }))

    expect(requestUpdate).not.toHaveBeenCalled()
  })

  it('creates and drags a TP range directly from the TP control', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    const primitive = adapter.orderPrimitive
    primitive.attached({
      series: { priceToCoordinate: (price: number) => price, coordinateToPrice: (coordinate: number) => coordinate },
      requestUpdate: vi.fn(), chart: {},
    } as never)
    const entry: OrderLine = {
      id: 'ticket-entry', price: 100, label: 'Buy Limit', color: '#2962ff', kind: 'limit', editable: true,
      role: 'entry', stage: 'draft', qty: 1, priceLabel: '100.00', showControls: true,
      protectionEnabled: { takeProfit: false, stopLoss: false }, maxQuantity: 1_000,
    }
    adapter.setOrderLines([entry])
    primitive.addHitRegion({ x: 20, y: 20, width: 34, height: 20, action: { type: 'toggle-take-profit' } })
    const moved = vi.fn()
    const actions = vi.fn((action) => {
      if (action.type !== 'toggle-take-profit') return
      adapter.setOrderLines([
        { ...entry, protectionEnabled: { takeProfit: true, stopLoss: false } },
        { ...entry, id: 'ticket-take-profit', role: 'takeProfit', kind: 'takeProfit', price: 120, priceLabel: '120.00', label: 'Take Profit', color: '#089981', showControls: false },
      ])
    })
    adapter.onOrderLineAction(actions)
    adapter.onOrderLineMove(moved)
    chartMocks.chartApplyOptions.mockClear()

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 9, clientX: 30, clientY: 30 }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 9, clientX: 30, clientY: 80 }))
    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, clientX: 30, clientY: 80 }))
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 30, clientY: 30 }))

    expect(actions).toHaveBeenCalledTimes(1)
    expect(actions).toHaveBeenCalledWith({ type: 'toggle-take-profit' })
    expect(moved).toHaveBeenCalledWith('ticket-take-profit', 80)
    expect(chartMocks.chartApplyOptions).toHaveBeenCalledWith({ handleScroll: false, handleScale: false })
    expect(chartMocks.chartApplyOptions).toHaveBeenLastCalledWith({ handleScroll: true, handleScale: true })
  })

  it('confirms a chart order with Enter after dragging its take-profit leg', async () => {
    const container = document.createElement('div')
    const outsideControl = document.createElement('button')
    document.body.append(outsideControl, container)
    outsideControl.focus()
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    adapter.orderPrimitive.attached({
      series: { priceToCoordinate: (price: number) => price, coordinateToPrice: (coordinate: number) => coordinate },
      requestUpdate: vi.fn(), chart: {},
    } as never)
    const entry: OrderLine = {
      id: 'ticket-entry', price: 100, label: 'Buy Limit', color: '#2962ff', kind: 'limit', editable: true,
      role: 'entry', stage: 'draft', qty: 1, priceLabel: '100.00', showControls: true,
      protectionEnabled: { takeProfit: true, stopLoss: true }, maxQuantity: 1_000,
    }
    adapter.setOrderLines([
      entry,
      { ...entry, id: 'ticket-take-profit', role: 'takeProfit', kind: 'takeProfit', price: 120, priceLabel: '120.00', label: 'Take Profit', color: '#089981', showControls: false },
      { ...entry, id: 'ticket-stop-loss', role: 'stopLoss', kind: 'stopLoss', price: 90, priceLabel: '90.00', label: 'Stop Loss', color: '#ff9800', showControls: false },
    ])
    const moved = vi.fn()
    const actions = vi.fn()
    adapter.onOrderLineMove(moved)
    adapter.onOrderLineAction(actions)

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 13, clientX: 300, clientY: 120 }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 13, clientX: 300, clientY: 110 }))
    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 13, clientX: 300, clientY: 110 }))
    expect(document.activeElement).toBe(container)
    const confirm = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    document.activeElement?.dispatchEvent(confirm)

    expect(moved).toHaveBeenCalledWith('ticket-take-profit', 110)
    expect(actions).toHaveBeenCalledWith({ type: 'confirm' })
    expect(confirm.defaultPrevented).toBe(true)
    adapter.destroy()
    outsideControl.remove()
    container.remove()
  })

  it('keeps preview transient and persists only the completed drawing', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    const changed = vi.fn()
    adapter.onDrawingsChanged(changed)

    adapter.setDrawingTool('trend-line')
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 100 }))
    const manager = drawingMocks.managers.at(-1)
    expect(manager?.drawings.map((drawing) => drawing.id)).toEqual(['__drawing-preview__'])
    expect(adapter.getDrawings()).toEqual([])
    expect(changed).not.toHaveBeenCalled()

    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 20, clientY: 110 }))
    expect(manager?.drawings[0]?.anchors).toEqual([{ time: 10, price: 100 }, { time: 20, price: 110 }])
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 110 }))

    expect(manager?.drawings).toHaveLength(1)
    expect(manager?.drawings[0]?.id).not.toBe('__drawing-preview__')
    expect(adapter.getDrawings()).toHaveLength(1)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('creates Curve from three visible points', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')

    adapter.setDrawingTool('curve')
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 40, clientY: 220 }))
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 240, clientY: 40 }))
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 520, clientY: 120 }))

    expect(adapter.getDrawings()).toEqual([expect.objectContaining({
      type: 'curve',
      anchors: [{ time: 40, price: 220 }, { time: 240, price: 40 }, { time: 520, price: 120 }],
    })])
  })

  it.each(['price-range', 'date-range'] as const)('persists %s after pointer drag instead of leaving a transient Measure preview', async (tool) => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')

    adapter.setDrawingTool(tool)
    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 82, clientX: 80, clientY: 80 }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, buttons: 1, pointerId: 82, clientX: 360, clientY: 260 }))
    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 82, clientX: 360, clientY: 260 }))

    expect(adapter.getDrawings()).toEqual([expect.objectContaining({
      type: tool,
      anchors: [{ time: 80, price: 80 }, { time: 360, price: 260 }],
    })])
    expect(drawingMocks.managers.at(-1)?.getSelectedDrawing()).toMatchObject({ type: tool })
  })

  it.each(['price-range', 'date-range'] as const)('supports click-click placement for %s', async (tool) => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    adapter.setDrawingTool(tool)

    const click = (pointerId: number, clientX: number, clientY: number): void => {
      container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId, clientX, clientY }))
      container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId, clientX, clientY }))
      container.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY }))
    }
    click(91, 80, 80)
    click(92, 360, 260)

    expect(adapter.getDrawings()).toEqual([expect.objectContaining({
      type: tool,
      anchors: [{ time: 80, price: 80 }, { time: 360, price: 260 }],
    })])
  })

  it.each([
    ['long-position', [{ time: 200, price: 200 }, { time: 200, price: 280 }, { time: 320, price: 120 }]],
    ['short-position', [{ time: 200, price: 200 }, { time: 200, price: 120 }, { time: 320, price: 280 }]],
  ] as const)('creates a selected %s with usable default bounds on the first click', async (tool, anchors) => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')

    adapter.setDrawingTool(tool)
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200, clientY: 200 }))

    expect(adapter.getDrawings()).toEqual([expect.objectContaining({ type: tool, anchors })])
    expect(drawingMocks.managers.at(-1)?.getSelectedDrawing()).toMatchObject({ type: tool, anchors })
  })

  it('keeps Measure visible after pointerup until the next chart interaction without persisting it', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    const changed = vi.fn()
    const toolChanged = vi.fn()
    adapter.onDrawingsChanged(changed)
    adapter.onDrawingToolChanged(toolChanged)

    adapter.setDrawingTool('date-price-range')
    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 21, clientX: 10, clientY: 100 }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 21, clientX: 40, clientY: 125 }))

    const manager = drawingMocks.managers.at(-1)
    expect(manager?.drawings).toHaveLength(1)
    expect(manager?.drawings[0]).toMatchObject({ id: '__drawing-preview__', type: 'date-price-range', anchors: [{ time: 10, price: 100 }, { time: 40, price: 125 }] })

    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 21, clientX: 40, clientY: 125 }))

    expect(manager?.drawings).toHaveLength(1)
    expect(manager?.drawings[0]?.id).toBe('__drawing-preview__')
    expect(adapter.getDrawings()).toEqual([])
    expect(changed).not.toHaveBeenCalled()
    expect(toolChanged).toHaveBeenLastCalledWith(null)

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 25, clientX: 80, clientY: 160 }))

    expect(manager?.drawings).toEqual([])
    expect(changed).not.toHaveBeenCalled()
  })

  it('keeps Measure armed after a first click so click-then-move interaction is visible', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    const toolChanged = vi.fn()
    adapter.onDrawingToolChanged(toolChanged)
    adapter.setDrawingTool('date-price-range')

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 22, clientX: 10, clientY: 100 }))
    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 22, clientX: 10, clientY: 100 }))
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 100 }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 0, pointerId: 22, clientX: 40, clientY: 125 }))

    const manager = drawingMocks.managers.at(-1)
    expect(manager?.drawings[0]).toMatchObject({ id: '__drawing-preview__', type: 'date-price-range', anchors: [{ time: 10, price: 100 }, { time: 40, price: 125 }] })
    expect(toolChanged).toHaveBeenLastCalledWith('date-price-range')

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 23, clientX: 40, clientY: 125 }))
    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 23, clientX: 40, clientY: 125 }))

    expect(manager?.drawings[0]).toMatchObject({ id: '__drawing-preview__', type: 'date-price-range' })
    expect(adapter.getDrawings()).toEqual([])
    expect(toolChanged).toHaveBeenLastCalledWith(null)

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 26, clientX: 80, clientY: 150 }))
    expect(manager?.drawings).toEqual([])
  })

  it('keeps Measure armed after Shift-click so releasing Shift can continue click-then-move drawing', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    const chartOrder = vi.fn()
    const toolChanged = vi.fn()
    adapter.onChartOrder(chartOrder)
    adapter.onDrawingToolChanged(toolChanged)

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 24, clientX: 10, clientY: 100, shiftKey: true }))
    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 24, clientX: 10, clientY: 100, shiftKey: true }))
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 100, shiftKey: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Shift' }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 0, pointerId: 24, clientX: 50, clientY: 130 }))

    expect(drawingMocks.managers.at(-1)?.drawings[0]).toMatchObject({
      id: '__drawing-preview__', type: 'date-price-range', anchors: [{ time: 10, price: 100 }, { time: 50, price: 130 }],
    })
    expect(toolChanged).toHaveBeenLastCalledWith('date-price-range')

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 25, clientX: 50, clientY: 130 }))
    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 25, clientX: 50, clientY: 130 }))
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 50, clientY: 130 }))

    expect(drawingMocks.managers.at(-1)?.drawings[0]).toMatchObject({ id: '__drawing-preview__', type: 'date-price-range' })
    expect(toolChanged).toHaveBeenLastCalledWith(null)
    expect(chartOrder).not.toHaveBeenCalled()
    expect(adapter.getDrawings()).toEqual([])

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 27, clientX: 70, clientY: 150 }))
    expect(drawingMocks.managers.at(-1)?.drawings).toEqual([])
  })

  it('dismisses a completed Measure and continues selecting another drawing on the same pointerdown', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    adapter.loadDrawings([{
      id: 'line-1', type: 'trend-line', anchors: [{ time: 10 as UTCTimestamp, price: 100 }, { time: 40 as UTCTimestamp, price: 125 }],
      style: { lineColor: '#2962ff', lineWidth: 2 }, options: {},
    }])
    adapter.setDrawingTool('date-price-range')
    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 28, clientX: 10, clientY: 100 }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 28, clientX: 50, clientY: 130 }))
    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 28, clientX: 50, clientY: 130 }))

    const manager = drawingMocks.managers.at(-1)
    const line = manager?.drawings.find((drawing) => drawing.id === 'line-1') ?? null
    expect(manager?.drawings.map((drawing) => drawing.id)).toEqual(['line-1', '__drawing-preview__'])
    if (manager) manager.hitDrawing = line

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 29, clientX: 20, clientY: 105 }))

    expect(manager?.drawings.map((drawing) => drawing.id)).toEqual(['line-1'])
    expect(manager?.selected?.id).toBe('line-1')
    expect(adapter.getDrawings()).toHaveLength(1)
  })

  it('copies, pastes, nudges, undoes and redoes the selected drawing', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    adapter.setHistory([
      { time: 0, open: 100, high: 103, low: 99, close: 101, volume: 10 },
      { time: 60, open: 101, high: 104, low: 100, close: 103, volume: 11 },
    ])
    const original: SerializedDrawing = {
      id: 'line-1', type: 'trend-line', anchors: [{ time: 0 as UTCTimestamp, price: 100 }, { time: 60 as UTCTimestamp, price: 105 }],
      style: { lineColor: '#2962ff', lineWidth: 2 }, options: {},
    }
    adapter.loadDrawings([original])
    drawingMocks.managers.at(-1)?.selectDrawing('line-1')

    const copied = adapter.copySelectedDrawing()
    expect(copied).toMatchObject(original)
    expect(adapter.nudgeSelectedDrawing('right')).toBe(true)
    expect(adapter.getDrawings()[0].anchors).toEqual([{ time: 60, price: 100 }, { time: 120, price: 105 }])
    expect(adapter.undoDrawing()).toBe(true)
    expect(adapter.getDrawings()[0].anchors).toEqual(original.anchors)
    expect(adapter.redoDrawing()).toBe(true)
    expect(adapter.getDrawings()[0].anchors).toEqual([{ time: 60, price: 100 }, { time: 120, price: 105 }])

    if (!copied) throw new Error('Expected a copied drawing')
    adapter.pasteDrawing(copied)
    expect(adapter.getDrawings()).toHaveLength(2)
    expect(adapter.getDrawings()[1].anchors).toEqual([{ time: 60, price: 100.25 }, { time: 120, price: 105.25 }])
  })

  it('removes whitespace-only Text on deselection but preserves authored Text', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    const textDrawing = (id: string, text: string): SerializedDrawing => ({
      id,
      type: 'text-annotation',
      anchors: [{ time: 0 as UTCTimestamp, price: 100 }],
      style: { lineColor: '#2962ff', lineWidth: 1, labelColor: '#2962ff' },
      options: { workbench: { ...DEFAULT_DRAWING_METADATA, text } },
    })

    adapter.loadDrawings([textDrawing('empty-text', '   ')])
    drawingMocks.managers.at(-1)?.selectDrawing('empty-text')
    adapter.deselectDrawing()
    expect(adapter.getDrawings()).toEqual([])

    adapter.loadDrawings([textDrawing('authored-text', 'Breakout')])
    drawingMocks.managers.at(-1)?.selectDrawing('authored-text')
    adapter.deselectDrawing()
    expect(adapter.getDrawings()).toHaveLength(1)
  })

  it('opens a focused inline editor on the first Text placement click', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 400 },
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')

    adapter.setDrawingTool('text-annotation')
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 120, clientY: 100 }))
    await Promise.resolve()

    const editor = container.querySelector<HTMLInputElement>('[aria-label="Inline text editor"]')
    expect(editor).not.toBeNull()
    expect(editor).toHaveValue('Add text')
    expect(document.activeElement).toBe(editor)
    expect([editor?.selectionStart, editor?.selectionEnd]).toEqual([0, 8])
    editor?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    expect(adapter.getDrawings()).toEqual([])

    adapter.setDrawingTool('text-annotation')
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 180, clientY: 140 }))
    await Promise.resolve()
    const authoredEditor = container.querySelector<HTMLInputElement>('[aria-label="Inline text editor"]')
    if (!authoredEditor) throw new Error('Expected the inline Text editor')
    authoredEditor.value = 'Breakout'
    authoredEditor.dispatchEvent(new InputEvent('input', { bubbles: true }))
    authoredEditor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))

    expect(container.querySelector('[aria-label="Inline text editor"]')).toBeNull()
    expect(adapter.getDrawings()).toHaveLength(1)
    expect(adapter.getDrawings()[0].options).toMatchObject({ text: 'Breakout', workbench: expect.objectContaining({ text: 'Breakout' }) })
    adapter.destroy()
    container.remove()
  })

  it('opens inline editors for two-point Note and one-point Comment placement', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 400 },
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')

    adapter.setDrawingTool('note')
    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 51, clientX: 80, clientY: 180 }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, buttons: 1, pointerId: 51, clientX: 220, clientY: 90 }))
    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 51, clientX: 220, clientY: 90 }))
    await Promise.resolve()
    const noteEditor = container.querySelector<HTMLInputElement>('[aria-label="Inline Note editor"]')
    expect(noteEditor).toHaveValue('Add text')
    if (!noteEditor) throw new Error('Expected Note editor')
    noteEditor.value = 'Plan entry'
    noteEditor.dispatchEvent(new InputEvent('input', { bubbles: true }))
    noteEditor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(adapter.getDrawings()[0]).toMatchObject({
      type: 'note',
      anchors: [{ time: 80, price: 180 }, { time: 220, price: 90 }],
      options: { text: 'Plan entry', workbench: expect.objectContaining({ text: 'Plan entry' }) },
    })

    adapter.setDrawingTool('comment')
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 320, clientY: 210 }))
    await Promise.resolve()
    expect(container.querySelector('[aria-label="Inline Comment editor"]')).toHaveValue('Add text')

    adapter.destroy()
    container.remove()
  })

  it('toggles Text between chart coordinates and a fixed pane anchor', async () => {
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 400 },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    adapter.loadDrawings([{
      id: 'text-anchor', type: 'text-annotation', anchors: [{ time: 120 as UTCTimestamp, price: 100 }],
      style: { lineColor: '#2962ff', lineWidth: 1, labelColor: '#2962ff' },
      options: { workbench: { ...DEFAULT_DRAWING_METADATA, text: 'Pinned' } },
    }])
    drawingMocks.managers.at(-1)?.selectDrawing('text-anchor')

    adapter.updateSelectedDrawing({ textAnchored: true })
    expect(adapter.getDrawings()[0].options).toMatchObject({
      screenAnchored: true,
      screenXRatio: 0.2,
      screenYRatio: 0.25,
      workbench: expect.objectContaining({ textAnchored: true, textAnchorX: 0.2, textAnchorY: 0.25 }),
    })

    adapter.updateSelectedDrawing({ textAnchored: false })
    expect(adapter.getDrawings()[0].options).toMatchObject({ screenAnchored: false })
  })

  it('supports TradingView chart pan, zoom, scale modes, snapshots and temporary drawing visibility', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    adapter.loadDrawings([{
      id: 'line-1', type: 'trend-line', anchors: [{ time: 0 as UTCTimestamp, price: 100 }, { time: 60 as UTCTimestamp, price: 105 }],
      style: { lineColor: '#2962ff', lineWidth: 2 }, options: {},
    }])
    chartMocks.setVisibleLogicalRange.mockClear()

    adapter.panView(1)
    expect(chartMocks.setVisibleLogicalRange).toHaveBeenLastCalledWith({ from: 11, to: 21 })
    adapter.zoomView(0.8)
    expect(chartMocks.setVisibleLogicalRange).toHaveBeenLastCalledWith({ from: 11, to: 19 })

    adapter.toggleInvertScale()
    expect(chartMocks.priceScaleState.invertScale).toBe(true)
    adapter.togglePriceScaleMode('logarithmic')
    expect(chartMocks.priceScaleState.mode).toBe(1)
    adapter.togglePriceScaleMode('logarithmic')
    expect(chartMocks.priceScaleState.mode).toBe(0)

    const drawing = drawingMocks.managers.at(-1)?.drawings[0]
    adapter.toggleDrawingsVisibility()
    expect(drawing?.detached).toBe(true)
    adapter.toggleDrawingsVisibility()
    expect(drawing?.detached).toBe(false)

    const toDataURL = vi.fn().mockReturnValue('data:image/png;base64,chart')
    chartMocks.takeScreenshot.mockReturnValue({ toDataURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    adapter.takeSnapshot()
    expect(toDataURL).toHaveBeenCalledWith('image/png')
    expect(click).toHaveBeenCalledOnce()
    click.mockRestore()
  })

  it('creates Path with every clicked point and finishes on double click', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')

    adapter.setDrawingTool('path')
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 10, clientY: 100 }))
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 20, clientY: 115 }))
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 35, clientY: 108 }))
    expect(adapter.getDrawings()).toEqual([])

    container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2, clientX: 35, clientY: 108 }))
    expect(adapter.getDrawings()).toHaveLength(1)
    expect(adapter.getDrawings()[0]).toMatchObject({
      type: 'path',
      anchors: [{ time: 10, price: 100 }, { time: 20, price: 115 }, { time: 35, price: 108 }],
    })
  })

  it('samples Brush points during pointer drag and keeps the tool armed when requested', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    const toolChanged = vi.fn()
    adapter.onDrawingToolChanged(toolChanged)
    adapter.setKeepDrawing(true)
    adapter.setDrawingTool('brush')

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 41, clientX: 10, clientY: 100 }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, buttons: 1, pointerId: 41, clientX: 18, clientY: 105 }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, buttons: 1, pointerId: 41, clientX: 28, clientY: 112 }))
    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 41, clientX: 28, clientY: 112 }))

    expect(adapter.getDrawings()[0]).toMatchObject({
      type: 'brush',
      anchors: [{ time: 10, price: 100 }, { time: 18, price: 105 }, { time: 28, price: 112 }],
    })
    expect(toolChanged).toHaveBeenLastCalledWith('brush')
  })

  it('locks every drawing and reports a count without including previews', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    adapter.loadDrawings([{
      id: 'line-1', type: 'trend-line', anchors: [{ time: 0 as UTCTimestamp, price: 100 }, { time: 60 as UTCTimestamp, price: 105 }],
      style: { lineColor: '#2962ff', lineWidth: 2 }, options: {},
    }])

    adapter.setAllDrawingsLocked(true)
    expect(adapter.drawingCount()).toBe(1)
    expect(adapter.getDrawings()[0].options).toMatchObject({ locked: true })
    adapter.setAllDrawingsLocked(false)
    expect(adapter.getDrawings()[0].options).toMatchObject({ locked: false })
  })

  it('toggles the selected drawing lock without clearing its selection', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    adapter.loadDrawings([
      {
        id: 'line-1', type: 'trend-line', anchors: [{ time: 0 as UTCTimestamp, price: 100 }, { time: 60 as UTCTimestamp, price: 105 }],
        style: { lineColor: '#2962ff', lineWidth: 2 }, options: {},
      },
      {
        id: 'line-2', type: 'trend-line', anchors: [{ time: 120 as UTCTimestamp, price: 110 }, { time: 180 as UTCTimestamp, price: 115 }],
        style: { lineColor: '#2962ff', lineWidth: 2 }, options: {},
      },
    ])
    drawingMocks.managers.at(-1)?.selectDrawing('line-1')

    adapter.lockSelectedDrawing()

    expect(adapter.getDrawings()[0].options).toMatchObject({ locked: true })
    expect(adapter.getDrawings()[1].options).not.toHaveProperty('locked')
    expect(drawingMocks.managers.at(-1)?.selected?.id).toBe('line-1')

    adapter.lockSelectedDrawing()

    expect(adapter.getDrawings()[0].options).toMatchObject({ locked: false })
    expect(drawingMocks.managers.at(-1)?.selected?.id).toBe('line-1')
  })

  it('absorbs pointer gestures on a locked drawing without deselecting or moving it', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    adapter.loadDrawings([{
      id: 'locked-line', type: 'trend-line', anchors: [{ time: 0 as UTCTimestamp, price: 100 }, { time: 60 as UTCTimestamp, price: 105 }],
      style: { lineColor: '#2962ff', lineWidth: 2 }, options: {},
    }])
    const manager = drawingMocks.managers.at(-1)
    manager?.selectDrawing('locked-line')
    manager!.hitDrawing = manager!.drawings[0]
    adapter.lockSelectedDrawing()
    const anchors = structuredClone(adapter.getDrawings()[0].anchors)

    const pointerDown = new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, pointerId: 71, clientX: 30, clientY: 100,
    })
    container.dispatchEvent(pointerDown)
    container.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, buttons: 1, pointerId: 71, clientX: 130, clientY: 40,
    }))
    container.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, pointerId: 71, clientX: 130, clientY: 40,
    }))

    expect(pointerDown.defaultPrevented).toBe(true)
    expect(manager?.getSelectedDrawing()?.id).toBe('locked-line')
    expect(adapter.getDrawings()[0].anchors).toEqual(anchors)
  })

  it('updates selected line coordinates and timeframe visibility from properties', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    adapter.setHistory([
      { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { time: 60, open: 100, high: 102, low: 99, close: 101, volume: 1 },
      { time: 120, open: 101, high: 103, low: 100, close: 102, volume: 1 },
    ])
    adapter.loadDrawings([{
      id: 'line-1', type: 'trend-line', anchors: [{ time: 0 as UTCTimestamp, price: 100 }, { time: 60 as UTCTimestamp, price: 105 }],
      style: { lineColor: '#2962ff', lineWidth: 2 }, options: {},
    }])
    drawingMocks.managers.at(-1)?.selectDrawing('line-1')

    adapter.updateSelectedDrawing({
      coordinates: [{ price: 101.25, bar: 1 }, { price: 106.5, bar: 2 }],
      visibility: {
        ...DEFAULT_DRAWING_METADATA.visibility,
        minutes: { enabled: false, min: 1, max: 59 },
      },
    })

    expect(adapter.getDrawings()[0].anchors).toEqual([{ time: 60, price: 101.25 }, { time: 120, price: 106.5 }])
    expect(adapter.getDrawings()[0].options).toMatchObject({ visible: false })

    adapter.updateSelectedDrawing({
      visibility: DEFAULT_DRAWING_METADATA.visibility,
    })
    expect(adapter.getDrawings()[0].options).toMatchObject({ visible: true })
  })

  it('preserves hidden and locked drawing controls configured before initialization', async () => {
    const adapter = new LwcAdapter()
    adapter.setAllDrawingsLocked(true)
    adapter.setDrawingsHidden(true)

    await adapter.init(document.createElement('div'), symbol, '1m')
    adapter.loadDrawings([{
      id: 'line-1', type: 'trend-line', anchors: [{ time: 0 as UTCTimestamp, price: 100 }, { time: 60 as UTCTimestamp, price: 105 }],
      style: { lineColor: '#2962ff', lineWidth: 2 }, options: {},
    }])

    const drawing = drawingMocks.managers.at(-1)?.drawings[0]
    expect(drawing?.options).toMatchObject({ locked: true })
    expect(drawing?.detached).toBe(true)
  })

  it('preserves keep drawing configured before initialization', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    adapter.setKeepDrawing(true)

    await adapter.init(container, symbol, '1m')
    adapter.setDrawingTool('trend-line')
    for (const [clientX, clientY] of [[10, 100], [20, 110], [30, 120], [40, 130]]) {
      container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }))
    }

    expect(adapter.getDrawings()).toHaveLength(2)
  })

  it('zooms to a dragged chart rectangle and restores the original viewport', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    const zoomChanged = vi.fn()
    adapter.onAreaZoomChanged(zoomChanged)
    chartMocks.setVisibleLogicalRange.mockClear()
    chartMocks.priceScaleSetVisibleRange.mockClear()

    adapter.beginAreaZoom()
    expect(container).toHaveClass('chart-area-zoom-active')
    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 42, clientX: 100, clientY: 80 }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, buttons: 1, pointerId: 42, clientX: 300, clientY: 220 }))
    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 42, clientX: 300, clientY: 220 }))

    expect(chartMocks.setVisibleLogicalRange).toHaveBeenLastCalledWith({ from: 100, to: 300 })
    expect(chartMocks.priceScaleSetVisibleRange).toHaveBeenLastCalledWith({ from: 80, to: 220 })
    expect(adapter.areaZoomState()).toEqual({ selecting: false, zoomed: true })
    expect(zoomChanged).toHaveBeenLastCalledWith({ selecting: false, zoomed: true })

    adapter.resetAreaZoom()
    expect(chartMocks.setVisibleLogicalRange).toHaveBeenLastCalledWith({ from: 10, to: 20 })
    expect(chartMocks.priceScaleSetVisibleRange).toHaveBeenLastCalledWith({ from: 90, to: 110 })
    expect(adapter.areaZoomState()).toEqual({ selecting: false, zoomed: false })
  })

  it('shows a labelled zoom range while the pointer is dragging', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')

    adapter.beginAreaZoom()
    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 52, clientX: 100, clientY: 80 }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, buttons: 1, pointerId: 52, clientX: 300, clientY: 220 }))

    const range = container.querySelector<HTMLElement>('.chart-area-zoom-selection')
    expect(range).not.toBeNull()
    expect(range?.dataset.label).toBe('Zoom range')
    expect(range?.style.left).toBe('0px')
    expect(range?.style.top).toBe('0px')
    expect(range?.style.width).toBe('200px')
    expect(range?.style.height).toBe('140px')

    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 52, clientX: 300, clientY: 220 }))
    expect(container.querySelector('.chart-area-zoom-selection')).toBeNull()
    expect(container).not.toHaveClass('chart-area-zoom-active')
  })

  it('zooms to the centered chart region when Enter is pressed', async () => {
    const container = document.createElement('div')
    container.tabIndex = 0
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    document.body.append(container)
    const focus = vi.spyOn(container, 'focus')
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    const zoomChanged = vi.fn()
    adapter.onAreaZoomChanged(zoomChanged)
    chartMocks.setVisibleLogicalRange.mockClear()
    chartMocks.priceScaleSetVisibleRange.mockClear()

    adapter.beginAreaZoom()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(chartMocks.setVisibleLogicalRange).toHaveBeenLastCalledWith({ from: 150, to: 450 })
    expect(chartMocks.priceScaleSetVisibleRange).toHaveBeenLastCalledWith({ from: 100, to: 300 })
    expect(adapter.areaZoomState()).toEqual({ selecting: false, zoomed: true })
    expect(zoomChanged).toHaveBeenLastCalledWith({ selecting: false, zoomed: true })
    container.remove()
  })

  it('publishes a moved drawing during drag so sibling timeframes update before pointerup', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    Object.defineProperties(container, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn().mockReturnValue(true) },
      releasePointerCapture: { value: vi.fn() },
    })
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextFrameId
      nextFrameId += 1
      frames.set(id, callback)
      return id
    })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    adapter.setHistory([
      { time: 0, open: 100, high: 103, low: 99, close: 101, volume: 10 },
      { time: 60, open: 101, high: 104, low: 100, close: 103, volume: 11 },
    ])
    adapter.loadDrawings([{
      id: 'shared-line', type: 'trend-line',
      anchors: [{ time: 0, price: 100 }, { time: 60, price: 105 }],
      style: { lineColor: '#2962ff', lineWidth: 2 }, options: {},
    } as SerializedDrawing])
    const manager = drawingMocks.managers.at(-1)
    expect(manager?.drawings[0]).toBeDefined()
    manager!.hitDrawing = manager!.drawings[0]
    const changed = vi.fn()
    const viewportChanged = vi.fn()
    adapter.onDrawingsChanged(changed)
    adapter.onViewportSync(viewportChanged)
    chartMocks.priceScaleSetAutoScale.mockClear()
    chartMocks.priceScaleSetVisibleRange.mockClear()

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 17, clientX: 10, clientY: 100 }))
    expect(chartMocks.priceScaleSetAutoScale).toHaveBeenLastCalledWith(false)
    expect(chartMocks.priceScaleSetVisibleRange).toHaveBeenLastCalledWith({ from: 90, to: 110 })

    // Emulate the chart attempting to expand the scale as the pointer reaches
    // the pane edge. Drawing drag must restore the captured range every frame.
    chartMocks.priceScaleState.autoScale = true
    chartMocks.priceScaleState.range = { from: 95, to: 135 }
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 17, clientX: 70, clientY: 101.25 }))
    expect(changed).not.toHaveBeenCalled()
    expect(chartMocks.priceScaleState.autoScale).toBe(false)
    expect(chartMocks.priceScaleState.range).toEqual({ from: 90, to: 110 })

    for (const [id, frame] of [...frames]) {
      frames.delete(id)
      frame(16)
    }
    expect(changed).toHaveBeenCalledWith('shared-line')
    expect(viewportChanged).not.toHaveBeenCalled()
    expect(adapter.getDrawings()[0].anchors).toEqual([
      { time: 60, price: 101.25 },
      { time: 120, price: 106.25 },
    ])

    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 17, clientX: 70, clientY: 101.25 }))
    expect(chartMocks.priceScaleSetAutoScale).toHaveBeenLastCalledWith(true)

    requestFrame.mockRestore()
    cancelFrame.mockRestore()
  })

  it('deselects a drawing on pointerdown outside and gives that same gesture back to the chart', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    adapter.loadDrawings([{
      id: 'selected-rectangle', type: 'rectangle',
      anchors: [{ time: 20, price: 20 }, { time: 180, price: 180 }],
      style: { lineColor: '#2962ff', lineWidth: 2 }, options: {},
    } as SerializedDrawing])
    const manager = drawingMocks.managers.at(-1)
    manager?.selectDrawing('selected-rectangle')
    chartMocks.chartApplyOptions.mockClear()

    const pointerDown = new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, pointerId: 18, clientX: 500, clientY: 300,
    })
    container.dispatchEvent(pointerDown)

    expect(manager?.getSelectedDrawing()).toBeNull()
    expect(pointerDown.defaultPrevented).toBe(false)
    expect(chartMocks.chartApplyOptions).toHaveBeenLastCalledWith({ handleScroll: true, handleScale: true })
  })

  it('removes preview without persistence when the tool is cancelled', async () => {
    const container = document.createElement('div')
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    const changed = vi.fn()
    adapter.onDrawingsChanged(changed)
    adapter.setDrawingTool('trend-line')
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 100 }))
    adapter.setDrawingTool(null)
    expect(adapter.getDrawings()).toEqual([])
    expect(changed).not.toHaveBeenCalled()
  })

  it('does not open Fibonacci properties when placement completes', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    const editRequested = vi.fn()
    adapter.onDrawingEditRequest(editRequested)

    adapter.setDrawingTool('fib-retracement')
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 100 }))
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 110 }))

    expect(editRequested).not.toHaveBeenCalled()
  })

  it('removes the volume pane and its separator when volume is hidden', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    const createdSeries = chartMocks.addSeries.mock.calls.length
    const hiddenAppearance = {
      upColor: '#111111', downColor: '#222222', wickUpColor: '#333333', wickDownColor: '#444444',
      borderUpColor: '#555555', borderDownColor: '#666666', borderVisible: true,
      backgroundColor: '#777777', textColor: '#aaaaaa', showGrid: false, verticalGridColor: '#888888', horizontalGridColor: '#999999', showVolume: false,
    } as const
    adapter.applyAppearance(hiddenAppearance)
    expect(chartMocks.candleApplyOptions).toHaveBeenLastCalledWith(expect.objectContaining({ upColor: '#111111', borderVisible: true }))
    expect(chartMocks.chartApplyOptions).toHaveBeenLastCalledWith(expect.objectContaining({ grid: expect.any(Object), layout: expect.objectContaining({ textColor: '#aaaaaa' }) }))
    expect(chartMocks.volumeApplyOptions).toHaveBeenLastCalledWith({ visible: false })
    expect(chartMocks.removeSeries).toHaveBeenCalledOnce()
    expect(chartMocks.paneCount).toBe(1)
    expect(chartMocks.addSeries).toHaveBeenCalledTimes(createdSeries)

    adapter.setHistory([{ time: 60, open: 100, high: 103, low: 99, close: 101, volume: 10 }])
    adapter.applyAppearance({ ...hiddenAppearance, showVolume: true })

    expect(chartMocks.paneCount).toBe(2)
    expect(chartMocks.addSeries).toHaveBeenCalledTimes(createdSeries + 1)
    expect(chartMocks.volumeSetData).toHaveBeenLastCalledWith([{ time: 60, value: 10, color: '#08998166' }])
    expect(chartMocks.paneSetHeight).toHaveBeenLastCalledWith(100)
  })

  it('centers the visible chart window on the nearest saved trade time', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    adapter.setHistory([
      { time: 60, open: 100, high: 103, low: 99, close: 101, volume: 10 },
      { time: 120, open: 101, high: 104, low: 100, close: 102, volume: 10 },
      { time: 180, open: 102, high: 105, low: 101, close: 103, volume: 10 },
    ])
    chartMocks.setVisibleLogicalRange.mockClear()

    adapter.focusTime(170)

    expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledOnce()
    const range = chartMocks.setVisibleLogicalRange.mock.calls[0]?.[0]
    expect(range?.from).toBeLessThan(2)
    expect(range?.to).toBeGreaterThan(2)
  })

  it('pushes a replay-frame batch incrementally instead of resetting full history', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    adapter.setHistory([{ time: 60, open: 100, high: 103, low: 99, close: 101, volume: 10 }])
    chartMocks.candleSetData.mockClear()
    chartMocks.volumeSetData.mockClear()
    chartMocks.candleUpdate.mockClear()
    chartMocks.volumeUpdate.mockClear()

    adapter.pushBars([
      { time: 120, open: 101, high: 104, low: 100, close: 103, volume: 11 },
      { time: 180, open: 103, high: 105, low: 102, close: 104, volume: 12 },
    ])

    expect(chartMocks.candleUpdate).toHaveBeenCalledTimes(2)
    expect(chartMocks.volumeUpdate).toHaveBeenCalledTimes(2)
    expect(chartMocks.candleSetData).not.toHaveBeenCalled()
    expect(chartMocks.volumeSetData).not.toHaveBeenCalled()
  })

  it('keeps the current zoom span while following every appended replay candle', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    adapter.setHistory([{ time: 60, open: 100, high: 103, low: 99, close: 101, volume: 10 }])
    chartMocks.setVisibleLogicalRange.mockClear()

    adapter.pushBars([{ time: 120, open: 101, high: 104, low: 100, close: 103, volume: 11 }])

    expect(chartMocks.setVisibleLogicalRange).toHaveBeenLastCalledWith({ from: -7, to: 3 })
  })

  // Regression: restoring a saved multi-pane layout created every pane's
  // chart before any of them had data, so the first pane to publish its
  // viewport drove setVisibleRange into an empty time scale. Lightweight
  // Charts asserts there ("Value is null"), the throw unwound through
  // loadSymbol, and every pane rendered "Data could not be loaded".
  it('ignores viewport and crosshair sync until the pane has data', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    chartMocks.setVisibleRange.mockClear()
    chartMocks.setCrosshairPosition.mockClear()

    adapter.setViewportSync({ time: { from: 60, to: 600 } })
    adapter.setCrosshairSync({ time: 120, price: 100 })
    expect(chartMocks.setVisibleLogicalRange).not.toHaveBeenCalled()
    expect(chartMocks.setCrosshairPosition).not.toHaveBeenCalled()

    adapter.setHistory([{ time: 60, open: 100, high: 103, low: 99, close: 101, volume: 10 }])
    chartMocks.setVisibleLogicalRange.mockClear()
    adapter.setViewportSync({ time: { from: 60, to: 600 } })
    adapter.setCrosshairSync({ time: 120, price: 100 })
    expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledOnce()
    expect(chartMocks.setCrosshairPosition).toHaveBeenCalledOnce()
  })

  it('replaces the series once for a large replay batch instead of updating per bar', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    adapter.setHistory([{ time: 60, open: 100, high: 103, low: 99, close: 101, volume: 10 }])
    chartMocks.candleSetData.mockClear()
    chartMocks.volumeSetData.mockClear()
    chartMocks.candleUpdate.mockClear()
    chartMocks.volumeUpdate.mockClear()
    chartMocks.setVisibleLogicalRange.mockClear()

    // A batch this size only happens at high replay speed with several
    // panes, where per-bar update() calls dominated the frame budget.
    const batch = Array.from({ length: 40 }, (_, index) => ({
      time: 120 + index * 60, open: 101, high: 104, low: 100, close: 103, volume: 11,
    }))
    adapter.pushBars(batch)

    expect(chartMocks.candleUpdate).not.toHaveBeenCalled()
    expect(chartMocks.volumeUpdate).not.toHaveBeenCalled()
    expect(chartMocks.candleSetData).toHaveBeenCalledTimes(1)
    expect(chartMocks.volumeSetData).toHaveBeenCalledTimes(1)

    // The whole history, not just the batch — a partial setData would erase
    // everything before it.
    const written = chartMocks.candleSetData.mock.calls[0][0] as Array<{ time: number }>
    expect(written).toHaveLength(41)
    expect(written[0].time).toBe(60)
    expect(written.at(-1)?.time).toBe(batch.at(-1)?.time)

    // The current candle is restored into view without changing the
    // ten-bar zoom span, even when the previous range was pure whitespace.
    expect(chartMocks.setVisibleLogicalRange).toHaveBeenLastCalledWith({ from: 32, to: 42 })
  })

  it('preserves a manually fixed price range while replay bars are appended', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    adapter.setHistory([{ time: 60, open: 100, high: 103, low: 99, close: 101, volume: 10 }])
    chartMocks.priceScaleState.autoScale = false
    chartMocks.priceScaleState.range = { from: 80, to: 120 }
    chartMocks.priceScaleSetAutoScale.mockClear()
    chartMocks.priceScaleSetVisibleRange.mockClear()
    chartMocks.candleUpdate.mockImplementationOnce(() => {
      chartMocks.priceScaleState.autoScale = true
      chartMocks.priceScaleState.range = { from: 95, to: 135 }
    })

    adapter.pushBars([
      { time: 120, open: 101, high: 124, low: 100, close: 123, volume: 11 },
      { time: 180, open: 123, high: 130, low: 122, close: 129, volume: 12 },
    ])

    expect(chartMocks.priceScaleSetAutoScale).toHaveBeenLastCalledWith(false)
    expect(chartMocks.priceScaleSetVisibleRange).toHaveBeenLastCalledWith({ from: 80, to: 120 })
  })

  it('selects the nearest replay bar with pointer and keyboard input', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    adapter.setHistory([
      { time: 60, open: 100, high: 103, low: 99, close: 101, volume: 10 },
      { time: 120, open: 101, high: 104, low: 100, close: 103, volume: 11 },
    ])
    const selected = vi.fn()
    adapter.onReplayBarSelect(selected)
    adapter.setReplaySelection({ mode: 'selecting' })

    expect(container).toHaveAttribute('tabindex', '0')
    expect(container.style.cursor).toBe('crosshair')
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 112, clientY: 100 }))
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 112, clientY: 100 }))
    expect(selected).toHaveBeenLastCalledWith(120)

    container.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }))
    container.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    expect(selected).toHaveBeenLastCalledWith(60)
  })

  it('resets to a standard candle density instead of fitting the entire history', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    chartMocks.setVisibleLogicalRange.mockClear()
    chartMocks.fitContent.mockClear()

    adapter.setHistory(Array.from({ length: 300 }, (_, index) => ({ time: index * 60, open: 100, high: 102, low: 99, close: 101, volume: 10 })), { resetView: true })

    expect(chartMocks.timeScaleApplyOptions).toHaveBeenLastCalledWith(expect.objectContaining({ barSpacing: 7, rightOffset: 12 }))
    expect(chartMocks.priceScaleApplyOptions).toHaveBeenLastCalledWith({ autoScale: true })
    const range = chartMocks.setVisibleLogicalRange.mock.calls.at(-1)?.[0] as { from: number; to: number }
    expect(range.to - range.from + 1).toBeGreaterThanOrEqual(60)
    expect(range.to - range.from + 1).toBeLessThanOrEqual(160)
    expect(chartMocks.fitContent).not.toHaveBeenCalled()
  })

  it('requests an older page once near the left edge and preserves viewport after prepend', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000)
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    const demand = vi.fn()
    adapter.onViewportDemand(demand)
    adapter.setHistory([
      { time: 120, open: 1, high: 2, low: 0, close: 1, volume: 1 },
      { time: 180, open: 1, high: 2, low: 0, close: 1, volume: 1 },
    ])
    await Promise.resolve()
    now.mockReturnValue(1_800)
    chartMocks.logicalRangeHandler?.({ from: -10, to: 1 })
    chartMocks.logicalRangeHandler?.({ from: -11, to: 1 })
    expect(demand).toHaveBeenCalledTimes(1)
    expect(demand).toHaveBeenCalledWith({ direction: 'before', anchorTs: 120 })

    adapter.setHistory([
      { time: 60, open: 1, high: 2, low: 0, close: 1, volume: 1 },
      { time: 120, open: 1, high: 2, low: 0, close: 1, volume: 1 },
      { time: 180, open: 1, high: 2, low: 0, close: 1, volume: 1 },
    ], { preserveViewport: true })
    expect(chartMocks.setVisibleLogicalRange).toHaveBeenLastCalledWith({ from: 11, to: 21 })
    now.mockRestore()
  })

  it('does not let a timeframe reset throttle the first real pan at the history edge', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100)
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '15m')
    const demand = vi.fn()
    adapter.onViewportDemand(demand)
    chartMocks.setVisibleLogicalRange.mockImplementationOnce((range: { from: number; to: number }) => {
      chartMocks.logicalRangeHandler?.(range)
    })

    adapter.setHistory([
      { time: 120, open: 1, high: 2, low: 0, close: 1, volume: 1 },
      { time: 180, open: 1, high: 2, low: 0, close: 1, volume: 1 },
    ], { resetView: true })
    await Promise.resolve()
    expect(demand).not.toHaveBeenCalled()

    now.mockReturnValue(500)
    chartMocks.logicalRangeHandler?.({ from: -10, to: 1 })
    expect(demand).toHaveBeenCalledOnce()
    expect(demand).toHaveBeenCalledWith({ direction: 'before', anchorTs: 120 })
    now.mockRestore()
  })

  it('projects canonical drawing anchors to the current display bars', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '5m')
    adapter.setHistory([
      { time: 300, open: 1, high: 2, low: 0, close: 1, volume: 1 },
      { time: 600, open: 1, high: 2, low: 0, close: 1, volume: 1 },
    ])
    adapter.loadDrawings([{ id: 'line', type: 'trend-line', anchors: [{ time: 359, price: 10 }], style: {}, options: {} } as SerializedDrawing])
    expect(adapter.getDrawings()[0].anchors[0]).toEqual({ time: 300, price: 10 })
  })

  it('emits the hovered candle and falls back on whitespace', async () => {
    let frame: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1 })
    const { HoverBarStore } = await import('./hover-bar-store')
    const store = new HoverBarStore()
    const adapter = new LwcAdapter(store)
    await adapter.init(document.createElement('div'), symbol, '1m')
    adapter.setHistory([{ time: 60, open: 100, high: 103, low: 99, close: 101, volume: 10 }])
    const handler = chartMocks.crosshairHandler
    expect(handler).not.toBeNull()
    handler?.({ time: 60, seriesData: new Map([[chartMocks.candles ?? {}, { open: 100, high: 104, low: 98, close: 103 }]]) })
    if (frame) (frame as FrameRequestCallback)(0)
    expect(store.getSnapshot()).toMatchObject({ time: 60, high: 104, hovered: true })

    handler?.({ seriesData: new Map() })
    if (frame) (frame as FrameRequestCallback)(1)
    expect(store.getSnapshot()).toMatchObject({ time: 60, close: 101, hovered: false })
  })

  it('publishes and applies canonical crosshair and viewport synchronization', async () => {
    const container = document.createElement('div')
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    // A pane only accepts incoming sync once it has data — see the
    // empty-pane guard test above.
    adapter.setHistory([
      { time: 60, open: 100, high: 103, low: 99, close: 101, volume: 10 },
      { time: 120, open: 101, high: 104, low: 100, close: 103, volume: 11 },
    ])
    await Promise.resolve()
    const crosshair = vi.fn()
    const viewport = vi.fn()
    adapter.onCrosshairSync(crosshair)
    adapter.onViewportSync(viewport)

    // Only a real input gesture may originate viewport synchronization.
    container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 }))

    chartMocks.crosshairHandler?.({
      time: 60,
      point: { x: 20, y: 101.25 },
      seriesData: new Map([[chartMocks.candles ?? {}, { open: 100, high: 103, low: 99, close: 101 }]]),
    })
    chartMocks.timeRangeHandler?.({ from: 60, to: 3_660 })

    expect(crosshair).toHaveBeenLastCalledWith({ time: 60, price: 101.25 })
    expect(viewport).toHaveBeenLastCalledWith({
      time: { from: 60, to: 3_660 },
      logicalSpan: 10,
    })

    adapter.setCrosshairSync({ time: 120, price: 102.5 })
    adapter.setViewportSync({ time: { from: 120, to: 7_320 } })
    expect(chartMocks.setCrosshairPosition).toHaveBeenCalledWith(102.5, 120, chartMocks.candles)
    expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalled()
    expect(chartMocks.priceScaleSetAutoScale).not.toHaveBeenCalled()
    expect(chartMocks.priceScaleSetVisibleRange).not.toHaveBeenCalled()

    adapter.setCrosshairSync(null)
    expect(chartMocks.clearCrosshairPosition).toHaveBeenCalledOnce()
  })

  it('does not echo an asynchronously reported programmatic viewport to the source pane', async () => {
    const container = document.createElement('div')
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    adapter.setHistory([
      { time: 60, open: 100, high: 103, low: 99, close: 101, volume: 10 },
      { time: 120, open: 101, high: 104, low: 100, close: 103, volume: 11 },
    ])
    await Promise.resolve()
    const viewport = vi.fn()
    adapter.onViewportSync(viewport)

    adapter.setViewportSync({ time: { from: 120, to: 7_320 } })
    // Lightweight Charts may report the clamped range after the adapter's
    // microtask guard has cleared. Echoing it creates a feedback loop between
    // panes with different timeframes and pins the source pane at an edge.
    await Promise.resolve()
    chartMocks.timeRangeHandler?.({ from: 60, to: 3_660 })

    expect(viewport).not.toHaveBeenCalled()

    container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 }))
    chartMocks.timeRangeHandler?.({ from: 120, to: 7_320 })
    expect(viewport).toHaveBeenLastCalledWith({ time: { from: 120, to: 7_320 }, logicalSpan: 10 })
  })

  it('does not echo a resize-triggered range change as a viewport-sync event', async () => {
    // Resizing this pane's own width makes Lightweight Charts fire the same
    // visible-range callback a real pan/zoom would (more/fewer bars fit at a
    // fixed barSpacing). Left unguarded, that used to echo out as a viewport
    // sync and fight a sibling pane resizing at the same time.
    const resizeRef: { current: (() => void) | null } = { current: null }
    class CapturingResizeObserver { constructor(callback: () => void) { resizeRef.current = callback }; observe(): void {}; disconnect(): void {} }
    vi.stubGlobal('ResizeObserver', CapturingResizeObserver)
    try {
      const container = document.createElement('div')
      Object.defineProperties(container, {
        clientWidth: { configurable: true, value: 600 },
        clientHeight: { configurable: true, value: 400 },
      })
      const adapter = new LwcAdapter()
      await adapter.init(container, symbol, '1m')
      adapter.setHistory([
        { time: 60, open: 100, high: 103, low: 99, close: 101, volume: 10 },
        { time: 120, open: 101, high: 104, low: 100, close: 103, volume: 11 },
      ])
      await Promise.resolve()
      const viewport = vi.fn()
      adapter.onViewportSync(viewport)

      // A real gesture on this pane unlocks sync, reproducing the state a
      // pane is normally in once the user has already interacted with it.
      container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 }))

      // Widening the container is what makes the resize observer actually
      // call chart.resize() below — syncContainerSize() no-ops when nothing
      // measured has changed since the last call.
      Object.defineProperty(container, 'clientWidth', { configurable: true, value: 900 })
      resizeRef.current?.()
      chartMocks.timeRangeHandler?.({ from: 60, to: 3_660 })

      expect(viewport).not.toHaveBeenCalled()
    } finally {
      vi.stubGlobal('ResizeObserver', class { observe(): void {}; disconnect(): void {} })
    }
  })

  it('repaints synchronously when its container resizes', async () => {
    const resizeRef: { current: (() => void) | null } = { current: null }
    class CapturingResizeObserver { constructor(callback: () => void) { resizeRef.current = callback }; observe(): void {}; disconnect(): void {} }
    vi.stubGlobal('ResizeObserver', CapturingResizeObserver)
    try {
      const container = document.createElement('div')
      Object.defineProperties(container, {
        clientWidth: { configurable: true, value: 640 },
        clientHeight: { configurable: true, value: 480 },
      })
      const adapter = new LwcAdapter()
      await adapter.init(container, symbol, '1m')

      resizeRef.current?.()

      expect(chartMocks.chartResize).toHaveBeenCalledWith(640, 480, true)
    } finally {
      vi.stubGlobal('ResizeObserver', class { observe(): void {}; disconnect(): void {} })
    }
  })

  it('re-centers a sibling on source center-time while preserving the sibling logical span and price scale', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    adapter.setHistory([
      { time: 60, open: 100, high: 103, low: 99, close: 101, volume: 10 },
      { time: 120, open: 101, high: 104, low: 100, close: 103, volume: 11 },
    ])
    chartMocks.setVisibleLogicalRange.mockClear()
    chartMocks.setVisibleRange.mockClear()
    chartMocks.priceScaleSetAutoScale.mockClear()
    chartMocks.priceScaleSetVisibleRange.mockClear()

    adapter.setViewportSync({ time: { from: 120, to: 7_320 } })

    expect(chartMocks.setVisibleRange).not.toHaveBeenCalled()
    expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledOnce()
    const applied = chartMocks.setVisibleLogicalRange.mock.calls[0]?.[0]
    expect(applied).toEqual({ from: 3_715, to: 3_725 })
    expect((applied?.to ?? 0) - (applied?.from ?? 0)).toBe(10)
    expect(chartMocks.priceScaleSetAutoScale).not.toHaveBeenCalled()
    expect(chartMocks.priceScaleSetVisibleRange).not.toHaveBeenCalled()
  })

  it('uses the source logical span when lock zoom is requested without changing the price scale', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    adapter.setHistory([
      { time: 60, open: 100, high: 103, low: 99, close: 101, volume: 10 },
      { time: 120, open: 101, high: 104, low: 100, close: 103, volume: 11 },
    ])
    chartMocks.setVisibleLogicalRange.mockClear()
    chartMocks.priceScaleSetAutoScale.mockClear()
    chartMocks.priceScaleSetVisibleRange.mockClear()

    adapter.setViewportSync({ time: { from: 120, to: 7_320 }, logicalSpan: 40 })

    expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 3_700, to: 3_740 })
    expect(chartMocks.priceScaleSetAutoScale).not.toHaveBeenCalled()
    expect(chartMocks.priceScaleSetVisibleRange).not.toHaveBeenCalled()
  })
})
