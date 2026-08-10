import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LwcAdapter } from './lwc-adapter'
import type { SymbolMeta } from '../api/types'
import type { SerializedDrawing } from 'lightweight-charts-drawing'
import type { OrderLine } from './chart-adapter'

interface FakeAnchor { time: number; price: number }
interface FakeDrawing {
  id: string
  type: string
  anchors: FakeAnchor[]
  style: Record<string, unknown>
  options: Record<string, unknown>
  state: string
  setAnchors(anchors: FakeAnchor[]): void
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
    clearAll(): void { this.drawings = []; this.emit('drawing:cleared', {}) }
    importDrawings(drawings: Array<{ id: string; type: string; anchors: FakeAnchor[]; style: Record<string, unknown>; options: Record<string, unknown> }>, factory: (type: string, data: { id: string; anchors: FakeAnchor[]; style: Record<string, unknown>; options: Record<string, unknown> }) => FakeDrawing): void {
      this.drawings = drawings.map((drawing) => factory(drawing.type, drawing))
    }
    addDrawing(drawing: FakeDrawing): void { this.drawings.push(drawing); this.emit('drawing:added', { drawingId: drawing.id, drawing }) }
    removeDrawing(id: string): void { this.drawings = this.drawings.filter((drawing) => drawing.id !== id); this.emit('drawing:removed', { drawingId: id }) }
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
      id, type, anchors, style, options, state: 'normal',
      setAnchors(next): void { this.anchors = next },
      toJSON(): Record<string, unknown> { return { id: this.id, type: this.type, anchors: this.anchors, style: this.style, options: this.options } },
    }
  }

  return { managers, FakeDrawingManager, createDrawing }
})

const chartMocks = vi.hoisted(() => {
  const priceScaleState = { autoScale: true, range: { from: 90, to: 110 } }
  return {
  chartApplyOptions: vi.fn(),
  candleApplyOptions: vi.fn(),
  volumeApplyOptions: vi.fn(),
  paneSetHeight: vi.fn(),
  addSeries: vi.fn(),
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
  priceScaleApplyOptions: vi.fn((options: { autoScale?: boolean }) => {
    if (typeof options.autoScale === 'boolean') priceScaleState.autoScale = options.autoScale
  }),
  priceScaleSetAutoScale: vi.fn((enabled: boolean) => { priceScaleState.autoScale = enabled }),
  priceScaleSetVisibleRange: vi.fn((range: { from: number; to: number }) => { priceScaleState.range = range }),
  setCrosshairPosition: vi.fn(),
  clearCrosshairPosition: vi.fn(),
  fitContent: vi.fn(),
  }
})

vi.mock('lightweight-charts-drawing', () => ({
  DrawingManager: drawingMocks.FakeDrawingManager,
  getToolRegistry: () => ({
    get: (type: string) => ({ type, name: type, category: 'line', requiredAnchors: 2 }),
    getAll: () => [{ type: 'trend-line', name: 'Trend Line', category: 'line', requiredAnchors: 2 }],
    createDrawing: drawingMocks.createDrawing,
  }),
}))

vi.mock('lightweight-charts', () => {
  const timeScale = {
    coordinateToTime: (x: number) => Math.round(x),
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
    getPane: () => pane,
    priceScale: () => ({
      applyOptions: chartMocks.priceScaleApplyOptions,
      getVisibleRange: () => chartMocks.priceScaleState.range,
      options: () => ({ autoScale: chartMocks.priceScaleState.autoScale }),
      setAutoScale: chartMocks.priceScaleSetAutoScale,
      setVisibleRange: chartMocks.priceScaleSetVisibleRange,
    }),
  }
  const candles = { ...baseSeries, setData: chartMocks.candleSetData, update: chartMocks.candleUpdate, applyOptions: chartMocks.candleApplyOptions }
  const volume = { ...baseSeries, setData: chartMocks.volumeSetData, update: chartMocks.volumeUpdate, applyOptions: chartMocks.volumeApplyOptions }
  const spacer = { ...baseSeries, applyOptions: vi.fn() }
  chartMocks.addSeries.mockImplementation((kind: string) => kind === 'CandlestickSeries' ? candles : kind === 'HistogramSeries' ? volume : spacer)
  chartMocks.candles = candles
  const chart = {
    addSeries: chartMocks.addSeries,
    timeScale: () => timeScale,
    applyOptions: chartMocks.chartApplyOptions, remove: vi.fn(),
    subscribeCrosshairMove: vi.fn((handler: typeof chartMocks.crosshairHandler) => { chartMocks.crosshairHandler = handler }),
    unsubscribeCrosshairMove: vi.fn(),
    setCrosshairPosition: chartMocks.setCrosshairPosition,
    clearCrosshairPosition: chartMocks.clearCrosshairPosition,
  }
  return {
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries', LineSeries: 'LineSeries',
    ColorType: { Solid: 'solid' }, CrosshairMode: { Normal: 0 },
    createChart: () => chart,
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

    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 17, clientX: 10, clientY: 100 }))
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 17, clientX: 70, clientY: 101.25 }))
    expect(changed).not.toHaveBeenCalled()

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

  it('opens Fibonacci properties when placement completes', async () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) })
    const adapter = new LwcAdapter()
    await adapter.init(container, symbol, '1m')
    const editRequested = vi.fn()
    adapter.onDrawingEditRequest(editRequested)

    adapter.setDrawingTool('fib-retracement')
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 100 }))
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 110 }))

    expect(editRequested).toHaveBeenCalledWith(expect.objectContaining({ type: 'fib-retracement', fibonacciLevels: expect.any(Array) }))
  })

  it('maps appearance settings and collapses volume without creating another series', async () => {
    const adapter = new LwcAdapter()
    await adapter.init(document.createElement('div'), symbol, '1m')
    const createdSeries = chartMocks.addSeries.mock.calls.length
    adapter.applyAppearance({
      upColor: '#111111', downColor: '#222222', wickUpColor: '#333333', wickDownColor: '#444444',
      borderUpColor: '#555555', borderDownColor: '#666666', borderVisible: true,
      backgroundColor: '#777777', textColor: '#aaaaaa', showGrid: false, verticalGridColor: '#888888', horizontalGridColor: '#999999', showVolume: false,
    })
    expect(chartMocks.candleApplyOptions).toHaveBeenLastCalledWith(expect.objectContaining({ upColor: '#111111', borderVisible: true }))
    expect(chartMocks.chartApplyOptions).toHaveBeenLastCalledWith(expect.objectContaining({ grid: expect.any(Object), layout: expect.objectContaining({ textColor: '#aaaaaa' }) }))
    expect(chartMocks.volumeApplyOptions).toHaveBeenLastCalledWith({ visible: false })
    expect(chartMocks.paneSetHeight).toHaveBeenLastCalledWith(0)
    expect(chartMocks.addSeries).toHaveBeenCalledTimes(createdSeries)
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

    // setData leaves the logical range where it was, so the right-edge
    // follow that shiftVisibleRangeOnNewBar gives update() is reapplied.
    expect(chartMocks.setVisibleLogicalRange).toHaveBeenLastCalledWith({ from: 50, to: 60 })
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
    expect(viewport).toHaveBeenLastCalledWith({ time: { from: 120, to: 7_320 } })
  })

  it('pans a sibling pane without changing its candle density or price scale', async () => {
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
    const applied = chartMocks.setVisibleLogicalRange.mock.calls[0]?.[0] as { from: number; to: number }
    expect(applied.to - applied.from).toBe(10)
    expect(chartMocks.priceScaleSetAutoScale).not.toHaveBeenCalled()
    expect(chartMocks.priceScaleSetVisibleRange).not.toHaveBeenCalled()
  })
})
