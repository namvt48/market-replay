import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  LineSeries,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
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
import type { IndicatorDrawIntent, IndicatorPlotPoint, SymbolMeta, Timeframe } from '../api/types'
import type { ChartAdapter, ChartCrosshairSync, ChartCursorMode, ChartViewportSync, DisplayBar, DrawingNudgeDirection, EconomicEventMarker, HistoryUpdateOptions, IndicatorRenderResult, OrderLine, OrderLineAction, PriceScaleToggle, ReplaySelectionState, TradeConnection, TradeMarker, ViewportDemand } from './chart-adapter'
import {
  DEFAULT_DRAWING_METADATA,
  appearanceOptions,
  appearanceStyle,
  colorWithOpacity,
  getDrawingAppearance,
  mergeDrawingAppearance,
  type DrawingAppearance,
  type DrawingAppearancePatch,
  type RangeStatKey,
  type DrawingVisibilityUnit,
  type DrawingWorkbenchOptions,
} from './drawing-appearance'
import { DrawingLabelsPrimitive } from './drawing-labels-primitive'
import { EconomicEventMarkersPrimitive } from './economic-event-markers-primitive'
import { IndicatorDrawingsPrimitive } from './indicator-drawings-primitive'
import { projectDrawingsToHistory } from './drawing-projection'
import { DEFAULT_CHART_APPEARANCE, type ChartAppearanceSettings } from './chart-settings'
import { DEFAULT_CHART_TIMEZONE, formatChartTime, type ChartTimezone } from './chart-timezone'
import { parseTimeframe, timeframeSeconds } from './timeframe'
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
const CHART_FONT_SIZE = 14
const MAX_ADAPTER_HISTORY_BARS = 6_000
const BULK_PUSH_BARS = 32
const CURSOR_MODE_CLASSES = ['chart-cursor-cross', 'chart-cursor-dot', 'chart-cursor-arrow', 'chart-cursor-demonstration', 'chart-cursor-eraser'] as const
const MAX_PRICE_LABEL_CACHE = 4_096
const INDICATOR_PLOT_COLORS = ['#5b8cff', '#22ab94', '#ffb74d', '#c084fc', '#ff5563'] as const
/**
 * A plot suffix this long or longer is applied as one setData instead of a
 * run of update() calls — the same threshold and the same reason as
 * BULK_PUSH_BARS: update()'s cost is nowhere near constant, so a large batch
 * turns into the storm pushBars documents, and one mutation per series per
 * flush is the rule this adapter holds itself to.
 */
const BULK_INDICATOR_POINTS = 32
const TIMEFRAME_VISIBILITY_UNITS: Record<'s' | 'm' | 'h' | 'd' | 'w' | 'M', DrawingVisibilityUnit> = {
  s: 'seconds', m: 'minutes', h: 'hours', d: 'days', w: 'weeks', M: 'months',
}

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
  screenAnchor?: { x: number; y: number }
}

interface PersistentRangeGesture {
  pointerId: number
  tool: 'price-range' | 'date-range'
  anchor: PlacementAnchor
  startX: number
  startY: number
  dragged: boolean
}

type InlineEditorVariant = 'callout' | 'comment' | 'note' | 'text'

interface InlineEditorConfig {
  anchorIndex: number
  label: string
  variant: InlineEditorVariant
}

const INLINE_EDITOR_CONFIGS: Readonly<Record<string, InlineEditorConfig>> = {
  'text-annotation': { anchorIndex: 0, label: 'text', variant: 'text' },
  'anchored-text': { anchorIndex: 1, label: 'Anchored Text', variant: 'note' },
  note: { anchorIndex: 1, label: 'Note', variant: 'note' },
  callout: { anchorIndex: 1, label: 'Callout', variant: 'callout' },
  comment: { anchorIndex: 0, label: 'Comment', variant: 'comment' },
}

const EMPTY_TEXT_REMOVAL_TYPES = new Set(Object.keys(INLINE_EDITOR_CONFIGS))
const LEADER_ANNOTATION_TOOLS = new Set(['anchored-text', 'note', 'price-note', 'callout'])

interface LeaderAnnotationGesture {
  pointerId: number
  tool: string
  anchor: PlacementAnchor
  startX: number
  startY: number
  dragged: boolean
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

interface FreehandGesture {
  pointerId: number
  tool: 'brush'
  anchors: PlacementAnchor[]
  lastX: number
  lastY: number
}

interface AreaZoomGesture {
  pointerId: number
  startX: number
  startY: number
  currentX: number
  currentY: number
}

interface AreaZoomRestoreState {
  logicalRange: LogicalRange
  priceRange: ManualPriceRange
  priceAutoScale: boolean
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

/** What the previous setIndicators call actually put on the chart. */
interface RenderedIndicator {
  /**
   * The exact arrays last rendered, kept by reference so the next call can
   * diff raw point-to-point. Diffing the payload rather than derived LineData
   * is the point: the dominant cost of the previous implementation was
   * allocating one object per plot point *before* it knew anything had moved.
   */
  plots: readonly IndicatorPlotPoint[]
  draws: readonly IndicatorDrawIntent[]
  /** Every "<indicatorId>:<plotKey>" series this indicator owns. */
  seriesKeys: Set<string>
}

/**
 * The only style keys IndicatorDrawingsRenderer paints with — see
 * indicator-drawings-primitive.ts. Comparing this fixed set is exact with
 * respect to what can reach a pixel, and it keeps an unchanged frame at a
 * handful of primitive compares per draw with no allocation at all. A string
 * digest was the alternative and is worse: for a script emitting ~1,000
 * draws it would allocate thousands of short strings on every call, which
 * costs more than the setData it is trying to avoid.
 *
 * Keep in sync with the renderer. A key added there and forgotten here
 * simply stops repainting — see the test that documents this boundary.
 */
const DRAW_STYLE_KEYS = [
  'linecolor', 'color', 'backgroundColor', 'textcolor',
  'linewidth', 'linestyle', 'extendRight', 'showLabel',
] as const

function sameIndicatorResults(next: readonly IndicatorRenderResult[], previous: readonly IndicatorRenderResult[]): boolean {
  if (next === previous) return true
  if (next.length !== previous.length) return false
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== previous[index]) return false
  }
  return true
}

/** Handles both scalars and the {r,g,b,a} literals scripts pass for colors. */
function sameStyleValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a
}

function sameIndicatorDraws(next: readonly IndicatorDrawIntent[], previous: readonly IndicatorDrawIntent[] | undefined): boolean {
  if (next === previous) return true
  if (!previous || next.length !== previous.length) return false
  for (let index = 0; index < next.length; index += 1) {
    const a = next[index]
    const b = previous[index]
    if (a === b) continue
    if (a.id !== b.id || a.kind !== b.kind || a.t0 !== b.t0 || a.y0 !== b.y0
      || a.t1 !== b.t1 || a.y1 !== b.y1 || a.label !== b.label) return false
    for (const key of DRAW_STYLE_KEYS) {
      if (!sameStyleValue(a.style[key], b.style[key])) return false
    }
  }
  return true
}

type PlotDelta = { kind: 'identical' } | { kind: 'append'; from: number } | { kind: 'replace' }

function samePlotPoint(a: IndicatorPlotPoint, b: IndicatorPlotPoint): boolean {
  return a === b || (a.time === b.time && a.value === b.value && a.key === b.key)
}

/**
 * Classifies a new plot stream against the rendered one.
 *
 * The point that used to be last is checked first, on its own: if it no
 * longer matches, the stream was recomputed rather than extended, which is
 * the rewind and timeframe-change case, and the full walk would only confirm
 * that the slow way. When it does match the prefix is still walked in full —
 * an input change can alter mid-series values while leaving the first and
 * last point identical, and that has to land on 'replace' rather than being
 * silently skipped.
 */
function plotDelta(previous: readonly IndicatorPlotPoint[] | undefined, next: readonly IndicatorPlotPoint[]): PlotDelta {
  if (!previous) return next.length === 0 ? { kind: 'identical' } : { kind: 'replace' }
  if (next === previous) return { kind: 'identical' }
  if (next.length < previous.length) return { kind: 'replace' }
  const boundary = previous.length - 1
  if (boundary >= 0 && !samePlotPoint(previous[boundary], next[boundary])) return { kind: 'replace' }
  for (let index = 0; index < boundary; index += 1) {
    if (!samePlotPoint(previous[index], next[index])) return { kind: 'replace' }
  }
  return next.length === previous.length ? { kind: 'identical' } : { kind: 'append', from: previous.length }
}

export class LwcAdapter implements ChartAdapter {
  private chart: IChartApi | null = null
  private candles: ISeriesApi<'Candlestick'> | null = null
  private volume: ISeriesApi<'Histogram'> | null = null
  private spacer: ISeriesApi<'Line'> | null = null
  private markers: ISeriesMarkersPluginApi<Time> | null = null
  private container: HTMLElement | null = null
  private chartRoot: HTMLElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private lastWidth = 0
  private lastHeight = 0
  private history: DisplayBar[] = []
  /** @internal Exposed for deterministic adapter interaction tests. */
  readonly orderPrimitive = new OrderLinesPrimitive()
  /** @internal Exposed for deterministic adapter interaction tests. */
  readonly tradeConnectionsPrimitive = new TradeConnectionsPrimitive()
  /** @internal Exposed for deterministic adapter interaction tests. */
  readonly economicEventMarkersPrimitive = new EconomicEventMarkersPrimitive()
  readonly indicatorDrawingsPrimitive = new IndicatorDrawingsPrimitive()
  private indicatorSeries = new Map<string, ISeriesApi<'Line'>>()
  /** Newest rendered timestamp per series key — what update() must stay ahead of. */
  private indicatorSeriesTail = new Map<string, number>()
  /** Color slot per series key, assigned once and never released. */
  private indicatorPlotColors = new Map<string, number>()
  private renderedIndicators = new Map<string, RenderedIndicator>()
  private renderedIndicatorResults: readonly IndicatorRenderResult[] = []
  /**
   * The chart the three maps above describe. A destroy()/init() cycle — which
   * is exactly what popping a pane out does — leaves the memo describing a
   * chart that no longer exists, and an unchanged payload would then render
   * nothing at all. Comparing chart identity carries that invariant in the
   * data instead of trusting every teardown path to remember it.
   */
  private renderedIndicatorChart: IChartApi | null = null
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
  private areaZoomChangedHandler: (state: { selecting: boolean; zoomed: boolean }) => void = () => undefined
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
  private cursorMode: ChartCursorMode = 'cross'
  private cursorIndicator: HTMLDivElement | null = null
  private placement: DrawingPlacementState = IDLE_DRAWING_PLACEMENT
  private pathAnchors: PlacementAnchor[] = []
  private freehandGesture: FreehandGesture | null = null
  private leaderAnnotationGesture: LeaderAnnotationGesture | null = null
  private suppressNextDrawingClick = false
  private suppressNextDrawingDoubleClick = false
  private preview: IDrawing | null = null
  private measurementGesture: { pointerId: number; startX: number; startY: number; dragged: boolean; transient: boolean } | null = null
  private persistentRangeGesture: PersistentRangeGesture | null = null
  private measurementClickAnchored = false
  private measurementPreviewPinned = false
  private draggingOrder: OrderLine | null = null
  private protectionDrag: ProtectionDragState | null = null
  private suppressNextOrderActionClick = false
  private quantityEditor: HTMLDivElement | null = null
  private textEditor: HTMLInputElement | null = null
  private textEditorDrawingId: string | null = null
  private textEditorOriginalText = ''
  private textEditorDirty = false
  private draggingDrawing: DrawingDragState | null = null
  private drawingPriceScaleLock: DrawingPriceScaleLock | null = null
  private drawingsHidden = false
  private drawingsLocked = false
  private keepDrawing = false
  private areaZoomSelecting = false
  private areaZoomGesture: AreaZoomGesture | null = null
  private areaZoomRestoreState: AreaZoomRestoreState | null = null
  private areaZoomOverlay: HTMLDivElement | null = null
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
  private secondsVisible = false
  private currentTimeframe: Timeframe = '1m'
  private volumePaneHeight = 100
  private hoverUnsubscribe: (() => void) | null = null
  private readonly hoverStore: HoverBarStore

  constructor(hoverStore: HoverBarStore = new HoverBarStore()) {
    this.hoverStore = hoverStore
  }

  async init(element: HTMLElement, symbol: SymbolMeta, timeframe: Timeframe): Promise<void> {
    // ReplayEngine applies global drawing controls before a newly-created pane
    // is initialized. Preserve those externally-owned controls while clearing
    // any chart-owned resources from a previous initialization.
    const drawingControls = {
      hidden: this.drawingsHidden,
      locked: this.drawingsLocked,
      keepDrawing: this.keepDrawing,
      cursorMode: this.cursorMode,
    }
    this.destroy()
    this.drawingsHidden = drawingControls.hidden
    this.drawingsLocked = drawingControls.locked
    this.keepDrawing = drawingControls.keepDrawing
    this.cursorMode = drawingControls.cursorMode
    this.drawingManager = new DrawingManager()
    this.container = element
    this.pricePrecision = symbol.priceDecimals
    this.tickSize = symbol.tickSize
    this.symbolCode = symbol.symbol
    this.currentTimeframe = timeframe
    this.secondsVisible = parseTimeframe(timeframe)?.unit === 's'
    // Canvas text is rasterized only when Lightweight Charts creates its
    // panes. Wait for the shipped UI face so price/time labels do not retain
    // a fallback raster on first paint.
    if ('fonts' in document) {
      try {
        await document.fonts.load(`${CHART_FONT_SIZE}px "Roboto Variable"`)
      } catch {
        // The system fallbacks remain valid when a browser cannot expose the
        // Font Loading API (for example in an embedded webview).
      }
    }
    const existingChildren = new Set(element.children)
    this.chart = createChart(element, {
      // This adapter already owns one guarded ResizeObserver below. Keeping
      // Lightweight Charts autoSize enabled creates a second observer whose
      // queued callback can outlive a chart moved back from a pop-out window.
      autoSize: false,
      layout: { background: { type: ColorType.Solid, color: this.appearance.backgroundColor }, textColor: this.appearance.textColor, fontFamily: UI_FONT_FAMILY, fontSize: CHART_FONT_SIZE, attributionLogo: false, panes: { separatorColor: '#2a2e39', enableResize: true } },
      grid: { vertLines: { color: this.appearance.verticalGridColor, visible: this.appearance.showGrid }, horzLines: { color: this.appearance.horizontalGridColor, visible: this.appearance.showGrid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#787b8688', labelBackgroundColor: '#2a2e39' }, horzLine: { color: '#787b8688', labelBackgroundColor: '#2a2e39' } },
      rightPriceScale: { borderColor: '#434651', scaleMargins: { top: 0.08, bottom: 0.06 } },
      timeScale: { borderColor: '#434651', rightOffset: 12, barSpacing: 7, shiftVisibleRangeOnNewBar: true, timeVisible: true, secondsVisible: this.secondsVisible, tickMarkFormatter: (time: Time) => formatChartTime(timestampFromTime(time) ?? 0, this.displayTimezone, false, this.secondsVisible) },
      localization: { priceFormatter: createPriceFormatter(symbol.priceDecimals), timeFormatter: (time: Time) => formatChartTime(timestampFromTime(time) ?? 0, this.displayTimezone, true, this.secondsVisible) },
      handleScale: true,
      handleScroll: true,
    })
    const chartRoot = Array.from(element.children).find((child) => !existingChildren.has(child))
    this.chartRoot = chartRoot && 'style' in chartRoot ? chartRoot as HTMLElement : null
    this.fillChartContainer()
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
    this.candles.attachPrimitive(this.indicatorDrawingsPrimitive)
    this.drawingManager.attach(this.chart, this.candles, element)
    this.bindDrawingEvents()
    this.bindInteractions()
    this.chart.subscribeCrosshairMove(this.handleCrosshairMove)
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.handleVisibleLogicalRangeChange)
    this.chart.timeScale().subscribeVisibleTimeRangeChange(this.handleVisibleTimeRangeChange)
    this.applyAppearance(this.appearance)
    this.applyReplaySelectionState()
    // ResizeObserver is the fallback path for size changes we don't drive
    // ourselves (window resize, a pop-out window's own OS-level resize). It
    // always fires at least one tick after the DOM has already resized, so
    // relying on it alone during an active split-drag left the canvas
    // visibly trailing the container's current width. ChartTile also calls
    // syncContainerSize() from a layout effect on every commit, which runs
    // synchronously right after the drag's own re-render resizes this
    // element — closing that gap for the case that actually matters.
    this.resizeObserver = new ResizeObserver(() => this.syncContainerSize())
    this.resizeObserver.observe(element)
  }

  syncContainerSize(): void {
    if (!this.chart || !this.container) return
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === this.lastWidth && height === this.lastHeight) return
    this.lastWidth = width
    this.lastHeight = height
    // Resizing this pane's own width changes how many bars fit at a fixed
    // barSpacing, which fires the same visible-range callbacks a real user
    // pan/zoom would; route it through the same guard as any other
    // programmatic viewport change so it doesn't echo out as a sync event
    // and fight a sibling pane resizing at the same time.
    this.withExternalSync(() => {
      this.chart?.resize(width, height, true)
      this.fillChartContainer()
    })
    this.positionInlineTextEditor()
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
    const secondsVisible = bars.some((bar, index) => index > 0 && bar.time > bars[index - 1].time && bar.time - bars[index - 1].time < 60)
    if (bars.length > 1 && secondsVisible !== this.secondsVisible) {
      this.secondsVisible = secondsVisible
      this.chart?.applyOptions({
        localization: { timeFormatter: (time: Time) => formatChartTime(timestampFromTime(time) ?? 0, this.displayTimezone, true, this.secondsVisible) },
        timeScale: { secondsVisible, tickMarkFormatter: (time: Time) => formatChartTime(timestampFromTime(time) ?? 0, this.displayTimezone, false, this.secondsVisible) },
      })
    }
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
      localization: { timeFormatter: (time: Time) => formatChartTime(timestampFromTime(time) ?? 0, timezone, true, this.secondsVisible) },
      timeScale: { tickMarkFormatter: (time: Time) => formatChartTime(timestampFromTime(time) ?? 0, timezone, false, this.secondsVisible) },
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

  /**
   * Publishes one refresh's indicator output.
   *
   * Called far more often than its output changes: every pane sharing a
   * symbol and timeframe gets the same results, toggling one indicator
   * republishes all of them, and while the replay is playing the cursor keeps
   * moving inside a display bucket whose closed-bar output is by definition
   * identical. So the first job is to notice that nothing moved and touch
   * nothing — no repaint request, no setData, no allocation. The second is to
   * treat the forward case as what it is, an append, rather than replacing
   * ~1,500 points per series to add one.
   */
  setIndicators(results: IndicatorRenderResult[]): void {
    const chart = this.chart
    if (!chart) {
      // The primitive holds state without a canvas; series cannot. Push the
      // drawings and deliberately memoize nothing, so the first call after
      // init() still builds every series from scratch.
      this.indicatorDrawingsPrimitive.setDraws(results.flatMap((result) => result.draws))
      return
    }
    const rebuiltChart = chart !== this.renderedIndicatorChart
    if (rebuiltChart) {
      // The handles belong to a chart that is gone; removeSeries on the new
      // one would throw. Drop them and rebuild.
      this.indicatorSeries.clear()
      this.indicatorSeriesTail.clear()
      this.renderedIndicators.clear()
    } else if (sameIndicatorResults(results, this.renderedIndicatorResults)) {
      return
    }

    const drawsChanged = rebuiltChart
      || results.length !== this.renderedIndicators.size
      || results.some((result) => !sameIndicatorDraws(result.draws, this.renderedIndicators.get(result.indicatorId)?.draws))
    if (drawsChanged) this.indicatorDrawingsPrimitive.setDraws(results.flatMap((result) => result.draws))

    const present = new Set<string>()
    for (const result of results) {
      present.add(result.indicatorId)
      const rendered = this.renderedIndicators.get(result.indicatorId)
      const delta = plotDelta(rendered?.plots, result.plots)
      if (delta.kind === 'identical') {
        // Geometry may still have moved, so the memoized draws have to
        // advance even though no series is touched.
        if (rendered) this.renderedIndicators.set(result.indicatorId, { ...rendered, draws: result.draws })
        else this.renderedIndicators.set(result.indicatorId, { plots: result.plots, draws: result.draws, seriesKeys: new Set() })
        continue
      }
      if (delta.kind === 'append') this.appendIndicatorPlots(result, delta.from)
      else this.replaceIndicatorPlots(result)
    }
    for (const [indicatorId, rendered] of this.renderedIndicators) {
      if (present.has(indicatorId)) continue
      for (const key of rendered.seriesKeys) this.removeIndicatorSeries(key)
      this.renderedIndicators.delete(indicatorId)
    }
    this.renderedIndicatorResults = results
    this.renderedIndicatorChart = chart
  }

  /**
   * The forward case: the new stream is the rendered one plus a suffix, so
   * only the suffix reaches the chart.
   *
   * The whole suffix is validated before anything mutates. update() throws on
   * a timestamp older than a series' last point, and a one-pass version could
   * half-mutate before discovering that and then rebuild — mutating a series
   * twice in one frame. A suffix that is out of order, lands on a series that
   * does not exist yet, or is BULK_INDICATOR_POINTS or longer falls back to
   * one setData per series instead.
   */
  private appendIndicatorPlots(result: IndicatorRenderResult, from: number): void {
    const suffix = new Map<string, LineData<Time>[]>()
    for (let index = from; index < result.plots.length; index += 1) {
      const point = result.plots[index]
      if (!Number.isFinite(point.time) || !Number.isFinite(point.value)) continue
      const key = `${result.indicatorId}:${point.key}`
      const points = suffix.get(key) ?? []
      points.push({ time: toTime(point.time), value: point.value })
      suffix.set(key, points)
    }
    for (const points of suffix.values()) {
      points.sort((left, right) => Number(left.time) - Number(right.time))
    }
    for (const [key, points] of suffix) {
      const tail = this.indicatorSeriesTail.get(key)
      if (!this.indicatorSeries.has(key) || tail === undefined
        || Number(points[0].time) < tail || points.length >= BULK_INDICATOR_POINTS) {
        this.replaceIndicatorPlots(result)
        return
      }
    }
    const rendered = this.renderedIndicators.get(result.indicatorId)
    const seriesKeys = new Set(rendered?.seriesKeys ?? [])
    for (const [key, points] of suffix) {
      const series = this.indicatorSeries.get(key)
      if (!series) continue
      for (const point of points) series.update(point)
      this.indicatorSeriesTail.set(key, Number(points[points.length - 1].time))
      seriesKeys.add(key)
    }
    this.renderedIndicators.set(result.indicatorId, { plots: result.plots, draws: result.draws, seriesKeys })
  }

  /** The cold path: first render, rewind, timeframe change, input change. */
  private replaceIndicatorPlots(result: IndicatorRenderResult): void {
    if (!this.chart) return
    // Map per key so a repeated timestamp resolves last-write-wins; setData
    // rejects duplicates.
    const grouped = new Map<string, Map<number, LineData<Time>>>()
    for (const point of result.plots) {
      if (!Number.isFinite(point.time) || !Number.isFinite(point.value)) continue
      const key = `${result.indicatorId}:${point.key}`
      const points = grouped.get(key) ?? new Map<number, LineData<Time>>()
      points.set(point.time, { time: toTime(point.time), value: point.value })
      grouped.set(key, points)
    }
    for (const key of this.renderedIndicators.get(result.indicatorId)?.seriesKeys ?? []) {
      if (!grouped.has(key)) this.removeIndicatorSeries(key)
    }
    for (const [key, points] of grouped) {
      const data = [...points.values()].sort((left, right) => Number(left.time) - Number(right.time))
      this.ensureIndicatorSeries(key).setData(data)
      this.indicatorSeriesTail.set(key, Number(data[data.length - 1].time))
    }
    this.renderedIndicators.set(result.indicatorId, {
      plots: result.plots, draws: result.draws, seriesKeys: new Set(grouped.keys()),
    })
  }

  private ensureIndicatorSeries(key: string): ISeriesApi<'Line'> {
    const existing = this.indicatorSeries.get(key)
    if (existing) return existing
    const series = this.chart!.addSeries(LineSeries, {
      color: INDICATOR_PLOT_COLORS[this.indicatorPlotColorSlot(key)],
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    this.indicatorSeries.set(key, series)
    return series
  }

  /**
   * A plot's color is bound to its "<indicatorId>:<plotKey>" identity for the
   * life of the chart. The previous code indexed INDICATOR_PLOT_COLORS by Map
   * iteration order, so removing one indicator recolored every plot after it.
   *
   * Lowest-free-slot rather than a hash of the key: a hash is stateless and
   * trivially stable, but across five colors it collides between indicators,
   * and two overlapping plots in the same color is the confusion this exists
   * to prevent. The slot is never released, so an indicator that is removed
   * and re-added comes back the color the user last saw it in.
   */
  private indicatorPlotColorSlot(key: string): number {
    const assigned = this.indicatorPlotColors.get(key)
    if (assigned !== undefined) return assigned
    const taken = new Set<number>()
    for (const live of this.indicatorSeries.keys()) {
      const slot = this.indicatorPlotColors.get(live)
      if (slot !== undefined) taken.add(slot)
    }
    let slot = 0
    while (slot < INDICATOR_PLOT_COLORS.length && taken.has(slot)) slot += 1
    if (slot === INDICATOR_PLOT_COLORS.length) slot = this.indicatorPlotColors.size % INDICATOR_PLOT_COLORS.length
    this.indicatorPlotColors.set(key, slot)
    return slot
  }

  /** The single choke point for dropping an indicator series. */
  private removeIndicatorSeries(key: string): void {
    const series = this.indicatorSeries.get(key)
    if (series && this.chart) this.chart.removeSeries(series)
    this.indicatorSeries.delete(key)
    this.indicatorSeriesTail.delete(key)
    // The color slot is deliberately retained — see indicatorPlotColorSlot.
  }

  setTradeConnections(connections: TradeConnection[]): void {
    this.tradeConnectionsPrimitive.setConnections(connections)
  }

  setOrderLines(lines: OrderLine[]): void {
    const draggingOrder = this.draggingOrder
    if (!draggingOrder) {
      this.orderPrimitive.setLines(lines)
      this.syncOrderKeyboardState(lines)
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
    this.syncOrderKeyboardState(nextLines)
  }
  onOrderLineMove(handler: (id: string, price: number) => void): void { this.orderMoveHandler = handler }
  onOrderLineDragStart(handler: (id: string) => void): void { this.orderDragStartHandler = handler }
  onOrderLineAction(handler: (action: OrderLineAction) => void): void { this.orderActionHandler = handler }
  onChartOrder(handler: (side: 'buy' | 'sell', type: 'limit' | 'stop', price: number) => void): void { this.chartOrderHandler = handler }
  drawingTools(): DrawingToolDefinition[] { return getToolRegistry().getAll() }

  setCursorMode(mode: ChartCursorMode): void {
    if (this.activeTool) this.setDrawingTool(null)
    if (mode === 'eraser') this.drawingManager.deselectAll()
    this.cursorMode = mode
    this.applyCursorMode()
  }

  private applyCursorMode(): void {
    const showsCrosshair = this.cursorMode === 'cross' || this.cursorMode === 'demonstration'
    this.chart?.applyOptions({
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          visible: showsCrosshair,
          labelVisible: showsCrosshair,
          color: '#787b8688',
          labelBackgroundColor: '#2a2e39',
          style: LineStyle.Dashed,
        },
        horzLine: {
          visible: showsCrosshair,
          labelVisible: showsCrosshair,
          color: '#787b8688',
          labelBackgroundColor: '#2a2e39',
          style: LineStyle.Dashed,
        },
      },
    })
    if (!this.container) return
    this.container.classList.remove(...CURSOR_MODE_CLASSES)
    this.container.classList.add(`chart-cursor-${this.cursorMode}`)
    if (this.replaySelectionState.mode !== 'selecting') {
      this.container.style.cursor = this.cursorMode === 'arrow' ? 'default' : this.cursorMode === 'eraser' ? 'crosshair' : this.cursorMode === 'cross' ? 'crosshair' : 'none'
    }
    if (this.cursorMode !== 'dot' && this.cursorMode !== 'demonstration') this.removeCursorIndicator()
  }

  private updateCursorIndicator(event: PointerEvent): void {
    if (!this.container || this.activeTool || (this.cursorMode !== 'dot' && this.cursorMode !== 'demonstration')) return
    const rect = this.container.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      this.removeCursorIndicator()
      return
    }
    if (!this.cursorIndicator) {
      this.cursorIndicator = this.container.ownerDocument.createElement('div')
      this.cursorIndicator.className = 'chart-cursor-indicator'
      this.cursorIndicator.setAttribute('aria-hidden', 'true')
      this.container.append(this.cursorIndicator)
    }
    this.cursorIndicator.dataset.mode = this.cursorMode
    this.cursorIndicator.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  private removeCursorIndicator = (): void => {
    this.cursorIndicator?.remove()
    this.cursorIndicator = null
  }

  setDrawingTool(tool: string | null): void {
    if (tool && this.drawingsHidden) this.toggleDrawingsVisibility()
    if (this.areaZoomSelecting) this.cancelAreaZoomSelection()
    this.cancelPreview()
    this.measurementGesture = null
    this.persistentRangeGesture = null
    this.measurementClickAnchored = false
    this.pathAnchors = []
    this.freehandGesture = null
    this.leaderAnnotationGesture = null
    if (tool) this.drawingManager.deselectAll()
    this.activeTool = tool
    const definition = tool ? getToolRegistry().get(tool) : undefined
    this.placement = definition && tool ? startDrawingPlacement(tool, definition.requiredAnchors) : IDLE_DRAWING_PLACEMENT
    this.drawingManager.setActiveTool(tool)
    if (tool) {
      this.removeCursorIndicator()
      this.container?.classList.remove(...CURSOR_MODE_CLASSES)
      this.container?.classList.add('chart-cursor-cross')
      if (this.container) this.container.style.cursor = 'crosshair'
      this.chart?.applyOptions({
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { visible: true, labelVisible: true, color: '#787b8688', labelBackgroundColor: '#2a2e39', style: LineStyle.Dashed },
          horzLine: { visible: true, labelVisible: true, color: '#787b8688', labelBackgroundColor: '#2a2e39', style: LineStyle.Dashed },
        },
      })
    } else this.applyCursorMode()
    this.applyChartInteractionLock()
    this.drawingToolChangedHandler(tool)
  }

  deselectDrawing(): void {
    this.finishInlineTextEditor('commit')
    this.drawingManager.deselectAll()
  }

  deleteSelectedDrawing(): void {
    const selected = this.drawingManager.getSelectedDrawing()
    if (selected) {
      this.closeInlineTextEditor()
      this.drawingManager.removeDrawing(selected.id)
    }
  }

  lockSelectedDrawing(): void {
    const selected = this.drawingManager.getSelectedDrawing()
    if (!selected) return
    selected.updateOptions({ locked: !(selected.options.locked ?? false) })
    this.recordDrawingHistory('drawing:updated', selected.id)
    this.drawingLabelsPrimitive.requestUpdate()
    this.drawingSelectionHandler(this.getDrawingAppearance(selected))
    this.drawingChangedHandler(selected.id)
    this.applyChartInteractionLock()
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
    const current = this.getDrawingAppearance(drawing)
    let nextPatch = patch
    if (drawing.type === 'text-annotation' && patch.textAnchored !== undefined && patch.textAnchored !== current.textAnchored) {
      const width = Math.max(1, this.chart?.timeScale().width() ?? this.container?.clientWidth ?? 1)
      const height = Math.max(1, this.container?.clientHeight ?? 1)
      if (patch.textAnchored) {
        const anchor = drawing.anchors[0]
        const x = anchor ? this.chart?.timeScale().timeToCoordinate(anchor.time) : null
        const y = anchor ? this.candles?.priceToCoordinate(anchor.price) : null
        nextPatch = {
          ...patch,
          textAnchorX: x === null || x === undefined ? current.textAnchorX : Math.max(0, Math.min(1, x / width)),
          textAnchorY: y === null || y === undefined ? current.textAnchorY : Math.max(0, Math.min(1, y / height)),
        }
      } else {
        const time = this.chart?.timeScale().coordinateToTime(current.textAnchorX * width)
        const price = this.candles?.coordinateToPrice(current.textAnchorY * height)
        if (time !== null && time !== undefined && price !== null && price !== undefined) drawing.updateAnchor(0, { time, price })
      }
    }
    if (nextPatch.coordinates && nextPatch.coordinates.length === drawing.anchors.length) {
      drawing.setAnchors(nextPatch.coordinates.map((coordinate, index) => {
        const fallback = drawing.anchors[index]
        const bar = this.history[Math.min(Math.max(0, coordinate.bar), Math.max(0, this.history.length - 1))]
        return { time: bar ? toTime(bar.time) : fallback.time, price: coordinate.price }
      }))
    }
    const appearance = mergeDrawingAppearance(this.getDrawingAppearance(drawing), nextPatch)
    this.applyDrawingAppearance(drawing, appearance)
  }

  private applyDrawingAppearance(drawing: IDrawing, appearance: DrawingAppearance): void {
    drawing.updateStyle(appearanceStyle(appearance))
    drawing.updateOptions({ ...appearanceOptions(appearance), visible: this.isDrawingVisibleAtCurrentTimeframe(appearance) })
    this.recordDrawingHistory('drawing:updated', drawing.id)
    this.drawingLabelsPrimitive.requestUpdate()
    this.drawingSelectionHandler(this.getDrawingAppearance(drawing))
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
    this.drawingSelectionHandler(this.getDrawingAppearance(drawing))
    this.drawingChangedHandler(drawing.id)
    return true
  }

  toggleDrawingsVisibility(): void {
    this.setDrawingsHidden(!this.drawingsHidden)
  }

  setDrawingsHidden(hidden: boolean): void {
    if (this.drawingsHidden === hidden) return
    this.drawingsHidden = hidden
    if (this.drawingsHidden) this.drawingManager.deselectAll()
    for (const drawing of this.drawingManager.getAllDrawings()) {
      if (drawing.id === PREVIEW_ID) continue
      if (this.drawingsHidden) drawing.detach()
      else if (this.candles && this.chart) drawing.attach(this.candles, this.chart, this.container ?? undefined)
    }
    this.drawingLabelsPrimitive.requestUpdate()
  }

  setAllDrawingsLocked(locked: boolean): void {
    if (this.drawingsLocked === locked) return
    this.drawingsLocked = locked
    if (locked) this.drawingManager.deselectAll()
    for (const drawing of this.drawingManager.getAllDrawings()) {
      if (drawing.id !== PREVIEW_ID) drawing.updateOptions({ locked })
    }
    this.recordDrawingHistory('drawing:updated')
    this.drawingLabelsPrimitive.requestUpdate()
    this.drawingChangedHandler()
    this.applyChartInteractionLock()
  }

  setKeepDrawing(enabled: boolean): void { this.keepDrawing = enabled }
  drawingCount(): number { return this.getDrawings().length }

  private getDrawingAppearance(drawing: IDrawing): DrawingAppearance {
    const appearance = getDrawingAppearance(drawing, (time) => {
      const timestamp = timestampFromTime(time)
      if (timestamp === null || this.history.length === 0) return 0
      let closestIndex = 0
      let closestDistance = Math.abs(this.history[0].time - timestamp)
      for (let index = 1; index < this.history.length; index += 1) {
        const distance = Math.abs(this.history[index].time - timestamp)
        if (distance >= closestDistance) continue
        closestIndex = index
        closestDistance = distance
      }
      return closestIndex
    })
    const rangeStart = appearance.coordinates?.[0]?.bar ?? 0
    const rangeEnd = appearance.coordinates?.[1]?.bar ?? rangeStart
    const from = Math.max(0, Math.min(rangeStart, rangeEnd))
    const to = Math.min(this.history.length - 1, Math.max(rangeStart, rangeEnd))
    const rangeVolume = this.history.slice(from, to + 1).reduce((total, bar) => total + bar.volume, 0)
    return {
      ...appearance,
      positionTickSize: this.tickSize,
      positionPricePrecision: this.pricePrecision,
      rangeVolume,
      rangeBarIntervalSeconds: timeframeSeconds(this.currentTimeframe),
      coordinates: appearance.coordinates?.map((coordinate) => ({
        ...coordinate,
        price: Number(coordinate.price.toFixed(this.pricePrecision)),
      })),
    }
  }

  private isDrawingVisibleAtCurrentTimeframe(appearance: DrawingAppearance): boolean {
    const parsed = parseTimeframe(this.currentTimeframe)
    if (!parsed) return true
    const rule = appearance.visibility[TIMEFRAME_VISIBILITY_UNITS[parsed.unit]]
    return rule.enabled && parsed.multiplier >= rule.min && parsed.multiplier <= rule.max
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
      this.drawingManager.getAllDrawings().forEach((drawing) => {
        const appearance = this.getDrawingAppearance(drawing)
        drawing.updateOptions({ visible: this.isDrawingVisibleAtCurrentTimeframe(appearance) })
      })
      if (this.drawingsLocked) this.drawingManager.getAllDrawings().forEach((drawing) => drawing.updateOptions({ locked: true }))
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
      this.drawingManager.getAllDrawings().forEach((drawing) => {
        const appearance = this.getDrawingAppearance(drawing)
        drawing.updateOptions({ visible: this.isDrawingVisibleAtCurrentTimeframe(appearance) })
      })
      if (this.drawingsLocked) this.drawingManager.getAllDrawings().forEach((drawing) => drawing.updateOptions({ locked: true }))
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
  onAreaZoomChanged(handler: (state: { selecting: boolean; zoomed: boolean }) => void): void { this.areaZoomChangedHandler = handler }
  areaZoomState(): { selecting: boolean; zoomed: boolean } { return { selecting: this.areaZoomSelecting, zoomed: this.areaZoomRestoreState !== null } }

  beginAreaZoom(): void {
    if (!this.chart || !this.candles) return
    this.setDrawingTool(null)
    this.drawingManager.deselectAll()
    this.areaZoomSelecting = true
    this.areaZoomGesture = null
    this.removeAreaZoomOverlay()
    this.container?.classList.add('chart-area-zoom-active')
    this.applyChartInteractionLock()
    if (this.container) {
      if (this.container.tabIndex < 0) this.container.tabIndex = 0
      this.container.focus({ preventScroll: true })
    }
    this.areaZoomChangedHandler({ selecting: true, zoomed: this.areaZoomRestoreState !== null })
  }

  resetAreaZoom(): void {
    const restore = this.areaZoomRestoreState
    if (!restore || !this.chart || !this.candles) return
    this.cancelAreaZoomSelection()
    this.withExternalSync(() => {
      this.chart?.timeScale().setVisibleLogicalRange(restore.logicalRange)
      const scale = this.candles?.priceScale()
      scale?.setVisibleRange(restore.priceRange)
      scale?.setAutoScale(restore.priceAutoScale)
    })
    this.areaZoomRestoreState = null
    queueMicrotask(() => this.scheduleViewportSync())
    this.areaZoomChangedHandler({ selecting: false, zoomed: false })
  }

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
    const chart = this.chart
    const chartWindow = this.container?.ownerDocument.defaultView
    this.removeCursorIndicator()
    this.container?.classList.remove(...CURSOR_MODE_CLASSES, 'chart-replay-selecting')
    this.removeAreaZoomOverlay()
    this.closeQuantityEditor()
    this.closeInlineTextEditor()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.lastWidth = 0
    this.lastHeight = 0
    this.drawingManager.detach()
    if (this.chart) this.chart.unsubscribeCrosshairMove(this.handleCrosshairMove)
    if (this.chart) this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.handleVisibleLogicalRangeChange)
    if (this.chart) this.chart.timeScale().unsubscribeVisibleTimeRangeChange(this.handleVisibleTimeRangeChange)
    if (this.container) {
      this.container.removeEventListener('pointerdown', this.handlePointerDown, true)
      this.container.removeEventListener('pointermove', this.handlePointerMove)
      this.container.removeEventListener('pointerleave', this.removeCursorIndicator)
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
    this.chart = null
    this.chartRoot = null
    this.candles = null
    this.volume = null
    this.spacer = null
    this.markers = null
    this.indicatorSeries.clear()
    this.indicatorSeriesTail.clear()
    this.indicatorPlotColors.clear()
    this.renderedIndicators.clear()
    this.renderedIndicatorResults = []
    this.renderedIndicatorChart = null
    this.indicatorDrawingsPrimitive.setDraws([])
    this.container = null
    this.activeTool = null
    this.placement = IDLE_DRAWING_PLACEMENT
    this.pathAnchors = []
    this.freehandGesture = null
    this.leaderAnnotationGesture = null
    this.suppressNextDrawingClick = false
    this.suppressNextDrawingDoubleClick = false
    this.preview = null
    this.measurementGesture = null
    this.measurementClickAnchored = false
    // Lightweight Charts can still have one invalidation frame queued after
    // its public API has finished an update. Let that frame drain while the
    // canvas bindings are alive, then remove the chart. Pop-out windows wait
    // one additional frame before closing for the same reason.
    if (chart) window.requestAnimationFrame(() => {
      if (!chartWindow?.closed) chart.remove()
    })
    this.measurementPreviewPinned = false
    this.draggingDrawing = null
    this.drawingPriceScaleLock = null
    this.drawingsHidden = false
    this.drawingsLocked = false
    this.keepDrawing = false
    this.areaZoomSelecting = false
    this.areaZoomGesture = null
    this.areaZoomRestoreState = null
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
    this.positionInlineTextEditor()
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
      this.drawingSelectionHandler(selected ? this.getDrawingAppearance(selected) : null)
      if (event.type === 'drawing:updated') this.scheduleDrawingChange(event.drawingId)
      else this.drawingChangedHandler(event.drawingId)
    }
    this.drawingManager.on('drawing:added', changed)
    this.drawingManager.on('drawing:removed', changed)
    this.drawingManager.on('drawing:updated', changed)
    this.drawingManager.on('drawing:cleared', changed)
    this.drawingManager.on('drawing:selected', (event) => {
      this.drawingLabelsPrimitive.requestUpdate()
      this.drawingSelectionHandler(event.drawing ? this.getDrawingAppearance(event.drawing) : null)
      this.applyChartInteractionLock()
    })
    this.drawingManager.on('drawing:deselected', (event) => {
      const drawing = event.drawingId ? this.drawingManager.getDrawing(event.drawingId) : undefined
      if (drawing && EMPTY_TEXT_REMOVAL_TYPES.has(drawing.type) && this.getDrawingAppearance(drawing).text.trim().length === 0) {
        this.drawingManager.removeDrawing(drawing.id)
        this.applyChartInteractionLock()
        return
      }
      this.drawingLabelsPrimitive.requestUpdate()
      this.drawingSelectionHandler(null)
      this.applyChartInteractionLock()
    })
  }

  private bindInteractions(): void {
    if (!this.container || !this.chart || !this.candles) return
    this.container.addEventListener('pointerdown', this.handlePointerDown, true)
    this.container.addEventListener('pointermove', this.handlePointerMove)
    this.container.addEventListener('pointerleave', this.removeCursorIndicator)
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

  private fillChartContainer(): void {
    if (!this.chartRoot) return
    // A split pane can be a fractional CSS-pixel wide on a scaled display.
    // Lightweight Charts snaps its explicit width and writes that integer
    // onto the outer chart element. On the second pane, whose right edge is
    // fixed, the rounded shell then alternates between a small gap and a
    // small overflow while the divider moves. Keep the internal canvases
    // snapped, but make their outer shell cover the pane exactly. This
    // mirrors the library's autoSize layout without giving up the adapter's
    // guarded ResizeObserver ownership.
    this.chartRoot.style.width = '100%'
    this.chartRoot.style.height = '100%'
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
    if (event.key === 'Escape' && this.areaZoomSelecting) {
      this.cancelAreaZoomSelection()
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === 'Enter' && this.areaZoomSelecting && this.container) {
      const { width, height } = this.container.getBoundingClientRect()
      if (width >= 16 && height >= 16) {
        this.areaZoomGesture = {
          pointerId: -1,
          startX: width * 0.25,
          startY: height * 0.25,
          currentX: width * 0.75,
          currentY: height * 0.75,
        }
        this.completeAreaZoom()
      }
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (this.activeTool === 'path' && (event.key === 'Enter' || event.key === 'Escape')) {
      if (event.key === 'Enter' && this.pathAnchors.length >= 2) this.completeDrawing('path', this.pathAnchors)
      else this.setDrawingTool(null)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === 'Enter' && this.orderPrimitive.lines.some((line) => line.stage === 'draft' && line.role === 'entry')) {
      event.preventDefault()
      event.stopPropagation()
      this.closeQuantityEditor()
      this.orderActionHandler({ type: 'confirm' })
      return
    }
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
    if (this.suppressNextDrawingClick) {
      this.suppressNextDrawingClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (!this.activeTool || event.shiftKey || event.ctrlKey || !this.container || !this.chart || !this.candles) return
    if (this.activeTool === 'date-price-range' || this.activeTool === 'brush') return
    const rect = this.container.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const time = this.chart.timeScale().coordinateToTime(x)
    const price = this.candles.coordinateToPrice(y)
    if (time === null || price === null) return
    if (typeof time !== 'number') return
    const anchor: PlacementAnchor = { time, price }
    if (this.activeTool === 'long-position' || this.activeTool === 'short-position') {
      const direction = this.activeTool === 'long-position' ? 1 : -1
      const rightX = Math.min(rect.width - 8, x + 120)
      const stopY = Math.max(8, Math.min(rect.height - 8, y + direction * 80))
      const targetY = Math.max(8, Math.min(rect.height - 8, y - direction * 80))
      const rightTime = this.chart.timeScale().coordinateToTime(rightX)
      const stopPrice = this.candles.coordinateToPrice(stopY)
      const targetPrice = this.candles.coordinateToPrice(targetY)
      if (typeof rightTime !== 'number' || stopPrice === null || targetPrice === null) return
      this.completeDrawing(this.activeTool, [
        anchor,
        { time, price: stopPrice },
        { time: rightTime, price: targetPrice },
      ])
      return
    }
    if (this.activeTool === 'path') {
      if (event.detail >= 2) {
        if (this.pathAnchors.length >= 2) {
          this.completeDrawing('path', this.pathAnchors)
          this.suppressNextDrawingDoubleClick = true
        }
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      this.pathAnchors.push(anchor)
      this.renderFreeformPreview('path', this.pathAnchors.length === 1 ? [anchor, anchor] : this.pathAnchors)
      return
    }
    const nextPlacement = commitDrawingAnchor(this.placement, anchor)
    this.placement = nextPlacement
    if (nextPlacement.status !== 'complete') {
      this.renderPlacementPreview(anchor)
      return
    }
    this.completeDrawing(this.activeTool, nextPlacement.anchors)
  }

  private completeDrawing(tool: string, anchors: PlacementAnchor[]): void {
    const registry = getToolRegistry()
    this.removePreview()
    const isPositionTool = tool === 'long-position' || tool === 'short-position'
    const isTextTool = tool === 'text-annotation'
    const inlineEditorConfig = INLINE_EDITOR_CONFIGS[tool]
    const isInlineTextTool = inlineEditorConfig !== undefined
    const isNoteTool = tool === 'note' || tool === 'anchored-text'
    const isCalloutTool = tool === 'callout'
    const isCommentTool = tool === 'comment'
    const isPriceNoteTool = tool === 'price-note'
    const isCurveTool = tool === 'curve'
    const isPriceRangeTool = tool === 'price-range'
    const isDateRangeTool = tool === 'date-range'
    const isRangeTool = isPriceRangeTool || isDateRangeTool
    const initialMetadata = {
      ...DEFAULT_DRAWING_METADATA,
      ...(isPositionTool ? { strokeColor: '#9e9e9e', textColor: '#ffffff', fontSize: 12 } : {}),
      ...(isTextTool ? { textColor: '#2962ff', fontSize: 14, horizontalAlign: 'left' as const, textBackgroundVisible: false, textBorderVisible: false, textWrap: false, textAnchored: false, textAnchorX: 0.5, textAnchorY: 0.5 } : {}),
      ...(isNoteTool ? { strokeColor: '#202020', textColor: '#555555', backgroundColor: '#ffffff', backgroundOpacity: 1, fontSize: 14 } : {}),
      ...(isCalloutTool ? { strokeColor: '#0097a7', fillColor: '#32b7bf', fillOpacity: 1, textColor: '#d7f5f6', fontSize: 14 } : {}),
      ...(isCommentTool ? { strokeColor: '#2962ff', fillColor: '#2962ff', fillOpacity: 1, textColor: '#ffffff', fontSize: 14 } : {}),
      ...(isPriceNoteTool ? { strokeColor: '#2962ff', fillColor: '#2962ff', fillOpacity: 1, textColor: '#ffffff', fontSize: 11 } : {}),
      ...(isCurveTool ? { drawingBackgroundVisible: false } : {}),
      ...(isRangeTool ? {
        strokeColor: '#2962ff', fillColor: '#2962ff', fillOpacity: 0.18,
        drawingBackgroundVisible: true, textColor: '#202020', backgroundColor: '#ffffff',
        backgroundOpacity: 1, rangeLabelBackgroundVisible: true, fontSize: 12,
        rangeStats: (isDateRangeTool
          ? ['bars-range', 'date-time-range', 'volume']
          : ['price-range', 'percent-change', 'change-in-pips']) as RangeStatKey[],
      } : {}),
    }
    const creationOptions: DrawingWorkbenchOptions & { text?: string; note?: string; iconColor?: string; priceColor?: string; noteColor?: string; pricePrecision?: number; displayTimezone?: string } = {
      workbench: initialMetadata,
      text: isInlineTextTool ? '' : undefined,
      fontSize: isInlineTextTool || isPriceNoteTool ? initialMetadata.fontSize : undefined,
      fontFamily: isTextTool ? '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif' : undefined,
      fontWeight: isTextTool ? '400' : undefined,
      textAlign: isTextTool ? initialMetadata.horizontalAlign : undefined,
      backgroundColor: isTextTool ? '' : isNoteTool ? '#ffffff' : isCalloutTool ? '#32b7bf' : isCommentTool || isPriceNoteTool ? '#2962ff' : undefined,
      borderColor: isTextTool ? '' : isCalloutTool ? '#0097a7' : undefined,
      textWrap: isTextTool ? false : undefined,
      screenAnchored: isTextTool ? false : undefined,
      note: isPriceNoteTool ? '' : undefined,
      iconColor: isNoteTool ? '#555555' : undefined,
      priceColor: isPriceNoteTool ? '#2962ff' : undefined,
      noteColor: isPriceNoteTool ? '#ffffff' : undefined,
      pricePrecision: this.pricePrecision,
      displayTimezone: 'UTC',
      filled: isRangeTool ? true : isCurveTool ? false : undefined,
      showRange: isPriceRangeTool ? true : undefined,
      showPercentage: isPriceRangeTool ? true : undefined,
      showPips: isPriceRangeTool ? true : undefined,
      showBars: isDateRangeTool ? true : undefined,
      showDateTime: isDateRangeTool ? true : undefined,
      showVolume: isDateRangeTool ? true : undefined,
      labelBackgroundVisible: isRangeTool ? true : undefined,
      labelBackgroundColor: isRangeTool ? '#ffffff' : undefined,
      barIntervalSeconds: isDateRangeTool ? timeframeSeconds(this.currentTimeframe) : undefined,
      volume: isDateRangeTool ? this.volumeBetweenAnchors(anchors) : undefined,
      tickSize: isPriceRangeTool ? this.tickSize : undefined,
      locked: this.drawingsLocked,
    }
    const drawing = registry.createDrawing(tool, `drawing-${crypto.randomUUID()}`, anchors.map((point) => ({ time: toTime(point.time), price: point.price })), {
      lineColor: colorWithOpacity(initialMetadata.strokeColor, initialMetadata.strokeOpacity),
      lineWidth: isPositionTool || isNoteTool || isCalloutTool || isCommentTool || isPriceNoteTool ? 1 : 2,
      lineDash: [],
      fillColor: colorWithOpacity(initialMetadata.fillColor, initialMetadata.fillOpacity),
      fillOpacity: initialMetadata.fillOpacity,
      labelColor: initialMetadata.textColor,
    }, creationOptions)
    if (drawing) {
      this.drawingManager.addDrawing(drawing)
      if (!this.drawingsLocked) this.drawingManager.selectDrawing(drawing.id)
      if (this.nextDrawingAppearance) {
        this.updateSelectedDrawing(this.nextDrawingAppearance)
        this.nextDrawingAppearance = null
      }
    }
    this.pathAnchors = []
    this.setDrawingTool(this.keepDrawing ? tool : null)
    if (drawing && inlineEditorConfig) queueMicrotask(() => this.openInlineTextEditor(drawing))
  }

  private volumeBetweenAnchors(anchors: PlacementAnchor[]): number {
    if (anchors.length < 2 || this.history.length === 0) return 0
    const start = Math.min(anchors[0].time, anchors[1].time)
    const end = Math.max(anchors[0].time, anchors[1].time)
    return this.history.reduce((total, bar) => bar.time >= start && bar.time <= end ? total + bar.volume : total, 0)
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

  private openInlineTextEditor(drawing: IDrawing): void {
    const config = INLINE_EDITOR_CONFIGS[drawing.type]
    if (!this.container || !config || !this.drawingManager.getDrawing(drawing.id)) return
    this.finishInlineTextEditor('commit')
    const appearance = this.getDrawingAppearance(drawing)
    const input = this.container.ownerDocument.createElement('input')
    this.textEditor = input
    this.textEditorDrawingId = drawing.id
    this.textEditorOriginalText = appearance.text
    this.textEditorDirty = false
    input.type = 'text'
    input.className = `drawing-inline-text-editor drawing-inline-text-editor--${config.variant}`
    input.setAttribute('aria-label', `Inline ${config.label} editor`)
    input.autocomplete = 'off'
    input.spellcheck = false
    input.value = appearance.text || 'Add text'
    input.style.color = config.variant === 'text' ? appearance.textColor : config.variant === 'note' ? '#555555' : config.variant === 'callout' ? '#d7f5f6' : '#ffffff'
    input.style.fontSize = `${appearance.fontSize}px`
    input.style.fontStyle = appearance.italic ? 'italic' : 'normal'
    input.style.fontWeight = appearance.bold ? '700' : '400'
    input.style.textAlign = config.variant === 'text' ? appearance.horizontalAlign : 'left'
    input.addEventListener('pointerdown', (event) => event.stopPropagation())
    input.addEventListener('click', (event) => event.stopPropagation())
    input.addEventListener('input', () => {
      this.textEditorDirty = true
      this.resizeInlineTextEditor(input)
      if (this.textEditor === input) this.applyDrawingAppearance(drawing, mergeDrawingAppearance(this.getDrawingAppearance(drawing), { text: input.value }))
    })
    input.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter') {
        event.preventDefault()
        this.finishInlineTextEditor('commit')
      } else if (event.key === 'Escape') {
        event.preventDefault()
        this.finishInlineTextEditor('cancel')
      }
    })
    input.addEventListener('blur', () => {
      if (this.textEditor === input) this.finishInlineTextEditor('commit')
    })
    drawing.setInlineEditing(true)
    this.container.append(input)
    this.resizeInlineTextEditor(input)
    this.positionInlineTextEditor()
    input.focus({ preventScroll: true })
    input.select()
  }

  private resizeInlineTextEditor(input: HTMLInputElement): void {
    const fontSize = Number.parseFloat(input.style.fontSize) || 14
    const bubble = input.classList.contains('drawing-inline-text-editor--comment') || input.classList.contains('drawing-inline-text-editor--callout')
    const minimumWidth = bubble ? 76 : 62
    const width = Math.max(minimumWidth, Math.ceil(input.value.length * fontSize * 0.58 + (bubble ? 24 : 14)))
    input.style.width = `${Math.min(width, Math.max(minimumWidth, (this.container?.clientWidth ?? width) - 8))}px`
  }

  private positionInlineTextEditor(): void {
    const input = this.textEditor
    const drawing = this.textEditorDrawingId ? this.drawingManager.getDrawing(this.textEditorDrawingId) : undefined
    if (!input || !drawing || !this.container) return
    const appearance = this.getDrawingAppearance(drawing)
    const config = INLINE_EDITOR_CONFIGS[drawing.type]
    if (!config) return
    const width = Math.max(1, this.chart?.timeScale().width() ?? this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    const anchor = drawing.anchors[config.anchorIndex]
    const rawX = drawing.type === 'text-annotation' && appearance.textAnchored
      ? appearance.textAnchorX * width
      : anchor ? this.chart?.timeScale().timeToCoordinate(anchor.time) : null
    const rawY = drawing.type === 'text-annotation' && appearance.textAnchored
      ? appearance.textAnchorY * height
      : anchor ? this.candles?.priceToCoordinate(anchor.price) : null
    if (rawX === null || rawX === undefined || rawY === null || rawY === undefined) return
    const inputWidth = input.offsetWidth || Number.parseFloat(input.style.width) || 62
    const translate = config.variant === 'text'
      ? appearance.horizontalAlign === 'center' ? -inputWidth / 2 : appearance.horizontalAlign === 'right' ? -inputWidth : 0
      : config.variant === 'comment' ? 0 : config.variant === 'callout' ? -2 : -2
    const editorHeight = input.offsetHeight || 28
    const top = config.variant === 'comment' ? rawY - editorHeight - 8 : rawY - editorHeight / 2
    input.style.left = `${Math.max(2, Math.min(width - inputWidth - 2, rawX + translate))}px`
    input.style.top = `${Math.max(2, Math.min(height - editorHeight - 2, top))}px`
  }

  private closeInlineTextEditor(): void {
    const drawing = this.textEditorDrawingId ? this.drawingManager.getDrawing(this.textEditorDrawingId) : undefined
    const input = this.textEditor
    this.textEditor = null
    this.textEditorDrawingId = null
    this.textEditorOriginalText = ''
    this.textEditorDirty = false
    drawing?.setInlineEditing(false)
    input?.remove()
  }

  private finishInlineTextEditor(mode: 'commit' | 'cancel'): void {
    const input = this.textEditor
    const drawing = this.textEditorDrawingId ? this.drawingManager.getDrawing(this.textEditorDrawingId) : undefined
    if (!input || !drawing) {
      this.closeInlineTextEditor()
      return
    }
    const originalText = this.textEditorOriginalText
    const value = !this.textEditorDirty && originalText.length === 0 ? '' : input.value
    this.closeInlineTextEditor()
    const nextText = mode === 'cancel' ? originalText : value
    if (nextText.trim().length === 0) {
      this.drawingManager.removeDrawing(drawing.id)
      this.applyChartInteractionLock()
      return
    }
    if (this.getDrawingAppearance(drawing).text !== nextText) {
      this.applyDrawingAppearance(drawing, mergeDrawingAppearance(this.getDrawingAppearance(drawing), { text: nextText }))
    }
  }

  private handleDrawingDoubleClick = (event: MouseEvent): void => {
    if (this.suppressNextDrawingDoubleClick) {
      this.suppressNextDrawingDoubleClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (this.activeTool === 'path') {
      if (this.pathAnchors.length >= 2) this.completeDrawing('path', this.pathAnchors)
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (this.activeTool || !this.container) return
    const rect = this.container.getBoundingClientRect()
    const drawing = this.drawingManager.hitTest({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    if (!drawing) return
    this.drawingManager.selectDrawing(drawing.id)
    if (INLINE_EDITOR_CONFIGS[drawing.type]) this.openInlineTextEditor(drawing)
    else this.drawingEditRequestHandler(this.getDrawingAppearance(drawing))
    event.preventDefault()
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (this.replaySelectionState.mode === 'selecting' || event.button !== 0 || !this.container || !this.chart || !this.candles) return
    if (this.textEditor?.contains(event.target as Node)) return
    if (this.cursorMode === 'eraser') {
      const rect = this.container.getBoundingClientRect()
      const drawing = this.drawingManager.hitTest({ x: event.clientX - rect.left, y: event.clientY - rect.top })
      if (drawing) {
        if (this.textEditorDrawingId === drawing.id) this.closeInlineTextEditor()
        this.drawingManager.removeDrawing(drawing.id)
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (this.areaZoomSelecting) {
      const rect = this.container.getBoundingClientRect()
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      this.areaZoomGesture = { pointerId: event.pointerId, startX: point.x, startY: point.y, currentX: point.x, currentY: point.y }
      this.ensureAreaZoomOverlay()
      this.updateAreaZoomOverlay()
      this.container.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (this.measurementPreviewPinned) this.cancelPreview()
    const initialRect = this.container.getBoundingClientRect()
    const initialPoint = { x: event.clientX - initialRect.left, y: event.clientY - initialRect.top }
    if (this.activeTool === 'brush') {
      const time = this.chart.timeScale().coordinateToTime(initialPoint.x)
      const price = this.candles.coordinateToPrice(initialPoint.y)
      if (typeof time !== 'number' || price === null) return
      this.freehandGesture = { pointerId: event.pointerId, tool: 'brush', anchors: [{ time, price }], lastX: initialPoint.x, lastY: initialPoint.y }
      this.container.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    const placementAnchorCount = this.placement.status === 'anchored' || this.placement.status === 'previewing'
      ? this.placement.anchors.length
      : 0
    if ((this.activeTool === 'price-range' || this.activeTool === 'date-range') && placementAnchorCount === 0) {
      const time = this.chart.timeScale().coordinateToTime(initialPoint.x)
      const price = this.candles.coordinateToPrice(initialPoint.y)
      if (typeof time !== 'number' || price === null) return
      const anchor = { time, price }
      this.placement = commitDrawingAnchor(this.placement, anchor)
      this.persistentRangeGesture = {
        pointerId: event.pointerId,
        tool: this.activeTool,
        anchor,
        startX: event.clientX,
        startY: event.clientY,
        dragged: false,
      }
      this.renderPlacementPreview(anchor)
      this.container.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (this.activeTool && LEADER_ANNOTATION_TOOLS.has(this.activeTool) && placementAnchorCount === 0) {
      const time = this.chart.timeScale().coordinateToTime(initialPoint.x)
      const price = this.candles.coordinateToPrice(initialPoint.y)
      if (typeof time !== 'number' || price === null) return
      const anchor = { time, price }
      this.placement = commitDrawingAnchor(this.placement, anchor)
      this.leaderAnnotationGesture = {
        pointerId: event.pointerId,
        tool: this.activeTool,
        anchor,
        startX: event.clientX,
        startY: event.clientY,
        dragged: false,
      }
      this.renderPlacementPreview(anchor)
      this.container.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
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
    if (hitDrawing?.options.locked) {
      if (this.drawingManager.getSelectedDrawing()?.id !== hitDrawing.id) this.drawingManager.selectDrawing(hitDrawing.id)
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
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
        screenAnchor: hitDrawing.type === 'text-annotation' && this.getDrawingAppearance(hitDrawing).textAnchored
          ? { x: this.getDrawingAppearance(hitDrawing).textAnchorX, y: this.getDrawingAppearance(hitDrawing).textAnchorY }
          : undefined,
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
      this.syncOrderKeyboardState(this.orderPrimitive.lines, true)
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
      this.syncOrderKeyboardState(this.orderPrimitive.lines, true)
      this.container.setPointerCapture(event.pointerId)
      this.applyChartInteractionLock()
      event.preventDefault()
      event.stopPropagation()
    }
  }

  private handlePointerMove = (event: PointerEvent): void => {
    this.updateCursorIndicator(event)
    if (this.areaZoomGesture?.pointerId === event.pointerId && this.container) {
      const rect = this.container.getBoundingClientRect()
      this.areaZoomGesture.currentX = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
      this.areaZoomGesture.currentY = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
      this.updateAreaZoomOverlay()
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (this.freehandGesture?.pointerId === event.pointerId && this.container && this.chart && this.candles) {
      const rect = this.container.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      if (Math.hypot(x - this.freehandGesture.lastX, y - this.freehandGesture.lastY) < 2) return
      const time = this.chart.timeScale().coordinateToTime(x)
      const price = this.candles.coordinateToPrice(y)
      if (typeof time !== 'number' || price === null) return
      this.freehandGesture.anchors.push({ time, price })
      this.freehandGesture.lastX = x
      this.freehandGesture.lastY = y
      this.renderFreeformPreview('brush', this.freehandGesture.anchors.length === 1 ? [...this.freehandGesture.anchors, { time, price }] : this.freehandGesture.anchors)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (this.leaderAnnotationGesture?.pointerId === event.pointerId && this.container && this.chart && this.candles) {
      const rect = this.container.getBoundingClientRect()
      const time = this.chart.timeScale().coordinateToTime(event.clientX - rect.left)
      const price = this.candles.coordinateToPrice(event.clientY - rect.top)
      if (typeof time !== 'number' || price === null) return
      if (Math.hypot(event.clientX - this.leaderAnnotationGesture.startX, event.clientY - this.leaderAnnotationGesture.startY) >= 3) {
        this.leaderAnnotationGesture.dragged = true
      }
      this.renderPlacementPreview({ time, price })
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (this.persistentRangeGesture?.pointerId === event.pointerId && this.container && this.chart && this.candles) {
      const rect = this.container.getBoundingClientRect()
      const time = this.chart.timeScale().coordinateToTime(event.clientX - rect.left)
      const price = this.candles.coordinateToPrice(event.clientY - rect.top)
      if (typeof time !== 'number' || price === null) return
      if (Math.hypot(event.clientX - this.persistentRangeGesture.startX, event.clientY - this.persistentRangeGesture.startY) >= 3) {
        this.persistentRangeGesture.dragged = true
      }
      this.renderPlacementPreview({ time, price })
      event.preventDefault()
      event.stopPropagation()
      return
    }
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
      if (typeof time === 'number' && price !== null) {
        if (this.activeTool === 'path' && this.pathAnchors.length > 0) this.renderFreeformPreview('path', [...this.pathAnchors, { time, price }])
        else this.renderPlacementPreview({ time, price })
      }
      return
    }
    if (this.draggingDrawing && this.draggingDrawing.pointerId === event.pointerId && this.container && this.chart && this.candles) {
      this.enforceDrawingPriceScaleLock()
      const rect = this.container.getBoundingClientRect()
      let drawing = this.drawingManager.getDrawing(this.draggingDrawing.drawingId)
      if (!drawing) return
      if (this.draggingDrawing.screenAnchor) {
        const deltaX = (event.clientX - this.draggingDrawing.startX) / Math.max(1, rect.width)
        const deltaY = (event.clientY - this.draggingDrawing.startY) / Math.max(1, rect.height)
        if (deltaX === 0 && deltaY === 0) return
        if (this.draggingDrawing.cloneOnDrag) {
          const clone = this.cloneDrawing(drawing)
          this.draggingDrawing.cloneOnDrag = false
          if (!clone) return
          drawing = clone
          this.draggingDrawing.drawingId = clone.id
          this.lastDrawingUpdate = { id: clone.id, at: performance.now() }
        }
        const appearance = mergeDrawingAppearance(this.getDrawingAppearance(drawing), {
          textAnchorX: this.draggingDrawing.screenAnchor.x + deltaX,
          textAnchorY: this.draggingDrawing.screenAnchor.y + deltaY,
        })
        this.applyDrawingAppearance(drawing, appearance)
        this.draggingDrawing.moved = true
        this.enforceDrawingPriceScaleLock()
        return
      }
      const time = this.chart.timeScale().coordinateToTime(event.clientX - rect.left)
      const price = this.candles.coordinateToPrice(event.clientY - rect.top)
      if (typeof time !== 'number' || price === null) return
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
    if (this.areaZoomGesture?.pointerId === event.pointerId && this.container) {
      if (this.container.hasPointerCapture(event.pointerId)) this.container.releasePointerCapture(event.pointerId)
      const cancelled = event.type === 'pointercancel'
      if (cancelled) this.cancelAreaZoomSelection()
      else this.completeAreaZoom()
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (this.freehandGesture?.pointerId === event.pointerId && this.container) {
      if (this.container.hasPointerCapture(event.pointerId)) this.container.releasePointerCapture(event.pointerId)
      const gesture = this.freehandGesture
      this.freehandGesture = null
      if (event.type === 'pointercancel' || gesture.anchors.length < 2) this.setDrawingTool(this.keepDrawing ? gesture.tool : null)
      else this.completeDrawing(gesture.tool, gesture.anchors)
      this.suppressNextDrawingClick = true
      window.setTimeout(() => { this.suppressNextDrawingClick = false }, 0)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (this.leaderAnnotationGesture?.pointerId === event.pointerId && this.container && this.chart && this.candles) {
      const gesture = this.leaderAnnotationGesture
      this.leaderAnnotationGesture = null
      if (this.container.hasPointerCapture(event.pointerId)) this.container.releasePointerCapture(event.pointerId)
      if (event.type === 'pointercancel') {
        this.setDrawingTool(null)
      } else if (gesture.dragged) {
        const rect = this.container.getBoundingClientRect()
        const time = this.chart.timeScale().coordinateToTime(event.clientX - rect.left)
        const price = this.candles.coordinateToPrice(event.clientY - rect.top)
        if (typeof time === 'number' && price !== null) this.completeDrawing(gesture.tool, [gesture.anchor, { time, price }])
      }
      this.suppressNextDrawingClick = true
      window.setTimeout(() => { this.suppressNextDrawingClick = false }, 0)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (this.persistentRangeGesture?.pointerId === event.pointerId && this.container && this.chart && this.candles) {
      const gesture = this.persistentRangeGesture
      this.persistentRangeGesture = null
      if (this.container.hasPointerCapture(event.pointerId)) this.container.releasePointerCapture(event.pointerId)
      if (event.type === 'pointercancel') {
        this.setDrawingTool(this.keepDrawing ? gesture.tool : null)
      } else if (gesture.dragged) {
        const rect = this.container.getBoundingClientRect()
        const time = this.chart.timeScale().coordinateToTime(event.clientX - rect.left)
        const price = this.candles.coordinateToPrice(event.clientY - rect.top)
        if (typeof time === 'number' && price !== null) this.completeDrawing(gesture.tool, [gesture.anchor, { time, price }])
      }
      this.suppressNextDrawingClick = true
      window.setTimeout(() => { this.suppressNextDrawingClick = false }, 0)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (this.measurementGesture?.pointerId === event.pointerId && this.container) {
      const transient = this.measurementGesture.transient
      const cancelled = event.type === 'pointercancel'
      const finishMeasurement = this.measurementGesture.dragged || this.measurementClickAnchored
      if (this.container.hasPointerCapture(event.pointerId)) this.container.releasePointerCapture(event.pointerId)
    this.measurementGesture = null
    this.persistentRangeGesture = null
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

  private renderFreeformPreview(tool: 'brush' | 'path', anchors: PlacementAnchor[]): void {
    if (anchors.length < 2) return
    const drawingAnchors: Anchor[] = anchors.map((anchor) => ({ time: toTime(anchor.time), price: anchor.price }))
    if (this.preview?.type === tool) {
      this.preview.setAnchors(drawingAnchors)
      return
    }
    this.removePreview()
    const previewOptions: DrawingWorkbenchOptions & { pricePrecision: number; displayTimezone: string } = {
      visible: true, locked: true, zIndex: 10_000, pricePrecision: this.pricePrecision, displayTimezone: 'UTC',
    }
    const drawing = getToolRegistry().createDrawing(tool, PREVIEW_ID, drawingAnchors, {
      lineColor: 'rgba(41, 98, 255, 0.82)', lineWidth: 2, lineDash: [],
      fillColor: 'rgba(41, 98, 255, 0.08)', fillOpacity: 0.08, labelColor: 'rgba(209, 212, 220, 0.72)',
    }, previewOptions)
    if (!drawing) return
    this.preview = drawing
    this.drawingManager.addDrawing(drawing)
  }

  private ensureAreaZoomOverlay(): void {
    if (this.areaZoomOverlay || !this.container) return
    const overlay = document.createElement('div')
    overlay.className = 'chart-area-zoom-selection'
    overlay.dataset.label = 'Zoom range'
    overlay.style.left = '0px'
    overlay.style.top = '0px'
    overlay.setAttribute('aria-hidden', 'true')
    this.container.append(overlay)
    this.areaZoomOverlay = overlay
  }

  private updateAreaZoomOverlay(): void {
    const gesture = this.areaZoomGesture
    const overlay = this.areaZoomOverlay
    if (!gesture || !overlay) return
    const left = Math.min(gesture.startX, gesture.currentX)
    const top = Math.min(gesture.startY, gesture.currentY)
    overlay.style.transform = `translate3d(${left}px, ${top}px, 0)`
    overlay.style.width = `${Math.abs(gesture.currentX - gesture.startX)}px`
    overlay.style.height = `${Math.abs(gesture.currentY - gesture.startY)}px`
  }

  private completeAreaZoom(): void {
    const gesture = this.areaZoomGesture
    const chart = this.chart
    const candles = this.candles
    this.areaZoomGesture = null
    this.removeAreaZoomOverlay()
    if (!gesture || !chart || !candles) return
    const width = Math.abs(gesture.currentX - gesture.startX)
    const height = Math.abs(gesture.currentY - gesture.startY)
    if (width < 8 || height < 8) {
      this.areaZoomSelecting = true
      this.container?.classList.add('chart-area-zoom-active')
      this.applyChartInteractionLock()
      return
    }
    const logicalFrom = chart.timeScale().coordinateToLogical(Math.min(gesture.startX, gesture.currentX))
    const logicalTo = chart.timeScale().coordinateToLogical(Math.max(gesture.startX, gesture.currentX))
    const priceAtTop = candles.coordinateToPrice(Math.min(gesture.startY, gesture.currentY))
    const priceAtBottom = candles.coordinateToPrice(Math.max(gesture.startY, gesture.currentY))
    const currentLogicalRange = chart.timeScale().getVisibleLogicalRange()
    const scale = candles.priceScale()
    const currentPriceRange = scale.getVisibleRange()
    if (logicalFrom === null || logicalTo === null || priceAtTop === null || priceAtBottom === null || !currentLogicalRange || !currentPriceRange) return
    if (!this.areaZoomRestoreState) {
      this.areaZoomRestoreState = {
        logicalRange: currentLogicalRange,
        priceRange: currentPriceRange,
        priceAutoScale: scale.options().autoScale,
      }
    }
    this.areaZoomSelecting = false
    this.withExternalSync(() => {
      chart.timeScale().setVisibleLogicalRange({ from: Math.min(logicalFrom, logicalTo), to: Math.max(logicalFrom, logicalTo) })
      scale.setAutoScale(false)
      scale.setVisibleRange({ from: Math.min(priceAtTop, priceAtBottom), to: Math.max(priceAtTop, priceAtBottom) })
    })
    this.applyChartInteractionLock()
    queueMicrotask(() => this.scheduleViewportSync())
    this.areaZoomChangedHandler({ selecting: false, zoomed: true })
  }

  private cancelAreaZoomSelection(): void {
    if (!this.areaZoomSelecting && !this.areaZoomGesture) return
    this.areaZoomSelecting = false
    this.areaZoomGesture = null
    this.removeAreaZoomOverlay()
    this.applyChartInteractionLock()
    this.areaZoomChangedHandler({ selecting: false, zoomed: this.areaZoomRestoreState !== null })
  }

  private removeAreaZoomOverlay(): void {
    this.areaZoomOverlay?.remove()
    this.areaZoomOverlay = null
    this.container?.classList.remove('chart-area-zoom-active')
  }

  private applyChartInteractionLock(): void {
    const locked = this.replaySelectionState.mode === 'selecting' || this.areaZoomSelecting || this.activeTool !== null || this.drawingManager.getSelectedDrawing() !== null || this.draggingOrder !== null
    this.chart?.applyOptions({ handleScroll: !locked, handleScale: !locked })
  }

  private syncOrderKeyboardState(lines: OrderLine[], focus = false): void {
    if (!this.container || this.replaySelectionState.mode === 'selecting') return
    const hasDraftOrder = lines.some((line) => line.stage === 'draft' && line.role === 'entry')
    if (!hasDraftOrder) {
      this.container.removeAttribute('tabindex')
      this.container.removeAttribute('role')
      this.container.removeAttribute('aria-label')
      return
    }
    this.container.tabIndex = 0
    this.container.setAttribute('role', 'group')
    this.container.setAttribute('aria-label', 'Order ticket active. Drag entry, take profit, or stop loss. Press Enter to confirm.')
    if (focus) this.container.focus({ preventScroll: true })
  }

  private applyReplaySelectionState(): void {
    let state = this.replaySelectionState
    if (state.mode === 'active') {
      const projected = this.projectReplayTimestamp(state.timestamp)
      state = projected === null ? { mode: 'inactive' } : { mode: 'active', timestamp: projected }
    }
    this.replaySelectionPrimitive.setState(state)
    const selecting = this.replaySelectionState.mode === 'selecting'
    if (selecting) {
      this.chart?.applyOptions({
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { visible: true, labelVisible: true, color: '#2962ff', labelBackgroundColor: '#2962ff', style: LineStyle.Dashed },
          horzLine: { visible: true, labelVisible: true, color: '#787b8688', labelBackgroundColor: '#2a2e39', style: LineStyle.Dashed },
        },
      })
      this.removeCursorIndicator()
    }
    if (this.container) {
      this.container.classList.toggle('chart-replay-selecting', selecting)
      if (selecting) {
        this.container.style.cursor = 'crosshair'
        this.container.tabIndex = 0
        this.container.setAttribute('role', 'group')
        this.container.setAttribute('aria-label', 'Select replay start bar. Use Left and Right arrows, then Enter.')
        queueMicrotask(() => this.container?.focus({ preventScroll: true }))
      } else {
        this.applyCursorMode()
        this.syncOrderKeyboardState(this.orderPrimitive.lines)
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
