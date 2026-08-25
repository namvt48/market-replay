// ChartAdapter is the single boundary the replay engine talks to the
// chart library through (docs §5.8) — the most important seam in the
// frontend. Interface verbatim from the architecture doc; core is
// lightweight-charts (LwcAdapter), but everything
// upstream of this interface (BarBuffer, Aggregator, logical clock,
// FillEngine) never changes if the chart library ever does.
import type { EconImportance, IndicatorRunResult, Timeframe, SymbolMeta } from '../api/types'
import type { SerializedDrawing, DrawingToolDefinition } from 'lightweight-charts-drawing'
import type { DrawingAppearance, DrawingAppearancePatch } from './drawing-appearance'
import type { ChartAppearanceSettings } from './chart-settings'
import type { ChartTimezone } from './chart-timezone'
import type { HoverBarSnapshot } from './hover-bar-store'

export interface DisplayBar {
  time: number // epoch seconds, bucket start
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type ViewportDirection = 'before' | 'after'

export interface ViewportDemand {
  direction: ViewportDirection
  anchorTs: number
}

export interface ChartCrosshairSync {
  time: number
  price: number
}

export interface ChartViewportSync {
  time: { from: number; to: number }
  logicalSpan?: number
}

export interface HistoryUpdateOptions {
  preserveViewport?: boolean
  resetView?: boolean
}

export type ReplaySelectionState =
  | { mode: 'inactive' }
  | { mode: 'selecting' }
  | { mode: 'active'; timestamp: number }

export type DrawingNudgeDirection = 'left' | 'right' | 'up' | 'down'

export type PriceScaleToggle = 'logarithmic' | 'percentage'

export type ChartCursorMode = 'cross' | 'dot' | 'arrow' | 'demonstration' | 'eraser'

export interface TradeMarker {
  time: number
  price: number
  text: string
  color: string
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'
}

export interface TradeConnection {
  entryTime: number
  entryPrice: number
  exitTime: number
  exitPrice: number
  priceDecimals?: number
  side?: 'long' | 'short'
  initialStop?: number | null
  initialTakeProfit?: number | null
  protectionAdjustments?: Array<{
    role: 'stopLoss' | 'takeProfit'
    time: number
    price: number
  }>
  exitReason?: 'manual' | 'stopLoss' | 'takeProfit'
}

export interface EconomicEventMarker {
  id: string
  time: number
  country: string
  currency?: string
  title: string
  importance: EconImportance
  state: 'past' | 'next' | 'scheduled'
}

export interface IndicatorRenderResult extends IndicatorRunResult {
  indicatorId: string
}

export interface OrderLine {
  id: string
  price: number
  label: string
  color: string
  kind: 'position' | 'stopLoss' | 'takeProfit' | 'market' | 'limit' | 'stop'
  editable: boolean
  side?: 'buy' | 'sell'
  role: 'entry' | 'stopLoss' | 'takeProfit' | 'position'
  stage: 'draft' | 'working' | 'position'
  qty: number
  priceLabel: string
  showControls?: boolean
  protectionEnabled?: { stopLoss: boolean; takeProfit: boolean }
  maxQuantity?: number
}

export type OrderLineAction =
  | { type: 'confirm' | 'discard' | 'toggle-stop-loss' | 'toggle-take-profit' }
  | { type: 'cancel' | 'edit'; orderId: string }
  | { type: 'quantity'; qty: number }

export interface ChartAdapter {
  init(el: HTMLElement, sym: SymbolMeta, tf: Timeframe): Promise<void>
  setSymbol(sym: SymbolMeta): void

  setHistory(bars: DisplayBar[], options?: HistoryUpdateOptions): void // seek / change symbol / change tf (rebuild)
  pushBar(bar: DisplayBar): void // hot path — call AT MOST once per frame
  pushBars(bars: DisplayBar[]): void // conflated hot path; one chart mutation per series
  truncateTo(ts: number): void // rewind
  setSpacerTimes(times: number[]): void // right-side whitespace
  // Re-measures the host element and repaints immediately if its size
  // changed. The adapter also watches its host with a ResizeObserver as a
  // fallback, but that fires a tick after the DOM actually resizes; calling
  // this from a layout effect keyed to the same commit that resized the
  // container (e.g. dragging a split) keeps the canvas from trailing behind.
  syncContainerSize(): void
  applyAppearance(settings: ChartAppearanceSettings): void
  setDisplayTimezone(timezone: ChartTimezone): void
  onHoveredBar(handler: (bar: HoverBarSnapshot | null) => void): void
  onViewportDemand(handler: (demand: ViewportDemand) => void): void
  onCrosshairSync(handler: (state: ChartCrosshairSync | null) => void): void
  setCrosshairSync(state: ChartCrosshairSync | null): void
  onViewportSync(handler: (state: ChartViewportSync) => void): void
  setViewportSync(state: ChartViewportSync): void
  setReplaySelection(state: ReplaySelectionState): void
  onReplayBarSelect(handler: (timestamp: number) => void): void

  setTradeMarkers(markers: TradeMarker[]): void // entry/exit
  setEconomicEventMarkers(markers: EconomicEventMarker[]): void
  setIndicators(results: IndicatorRenderResult[]): void
  setTradeConnections(connections: TradeConnection[]): void
  setOrderLines(lines: OrderLine[]): void
  onOrderLineMove(handler: (id: string, price: number) => void): void
  onOrderLineDragStart(handler: (id: string) => void): void
  onOrderLineAction(handler: (action: OrderLineAction) => void): void
  onChartOrder(handler: (side: 'buy' | 'sell', type: 'limit' | 'stop', price: number) => void): void

  drawingTools(): DrawingToolDefinition[]
  setCursorMode(mode: ChartCursorMode): void
  setDrawingTool(tool: string | null): void
  deselectDrawing(): void
  deleteSelectedDrawing(): void
  lockSelectedDrawing(): void
  deleteAllDrawings(): void
  updateSelectedDrawing(patch: DrawingAppearancePatch): void
  setNextDrawingAppearance(patch: DrawingAppearancePatch | null): void
  copySelectedDrawing(): SerializedDrawing | null
  pasteDrawing(drawing: SerializedDrawing): void
  undoDrawing(): boolean
  redoDrawing(): boolean
  nudgeSelectedDrawing(direction: DrawingNudgeDirection): boolean
  toggleDrawingsVisibility(): void
  setDrawingsHidden(hidden: boolean): void
  setAllDrawingsLocked(locked: boolean): void
  setKeepDrawing(enabled: boolean): void
  drawingCount(): number
  getDrawings(): SerializedDrawing[]
  loadDrawings(drawings: SerializedDrawing[]): void
  onDrawingsChanged(handler: (drawingId?: string) => void): void
  onDrawingSelection(handler: (drawing: DrawingAppearance | null) => void): void
  onDrawingEditRequest(handler: (drawing: DrawingAppearance) => void): void
  onDrawingToolChanged(handler: (tool: string | null) => void): void
  beginAreaZoom(): void
  resetAreaZoom(): void
  areaZoomState(): { selecting: boolean; zoomed: boolean }
  onAreaZoomChanged(handler: (state: { selecting: boolean; zoomed: boolean }) => void): void
  visibleRange(): { from: number; to: number }
  focusTime(timestamp: number): void
  panView(logicalBars: number): void
  zoomView(factor: number): void
  toggleInvertScale(): void
  togglePriceScaleMode(mode: PriceScaleToggle): void
  takeSnapshot(): void
  resetView(): void
  destroy(): void
}
