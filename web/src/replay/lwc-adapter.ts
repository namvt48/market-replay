import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LogicalRange,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  DrawingManager,
  getToolRegistry,
  type Anchor,
  type DrawingEvent,
  type DrawingToolDefinition,
  type IDrawing,
  type SerializedDrawing,
} from 'lightweight-charts-drawing'
import type { SymbolMeta, Timeframe } from '../api/types'
import type { ChartAdapter, ChartCrosshairSync, ChartViewportSync, DisplayBar, DrawingNudgeDirection, EconomicEventMarker, HistoryUpdateOptions, OrderLine, OrderLineAction, PriceScaleToggle, ReplaySelectionState, TradeConnection, TradeMarker, ViewportDemand } from './chart-adapter'
import {
  DEFAULT_DRAWING_METADATA,
  appearanceOptions,
  appearanceStyle,
  colorWithOpacity,
  getDrawingAppearance,
  mergeDrawingAppearance,
  type DrawingAppearance,
  type DrawingAppearancePatch,
  type DrawingWorkbenchOptions,
} from './drawing-appearance'
import { DrawingLabelsPrimitive } from './drawing-labels-primitive'
import { EconomicEventMarkersPrimitive } from './economic-event-markers-primitive'
import { projectDrawingsToHistory } from './drawing-projection'
import { DEFAULT_CHART_APPEARANCE, type ChartAppearanceSettings } from './chart-settings'
import { DEFAULT_CHART_TIMEZONE, formatChartTime, type ChartTimezone } from './chart-timezone'
import {
  IDLE_DRAWING_PLACEMENT,
  cancelDrawingPlacement,
  commitDrawingAnchor,
  drawingPreviewAnchors,
  moveDrawingPlacement,
  startDrawingPlacement,
  type DrawingPlacementState,
  type PlacementAnchor,
} from './drawing-placement'
import { OrderLinesPrimitive } from './order-lines-primitive'
import { HoverBarStore, type HoverBarSnapshot } from './hover-bar-store'
import { ReplaySelectionPrimitive } from './replay-selection-primitive'
import { TradeConnectionsPrimitive } from './trade-connections-primitive'

const PREVIEW_ID = '__drawing-preview__'
const UI_FONT_FAMILY = '"Roboto Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const MAX_ADAPTER_HISTORY_BARS = 6_000
const BULK_PUSH_BARS = 32
const MAX_PRICE_LABEL_CACHE = 4_096

interface DrawingDragState {
  drawingId: string
  pointerId: number
  startTime: number
  startPrice: number
  startX: number
  startY: number
  anchors: Anchor[]
  moved: boolean
  cloneOnDrag: boolean
}

interface ProtectionDragState {
  role: 'takeProfit' | 'stopLoss'
  pointerId: number
  startY: number
  moved: boolean
  wasActive: boolean
}

interface ManualPriceRange {
  from: number
  to: number
}

interface DrawingPriceScaleLock {
  range: ManualPriceRange
  restoreAutoScale: boolean
}

/**
 * Lightweight Charts calls the price formatter for every axis label, every
 * crosshair label and every price line, on every repaint — it came out at
 * ~7% of all frame time during a four-pane replay profile. Prices are
 * quantised to the tick, so the same handful of strings are rebuilt over
 * and over; caching them turns a toFixed plus a string allocation into a
 * map lookup.
 */
function createPriceFormatter(decimals: number): (price: number) => string {
  const cache = new Map<number, string>()
  return (price: number): string => {
    const cached = cache.get(price)
    if (cached !== undefined) return cached
    const formatted = price.toFixed(decimals)
    if (cache.size >= MAX_PRICE_LABEL_CACHE) cache.clear()
    cache.set(price, formatted)
    return formatted
  }
}

function toTime(timestamp: number): UTCTimestamp { return timestamp as UTCTimestamp }
function timestampFromTime(time: Time | undefined): number | null {
  if (typeof time === 'number') return time
  if (!time) return null
  if (typeof time === 'string') return Math.floor(Date.parse(time) / 1000)
  return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000)
}
function toCandle(bar: DisplayBar): CandlestickData<Time> {
  return { time: toTime(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close }
}
function toVolume(bar: DisplayBar): HistogramData<Time> {
  return { time: toTime(bar.time), value: bar.volume, color: bar.close >= bar.open ? '#08998166' : '#f2364566' }
}

export class LwcAdapter implements ChartAdapter {
  private chart: IChartApi | null = null
  private candles: ISeriesApi<'Candlestick'> | null = null
  private volume: ISeriesApi<'Histogram'> | null = null
  private spacer: ISeriesApi<'Line'> | null = null
  private markers: ISeriesMarkersPluginApi<Time> | null = null
  private container: HTMLElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private history: DisplayBar[] = []
  /** @internal Exposed for deterministic adapter interaction tests. */
  readonly orderPrimitive = new OrderLinesPrimitive()
  /** @internal Exposed for deterministic adapter interaction tests. */
  readonly tradeConnectionsPrimitive = new TradeConnectionsPrimitive()
  /** @internal Exposed for deterministic adapter interaction tests. */
  readonly economicEventMarkersPrimitive = new EconomicEventMarkersPrimitive()
  private replaySelectionPrimitive = new ReplaySelectionPrimitive()
  private replaySelectionState: ReplaySelectionState = { mode: 'inactive' }
  private replaySelectionHandler: (timestamp: number) => void = () => undefined
  private replayPreviewIndex = -1
  private orderMoveHandler: (id: string, price: number) => void = () => undefined
  private orderDragStartHandler: (id: string) => void = () => undefined
  private orderActionHandler: (action: OrderLineAction) => void = () => undefined
  private chartOrderHandler: (side: 'buy' | 'sell', type: 'limit' | 'stop', price: number) => void = () => undefined
  private drawingChangedHandler: (drawingId?: string) => void = () => undefined
  private drawingSelectionHandler: (drawing: DrawingAppearance | null) => void = () => undefined
  private drawingEditRequestHandler: (drawing: DrawingAppearance) => void = () => undefined
  private drawingToolChangedHandler: (tool: string | null) => void = () => undefined
  private viewportDemandHandler: (demand: ViewportDemand) => void = () => undefined
  private crosshairSyncHandler: (state: ChartCrosshairSync | null) => void = () => undefined
  private viewportSyncHandler: (state: ChartViewportSync) => void = () => undefined
  private applyingExternalSync = false
  private suppressViewportEchoUntilGesture = true
  private viewportSyncFrame = 0
  private drawingSyncFrame = 0
  private pendingDrawingChange: { drawingId?: string } | null = null
  private lastViewportDemandAt = Number.NEGATIVE_INFINITY
  private drawingManager = new DrawingManager()
  private drawingLabelsPrimitive = new DrawingLabelsPrimitive(
    () => this.drawingManager.getAllDrawings(),
    (price) => price.toFixed(this.pricePrecision),
  )
  private activeTool: string | null = null
  private placement: DrawingPlacementState = IDLE_DRAWING_PLACEMENT
  private preview: IDrawing | null = null
  private measurementGesture: { pointerId: number; startX: number; startY: number; dragged: boolean; transient: boolean } | null = null
  private measurementClickAnchored = false
  private measurementPreviewPinned = false
  private draggingOrder: OrderLine | null = null
  private protectionDrag: ProtectionDragState | null = null
  private suppressNextOrderActionClick = false
  private quantityEditor: HTMLDivElement | null = null
  private draggingDrawing: DrawingDragState | null = null
  private drawingPriceScaleLock: DrawingPriceScaleLock | null = null
  private drawingsHidden = false
  private drawingUndoStack: SerializedDrawing[][] = []
  private drawingRedoStack: SerializedDrawing[][] = []
  private drawingHistorySnapshot: SerializedDrawing[] = []
  private applyingDrawingHistory = false
  private lastDrawingUpdate: { id: string; at: number } | null = null
  private suppressNextModifiedClick = false
  private nextDrawingAppearance: DrawingAppearancePatch | null = null
  private pricePrecision = 2
  private tickSize = 0.25
  private symbolCode = 'chart'
  private lastClose = 0
  private appearance: ChartAppearanceSettings = { ...DEFAULT_CHART_APPEARANCE }
  private displayTimezone: ChartTimezone = DEFAULT_CHART_TIMEZONE
  private volumePaneHeight = 100
  private hoverUnsubscribe: (() => void) | null = null
  private readonly hoverStore: HoverBarStore

  constructor(hoverStore: HoverBarStore = new HoverBarStore()) {
    this.hoverStore = hoverStore
  }

  async init(element: HTMLElement, symbol: SymbolMeta, _tf: Timeframe): Promise<void> {
    this.destroy()
    this.drawingManager = new DrawingManager()
    this.container = element
    this.pricePrecision = symbol.priceDecimals
    this.tickSize = symbol.tickSize
    this.symbolCode = symbol.symbol
    this.chart = createChart(element, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: this.appearance.backgroundColor }, textColor: this.appearance.textColor, fontFamily: UI_FONT_FAMILY, fontSize: 12, attributionLogo: false, panes: { separatorColor: '#2a2e39', enableResize: true } },
      grid: { vertLines: { color: this.appearance.verticalGridColor, visible: this.appearance.showGrid }, horzLines: { color: this.appearance.horizontalGridColor, visible: this.appearance.showGrid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#787b8688', labelBackgroundColor: '#2a2e39' }, horzLine: { color: '#787b8688', labelBackgroundColor: '#2a2e39' } },
      rightPriceScale: { borderColor: '#434651', scaleMargins: { top: 0.08, bottom: 0.06 } },
      timeScale: { borderColor: '#434651', rightOffset: 12, barSpacing: 7, shiftVisibleRangeOnNewBar: true, timeVisible: true, secondsVisible: false, tickMarkFormatter: (time: Time) => formatChartTime(timestampFromTime(time) ?? 0, this.displayTimezone, false) },
      localization: { priceFormatter: createPriceFormatter(symbol.priceDecimals), timeFormatter: (time: Time) => formatChartTime(timestampFromTime(time) ?? 0, this.displayTimezone) },
      handleScale: true,
      handleScroll: true,
    })
    this.candles = this.chart.addSeries(CandlestickSeries, {
      upColor: this.appearance.upColor, downColor: this.appearance.downColor, wickUpColor: this.appearance.wickUpColor, wickDownColor: this.appearance.wickDownColor,
      borderUpColor: this.appearance.borderUpColor, borderDownColor: this.appearance.borderDownColor, borderVisible: this.appearance.borderVisible,
      priceFormat: { type: 'price', precision: symbol.priceDecimals, minMove: symbol.tickSize },
    })
    this.volume = this.chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' }, 1)
    this.spacer = this.chart.addSeries(LineSeries, { visible: false, priceLineVisible: false, lastValueVisible: false })
    this.markers = createSeriesMarkers(this.candles)
    this.candles.attachPrimitive(this.tradeConnectionsPrimitive)
    this.candles.attachPrimitive(this.orderPrimitive)
    this.candles.attachPrimitive(this.drawingLabelsPrimitive)
    this.candles.attachPrimitive(this.replaySelectionPrimitive)
    this.candles.attachPrimitive(this.economicEventMarkersPrimitive)
    this.drawingManager.attach(this.chart, this.candles, element)
    this.bindDrawingEvents()
    this.bindInteractions()
    this.chart.subscribeCrosshairMove(this.handleCrosshairMove)
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.handleVisibleLogicalRangeChange)
    this.chart.timeScale().subscribeVisibleTimeRangeChange(this.handleVisibleTimeRangeChange)
    this.applyAppearance(this.appearance)
    this.applyReplaySelectionState()
    this.resizeObserver = new ResizeObserver(() => this.chart?.applyOptions({ width: element.clientWidth, height: element.clientHeight }))
    this.resizeObserver.observe(element)
  }

  setSymbol(symbol: SymbolMeta): void {
    this.pricePrecision = symbol.priceDecimals
    this.tickSize = symbol.tickSize
    this.symbolCode = symbol.symbol
    this.chart?.applyOptions({ localization: { priceFormatter: createPriceFormatter(symbol.priceDecimals) } })
    this.candles?.applyOptions({ priceFormat: { type: 'price', precision: symbol.priceDecimals, minMove: symbol.tickSize } })
  }

  setHistory(bars: DisplayBar[], options: HistoryUpdateOptions = {}): void {
    const manualPriceRange = options.preserveViewport ? this.captureManualPriceRange() : null
    const previousLogicalRange = options.preserveViewport ? this.chart?.timeScale().getVisibleLogicalRange() : null
    const previousAnchorIndex = previousLogicalRange && this.history.length > 0
      ? Math.max(0, Math.min(this.history.length - 1, Math.floor(previousLogicalRange.from)))
      : -1
    const previousAnchorTs = this.history[previousAnchorIndex]?.time
    this.history = bars.slice(-MAX_ADAPTER_HISTORY_BARS)
    this.lastClose = this.history.at(-1)?.close ?? 0
    this.candles?.setData(this.history.map(toCandle))
    this.volume?.setData(this.history.map(toVolume))
    const shiftedAnchorIndex = previousAnchorTs === undefined ? -1 : this.history.findIndex((bar) => bar.time === previousAnchorTs)
    if (previousLogicalRange && shiftedAnchorIndex >= 0) {
      const logicalShift = shiftedAnchorIndex - previousAnchorIndex
      this.withExternalSync(() => {
        this.chart?.timeScale().setVisibleLogicalRange({
          from: previousLogicalRange.from + logicalShift,
          to: previousLogicalRange.to + logicalShift,
        })
      })
    } else if (options.resetView || !options.preserveViewport) {
      this.resetView()
    }
    this.restoreManualPriceRange(manualPriceRange)
    this.publishLatestBar()
    this.applyReplaySelectionState()
  }

  pushBar(bar: DisplayBar): void {
    const manualPriceRange = this.captureManualPriceRange()
    const previousRange = this.chart?.timeScale().getVisibleLogicalRange() ?? null
    const last = this.history.at(-1)
    const appended = last?.time === bar.time ? 0 : 1
    if (appended === 0) this.history[this.history.length - 1] = bar
    else this.history.push(bar)
    this.candles?.update(toCandle(bar))
    this.volume?.update(toVolume(bar))
    this.followLatestBar(previousRange, appended)
    this.restoreManualPriceRange(manualPriceRange)
    this.lastClose = bar.close
    this.publishLatestBar()
  }

  pushBars(bars: DisplayBar[]): void {
    if (bars.length === 0) return
    // A batch this size or larger is replaced wholesale instead of applied
    // one update() at a time. update() is the right call for a single new
    // bar, but its cost is nowhere near constant, so a batch turns into a
    // storm: at 500x across four panes a CPU profile attributed 61% of all
    // frame time to this method, from ~20,000 update() calls in five
    // seconds. One setData per series per flush is also what PRODUCT.md
    // asks for — "at most one mutation per series per animation frame".
    const bulk = bars.length >= BULK_PUSH_BARS
    const manualPriceRange = this.captureManualPriceRange()
    const previousRange = this.chart?.timeScale().getVisibleLogicalRange() ?? null

    let appended = 0
    for (const bar of bars) {
      const last = this.history.at(-1)
      if (last?.time === bar.time) this.history[this.history.length - 1] = bar
      else {
        this.history.push(bar)
        appended += 1
      }
    }
    // Unconditional slice(-MAX) copies the whole history array even when
    // it's already within budget (slice on a shorter-than-limit array still
    // allocates a full copy) — every animation frame during replay. Only
    // pay for the copy once there's actually something to trim.
    let trimmed = 0
    if (this.history.length > MAX_ADAPTER_HISTORY_BARS) {
      trimmed = this.history.length - MAX_ADAPTER_HISTORY_BARS
      this.history = this.history.slice(-MAX_ADAPTER_HISTORY_BARS)
    }

    if (bulk) {
      this.candles?.setData(this.history.map(toCandle))
      this.volume?.setData(this.history.map(toVolume))
    } else {
      for (const bar of bars) {
        this.candles?.update(toCandle(bar))
        this.volume?.update(toVolume(bar))
      }
    }

    this.followLatestBar(previousRange, appended - trimmed)

    this.restoreManualPriceRange(manualPriceRange)
    this.lastClose = bars.at(-1)?.close ?? this.lastClose
    this.publishLatestBar()
  }

  truncateTo(timestamp: number): void {
    const manualPriceRange = this.captureManualPriceRange()
    const keep = this.history.filter((bar) => bar.time <= timestamp)
    const removeCount = this.history.length - keep.length
    this.history = keep
    if (removeCount > 0 && removeCount <= 200) {
      this.candles?.pop(removeCount)
      this.volume?.pop(removeCount)
    } else {
      this.candles?.setData(keep.map(toCandle))
      this.volume?.setData(keep.map(toVolume))
    }
    this.restoreManualPriceRange(manualPriceRange)
  }

  setSpacerTimes(times: number[]): void { this.spacer?.setData(times.map((time) => ({ time: toTime(time) }))) }

  applyAppearance(settings: ChartAppearanceSettings): void {
    this.appearance = { ...settings }
    this.candles?.applyOptions({
      upColor: settings.upColor, downColor: settings.downColor,
      wickUpColor: settings.wickUpColor, wickDownColor: settings.wickDownColor,
      borderUpColor: settings.borderUpColor, borderDownColor: settings.borderDownColor,
      borderVisible: settings.borderVisible,
    })
    this.chart?.applyOptions({
      layout: { background: { type: ColorType.Solid, color: settings.backgroundColor }, textColor: settings.textColor },
      grid: {
        vertLines: { color: settings.verticalGridColor, visible: settings.showGrid },
        horzLines: { color: settings.horizontalGridColor, visible: settings.showGrid },
      },
    })
    if (settings.showVolume) {
      if (!this.volume && this.chart) {
        this.volume = this.chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' }, 1)
        this.volume.setData(this.history.map(toVolume))
      }
      this.volume?.applyOptions({ visible: true })
      this.volume?.getPane()?.setHeight(this.volumePaneHeight)
      return
    }

    const volume = this.volume
    const pane = volume?.getPane()
    if (!volume || !this.chart) return
    if (pane && pane.getHeight() > 0) this.volumePaneHeight = pane.getHeight()
    volume.applyOptions({ visible: false })
    this.chart.removeSeries(volume)
    this.volume = null
  }

  setDisplayTimezone(timezone: ChartTimezone): void {
    this.displayTimezone = timezone
    this.chart?.applyOptions({
      localization: { timeFormatter: (time: Time) => formatChartTime(timestampFromTime(time) ?? 0, timezone) },
      timeScale: { tickMarkFormatter: (time: Time) => formatChartTime(timestampFromTime(time) ?? 0, timezone, false) },
    })
  }

  onHoveredBar(handler: (bar: HoverBarSnapshot | null) => void): void {
    this.hoverUnsubscribe?.()
    this.hoverUnsubscribe = this.hoverStore.subscribe(() => handler(this.hoverStore.getSnapshot()))
    handler(this.hoverStore.getSnapshot())
  }

  onViewportDemand(handler: (demand: ViewportDemand) => void): void { this.viewportDemandHandler = handler }

  onCrosshairSync(handler: (state: ChartCrosshairSync | null) => void): void { this.crosshairSyncHandler = handler }

  setCrosshairSync(state: ChartCrosshairSync | null): void {
    if (!this.chart || !this.candles) return
    // Same emptiness guard as setViewportSync: positioning a crosshair
    // needs a time scale with points on it.
    if (state && this.history.length === 0) return
    this.withExternalSync(() => {
      if (state) this.chart?.setCrosshairPosition(state.price, toTime(state.time), this.candles as ISeriesApi<'Candlestick'>)
      else this.chart?.clearCrosshairPosition()
    })
  }

  onViewportSync(handler: (state: ChartViewportSync) => void): void { this.viewportSyncHandler = handler }

  setViewportSync(state: ChartViewportSync): void {
    if (!this.chart || !this.candles || state.time.to <= state.time.from) return
    // Lightweight Charts resolves a time range against the series' own
    // points, and asserts ("Value is null") when there are none. A pane that
    // has been created but not yet filled is exactly that case, and it is
    // reachable on a normal boot: with a multi-pane layout restored from
    // storage, every pane's chart exists before any of them has data, so the
    // first pane to publish its viewport threw across the others — surfacing
    // as "Data could not be loaded" on every pane of a saved layout.
    if (this.history.length === 0) return
    const timeScale = this.chart.timeScale()
    const current = timeScale.getVisibleLogicalRange()
    const currentSpan = current && current.to > current.from ? current.to - current.from : null
    const centerTime = Math.floor((state.time.from + state.time.to) / 2)
    const centerIndex = timeScale.timeToIndex(toTime(centerTime), true)
    if (centerIndex === null) return
    const span = state.logicalSpan ?? currentSpan
    if (span === null || !Number.isFinite(span) || span <= 0) return
    const center = Number(centerIndex)
    this.withExternalSync(() => {
      timeScale.setVisibleLogicalRange({ from: center - span / 2, to: center + span / 2 })
    })
  }

  focusTime(timestamp: number): void {
    if (!this.chart || this.history.length === 0) return
    let low = 0
    let high = this.history.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (this.history[middle].time < timestamp) low = middle + 1
      else high = middle
    }
    const after = Math.min(this.history.length - 1, low)
    const before = Math.max(0, after - 1)
    const index = Math.abs(this.history[after].time - timestamp) < Math.abs(this.history[before].time - timestamp) ? after : before
    const current = this.chart.timeScale().getVisibleLogicalRange()
    const span = Math.max(60, current ? current.to - current.from : 80)
    this.withExternalSync(() => {
      this.chart?.timeScale().setVisibleLogicalRange({ from: index - span * 0.72, to: index + span * 0.28 })
    })
  }

  setReplaySelection(state: ReplaySelectionState): void {
    this.replaySelectionState = state
    this.replayPreviewIndex = -1
    this.applyReplaySelectionState()
  }

  onReplayBarSelect(handler: (timestamp: number) => void): void { this.replaySelectionHandler = handler }

  setTradeMarkers(markers: TradeMarker[]): void {
    const next: SeriesMarker<Time>[] = markers.map((marker) => ({
      time: toTime(marker.time), position: marker.shape === 'arrowUp' ? 'belowBar' : marker.shape === 'arrowDown' ? 'aboveBar' : 'inBar',
      shape: marker.shape, color: marker.color, text: marker.text, price: marker.price,
    }))
    this.markers?.setMarkers(next)
  }

  setEconomicEventMarkers(markers: EconomicEventMarker[]): void {
    this.economicEventMarkersPrimitive.setMarkers(markers)
  }

  setTradeConnections(connections: TradeConnection[]): void {
    this.tradeConnectionsPrimitive.setConnections(connections)
  }

  setOrderLines(lines: OrderLine[]): void {
    const draggingOrder = this.draggingOrder
    if (!draggingOrder) {
      this.orderPrimitive.setLines(lines)
      return
    }

    // Replay keeps projecting the committed fill state while it is playing.
    // During a drag that projection still contains the old TP/SL price, so
    // accepting it verbatim would make the line alternate between the cursor
    // preview and the committed price on every replay frame. Preserve only
    // the active line's local preview until pointerup commits it to the engine.
    const nextLines = lines.map((line) => line.id === draggingOrder.id
      ? { ...line, price: draggingOrder.price, priceLabel: draggingOrder.priceLabel }
      : line)
    this.draggingOrder = nextLines.find((line) => line.id === draggingOrder.id) ?? draggingOrder
    this.orderPrimitive.setLines(nextLines)
  }
  onOrderLineMove(handler: (id: string, price: number) => void): void { this.orderMoveHandler = handler }
  onOrderLineDragStart(handler: (id: string) => void): void { this.orderDragStartHandler = handler }
  onOrderLineAction(handler: (action: OrderLineAction) => void): void { this.orderActionHandler = handler }
  onChartOrder(handler: (side: 'buy' | 'sell', type: 'limit' | 'stop', price: number) => void): void { this.chartOrderHandler = handler }
  drawingTools(): DrawingToolDefinition[] { return getToolRegistry().getAll() }

  setDrawingTool(tool: string | null): void {
    if (tool && this.drawingsHidden) this.toggleDrawingsVisibility()
    this.cancelPreview()
    this.measurementGesture = null
    this.measurementClickAnchored = false
    if (tool) this.drawingManager.deselectAll()
    this.activeTool = tool
    const definition = tool ? getToolRegistry().get(tool) : undefined
    this.placement = definition && tool ? startDrawingPlacement(tool, definition.requiredAnchors) : IDLE_DRAWING_PLACEMENT
    this.drawingManager.setActiveTool(tool)
    this.applyChartInteractionLock()
    this.drawingToolChangedHandler(tool)
  }

  deselectDrawing(): void { this.drawingManager.deselectAll() }

  deleteSelectedDrawing(): void {
    const selected = this.drawingManager.getSelectedDrawing()
    if (selected) this.drawingManager.removeDrawing(selected.id)
  }

  deleteAllDrawings(): void {
    this.drawingManager.clearAll()
    this.drawingLabelsPrimitive.requestUpdate()
    this.drawingSelectionHandler(null)
    this.applyChartInteractionLock()
  }

  updateSelectedDrawing(patch: DrawingAppearancePatch): void {
    const drawing = this.drawingManager.getSelectedDrawing()
    if (!drawing) return
    const appearance = mergeDrawingAppearance(getDrawingAppearance(drawing), patch)
    drawing.updateStyle(appearanceStyle(appearance))
    drawing.updateOptions(appearanceOptions(appearance))
    this.recordDrawingHistory('drawing:updated', drawing.id)
    this.drawingLabelsPrimitive.requestUpdate()
    this.drawingSelectionHandler(appearance)
    this.drawingChangedHandler(drawing.id)
  }

  setNextDrawingAppearance(patch: DrawingAppearancePatch | null): void {
    this.nextDrawingAppearance = patch ? { ...patch } : null
  }

  copySelectedDrawing(): SerializedDrawing | null {
    const selected = this.drawingManager.getSelectedDrawing()
    if (!selected) return null
    const serialized = selected.toJSON()
    return structuredClone({ ...serialized, options: { ...serialized.options, ...selected.options } })
  }

  pasteDrawing(source: SerializedDrawing): void {
    const last = this.history.at(-1)
    const previous = this.history.at(-2)
    const interval = Math.max(1, last && previous ? last.time - previous.time : 60)
    const drawing = getToolRegistry().createDrawing(
      source.type,
      `drawing-${crypto.randomUUID()}`,
      source.anchors.map((anchor) => ({
        time: typeof anchor.time === 'number' ? toTime(Number(anchor.time) + interval) : anchor.time,
        price: anchor.price + this.tickSize,
      })),
      structuredClone(source.style),
      structuredClone(source.options),
    )
    if (!drawing) return
    this.drawingManager.addDrawing(drawing)
    this.drawingManager.selectDrawing(drawing.id)
  }

  private cloneDrawing(source: IDrawing): IDrawing | null {
    const serialized = source.toJSON()
    const clone = getToolRegistry().createDrawing(
      serialized.type,
      `drawing-${crypto.randomUUID()}`,
      structuredClone(serialized.anchors),
      structuredClone(serialized.style),
      structuredClone({ ...serialized.options, ...source.options }),
    )
    if (!clone) return null
    this.drawingManager.addDrawing(clone)
    this.drawingManager.selectDrawing(clone.id)
    return clone
  }

  undoDrawing(): boolean {
    const previous = this.drawingUndoStack.pop()
    if (!previous) return false
    this.drawingRedoStack.push(this.captureDrawingState())
    this.replaceDrawingsFromHistory(previous)
    return true
  }

  redoDrawing(): boolean {
    const next = this.drawingRedoStack.pop()
    if (!next) return false
    this.drawingUndoStack.push(this.captureDrawingState())
    this.replaceDrawingsFromHistory(next)
    return true
  }

  nudgeSelectedDrawing(direction: DrawingNudgeDirection): boolean {
    const drawing = this.drawingManager.getSelectedDrawing()
    if (!drawing || drawing.options.locked) return false
    const last = this.history.at(-1)
    const previous = this.history.at(-2)
    const interval = Math.max(1, last && previous ? last.time - previous.time : 60)
    drawing.setAnchors(drawing.anchors.map((anchor) => ({
      time: typeof anchor.time === 'number'
        ? toTime(Number(anchor.time) + (direction === 'left' ? -interval : direction === 'right' ? interval : 0))
        : anchor.time,
      price: anchor.price + (direction === 'up' ? this.tickSize : direction === 'down' ? -this.tickSize : 0),
    })))
    this.recordDrawingHistory('drawing:updated', drawing.id)
    this.drawingLabelsPrimitive.requestUpdate()
    this.drawingSelectionHandler(getDrawingAppearance(drawing))
    this.drawingChangedHandler(drawing.id)
    return true
  }

  toggleDrawingsVisibility(): void {
    this.drawingsHidden = !this.drawingsHidden
    if (this.drawingsHidden) this.drawingManager.deselectAll()
    for (const drawing of this.drawingManager.getAllDrawings()) {
      if (drawing.id === PREVIEW_ID) continue
      if (this.drawingsHidden) drawing.detach()
      else if (this.candles && this.chart) drawing.attach(this.candles, this.chart, this.container ?? undefined)
    }
    this.drawingLabelsPrimitive.requestUpdate()
  }

  private captureDrawingState(): SerializedDrawing[] {
    return structuredClone(this.getDrawings())
  }

  private recordDrawingHistory(type: DrawingEvent['type'], drawingId?: string): void {
    if (this.applyingDrawingHistory) return
    const next = this.captureDrawingState()
    if (JSON.stringify(next) === JSON.stringify(this.drawingHistorySnapshot)) return
    const now = performance.now()
    const continuousUpdate = type === 'drawing:updated'
      && drawingId !== undefined
      && this.lastDrawingUpdate?.id === drawingId
      && now - this.lastDrawingUpdate.at < 500
    if (!continuousUpdate) {
      this.drawingUndoStack.push(structuredClone(this.drawingHistorySnapshot))
      if (this.drawingUndoStack.length > 100) this.drawingUndoStack.shift()
      this.drawingRedoStack = []
    }
    this.drawingHistorySnapshot = next
    this.lastDrawingUpdate = type === 'drawing:updated' && drawingId ? { id: drawingId, at: now } : null
  }

  private replaceDrawingsFromHistory(drawings: SerializedDrawing[]): void {
    this.applyingDrawingHistory = true
    try {
      this.drawingManager.clearAll()
      const registry = getToolRegistry()
      this.drawingManager.importDrawings(structuredClone(drawings), (type, data) => registry.createDrawing(type, data.id, data.anchors, data.style, data.options))
      if (this.drawingsHidden) this.drawingManager.getAllDrawings().forEach((drawing) => drawing.detach())
      this.drawingHistorySnapshot = this.captureDrawingState()
      this.lastDrawingUpdate = null
      this.drawingLabelsPrimitive.requestUpdate()
      this.drawingSelectionHandler(null)
      this.applyChartInteractionLock()
    } finally {
      this.applyingDrawingHistory = false
    }
    this.drawingChangedHandler()
  }

  getDrawings(): SerializedDrawing[] {
    return this.drawingManager.getAllDrawings().filter((drawing) => drawing.id !== PREVIEW_ID).map((drawing) => {
      const serialized = drawing.toJSON()
      return { ...serialized, options: { ...serialized.options, ...drawing.options } }
    })
  }

  loadDrawings(drawings: SerializedDrawing[]): void {
    this.applyingDrawingHistory = true
    try {
      this.drawingManager.clearAll()
      const registry = getToolRegistry()
      const projected = projectDrawingsToHistory(drawings, this.history)
      this.drawingManager.importDrawings(projected, (type, data) => registry.createDrawing(type, data.id, data.anchors, data.style, data.options))
      if (this.drawingsHidden) this.drawingManager.getAllDrawings().forEach((drawing) => drawing.detach())
      this.drawingHistorySnapshot = this.captureDrawingState()
      this.lastDrawingUpdate = null
      this.drawingLabelsPrimitive.requestUpdate()
      this.drawingSelectionHandler(null)
      this.applyChartInteractionLock()
    } finally {
      this.applyingDrawingHistory = false
    }
  }

  onDrawingsChanged(handler: (drawingId?: string) => void): void { this.drawingChangedHandler = handler }
  onDrawingSelection(handler: (drawing: DrawingAppearance | null) => void): void { this.drawingSelectionHandler = handler }
  onDrawingEditRequest(handler: (drawing: DrawingAppearance) => void): void { this.drawingEditRequestHandler = handler }
  onDrawingToolChanged(handler: (tool: string | null) => void): void { this.drawingToolChangedHandler = handler }

  visibleRange(): { from: number; to: number } {
    const range = this.chart?.timeScale().getVisibleRange()
    return range ? { from: Number(range.from), to: Number(range.to) } : { from: 0, to: 0 }
  }

  panView(logicalBars: number): void {
    const timeScale = this.chart?.timeScale()
    const range = timeScale?.getVisibleLogicalRange()
    if (!timeScale || !range || !Number.isFinite(logicalBars) || logicalBars === 0) return
    this.suppressViewportEchoUntilGesture = false
    timeScale.setVisibleLogicalRange({ from: range.from + logicalBars, to: range.to + logicalBars })
    this.scheduleViewportSync()
  }

  zoomView(factor: number): void {
    const timeScale = this.chart?.timeScale()
    const range = timeScale?.getVisibleLogicalRange()
    if (!timeScale || !range || !Number.isFinite(factor) || factor <= 0) return
    const center = (range.from + range.to) / 2
    const halfSpan = Math.max(2, ((range.to - range.from) * factor) / 2)
    this.suppressViewportEchoUntilGesture = false
    timeScale.setVisibleLogicalRange({ from: center - halfSpan, to: center + halfSpan })
    this.scheduleViewportSync()
  }

  toggleInvertScale(): void {
    const scale = this.candles?.priceScale()
    if (!scale) return
    scale.applyOptions({ invertScale: !scale.options().invertScale })
  }

  togglePriceScaleMode(mode: PriceScaleToggle): void {
    const scale = this.candles?.priceScale()
    if (!scale) return
    const requested = mode === 'logarithmic' ? PriceScaleMode.Logarithmic : PriceScaleMode.Percentage
    scale.applyOptions({ mode: scale.options().mode === requested ? PriceScaleMode.Normal : requested })
  }

  takeSnapshot(): void {
    if (!this.chart) return
    const canvas = this.chart.takeScreenshot(true, true)
    const anchor = document.createElement('a')
    anchor.download = `market-replay-${this.symbolCode}-${new Date().toISOString().replaceAll(':', '-')}.png`
    anchor.href = canvas.toDataURL('image/png')
    anchor.click()
  }

  resetView(): void {
    if (!this.chart || this.history.length === 0) return
    const width = this.container?.clientWidth || this.container?.getBoundingClientRect().width || 960
    const visibleBars = Math.max(60, Math.min(160, Math.floor(width / 8)))
    const rightOffset = 12
    const to = this.history.length - 1 + rightOffset
    // A reset/TF switch is programmatic. Suppress only callbacks caused by
    // this mutation instead of starting a wall-clock throttle that can eat
    // the user's first real pan and leave the chart pinned at its cache edge.
    this.lastViewportDemandAt = Number.NEGATIVE_INFINITY
    this.withExternalSync(() => {
      this.candles?.priceScale().applyOptions({ autoScale: true })
      this.chart?.timeScale().applyOptions({ barSpacing: 7, rightOffset })
      this.chart?.timeScale().setVisibleLogicalRange({ from: to - visibleBars + 1, to })
    })
  }

  private captureManualPriceRange(): ManualPriceRange | null {
    const scale = this.candles?.priceScale()
    if (!scale || scale.options().autoScale) return null
    const range = scale.getVisibleRange()
    if (!range || range.to <= range.from) return null
    return { from: range.from, to: range.to }
  }

  private followLatestBar(previousRange: LogicalRange | null, logicalShift: number): void {
    const timeScale = this.chart?.timeScale()
    if (!timeScale || !previousRange || previousRange.to <= previousRange.from || this.history.length === 0) return
    const span = previousRange.to - previousRange.from
    const shifted = { from: previousRange.from + logicalShift, to: previousRange.to + logicalShift }
    const latestIndex = this.history.length - 1
    const rightReserve = Math.max(2, Math.min(12, Math.floor(span * 0.15)))
    const target = latestIndex < shifted.from || latestIndex > shifted.to - rightReserve
      ? { from: latestIndex + rightReserve - span, to: latestIndex + rightReserve }
      : shifted
    if (target.from === previousRange.from && target.to === previousRange.to) return
    this.withExternalSync(() => { timeScale.setVisibleLogicalRange(target) })
  }

  private restoreManualPriceRange(range: ManualPriceRange | null): void {
    if (!range) return
    const scale = this.candles?.priceScale()
    if (!scale) return
    const current = scale.getVisibleRange()
    if (scale.options().autoScale) scale.setAutoScale(false)
    if (!current || current.from !== range.from || current.to !== range.to) scale.setVisibleRange(range)
  }

  private lockDrawingPriceScale(): void {
    const scale = this.candles?.priceScale()
    const range = scale?.getVisibleRange()
    if (!scale || !range || range.to <= range.from) return
    this.drawingPriceScaleLock = {
      range: { from: range.from, to: range.to },
      restoreAutoScale: scale.options().autoScale,
    }
    if (scale.options().autoScale) scale.setAutoScale(false)
    scale.setVisibleRange(this.drawingPriceScaleLock.range)
  }

  private enforceDrawingPriceScaleLock(): void {
    const scale = this.candles?.priceScale()
    const lock = this.drawingPriceScaleLock
    if (!scale || !lock) return
    if (scale.options().autoScale) scale.setAutoScale(false)
    scale.setVisibleRange(lock.range)
  }

  private releaseDrawingPriceScaleLock(): void {
    const scale = this.candles?.priceScale()
    const lock = this.drawingPriceScaleLock
    this.drawingPriceScaleLock = null
    if (!scale || !lock) return
    scale.setVisibleRange(lock.range)
    if (lock.restoreAutoScale) scale.setAutoScale(true)
  }

  destroy(): void {
    this.closeQuantityEditor()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.drawingManager.detach()
    if (this.chart) this.chart.unsubscribeCrosshairMove(this.handleCrosshairMove)
    if (this.chart) this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.handleVisibleLogicalRangeChange)
    if (this.chart) this.chart.timeScale().unsubscribeVisibleTimeRangeChange(this.handleVisibleTimeRangeChange)
    if (this.container) {
      this.container.removeEventListener('pointerdown', this.handlePointerDown, true)
      this.container.removeEventListener('pointermove', this.handlePointerMove)
      this.container.removeEventListener('pointerup', this.handlePointerUp)
      this.container.removeEventListener('pointercancel', this.handlePointerUp)
      this.container.removeEventListener('click', this.handleReplaySelectionClick)
      this.container.removeEventListener('click', this.handleOrderActionClick)
      this.container.removeEventListener('click', this.handleModifiedClick)
      this.container.removeEventListener('click', this.handleDrawingClick)
      this.container.removeEventListener('dblclick', this.handleDrawingDoubleClick)
      this.container.removeEventListener('keydown', this.handleReplaySelectionKeyDown)
      this.container.removeEventListener('wheel', this.handleViewportGesture)
    }
    if (this.viewportSyncFrame) window.cancelAnimationFrame(this.viewportSyncFrame)
    if (this.drawingSyncFrame) window.cancelAnimationFrame(this.drawingSyncFrame)
    this.chart?.remove()
    this.chart = null
    this.candles = null
    this.volume = null
    this.spacer = null
    this.markers = null
    this.container = null
    this.activeTool = null
    this.placement = IDLE_DRAWING_PLACEMENT
    this.preview = null
    this.measurementGesture = null
    this.measurementClickAnchored = false
    this.measurementPreviewPinned = false
    this.draggingDrawing = null
    this.drawingPriceScaleLock = null
    this.drawingsHidden = false
    this.drawingUndoStack = []
    this.drawingRedoStack = []
    this.drawingHistorySnapshot = []
    this.applyingDrawingHistory = false
    this.lastDrawingUpdate = null
    this.suppressNextModifiedClick = false
    this.draggingOrder = null
    this.protectionDrag = null
    this.suppressNextOrderActionClick = false
    this.replaySelectionState = { mode: 'inactive' }
    this.replayPreviewIndex = -1
    this.applyingExternalSync = false
    this.suppressViewportEchoUntilGesture = true
    this.viewportSyncFrame = 0
    this.drawingSyncFrame = 0
    this.pendingDrawingChange = null
    this.hoverStore.emit(null)
  }

  private handleVisibleTimeRangeChange = (range: { from: Time; to: Time } | null): void => {
    if (this.suppressViewportEchoUntilGesture) return
    this.publishViewportSync(range)
  }

  private handleVisibleLogicalRangeChange = (range: LogicalRange | null): void => {
    if (this.applyingExternalSync || !range || this.history.length === 0) return
    const threshold = Math.min(120, Math.max(24, Math.floor(this.history.length * 0.08)))
    let demand: ViewportDemand | null = null
    if (range.from <= threshold) demand = { direction: 'before', anchorTs: this.history[0].time }
    else if (range.to >= this.history.length - 1 - threshold) demand = { direction: 'after', anchorTs: this.history.at(-1)?.time ?? 0 }
    if (!demand) return
    const now = performance.now()
    if (now - this.lastViewportDemandAt < 750) return
    this.lastViewportDemandAt = now
    this.viewportDemandHandler(demand)
  }

  private bindDrawingEvents(): void {
    const changed = (event: DrawingEvent): void => {
      if (event.drawingId === PREVIEW_ID) return
      this.recordDrawingHistory(event.type, event.drawingId)
      this.drawingLabelsPrimitive.requestUpdate()
      const selected = this.drawingManager.getSelectedDrawing()
      this.drawingSelectionHandler(selected ? getDrawingAppearance(selected) : null)
      if (event.type === 'drawing:updated') this.scheduleDrawingChange(event.drawingId)
      else this.drawingChangedHandler(event.drawingId)
    }
    this.drawingManager.on('drawing:added', changed)
    this.drawingManager.on('drawing:removed', changed)
    this.drawingManager.on('drawing:updated', changed)
    this.drawingManager.on('drawing:cleared', changed)
    this.drawingManager.on('drawing:selected', (event) => {
      this.drawingLabelsPrimitive.requestUpdate()
      this.drawingSelectionHandler(event.drawing ? getDrawingAppearance(event.drawing) : null)
      this.applyChartInteractionLock()
    })
    this.drawingManager.on('drawing:deselected', () => {
      this.drawingLabelsPrimitive.requestUpdate()
      this.drawingSelectionHandler(null)
      this.applyChartInteractionLock()
    })
  }

  private bindInteractions(): void {
    if (!this.container || !this.chart || !this.candles) return
    this.container.addEventListener('pointerdown', this.handlePointerDown, true)
    this.container.addEventListener('pointermove', this.handlePointerMove)
    this.container.addEventListener('pointerup', this.handlePointerUp)
    this.container.addEventListener('pointercancel', this.handlePointerUp)
    this.container.addEventListener('click', this.handleReplaySelectionClick)
    this.container.addEventListener('click', this.handleOrderActionClick)
    this.container.addEventListener('click', this.handleModifiedClick)
    this.container.addEventListener('click', this.handleDrawingClick)
    this.container.addEventListener('dblclick', this.handleDrawingDoubleClick)
    this.container.addEventListener('keydown', this.handleReplaySelectionKeyDown)
    this.container.addEventListener('wheel', this.handleViewportGesture, { passive: true })
  }

  private handleViewportGesture = (): void => {
    this.suppressViewportEchoUntilGesture = false
    this.scheduleViewportSync()
  }

  private scheduleViewportSync(): void {
    if (this.viewportSyncFrame || this.applyingExternalSync) return
    this.viewportSyncFrame = window.requestAnimationFrame(() => {
      this.viewportSyncFrame = 0
      this.publishViewportSync()
    })
  }

  private scheduleDrawingChange(drawingId?: string): void {
    this.pendingDrawingChange = { drawingId }
    if (this.drawingSyncFrame) return
    this.drawingSyncFrame = window.requestAnimationFrame(() => {
      this.drawingSyncFrame = 0
      const pending = this.pendingDrawingChange
      this.pendingDrawingChange = null
      if (pending) this.drawingChangedHandler(pending.drawingId)
    })
  }

  private flushDrawingChange(): void {
    const pending = this.pendingDrawingChange
    if (!pending) return
    if (this.drawingSyncFrame) window.cancelAnimationFrame(this.drawingSyncFrame)
    this.drawingSyncFrame = 0
    this.pendingDrawingChange = null
    this.drawingChangedHandler(pending.drawingId)
  }

  private publishViewportSync(visibleTime?: { from: Time; to: Time } | null): void {
    if (this.applyingExternalSync || !this.chart || !this.candles) return
    const time = visibleTime === undefined ? this.chart.timeScale().getVisibleRange() : visibleTime
    if (!time) return
    const from = timestampFromTime(time.from)
    const to = timestampFromTime(time.to)
    if (from === null || to === null || to <= from) return
    const logicalRange = this.chart.timeScale().getVisibleLogicalRange()
    const logicalSpan = logicalRange && logicalRange.to > logicalRange.from ? logicalRange.to - logicalRange.from : null
    this.viewportSyncHandler(logicalSpan === null ? { time: { from, to } } : { time: { from, to }, logicalSpan })
  }

  private withExternalSync(action: () => void): void {
    // Lightweight Charts can report a programmatic range change on a later
    // task, after applyingExternalSync's microtask guard has cleared. Keep
    // viewport publication disabled until this pane receives real user
    // input; otherwise panes with different timeframes echo clamped ranges
    // back and forth and pin the source pane at the shortest cache edge.
    this.suppressViewportEchoUntilGesture = true
    this.applyingExternalSync = true
    try { action() } finally { queueMicrotask(() => { this.applyingExternalSync = false }) }
  }

  private handleReplaySelectionClick = (event: MouseEvent): void => {
    if (this.replaySelectionState.mode !== 'selecting' || !this.container || !this.chart) return
    const bar = this.nearestReplayBarAt(event.clientX - this.container.getBoundingClientRect().left)
    if (!bar) return
    this.replaySelectionPrimitive.setPreview(bar.time, formatChartTime(bar.time, this.displayTimezone, false))
    event.preventDefault()
    event.stopImmediatePropagation()
    this.replaySelectionHandler(bar.time)
  }

  private handleReplaySelectionKeyDown = (event: KeyboardEvent): void => {
    if (this.replaySelectionState.mode !== 'selecting' || this.history.length === 0) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      const initialIndex = this.replayPreviewIndex < 0 ? this.history.length - 1 : this.replayPreviewIndex
      this.replayPreviewIndex = Math.max(0, Math.min(this.history.length - 1, initialIndex + direction))
      const bar = this.history[this.replayPreviewIndex]
      this.replaySelectionPrimitive.setPreview(bar.time, formatChartTime(bar.time, this.displayTimezone, false))
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key !== 'Enter') return
    const bar = this.history[this.replayPreviewIndex]
    if (!bar) return
    event.preventDefault()
    event.stopPropagation()
    this.replaySelectionHandler(bar.time)
  }

  private handleDrawingClick = (event: MouseEvent): void => {
    if (!this.activeTool || event.shiftKey || event.ctrlKey || !this.container || !this.chart || !this.candles) return
    if (this.activeTool === 'date-price-range') return
    const rect = this.container.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const time = this.chart.timeScale().coordinateToTime(x)
    const price = this.candles.coordinateToPrice(y)
    if (time === null || price === null) return
    if (typeof time !== 'number') return
    const anchor: PlacementAnchor = { time, price }
    const nextPlacement = commitDrawingAnchor(this.placement, anchor)
    this.placement = nextPlacement
    if (nextPlacement.status !== 'complete') {
      this.renderPlacementPreview(anchor)
      return
    }
    const registry = getToolRegistry()
    this.removePreview()
    const creationOptions: DrawingWorkbenchOptions & { text?: string; note?: string; pricePrecision?: number; displayTimezone?: string } = {
      workbench: { ...DEFAULT_DRAWING_METADATA },
      text: this.activeTool.includes('text') ? '' : undefined,
      note: this.activeTool.includes('note') ? '' : undefined,
      pricePrecision: this.pricePrecision,
      displayTimezone: 'UTC',
    }
    const drawing = registry.createDrawing(this.activeTool, `drawing-${crypto.randomUUID()}`, nextPlacement.anchors.map((point) => ({ time: toTime(point.time), price: point.price })), {
      lineColor: colorWithOpacity(DEFAULT_DRAWING_METADATA.strokeColor, DEFAULT_DRAWING_METADATA.strokeOpacity),
      lineWidth: 2,
      lineDash: [],
      fillColor: colorWithOpacity(DEFAULT_DRAWING_METADATA.fillColor, DEFAULT_DRAWING_METADATA.fillOpacity),
      fillOpacity: DEFAULT_DRAWING_METADATA.fillOpacity,
      labelColor: DEFAULT_DRAWING_METADATA.textColor,
    }, creationOptions)
    if (drawing) {
      this.drawingManager.addDrawing(drawing)
      this.drawingManager.selectDrawing(drawing.id)
      if (this.nextDrawingAppearance) {
        this.updateSelectedDrawing(this.nextDrawingAppearance)
        this.nextDrawingAppearance = null
      }
      if (drawing.type === 'fib-retracement') this.drawingEditRequestHandler(getDrawingAppearance(drawing))
    }
    this.setDrawingTool(null)
  }

  private handleModifiedClick = (event: MouseEvent): void => {
    if (this.suppressNextModifiedClick) {
      this.suppressNextModifiedClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if ((!event.shiftKey && !event.ctrlKey) || this.activeTool || this.drawingManager.getSelectedDrawing() || !this.container) return
    const y = event.clientY - this.container.getBoundingClientRect().top
    const price = this.candles?.coordinateToPrice(y)
    if (price === null || price === undefined) return
    const snapped = Math.round(price / this.tickSize) * this.tickSize
    const type = event.shiftKey ? 'limit' : 'stop'
    const side = type === 'limit' ? (snapped <= this.lastClose ? 'buy' : 'sell') : (snapped >= this.lastClose ? 'buy' : 'sell')
    this.chartOrderHandler(side, type, snapped)
  }

  private handleOrderActionClick = (event: MouseEvent): void => {
    if (!this.container || this.replaySelectionState.mode === 'selecting') return
    if (this.suppressNextOrderActionClick) {
      this.suppressNextOrderActionClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    const rect = this.container.getBoundingClientRect()
    const action = this.orderPrimitive.actionAt(event.clientX - rect.left, event.clientY - rect.top)
    if (!action) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (action.type === 'quantity') {
      const line = this.orderPrimitive.lines.find((item) => item.id === action.orderId)
      if (!line || line.stage === 'position') return
      if (line.stage === 'working') this.orderActionHandler({ type: 'edit', orderId: line.id })
      this.openQuantityEditor(action.x, action.y, line.qty, line.maxQuantity ?? 1_000)
      return
    }
    if (action.type === 'cancel' || action.type === 'edit') {
      this.orderActionHandler({ type: action.type, orderId: action.orderId })
      return
    }
    this.orderActionHandler({ type: action.type })
  }

  private openQuantityEditor(x: number, y: number, currentQty: number, maxQuantity: number): void {
    if (!this.container) return
    this.closeQuantityEditor()
    const editor = document.createElement('div')
    editor.className = 'order-quantity-editor'
    editor.setAttribute('role', 'dialog')
    editor.setAttribute('aria-label', 'Order quantity')
    editor.style.left = `${Math.max(8, Math.min(x, this.container.clientWidth - 202))}px`
    editor.style.top = `${Math.max(8, Math.min(y + 8, this.container.clientHeight - 286))}px`
    editor.addEventListener('pointerdown', (event) => event.stopPropagation())
    editor.addEventListener('click', (event) => event.stopPropagation())
    editor.addEventListener('keydown', (event) => { if (event.key === 'Escape') this.closeQuantityEditor() })

    const label = document.createElement('label')
    label.textContent = 'Quantity'
    label.className = 'order-quantity-editor__label'
    const input = document.createElement('input')
    input.type = 'number'
    input.min = '1'
    input.max = String(maxQuantity)
    input.step = '1'
    input.value = String(currentQty)
    input.className = 'order-quantity-editor__input'
    label.append(input)
    editor.append(label)

    const grid = document.createElement('div')
    grid.className = 'order-quantity-editor__grid'
    const setQuantity = (qty: number): void => {
      const next = Math.max(1, Math.min(maxQuantity, Math.round(qty)))
      input.value = String(next)
      this.orderActionHandler({ type: 'quantity', qty: next })
    }
    input.addEventListener('input', () => setQuantity(Number(input.value)))
    const actions: Array<{ label: string; value: (qty: number) => number }> = [
      { label: '−', value: (qty) => qty - 1 }, { label: '+', value: (qty) => qty + 1 },
      ...[1, 5, 25, 100, 500, 1_000].map((qty) => ({ label: String(qty), value: () => qty })),
      { label: 'C', value: () => 1 }, { label: '↶', value: () => currentQty },
    ]
    for (const action of actions) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = action.label
      button.className = 'order-quantity-editor__button'
      button.addEventListener('click', () => setQuantity(action.value(Number(input.value))))
      grid.append(button)
    }
    editor.append(grid)
    this.container.append(editor)
    this.quantityEditor = editor
    queueMicrotask(() => input.focus())
  }

  private closeQuantityEditor(): void {
    this.quantityEditor?.remove()
    this.quantityEditor = null
  }

  private handleDrawingDoubleClick = (event: MouseEvent): void => {
    if (this.activeTool || !this.container) return
    const rect = this.container.getBoundingClientRect()
    const drawing = this.drawingManager.hitTest({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    if (!drawing) return
    this.drawingManager.selectDrawing(drawing.id)
    this.drawingEditRequestHandler(getDrawingAppearance(drawing))
    event.preventDefault()
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (this.replaySelectionState.mode === 'selecting' || event.button !== 0 || !this.container || !this.chart || !this.candles) return
    if (this.measurementPreviewPinned) this.cancelPreview()
    const initialRect = this.container.getBoundingClientRect()
    const initialPoint = { x: event.clientX - initialRect.left, y: event.clientY - initialRect.top }
    const transientMeasurement = event.shiftKey && !this.activeTool && this.drawingManager.hitTest(initialPoint) === null
    if (this.activeTool === 'date-price-range' || transientMeasurement) {
      if (transientMeasurement) this.setDrawingTool('date-price-range')
      const rect = this.container.getBoundingClientRect()
      const time = this.chart.timeScale().coordinateToTime(event.clientX - rect.left)
      const price = this.candles.coordinateToPrice(event.clientY - rect.top)
      if (typeof time !== 'number' || price === null) return
      const anchor = { time, price }
      if (!this.measurementClickAnchored) this.placement = commitDrawingAnchor(this.placement, anchor)
      this.measurementGesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dragged: false, transient: transientMeasurement }
      this.renderPlacementPreview(anchor)
      this.container.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (this.activeTool) return
    if (this.quantityEditor?.contains(event.target as Node)) return
    const rect = this.container.getBoundingClientRect()
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const orderAction = this.orderPrimitive.actionAt(point.x, point.y)
    if (!orderAction || orderAction.type !== 'quantity') this.closeQuantityEditor()
    const hitDrawing = this.drawingManager.hitTest(point)
    if (hitDrawing && !hitDrawing.options.locked) {
      if (this.drawingManager.getSelectedDrawing()?.id !== hitDrawing.id) this.drawingManager.selectDrawing(hitDrawing.id)
      if (this.drawingManager.hitTestAnchor(point) !== null) return
      const time = this.chart.timeScale().coordinateToTime(point.x)
      const price = this.candles.coordinateToPrice(point.y)
      if (typeof time !== 'number' || price === null || hitDrawing.anchors.some((anchor) => typeof anchor.time !== 'number')) return
      this.draggingDrawing = {
        drawingId: hitDrawing.id,
        pointerId: event.pointerId,
        startTime: time,
        startPrice: price,
        startX: event.clientX,
        startY: event.clientY,
        anchors: hitDrawing.anchors.map((anchor) => ({ ...anchor })),
        moved: false,
        cloneOnDrag: event.ctrlKey || event.metaKey,
      }
      this.lockDrawingPriceScale()
      this.container.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (this.drawingManager.getSelectedDrawing()) {
      // Unlock synchronously and let this same pointerdown continue to the
      // chart, so panning outside a selected drawing never needs two drags.
      this.drawingManager.deselectAll()
      return
    }
    const action = orderAction
    if (action?.type === 'toggle-take-profit' || action?.type === 'toggle-stop-loss') {
      const role = action.type === 'toggle-take-profit' ? 'takeProfit' : 'stopLoss'
      const entry = this.orderPrimitive.lines.find((line) => line.stage === 'draft' && line.role === 'entry')
      if (!entry) return
      const wasActive = role === 'takeProfit'
        ? entry.protectionEnabled?.takeProfit ?? false
        : entry.protectionEnabled?.stopLoss ?? false
      if (!wasActive) this.orderActionHandler({ type: action.type })
      const leg = this.orderPrimitive.lines.find((line) => line.stage === 'draft' && line.role === role)
      if (!leg) return
      this.draggingOrder = leg
      this.protectionDrag = { role, pointerId: event.pointerId, startY: point.y, moved: false, wasActive }
      this.container.setPointerCapture(event.pointerId)
      this.applyChartInteractionLock()
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (action && action.type !== 'edit') {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    this.draggingOrder = action?.type === 'edit'
      ? this.orderPrimitive.lines.find((line) => line.id === action.orderId) ?? null
      : this.orderPrimitive.nearestEditable(point.y)
    if (this.draggingOrder) {
      this.closeQuantityEditor()
      this.orderDragStartHandler(this.draggingOrder.id)
      const draftLine = this.orderPrimitive.lines.find((line) => line.stage === 'draft' && line.role === this.draggingOrder?.role)
      if (draftLine) this.draggingOrder = draftLine
      this.container.setPointerCapture(event.pointerId)
      this.applyChartInteractionLock()
      event.preventDefault()
      event.stopPropagation()
    }
  }

  private handlePointerMove = (event: PointerEvent): void => {
    if (event.buttons !== 0 && !this.draggingOrder) this.handleViewportGesture()
    if (this.replaySelectionState.mode === 'selecting' && this.container) {
      const bar = this.nearestReplayBarAt(event.clientX - this.container.getBoundingClientRect().left)
      if (bar) {
        this.replayPreviewIndex = this.history.indexOf(bar)
        this.replaySelectionPrimitive.setPreview(bar.time, formatChartTime(bar.time, this.displayTimezone, false))
      }
      return
    }
    if (this.activeTool && this.container && this.chart && this.candles) {
      if (this.activeTool === 'date-price-range' && this.measurementGesture?.pointerId === event.pointerId && event.buttons !== 0) {
        const distance = Math.hypot(event.clientX - this.measurementGesture.startX, event.clientY - this.measurementGesture.startY)
        if (distance >= 3) this.measurementGesture.dragged = true
      }
      const rect = this.container.getBoundingClientRect()
      const time = this.chart.timeScale().coordinateToTime(event.clientX - rect.left)
      const price = this.candles.coordinateToPrice(event.clientY - rect.top)
      if (typeof time === 'number' && price !== null) this.renderPlacementPreview({ time, price })
      return
    }
    if (this.draggingDrawing && this.draggingDrawing.pointerId === event.pointerId && this.container && this.chart && this.candles) {
      this.enforceDrawingPriceScaleLock()
      const rect = this.container.getBoundingClientRect()
      const time = this.chart.timeScale().coordinateToTime(event.clientX - rect.left)
      const price = this.candles.coordinateToPrice(event.clientY - rect.top)
      let drawing = this.drawingManager.getDrawing(this.draggingDrawing.drawingId)
      if (typeof time !== 'number' || price === null || !drawing) return
      const last = this.history.at(-1)
      const previous = this.history.at(-2)
      const barInterval = Math.max(1, last && previous ? last.time - previous.time : 60)
      let timeDelta = Math.round((time - this.draggingDrawing.startTime) / barInterval) * barInterval
      let priceDelta = Math.round((price - this.draggingDrawing.startPrice) / this.tickSize) * this.tickSize
      if (event.shiftKey) {
        if (Math.abs(event.clientX - this.draggingDrawing.startX) >= Math.abs(event.clientY - this.draggingDrawing.startY)) priceDelta = 0
        else timeDelta = 0
      }
      if (timeDelta === 0 && priceDelta === 0) return
      if (this.draggingDrawing.cloneOnDrag) {
        const clone = this.cloneDrawing(drawing)
        this.draggingDrawing.cloneOnDrag = false
        if (!clone) return
        drawing = clone
        this.draggingDrawing.drawingId = clone.id
        this.lastDrawingUpdate = { id: clone.id, at: performance.now() }
      }
      drawing.setAnchors(this.draggingDrawing.anchors.map((anchor) => ({
        time: (Number(anchor.time) + timeDelta) as UTCTimestamp,
        price: anchor.price + priceDelta,
      })))
      this.draggingDrawing.moved = true
      this.recordDrawingHistory('drawing:updated', drawing.id)
      this.drawingLabelsPrimitive.requestUpdate()
      this.enforceDrawingPriceScaleLock()
      this.scheduleDrawingChange(this.draggingDrawing.drawingId)
      return
    }
    if (!this.draggingOrder || !this.container) return
    const y = event.clientY - this.container.getBoundingClientRect().top
    if (this.protectionDrag?.pointerId === event.pointerId) {
      if (Math.abs(y - this.protectionDrag.startY) < 3) return
      this.protectionDrag.moved = true
    }
    const price = this.orderPrimitive.priceAt(y)
    if (price === null) return
    const snapped = Math.round(price / this.tickSize) * this.tickSize
    if (snapped === this.draggingOrder.price) return
    this.draggingOrder = { ...this.draggingOrder, price: snapped, priceLabel: snapped.toFixed(this.pricePrecision) }
    this.orderPrimitive.setLines(this.orderPrimitive.lines.map((line) => line.id === this.draggingOrder?.id ? this.draggingOrder : line))
  }

  private handlePointerUp = (event: PointerEvent): void => {
    if (this.measurementGesture?.pointerId === event.pointerId && this.container) {
      const transient = this.measurementGesture.transient
      const cancelled = event.type === 'pointercancel'
      const finishMeasurement = this.measurementGesture.dragged || this.measurementClickAnchored
      if (this.container.hasPointerCapture(event.pointerId)) this.container.releasePointerCapture(event.pointerId)
      this.measurementGesture = null
      if (cancelled) this.setDrawingTool(null)
      else if (finishMeasurement) this.pinMeasurementPreview()
      else this.measurementClickAnchored = true
      if (transient) {
        this.suppressNextModifiedClick = true
        window.setTimeout(() => { this.suppressNextModifiedClick = false }, 0)
      }
      event.preventDefault()
      event.stopPropagation()
      return
    }
    this.handleViewportGesture()
    if (this.draggingDrawing?.pointerId === event.pointerId && this.container) {
      if (this.container.hasPointerCapture(event.pointerId)) this.container.releasePointerCapture(event.pointerId)
      const moved = this.draggingDrawing.moved
      const drawingId = this.draggingDrawing.drawingId
      this.draggingDrawing = null
      if (moved) {
        this.scheduleDrawingChange(drawingId)
        this.flushDrawingChange()
      }
      this.releaseDrawingPriceScaleLock()
      return
    }
    if (!this.draggingOrder || !this.container) return
    const protectionDrag = this.protectionDrag?.pointerId === event.pointerId ? this.protectionDrag : null
    if (protectionDrag) {
      if (protectionDrag.moved && event.type !== 'pointercancel') {
        this.orderMoveHandler(this.draggingOrder.id, this.draggingOrder.price)
      } else if (protectionDrag.wasActive && event.type !== 'pointercancel') {
        this.orderActionHandler({ type: protectionDrag.role === 'takeProfit' ? 'toggle-take-profit' : 'toggle-stop-loss' })
      }
      this.suppressNextOrderActionClick = event.type !== 'pointercancel'
      if (this.suppressNextOrderActionClick) {
        window.setTimeout(() => { this.suppressNextOrderActionClick = false }, 0)
      }
      this.protectionDrag = null
      if (this.container.hasPointerCapture(event.pointerId)) this.container.releasePointerCapture(event.pointerId)
      this.draggingOrder = null
      this.applyChartInteractionLock()
      return
    }
    this.orderMoveHandler(this.draggingOrder.id, this.draggingOrder.price)
    if (this.container.hasPointerCapture(event.pointerId)) this.container.releasePointerCapture(event.pointerId)
    this.draggingOrder = null
    this.protectionDrag = null
    this.applyChartInteractionLock()
  }

  private handleCrosshairMove = (params: MouseEventParams<Time>): void => {
    const candle = this.candles ? params.seriesData.get(this.candles) : undefined
    const time = timestampFromTime(params.time)
    if (!this.applyingExternalSync) {
      const cursorPrice = params.point && this.candles ? this.candles.coordinateToPrice(params.point.y) : null
      this.crosshairSyncHandler(time !== null && cursorPrice !== null ? { time, price: cursorPrice } : null)
    }
    if (candle && 'open' in candle && 'high' in candle && 'low' in candle && 'close' in candle && time !== null
      && typeof candle.open === 'number' && typeof candle.high === 'number' && typeof candle.low === 'number' && typeof candle.close === 'number') {
      this.hoverStore.emit({ time, open: candle.open, high: candle.high, low: candle.low, close: candle.close, hovered: true })
      return
    }
    const fallback = this.history.at(-1)
    this.hoverStore.emit(fallback ? { ...fallback, hovered: false } : null)
  }

  private publishLatestBar(): void {
    if (this.hoverStore.getSnapshot()?.hovered) return
    const fallback = this.history.at(-1)
    this.hoverStore.emit(fallback ? { ...fallback, hovered: false } : null)
  }

  private cancelPreview(): void {
    this.removePreview()
    this.placement = cancelDrawingPlacement(this.placement)
    this.placement = IDLE_DRAWING_PLACEMENT
  }

  private removePreview(): void {
    if (this.preview) this.drawingManager.removeDrawing(this.preview.id)
    this.preview = null
    this.measurementPreviewPinned = false
  }

  private pinMeasurementPreview(): void {
    this.measurementPreviewPinned = this.preview !== null
    this.measurementClickAnchored = false
    this.activeTool = null
    this.placement = IDLE_DRAWING_PLACEMENT
    this.drawingManager.setActiveTool(null)
    this.applyChartInteractionLock()
    this.drawingToolChangedHandler(null)
  }

  private renderPlacementPreview(cursor: PlacementAnchor): void {
    this.placement = moveDrawingPlacement(this.placement, cursor)
    const anchors = drawingPreviewAnchors(this.placement)
    if (!anchors || !this.activeTool) return
    const drawingAnchors: Anchor[] = anchors.map((anchor) => ({ time: toTime(anchor.time), price: anchor.price }))
    if (this.preview) {
      this.preview.setAnchors(drawingAnchors)
      return
    }
    const previewOptions: DrawingWorkbenchOptions & { pricePrecision: number; displayTimezone: string } = {
      visible: true,
      locked: true,
      zIndex: 10_000,
      pricePrecision: this.pricePrecision,
      displayTimezone: 'UTC',
    }
    const drawing = getToolRegistry().createDrawing(this.activeTool, PREVIEW_ID, drawingAnchors, {
      lineColor: 'rgba(41, 98, 255, 0.72)',
      lineWidth: 2,
      lineDash: [7, 5],
      fillColor: 'rgba(41, 98, 255, 0.08)',
      fillOpacity: 0.08,
      labelColor: 'rgba(209, 212, 220, 0.72)',
    }, previewOptions)
    if (!drawing) return
    this.preview = drawing
    this.drawingManager.addDrawing(drawing)
  }

  private applyChartInteractionLock(): void {
    const locked = this.replaySelectionState.mode === 'selecting' || this.activeTool !== null || this.drawingManager.getSelectedDrawing() !== null || this.draggingOrder !== null
    this.chart?.applyOptions({ handleScroll: !locked, handleScale: !locked })
  }

  private applyReplaySelectionState(): void {
    let state = this.replaySelectionState
    if (state.mode === 'active') {
      const projected = this.projectReplayTimestamp(state.timestamp)
      state = projected === null ? { mode: 'inactive' } : { mode: 'active', timestamp: projected }
    }
    this.replaySelectionPrimitive.setState(state)
    const selecting = this.replaySelectionState.mode === 'selecting'
    this.chart?.applyOptions({
      crosshair: {
        vertLine: {
          color: selecting ? '#2962ff' : '#787b8688',
          labelBackgroundColor: selecting ? '#2962ff' : '#2a2e39',
        },
      },
    })
    if (this.container) {
      this.container.style.cursor = selecting ? 'crosshair' : ''
      if (selecting) {
        this.container.tabIndex = 0
        this.container.setAttribute('role', 'group')
        this.container.setAttribute('aria-label', 'Select replay start bar. Use Left and Right arrows, then Enter.')
        queueMicrotask(() => this.container?.focus({ preventScroll: true }))
      } else {
        this.container.removeAttribute('tabindex')
        this.container.removeAttribute('role')
        this.container.removeAttribute('aria-label')
      }
    }
    this.applyChartInteractionLock()
  }

  private projectReplayTimestamp(timestamp: number): number | null {
    if (this.history.length === 0) return null
    let low = 0
    let high = this.history.length - 1
    let match = 0
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if (this.history[middle].time <= timestamp) {
        match = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    return this.history[match]?.time ?? null
  }

  private nearestReplayBarAt(coordinate: number): DisplayBar | null {
    if (!this.chart || this.history.length === 0) return null
    const timestamp = timestampFromTime(this.chart.timeScale().coordinateToTime(coordinate) ?? undefined)
    if (timestamp === null) return null
    let low = 0
    let high = this.history.length - 1
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (this.history[middle].time < timestamp) low = middle + 1
      else high = middle
    }
    const right = this.history[low]
    const left = this.history[Math.max(0, low - 1)]
    if (!right) return left ?? null
    if (!left) return right
    return Math.abs(timestamp - left.time) <= Math.abs(right.time - timestamp) ? left : right
  }
}
