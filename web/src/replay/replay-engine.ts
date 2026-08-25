import type { DrawingToolDefinition, SerializedDrawing } from 'lightweight-charts-drawing'
import {
  createSession,
  fetchBarsAt,
  fetchCalendar,
  fetchDrawings,
  runIndicator,
  fetchSessions,
  fetchSymbols,
  fetchTrades,
  patchSession,
  putTrades,
  upsertDrawings,
} from '../api/client'
import type { ActiveIndicator, ClosedTrade, IndicatorDescriptor, IndicatorInputValue, PersistedDrawing, ReplaySession, SymbolMeta, Timeframe } from '../api/types'
import { DEFAULT_CHART_SYNC_FLAGS, type ChartSyncFlags } from '../chart-workspace/types'
import {
  amendOrder,
  cancelAllOrders,
  cancelOrder,
  createFillEngine,
  flattenPosition,
  placeBracket,
  placeEntryBracket,
  reversePosition,
  stepFillEngine,
} from '../fill-engine/engine'
import { calculateTradeStats, type TradeStats } from '../fill-engine/stats'
import type { Bar1m, EngineTrade, FillEngineState, OrderSide, OrderType } from '../fill-engine/types'
import { getEvalState, isEvalActive, type EvalFillState } from '../store/eval-store'
import { aggregateRange } from './aggregate'
import { BarSource } from './bar-source'
import { REPLAY_STEP_TIMEFRAMES, parseTimeframe, timeframeSeconds, type ReplayStepTimeframe } from './timeframe'
import { restoreReplayIndicators, restoreReplayRuntime, serializeReplayRuntime } from './session-state'
import {
  captureChartWorkspaceState,
  compareSnapshotRank,
  fetchRemoteWorkspaceSnapshot,
  loadSessionWorkspaceSnapshot,
  restoreChartWorkspaceState,
  saveSessionWorkspaceSnapshot,
  syncWorkspaceSnapshot,
  type SessionSnapshotOwner,
  type SessionWorkspaceSnapshot,
} from './session-workspace-snapshot'
import { pruneSymbolCache } from './symbol-cache'
import type { ChartAdapter, ChartCursorMode, DisplayBar, EconomicEventMarker, IndicatorRenderResult, OrderLine, OrderLineAction, ReplaySelectionState, TradeConnection, TradeMarker, ViewportDemand, ViewportDirection } from './chart-adapter'
import type { ChartPaneSettings } from './chart-settings-store'
import { shortEvalAccountHash } from '../eval/rules'
import { ChartViewController } from './chart-view-controller'
import { ChartViewRegistry } from './chart-view-registry'
import type { DrawingAppearance, DrawingAppearancePatch } from './drawing-appearance'
import type { HoverBarStore } from './hover-bar-store'
import { DEFAULT_MARKET_SESSION, type MarketSession } from './market-session'
import { nearestDataTimestamp, type NearestDataDirection } from './nearest-data'
import {
  createOrderTicketDraft,
  editOrderTicketDraft,
  setOrderTicketPrice,
  setOrderTicketQuantity,
  toggleOrderTicketProtection,
  validateOrderTicket,
  type OrderTicketDraft,
  type OrderTicketRole,
} from './order-ticket'
import {
  BoundedBarCache,
  HttpViewportDataClient,
  MAX_VIEWPORT_RAW_BARS,
  VIEWPORT_PAGE_BARS,
  type ViewportDataClient,
} from './viewport-data'

export const SPEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const
export const STEP_TIMEFRAMES = REPLAY_STEP_TIMEFRAMES
export type { ReplayStepTimeframe } from './timeframe'

function replayBaseTimeframe(symbol: SymbolMeta): Timeframe {
  return symbol.ranges['5s'] ? '5s' : '1m'
}
const HIGH_THROUGHPUT_BARS_PER_SECOND = 100
const TIMEFRAME_SWITCH_SETTLE_MS = 48
/**
 * How often indicators recompute while the replay is playing.
 *
 * Every built-in script anchors its output to session or display-bucket
 * boundaries, so the content only actually changes at a bucket rollover —
 * two passes a second is comfortably inside "follows the replay" without
 * pretending to more resolution than the data has. It is also close to free:
 * on a coarse timeframe the server quantises every cursor inside a bucket to
 * the same request and answers from its LRU, and on the base timeframe the
 * suspended-Runtime session advances only the bars newly crossed rather than
 * replaying the window. For comparison, scheduleSecondsPaneRefresh already
 * accepted a 1s interval for the heavier job of refetching a whole viewport.
 */
const INDICATOR_PLAYBACK_REFRESH_MS = 500
const MAX_REPLAY_CONTRACTS = 1_000
// The fill engine's fixed paper bankroll ($10,000). Now also reported to the
// server as a session's initialBalanceCents, so the two must not drift.
const REPLAY_STARTING_EQUITY_CENTS = 1_000_000
const TRANSIENT_ERROR_TIMEOUT_MS = 20_000
const FRAME_SAMPLE_WINDOW = 120
const MAX_FILL_SNAPSHOTS = MAX_VIEWPORT_RAW_BARS
const EMPTY_STATS: TradeStats = { trades: 0, winRate: 0, netCents: 0, expectancyCents: 0, averageR: null, profitFactor: null }

export interface FrameMetrics { p50: number; p95: number; max: number; samples: number }
export type ReplayStatus = 'idle' | 'loading' | 'ready' | 'buffering' | 'error'
export type ReplayMode = 'inactive' | 'selecting' | 'active'
export type DrawingMode = 'analysis' | 'replay'

export interface ReplaySelectionOptions {
  createSession?: boolean
}

export interface ReplaySnapshot {
  status: ReplayStatus
  error: string | null
  symbols: SymbolMeta[]
  symbol: SymbolMeta | null
  activeSymbol?: SymbolMeta | null
  timeframe: Timeframe
  cursorTs: number
  replayMode: ReplayMode
  replayStartTs: number | null
  playing: boolean
  speed: number
  stepTimeframe: ReplayStepTimeframe
  qty: number
  eagerState: 'idle' | 'loading' | 'ready' | 'disabled' | 'error'
  viewportCachedBars: number
  sessionId: string | null
  sessionStatus: ReplaySession['status'] | null
  fill: FillEngineState | null
  /** Account-wide fill totals across every symbol during an evaluation. */
  evalFill: EvalFillState | null
  stats: TradeStats
  frameMetrics: FrameMetrics
  lastBar: Bar1m | null
  drawingMode: DrawingMode
  cursorMode: ChartCursorMode
  activeDrawingTool: string | null
  selectedDrawing: DrawingAppearance | null
  drawingInspectorOpen: boolean
  keepDrawing: boolean
  drawingsLocked: boolean
  drawingsHidden: boolean
  indicatorsHidden: boolean
  areaZoomSelecting: boolean
  areaZoomed: boolean
  persistencePending: boolean
  indicators: ActiveIndicator[]
  indicatorLoading: boolean
  indicatorError: string | null
}

const initialSnapshot: ReplaySnapshot = {
  status: 'idle', error: null, symbols: [], symbol: null, activeSymbol: null, timeframe: '1m', cursorTs: 0,
  replayMode: 'inactive', replayStartTs: null, playing: false, speed: 1, stepTimeframe: '1m', qty: 1, eagerState: 'idle', viewportCachedBars: 0, sessionId: null, sessionStatus: null, fill: null, evalFill: null,
  stats: EMPTY_STATS, frameMetrics: { p50: 0, p95: 0, max: 0, samples: 0 }, lastBar: null,
  drawingMode: 'replay', cursorMode: 'cross', activeDrawingTool: null, selectedDrawing: null, drawingInspectorOpen: false,
  keepDrawing: false, drawingsLocked: false, drawingsHidden: false, indicatorsHidden: false, areaZoomSelecting: false, areaZoomed: false,
  persistencePending: false,
  indicators: [], indicatorLoading: false, indicatorError: null,
}

const SOURCE_PREFETCH_REMAINING_BARS = 2_000
const SOURCE_PREFETCH_PAGE_BARS = 10_000

interface DrawingDocument {
  buckets: Map<string, string>
  previousIds: Set<string>
  createdTimeframes: Map<string, Timeframe>
  drawings: SerializedDrawing[]
}

interface DataTimestampResolution {
  timestamp: number
  calendarAvailable: boolean
}

export class ReplayEngine {
  private views = new ChartViewRegistry()
  private source: BarSource | null = null
  private auxiliarySources = new Map<string, BarSource>()
  private sourcePrefetchController: AbortController | null = null
  private sourcePrefetchPromise: Promise<void> | null = null
  private resumeAfterSourcePrefetch = false
  /** Independent execution state per market, with the active pane selecting which one is projected. */
  private symbolFills = new Map<string, FillEngineState>()
  private snapshot: ReplaySnapshot = initialSnapshot
  private listeners = new Set<() => void>()
  private cursorIndex = 0
  private startIndex = 0
  private bootstrapPromise: Promise<void> | null = null
  private animationFrame = 0
  private lastFrameAt = 0
  private accumulator = 0
  private highSpeedChartFrame = 0
  private lastEmitAt = 0
  private frameSamples = new Float64Array(FRAME_SAMPLE_WINDOW)
  private frameSortScratch = new Float64Array(FRAME_SAMPLE_WINDOW)
  private frameSampleCount = 0
  private frameSampleCursor = 0
  private frameMetricsStale = false
  private viewportCache = new BoundedBarCache()
  private viewportControllers = new Map<ViewportDirection, AbortController>()
  private viewportLastRequestAt = new Map<ViewportDirection, number>()
  private readonly viewportClient: ViewportDataClient
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private drawingTimer: ReturnType<typeof setTimeout> | null = null
  private transientErrorTimer: ReturnType<typeof setTimeout> | null = null
  private pendingDrawingViewId: string | null = null
  private drawingDocuments = new Map<string, DrawingDocument>()
  private pendingWorkspaceRestore: SessionWorkspaceSnapshot | null = null
  private syncingDrawings = false
  /**
   * Fill-engine state as of each replay bar index, so stepping the cursor
   * back can restore the simulation exactly.
   *
   * Previously step-back called rebuildSimulation(), which built a *fresh*
   * engine and replayed bars — but not the user's orders, which are not
   * derivable from bars. One press of the back button therefore wiped the
   * journal, position and equity while the stored journal kept them.
   *
   * Snapshots are nearly free: the fill engine is fully immutable, so every
   * entry shares its orders/trades arrays with its neighbours until one of
   * them actually changes.
   *
   * Invariant pruneFillSnapshots relies on: every `.set()` call site either
   * (a) writes at the *current* cursorIndex — updating an already-present
   * key's value in place, which never moves it in iteration order — or
   * (b) follows a `.clear()` that resets the map to that one entry, or
   * (c) is advance()'s forward walk, which only ever increases cursorIndex
   * one bar at a time. So the map's iteration order (insertion order, per
   * the Map spec) is always ascending by key — the oldest surviving entry is
   * always first.
   */
  private fillSnapshots = new Map<number, Map<string, FillEngineState>>()
  /** Last journal handed to the backend, by reference — the engine's immutability makes identity a valid "unchanged" test. */
  private persistedTrades: FillEngineState['trades'] | null = null
  /** Saved session journal retained for spoiler-safe chart projection after replay seek resets the fill engine. */
  private retainedSessionTrades: readonly EngineTrade[] = []
  private projectedOrders: FillEngineState['orders'] | null = null
  private projectedTrades: FillEngineState['trades'] | null = null
  private projectedRetainedTradeKey: string | null = null
  private projectedTradeSymbol: string | null = null
  private projectedPositionQty: number | null = null
  private projectedPositionPrice: number | null = null
  private projectedUnrealizedCents: number | null = null
  private projectedOrderDraft: OrderTicketDraft | null = null
  /**
   * Cached markers/connections from the last trade-set rebuild, reused
   * as-is whenever only unrealized P&L moved (see syncChartTradingState) —
   * rebuilding these is O(closed trades), while a position's unrealized P&L
   * changes on nearly every replay bar.
   */
  private projectedMarkers: TradeMarker[] = []
  private projectedConnections: TradeConnection[] = []
  /** Reused across calls: a NumberFormat for the same decimal count is the same formatter. */
  private priceFormatterCache: { decimals: number; formatter: Intl.NumberFormat } | null = null
  private orderDraft: OrderTicketDraft | null = null
  private drawingClipboard: SerializedDrawing | null = null
  private pendingTimeframeSwitches = new Map<string, ReturnType<typeof setTimeout>>()
  private timeframeControllers = new Map<string, AbortController>()
  private createSessionOnSelection = false
  private marketSession: MarketSession = DEFAULT_MARKET_SESSION
  private syncFlags: ChartSyncFlags = { ...DEFAULT_CHART_SYNC_FLAGS }
  private economicEventMarkers: EconomicEventMarker[] = []
  private indicatorResults = new Map<string, Map<string, IndicatorRenderResult>>()
  /** The (symbol, timeframe, cursor) each view's current indicatorResults entry was computed for — see indicatorResultsAreStale. */
  private indicatorResultCursors = new Map<string, { cursorTs: number; symbol: string; timeframe: Timeframe }>()
  private indicatorControllers = new Map<string, AbortController>()
  private indicatorRefreshTimer: ReturnType<typeof setTimeout> | null = null
  private indicatorPlaybackTimer: ReturnType<typeof setInterval> | null = null
  /**
   * How many user-initiated indicator runs are outstanding. Only these drive
   * indicatorLoading: a background playback refresh registers an
   * AbortController like any other run — that is what makes preemption work —
   * but blinking the legend spinner twice a second would be worse than the
   * freeze this whole mechanism exists to fix.
   */
  private indicatorForegroundRuns = 0
  private indicatorVisibilityBeforeHide = new Map<string, boolean>()
  /**
   * Seconds-unit panes (5s/15s/30s) can't use the normal pushRawBars live
   * path — the replay feed is 1m bars, which can't be split into correct
   * sub-minute buckets (see ChartViewController.isSecondsTimeframe). This
   * timer re-fetches such panes from /chart-bars/at on a short interval
   * instead, so they still update during continuous playback rather than
   * freezing until the user pauses.
   */
  private secondsPaneRefreshTimer: ReturnType<typeof setInterval> | null = null

  constructor(viewportClient: ViewportDataClient = new HttpViewportDataClient()) {
    this.viewportClient = viewportClient
    window.addEventListener('pagehide', this.handlePageHide)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  getSnapshot = (): ReplaySnapshot => this.snapshot

  async registerChartView(id: string, element: HTMLElement, adapter: ChartAdapter, timeframe: Timeframe, settings: ChartPaneSettings, hoverStore: HoverBarStore, symbolCode?: string): Promise<void> {
    const view = new ChartViewController({ id, element, adapter, timeframe, settings, marketSession: this.marketSession, hoverStore, followsReplaySymbol: !symbolCode })
    const isCurrentView = (): boolean => this.views.get(id) === view
    this.views.register(view)
    adapter.setKeepDrawing(this.snapshot.keepDrawing)
    adapter.setAllDrawingsLocked(this.snapshot.drawingsLocked)
    adapter.setDrawingsHidden(this.snapshot.drawingsHidden)
    adapter.setCursorMode(this.snapshot.cursorMode)
    this.bindView(view)
    if (!this.bootstrapPromise && this.snapshot.symbols.length === 0) this.bootstrapPromise = this.bootstrap()
    if (this.bootstrapPromise) await this.bootstrapPromise
    if (!isCurrentView()) return
    const symbol = this.snapshot.symbol
    if (symbol && this.source && !view.isInitialized()) {
      await view.initialize(symbol)
      if (!isCurrentView()) return
      const raw = this.rawHistory()
      const displayBars = await this.loadInitialDisplayHistory(view.id, view.timeframe, symbol, raw)
      if (!isCurrentView()) return
      view.rebuild(raw, symbol, false, displayBars)
      view.setReplaySelection(this.currentReplaySelectionState())
      view.syncEconomicEventMarkers(this.economicEventMarkers)
      this.syncChartTradingState(true)
      // Layout changes can remount a chart before the debounced drawing write
      // reaches the API. Prefer the canonical in-memory document in that case
      // so a stale server response cannot clear drawings from the new view.
      if (!this.reloadDrawingDocumentForView(symbol.symbol, id)) await this.reconcileDrawings(id)
    }
    if (!isCurrentView()) return
    if (symbolCode && view.symbol()?.symbol !== symbolCode) await this.setChartViewSymbol(id, symbolCode)
    if (!isCurrentView()) return
    await this.refreshIndicatorView(view)
    this.applyWorkspaceRestoreToView(view)
  }

  unregisterChartView(id: string, expectedAdapter?: ChartAdapter): void {
    if (expectedAdapter && this.views.get(id)?.adapter !== expectedAdapter) return
    this.cancelPendingTimeframeSwitch(id)
    this.indicatorControllers.get(id)?.abort()
    this.indicatorControllers.delete(id)
    this.indicatorResults.delete(id)
    this.indicatorResultCursors.delete(id)
    this.views.unregister(id, expectedAdapter)
    this.pruneInactiveSymbolCaches()
  }

  activateChartView(id: string): void {
    if (!this.views.activate(id)) return
    const view = this.views.active()
    if (!view) return
    const areaZoom = view.adapter.areaZoomState()
    this.orderDraft = null
    const symbol = view.symbol() ?? this.snapshot.symbol
    const fill = symbol ? this.ensureSymbolFill(symbol) : null
    const source = symbol ? this.sourceForSymbol(symbol.symbol) : null
    const lastBar = source ? this.barAtCursor(source) : null
    view.adapter.setCursorMode(this.snapshot.cursorMode)
    this.setSnapshot({ activeSymbol: symbol, timeframe: view.timeframe, fill, evalFill: isEvalActive() ? this.aggregateEvaluationFill() : null, lastBar, stats: fill ? calculateTradeStats(fill.trades) : EMPTY_STATS, selectedDrawing: null, drawingInspectorOpen: false, activeDrawingTool: null, areaZoomSelecting: areaZoom.selecting, areaZoomed: areaZoom.zoomed }, true)
    this.syncChartTradingState(true)
  }

  updateChartViewSettings(id: string, settings: ChartPaneSettings): void {
    const view = this.views.get(id)
    if (!view) return
    view.applySettings(settings)
  }

  setMarketSession(marketSession: MarketSession): void {
    if (marketSession === this.marketSession) return
    this.marketSession = marketSession
    this.views.all().forEach((view) => view.setMarketSession(marketSession))
    const symbol = this.snapshot.symbol
    if (symbol && this.source) this.views.rebuildSymbol(this.rawHistory(), symbol, false)
    this.rebuildAuxiliaryCharts(this.snapshot.cursorTs, false)
    this.syncChartTradingState(true)
  }

  setSyncFlags(syncFlags: ChartSyncFlags): void {
    const shouldAlignDateRange = !this.syncFlags.dateRange && syncFlags.dateRange
    this.syncFlags = { ...syncFlags }
    if (!shouldAlignDateRange) return
    const source = this.views.active()
    if (!source) return
    const time = source.adapter.visibleRange()
    if (!Number.isFinite(time.from) || !Number.isFinite(time.to) || time.to <= time.from) return
    this.views.syncViewport(source.id, { time })
  }
  resetChartView(id: string): void { this.views.resetView(id) }

  setEconomicEventMarkers(markers: EconomicEventMarker[]): void {
    this.economicEventMarkers = markers
    this.views.syncEconomicEventMarkers(markers)
  }

  addIndicator(descriptor: IndicatorDescriptor): void {
    const current = this.snapshot.indicators.find((indicator) => indicator.scriptId === descriptor.id)
    if (current) {
      if (!current.visible) this.setIndicatorVisibility(current.id, true)
      return
    }
    const inputs = Object.fromEntries(descriptor.inputs.map((input) => [input.key, input.default])) as Record<string, IndicatorInputValue>
    const indicator: ActiveIndicator = { id: descriptor.id, scriptId: descriptor.id, name: descriptor.name, visible: !this.snapshot.indicatorsHidden, inputs }
    if (this.snapshot.indicatorsHidden) this.indicatorVisibilityBeforeHide.set(indicator.id, true)
    this.setSnapshot({ indicators: [...this.snapshot.indicators, indicator], indicatorError: null }, true)
    this.scheduleSessionPersist()
    void this.refreshIndicators()
  }

  setIndicatorVisibility(id: string, visible: boolean): void {
    if (this.snapshot.indicatorsHidden) this.indicatorVisibilityBeforeHide.set(id, visible)
    const indicators = this.snapshot.indicators.map((indicator) => indicator.id === id ? { ...indicator, visible: this.snapshot.indicatorsHidden ? false : visible } : indicator)
    this.setSnapshot({ indicators, indicatorError: null }, true)
    this.publishAllIndicatorResults()
    this.scheduleSessionPersist()
    if (visible) void this.refreshIndicators()
  }

  updateIndicatorInputs(id: string, inputs: Record<string, IndicatorInputValue>): void {
    const indicators = this.snapshot.indicators.map((indicator) => indicator.id === id ? { ...indicator, inputs: { ...inputs } } : indicator)
    this.setSnapshot({ indicators, indicatorError: null }, true)
    this.scheduleSessionPersist()
    void this.refreshIndicators()
  }

  removeIndicator(id: string): void {
    this.indicatorVisibilityBeforeHide.delete(id)
    const indicators = this.snapshot.indicators.filter((indicator) => indicator.id !== id)
    this.indicatorResults.forEach((results) => results.delete(id))
    this.setSnapshot({ indicators, indicatorError: null }, true)
    this.publishAllIndicatorResults()
    this.scheduleSessionPersist()
  }

  setIndicatorsHidden(hidden: boolean): void {
    if (this.snapshot.indicatorsHidden === hidden) return
    if (hidden) {
      this.indicatorVisibilityBeforeHide = new Map(this.snapshot.indicators.map((indicator) => [indicator.id, indicator.visible]))
    }
    const indicators = this.snapshot.indicators.map((indicator) => ({
      ...indicator,
      visible: hidden ? false : (this.indicatorVisibilityBeforeHide.get(indicator.id) ?? true),
    }))
    if (!hidden) this.indicatorVisibilityBeforeHide.clear()
    this.setSnapshot({ indicators, indicatorsHidden: hidden, indicatorError: null }, true)
    this.publishAllIndicatorResults()
    this.scheduleSessionPersist()
    if (!hidden && indicators.some((indicator) => indicator.visible)) void this.refreshIndicators()
  }

  removeAllIndicators(): void {
    this.indicatorControllers.forEach((controller) => controller.abort())
    this.indicatorControllers.clear()
    this.indicatorResults.clear()
    this.indicatorResultCursors.clear()
    this.drawingDocuments.clear()
    this.indicatorVisibilityBeforeHide.clear()
    this.setSnapshot({ indicators: [], indicatorsHidden: false, indicatorLoading: false, indicatorError: null }, true)
    this.publishAllIndicatorResults()
    this.scheduleSessionPersist()
  }

  refreshIndicator(id: string): void {
    if (!this.snapshot.indicators.some((indicator) => indicator.id === id && indicator.visible)) return
    void this.refreshIndicators()
  }

  /**
   * Whether a view's on-screen indicator output has to come off the chart
   * before the replacement is fetched.
   *
   * Indicator output belongs to one exact symbol/cursor snapshot, and the
   * reason it was previously cleared on *every* refresh is spoiler safety: a
   * rewind or backwards seek would otherwise leave drawings calculated from
   * bars the replay has not reached again visible while the new request is in
   * flight. That reasoning only applies to a cursor that moved backwards.
   *
   * Stepping forward — the overwhelmingly common case, and the one that fires
   * on every press of the step button — cannot turn old output into a spoiler,
   * because it was computed from strictly less data than the viewer is now
   * allowed to see. Blanking there bought nothing and cost a visible flash of
   * empty chart on every step.
   */
  private indicatorResultsAreStale(view: ChartViewController, symbolCode: string): boolean {
    const previous = this.indicatorResultCursors.get(view.id)
    if (!previous) return true
    if (previous.symbol !== symbolCode || previous.timeframe !== view.timeframe) return true
    return this.snapshot.cursorTs < previous.cursorTs
  }

  private clearIndicatorResults(view: ChartViewController): void {
    this.indicatorResults.delete(view.id)
    this.indicatorResultCursors.delete(view.id)
    view.syncIndicators([])
  }

  private publishIndicatorResults(viewId: string): void {
    const visible = new Set(this.snapshot.indicators.filter((indicator) => indicator.visible).map((indicator) => indicator.id))
    const results = [...(this.indicatorResults.get(viewId)?.values() ?? [])].filter((result) => visible.has(result.indicatorId))
    this.views.syncIndicators(viewId, results)
  }

  private publishAllIndicatorResults(): void {
    this.views.all().forEach((view) => this.publishIndicatorResults(view.id))
  }

  private async refreshIndicatorView(view: ChartViewController): Promise<void> {
    await this.refreshIndicatorGroup([view])
  }

  private async refreshIndicatorGroup(views: readonly ChartViewController[], options: { background?: boolean } = {}): Promise<void> {
    const active = this.snapshot.indicators.filter((indicator) => indicator.visible)
    const firstView = views[0]
    const symbol = firstView?.symbol() ?? null
    if (!firstView || !symbol || this.snapshot.cursorTs <= 0 || active.length === 0) {
      for (const view of views) {
        this.indicatorControllers.get(view.id)?.abort()
        this.indicatorControllers.delete(view.id)
        this.clearIndicatorResults(view)
      }
      return
    }

    const controllers = new Map<ChartViewController, AbortController>()
    for (const view of views) {
      this.indicatorControllers.get(view.id)?.abort()
      if (this.indicatorResultsAreStale(view, symbol.symbol)) this.clearIndicatorResults(view)
      const controller = new AbortController()
      controllers.set(view, controller)
      this.indicatorControllers.set(view.id, controller)
    }
    const sharedController = new AbortController()
    let remainingWaiters = controllers.size
    const abortListeners = new Map<AbortController, () => void>()
    for (const controller of controllers.values()) {
      const handleAbort = (): void => {
        remainingWaiters -= 1
        if (remainingWaiters === 0) sharedController.abort()
      }
      abortListeners.set(controller, handleAbort)
      controller.signal.addEventListener('abort', handleAbort, { once: true })
    }
    // Read once. The request used to take the dispatch-time cursor while
    // indicatorResultCursors recorded the post-await one; with a background
    // refresh running while the cursor keeps moving those diverge by hundreds
    // of bars, and the rewind detector's baseline would then describe
    // something other than the data it is guarding.
    const requestedCursorTs = this.snapshot.cursorTs
    if (!options.background) {
      this.indicatorForegroundRuns += 1
      this.setSnapshot({ indicatorLoading: true }, false)
    }
    try {
      const results = await Promise.all(active.map(async (indicator): Promise<IndicatorRenderResult> => ({
        indicatorId: indicator.id,
        ...await runIndicator(symbol.symbol, firstView.timeframe, indicator.scriptId, requestedCursorTs, indicator.inputs, sharedController.signal),
      })))
      for (const [view, controller] of controllers) {
        if (controller.signal.aborted || this.indicatorControllers.get(view.id) !== controller) continue
        this.indicatorResults.set(view.id, new Map(results.map((result) => [result.indicatorId, result])))
        this.indicatorResultCursors.set(view.id, { cursorTs: requestedCursorTs, symbol: symbol.symbol, timeframe: firstView.timeframe })
        this.publishIndicatorResults(view.id)
      }
      if (this.snapshot.indicatorError) this.setSnapshot({ indicatorError: null }, true)
    } catch (error) {
      if (sharedController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
      const message = error instanceof Error ? error.message : 'Indicator could not be calculated'
      // A script that keeps failing would otherwise re-emit the same message
      // twice a second, re-rendering every snapshot subscriber for no change
      // in what is on screen.
      if (this.snapshot.indicatorError !== message) this.setSnapshot({ indicatorError: message }, true)
    } finally {
      for (const [view, controller] of controllers) {
        const listener = abortListeners.get(controller)
        if (listener) controller.signal.removeEventListener('abort', listener)
        if (this.indicatorControllers.get(view.id) === controller) this.indicatorControllers.delete(view.id)
      }
      if (!options.background) {
        this.indicatorForegroundRuns -= 1
        this.setSnapshot({ indicatorLoading: this.indicatorForegroundRuns > 0 }, true)
      }
    }
  }

  /** Panes that share a symbol and timeframe, so one run can serve them all. */
  private indicatorRefreshGroups(): ChartViewController[][] {
    const groups = new Map<string, ChartViewController[]>()
    for (const view of this.views.all()) {
      const symbol = view.symbol()
      const key = symbol ? JSON.stringify([symbol.symbol, view.timeframe]) : `uninitialized:${view.id}`
      const group = groups.get(key)
      if (group) group.push(view)
      else groups.set(key, [view])
    }
    return [...groups.values()]
  }

  private async refreshIndicators(): Promise<void> {
    await Promise.all(this.indicatorRefreshGroups().map((views) => this.refreshIndicatorGroup(views)))
  }

  /**
   * Keeps indicator output following the cursor during continuous playback.
   *
   * scheduleIndicatorRefresh is a trailing debounce and advance() calls it on
   * every processed tick — once a second at speed 1, every ~60 ms at speed 16
   * — so its timer was always cleared before it could fire, and indicators
   * only ever recomputed once the replay stopped. This is the same shape
   * scheduleSecondsPaneRefresh uses for the same reason: an interval armed
   * once by play() that nothing downstream resets.
   */
  private scheduleIndicatorPlaybackRefresh(): void {
    if (this.indicatorPlaybackTimer) return
    this.indicatorPlaybackTimer = setInterval(
      () => void this.refreshIndicatorsForPlayback(),
      INDICATOR_PLAYBACK_REFRESH_MS,
    )
  }

  private clearIndicatorPlaybackRefresh(): void {
    if (!this.indicatorPlaybackTimer) return
    clearInterval(this.indicatorPlaybackTimer)
    this.indicatorPlaybackTimer = null
  }

  /**
   * One background pass.
   *
   * A group whose previous run is still in flight is skipped, not preempted.
   * refreshIndicatorGroup aborts the outstanding controller on entry, so
   * restarting every 500 ms against a symbol whose runs take longer than that
   * would mean no run ever completes — the same freeze as before, now with
   * continuous server load. Output is a pure function of the cursor, so a
   * skipped tick costs one interval of staleness and the next tick asks for a
   * strictly fresher cursor. User actions still preempt instantly, because
   * the foreground paths keep their unconditional abort.
   */
  private async refreshIndicatorsForPlayback(): Promise<void> {
    // Self-healing: not every path out of playback goes through pause(), so
    // the timer stops itself rather than relying on each of them to remember.
    if (!this.snapshot.playing) {
      this.clearIndicatorPlaybackRefresh()
      return
    }
    if (this.snapshot.status !== 'ready' || this.snapshot.indicatorsHidden) return
    if (this.snapshot.indicators.every((indicator) => !indicator.visible)) return
    const idle = this.indicatorRefreshGroups()
      .filter((views) => views.every((view) => !this.indicatorControllers.has(view.id)))
    await Promise.all(idle.map((views) => this.refreshIndicatorGroup(views, { background: true })))
  }

  private scheduleIndicatorRefresh(delay = 1_000): void {
    if (this.snapshot.indicators.every((indicator) => !indicator.visible)) return
    if (this.indicatorRefreshTimer) clearTimeout(this.indicatorRefreshTimer)
    this.indicatorRefreshTimer = setTimeout(() => {
      this.indicatorRefreshTimer = null
      void this.refreshIndicators()
    }, delay)
  }

  private secondsPaneViews(): ChartViewController[] {
    return this.views.all().filter((view) => parseTimeframe(view.timeframe)?.unit === 's')
  }

  /**
   * Keeps seconds-unit panes fresh. Unlike scheduleIndicatorRefresh, this
   * keeps firing on an interval even during continuous playback rather than
   * only once ticks stop — /chart-bars/at is cheap regardless of timeframe
   * (perf baseline: 0.8-1.7ms), and freezing a 5s chart until pause would be
   * a worse experience than the coarser timeframes already have.
   */
  private scheduleSecondsPaneRefresh(immediate = false): void {
    const panes = this.secondsPaneViews()
    if (panes.length === 0) {
      if (this.secondsPaneRefreshTimer) {
        clearInterval(this.secondsPaneRefreshTimer)
        this.secondsPaneRefreshTimer = null
      }
      return
    }
    if (!this.secondsPaneRefreshTimer) {
      this.secondsPaneRefreshTimer = setInterval(() => void this.refreshSecondsPanes(), 1_000)
    }
    if (immediate) void this.refreshSecondsPanes()
  }

  private async refreshSecondsPanes(): Promise<void> {
    if (this.snapshot.status !== 'ready') return
    const cursorTs = this.snapshot.cursorTs
    await Promise.all(this.secondsPaneViews().map(async (view) => {
      const symbol = view.symbol()
      if (!symbol) return
      try {
        const page = await this.viewportClient.load({
          symbol: symbol.symbol,
          visibleTimeframe: view.timeframe,
          direction: 'before',
          anchorTs: cursorTs,
          pageBars: VIEWPORT_PAGE_BARS,
          maxTs: cursorTs,
          tickSize: symbol.tickSize,
          marketSession: this.marketSession,
        }, new AbortController().signal)
        const displayBars = page.bars.filter((bar) => bar.time <= cursorTs)
        // Empty means "no fresher data yet" (or a transient miss) — keep
        // whatever the pane is already showing rather than blank it.
        if (displayBars.length > 0) view.rebuild([], symbol, true, displayBars)
      } catch {
        // Best-effort background refresh — leave the pane's current (if
        // slightly stale) bars alone rather than surface a transient error.
      }
    }))
  }

  private async bootstrap(): Promise<void> {
    this.setSnapshot({ status: 'loading', error: null }, true)
    try {
      const [symbols, sessions] = await Promise.all([fetchSymbols(), fetchSessions().catch(() => [])])
      await Promise.all(sessions.filter((session) => session.status === 'active').map((session) => patchSession(session.id, { status: 'paused' }).catch(() => undefined)))
      if (symbols.length === 0) throw new Error('No symbols are available in the local data registry')
      const evaluation = getEvalState()
      const symbol = symbols.find((item) => item.symbol === 'NQ') ?? symbols[0]
      this.setSnapshot({ symbols, symbol, activeSymbol: symbol, timeframe: this.views.active()?.timeframe ?? this.snapshot.timeframe }, true)
      await this.loadSymbol(symbol, evaluation.phase === 'running' ? (evaluation.lastCursorTs ?? evaluation.startTs ?? undefined) : undefined)
    } catch (error) {
      this.setSnapshot({ status: 'error', error: error instanceof Error ? error.message : 'Failed to initialize replay' }, true)
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame)
    this.abortViewportLoads()
    this.abortSourcePrefetch()
    if (this.persistTimer) clearTimeout(this.persistTimer)
    if (this.drawingTimer) clearTimeout(this.drawingTimer)
    if (this.transientErrorTimer) clearTimeout(this.transientErrorTimer)
    if (this.indicatorRefreshTimer) clearTimeout(this.indicatorRefreshTimer)
    if (this.secondsPaneRefreshTimer) clearInterval(this.secondsPaneRefreshTimer)
    this.clearIndicatorPlaybackRefresh()
    this.indicatorForegroundRuns = 0
    this.indicatorControllers.forEach((controller) => controller.abort())
    this.indicatorControllers.clear()
    this.indicatorResults.clear()
    this.indicatorResultCursors.clear()
    this.pendingTimeframeSwitches.forEach((timer) => clearTimeout(timer))
    this.pendingTimeframeSwitches.clear()
    this.timeframeControllers.forEach((controller) => controller.abort())
    this.timeframeControllers.clear()
    this.auxiliarySources.clear()
    this.views.destroy()
    window.removeEventListener('pagehide', this.handlePageHide)
    this.bootstrapPromise = null
  }

  async selectSymbol(symbolCode: string): Promise<void> {
    const evaluation = getEvalState()
    if (evaluation.phase === 'running') {
      const active = this.views.active()
      if (active) await this.setChartViewSymbol(active.id, symbolCode)
      return
    }
    const symbol = this.snapshot.symbols.find((item) => item.symbol === symbolCode)
    if (!symbol || symbol.symbol === this.snapshot.symbol?.symbol) return
    this.pause()
    await this.deactivateReplaySession('paused')
    this.setSnapshot({ symbol, activeSymbol: symbol }, true)
    await this.loadSymbol(symbol)
  }

  async setTimeframe(timeframe: Timeframe): Promise<void> {
    const view = this.views.active()
    if (!view) return
    await this.setChartViewTimeframe(view.id, timeframe)
  }

  async setChartViewTimeframe(id: string, timeframe: Timeframe): Promise<void> {
    this.cancelPendingTimeframeSwitch(id)
    const view = this.views.get(id)
    if (!view || timeframe === view.timeframe) return
    this.pause()
    if (this.views.active()?.id === id) this.setSnapshot({ timeframe }, true)
    const symbol = view.symbol() ?? this.snapshot.symbol
    if (!symbol) return
    const controller = new AbortController()
    this.timeframeControllers.set(id, controller)
    let displayBars: DisplayBar[] | undefined
    try {
      const page = await this.viewportClient.load({
        symbol: symbol.symbol,
        visibleTimeframe: timeframe,
        direction: 'before',
        anchorTs: this.snapshot.cursorTs,
        pageBars: VIEWPORT_PAGE_BARS,
        maxTs: this.snapshot.cursorTs,
        tickSize: symbol.tickSize,
        marketSession: this.marketSession,
      }, controller.signal)
      if (controller.signal.aborted || this.timeframeControllers.get(id) !== controller) return
      displayBars = page.bars.filter((bar) => bar.time <= this.snapshot.cursorTs)
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
      // Keep the chart usable with the already loaded replay window when the
      // dedicated display-history endpoint is temporarily unavailable.
      displayBars = undefined
    } finally {
      if (this.timeframeControllers.get(id) === controller) this.timeframeControllers.delete(id)
    }
    const raw = this.snapshot.symbol?.symbol === symbol.symbol && this.source ? this.rawHistory(timeframe) : []
    await view.changeTimeframe(timeframe, symbol, raw, displayBars)
    view.syncEconomicEventMarkers(this.economicEventMarkers)
    this.syncChartTradingState(true)
    if (!this.reloadDrawingDocumentForView(symbol.symbol, view.id) && this.snapshot.symbol?.symbol === symbol.symbol) await this.reconcileDrawings(view.id)
    await this.refreshIndicatorView(view)
  }

  async setChartViewSymbol(id: string, symbolCode: string): Promise<void> {
    const view = this.views.get(id)
    const symbol = this.snapshot.symbols.find((item) => item.symbol === symbolCode)
    if (!view || !symbol || view.symbol()?.symbol === symbolCode) return
    this.cancelPendingTimeframeSwitch(id)
    this.timeframeControllers.get(id)?.abort()
    const controller = new AbortController()
    this.timeframeControllers.set(id, controller)
    try {
      const isReplaySymbol = this.snapshot.symbol?.symbol === symbol.symbol
      const [page, auxiliarySource] = await Promise.all([
        this.viewportClient.load({
          symbol: symbol.symbol,
          visibleTimeframe: view.timeframe,
          direction: 'before',
          anchorTs: this.snapshot.cursorTs,
          pageBars: VIEWPORT_PAGE_BARS,
          maxTs: this.snapshot.cursorTs,
          tickSize: symbol.tickSize,
          marketSession: this.marketSession,
        }, controller.signal),
        isReplaySymbol
          ? Promise.resolve<BarSource | null>(null)
          : fetchBarsAt(symbol.symbol, replayBaseTimeframe(symbol), this.snapshot.cursorTs, 3000, 10000, controller.signal).then((frame) => new BarSource(frame)),
      ])
      if (controller.signal.aborted || this.timeframeControllers.get(id) !== controller) return
      if (auxiliarySource) this.auxiliarySources.set(symbol.symbol, auxiliarySource)
      const raw = isReplaySymbol && this.source
        ? this.rawHistory()
        : auxiliarySource ? this.rawHistoryFromSource(auxiliarySource, this.snapshot.cursorTs) : []
      view.changeSymbol(symbol, raw, page.bars.filter((bar) => bar.time <= this.snapshot.cursorTs))
      view.setReplaySelection(this.currentReplaySelectionState())
      view.syncEconomicEventMarkers(this.economicEventMarkers)
      this.ensureSymbolFill(symbol)
      if (this.views.active()?.id === id) this.activateChartView(id)
      else this.syncChartTradingState(true)
      if (!this.reloadDrawingDocumentForView(symbol.symbol, id)) await this.reconcileDrawings(id)
      await this.refreshIndicatorView(view)
      this.pruneInactiveSymbolCaches()
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
      this.setSnapshot({ error: error instanceof Error ? error.message : `Could not load ${symbolCode} for this chart` }, true)
    } finally {
      if (this.timeframeControllers.get(id) === controller) this.timeframeControllers.delete(id)
    }
  }

  requestChartViewSymbol(id: string, symbolCode: string): void {
    void this.setChartViewSymbol(id, symbolCode)
  }

  requestChartViewTimeframe(id: string, timeframe: Timeframe): void {
    const view = this.views.get(id)
    if (!view) return
    this.cancelPendingTimeframeSwitch(id)
    if (timeframe === view.timeframe) return
    if (this.snapshot.playing) this.pause()
    const timer = setTimeout(() => {
      this.pendingTimeframeSwitches.delete(id)
      void this.setChartViewTimeframe(id, timeframe)
    }, TIMEFRAME_SWITCH_SETTLE_MS)
    this.pendingTimeframeSwitches.set(id, timer)
  }

  togglePlay(): void {
    if (this.snapshot.playing) this.pause()
    else this.play()
  }
  play(): void {
    if (this.snapshot.status !== 'ready' || !this.source || this.snapshot.replayMode !== 'active') return
    this.ensureCursorViewport()
    this.lastFrameAt = performance.now()
    this.setSnapshot({ playing: true }, true)
    this.scheduleIndicatorPlaybackRefresh()
    cancelAnimationFrame(this.animationFrame)
    this.animationFrame = requestAnimationFrame(this.frame)
  }
  pause(): void {
    const wasPlaying = this.snapshot.playing
    this.clearIndicatorPlaybackRefresh()
    cancelAnimationFrame(this.animationFrame)
    this.views.flushRawBars()
    this.highSpeedChartFrame = 0
    this.setSnapshot({ playing: false }, true)
    this.scheduleSessionPersist()
    if (wasPlaying) {
      this.scheduleIndicatorRefresh(0)
      this.scheduleSecondsPaneRefresh(true)
    }
  }

  /** Number of canonical source bars covered by the selected replay interval. */
  private stepBars(): number {
    const symbol = this.snapshot.symbol
    const baseSeconds = symbol ? timeframeSeconds(replayBaseTimeframe(symbol)) : 60
    return Math.max(1, Math.round(timeframeSeconds(this.snapshot.stepTimeframe) / baseSeconds))
  }

  stepForward(): void { this.pause(); this.ensureCursorViewport(); this.advance(this.stepBars()); this.scheduleIndicatorRefresh(0); this.scheduleSecondsPaneRefresh(true); this.emitSnapshot(true) }
  stepBack(): void {
    if (isEvalActive()) return
    this.pause()
    if (!this.source || this.cursorIndex <= 0) return
    const steps = Math.min(this.stepBars(), this.cursorIndex)
    const targetIndex = this.cursorIndex - steps
    const restored = this.fillSnapshots.get(targetIndex)
    const hasRecordedTrades = [...this.symbolFills.values()].some((fill) => fill.trades.length > 0)
    if (!restored && hasRecordedTrades) {
      // Refuse rather than reset: rewinding past the recorded window would
      // discard a journal that has already been persisted, which is exactly
      // the silent data loss this snapshot ring exists to prevent.
      this.setSnapshot({ error: 'Cannot step back past the start of this replay session' }, true)
      return
    }
    for (let index = targetIndex + 1; index <= this.cursorIndex; index += 1) this.fillSnapshots.delete(index)
    this.cursorIndex = targetIndex
    this.recenterViewportCache()
    if (restored) {
      this.symbolFills = new Map(restored)
      const activeSymbol = this.tradingSymbol()
      const activeFill = activeSymbol ? this.symbolFills.get(activeSymbol.symbol) ?? null : null
      this.snapshot = { ...this.snapshot, fill: activeFill, stats: activeFill ? calculateTradeStats(activeFill.trades) : EMPTY_STATS }
      this.orderDraft = null
    } else {
      // No session in progress (plain browsing) — nothing to preserve.
      this.rebuildSimulation()
    }
    this.rebuildChart()
    this.syncChartTradingState(true)
    this.scheduleSessionPersist()
    this.scheduleIndicatorRefresh(0)
    this.scheduleSecondsPaneRefresh(true)
    this.emitSnapshot(true)
  }

  setSpeed(speed: number): void {
    if (!SPEEDS.includes(speed as (typeof SPEEDS)[number])) return
    this.accumulator = 0
    this.setSnapshot({ speed }, true)
  }
  cycleSpeed(direction: 1 | -1): void {
    const index = SPEEDS.indexOf(this.snapshot.speed as (typeof SPEEDS)[number])
    this.setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, index + direction))])
  }
  setStepTimeframe(stepTimeframe: ReplayStepTimeframe): void {
    if (!STEP_TIMEFRAMES.includes(stepTimeframe)) return
    this.accumulator = 0
    this.setSnapshot({ stepTimeframe }, true)
  }
  setQty(qty: number): void {
    const evaluation = getEvalState()
    const evalLimit = evaluation.phase === 'running' ? (evaluation.config?.maxPositionSize ?? 0) : 0
    const maxContracts = evalLimit > 0 ? Math.min(MAX_REPLAY_CONTRACTS, evalLimit) : MAX_REPLAY_CONTRACTS
    const next = Math.max(1, Math.min(maxContracts, Math.round(qty)))
    if (this.orderDraft) this.orderDraft = setOrderTicketQuantity(this.orderDraft, next, MAX_REPLAY_CONTRACTS)
    this.setSnapshot({ qty: next }, true)
    this.syncChartTradingState(true)
  }

  beginReplaySelection(options: ReplaySelectionOptions = {}): void {
    if (isEvalActive()) return
    if (!this.source || !this.snapshot.symbol || (this.snapshot.status !== 'ready' && this.snapshot.status !== 'buffering')) return
    this.pause()
    this.setDrawingTool(null)
    this.deselectDrawing()
    this.createSessionOnSelection = options.createSession === true
    this.setSnapshot({ replayMode: 'selecting' }, true)
    this.views.setReplaySelection({ mode: 'selecting' })
  }

  async selectReplayBar(timestamp: number): Promise<void> {
    if (isEvalActive()) return
    if (this.snapshot.replayMode !== 'selecting' || !Number.isFinite(timestamp)) return
    const selectedTimestamp = Math.max(this.normalizeReplaySelectionTimestamp(timestamp), 0)
    const shouldCreateSession = this.createSessionOnSelection
    this.createSessionOnSelection = false
    if (!isEvalActive()) await this.deactivateReplaySession('paused')
    if (shouldCreateSession) this.retainedSessionTrades = []
    await this.seek(selectedTimestamp, 'ceil')
    if (this.snapshot.status !== 'ready') return
    const replayStartTs = this.snapshot.cursorTs
    let sessionId: string | null = null
    let sessionStatus: ReplaySession['status'] | null = null
    if (shouldCreateSession && !isEvalActive() && this.snapshot.symbol) {
      try {
        sessionId = await createSession(this.snapshot.symbol.symbol, this.views.active()?.timeframe ?? this.snapshot.timeframe, replayStartTs, {
          kind: 'replay',
          initialBalanceCents: REPLAY_STARTING_EQUITY_CENTS,
        })
        sessionStatus = 'active'
        this.persistedTrades = null
        if (this.snapshot.fill) {
          await patchSession(sessionId, { equityCents: this.snapshot.fill.equityCents, status: 'active', config: serializeReplayRuntime(this.snapshot.fill, this.snapshot.indicators) })
        }
      } catch {
        sessionId = null
        sessionStatus = null
        this.setSnapshot({ error: 'Session could not be created. This replay will remain temporary.' }, true)
      }
    }
    this.setSnapshot({ replayMode: 'active', replayStartTs, sessionId, sessionStatus }, true)
    this.views.setReplaySelection({ mode: 'active', timestamp: replayStartTs })
    this.resetAllChartViews()
  }

  cancelReplaySelection(): void {
    if (this.snapshot.replayMode !== 'selecting') return
    this.createSessionOnSelection = false
    const replayStartTs = this.snapshot.replayStartTs
    if (replayStartTs === null) {
      this.setSnapshot({ replayMode: 'inactive' }, true)
      this.views.setReplaySelection({ mode: 'inactive' })
      return
    }
    this.setSnapshot({ replayMode: 'active' }, true)
    this.views.setReplaySelection({ mode: 'active', timestamp: replayStartTs })
  }

  exitReplay(): void {
    if (isEvalActive()) return
    void this.deactivateReplaySession('paused', { returnToLatest: true, snapshotOnExit: true })
  }

  pauseReplaySession(): Promise<void> { return this.deactivateReplaySession('paused', { returnToLatest: true, snapshotOnExit: true }) }
  stopReplaySession(): Promise<void> { return this.deactivateReplaySession('stopped', { returnToLatest: true, snapshotOnExit: true }) }
  async exitEvaluation(): Promise<void> {
    if (!isEvalActive()) return
    if (!await this.flushDrawingPersistence()) {
      this.setSnapshot({ error: 'Evaluation drawings could not be saved. Exit was cancelled so you can retry.' }, true)
      return
    }
    this.captureWorkspaceRecoveryPoint('explicit-exit')
    this.cancelActiveOrders()
    getEvalState().exitEvaluation()
    await this.deactivateReplaySession('paused', { returnToLatest: true, drawingsFlushed: true })
  }

  async seek(timestamp: number, alignment: 'floor' | 'ceil' = 'floor'): Promise<void> {
    this.pause()
    const symbol = this.snapshot.symbol
    if (!symbol) return
    const evaluation = getEvalState()
    if (evaluation.phase === 'running') evaluation.prepareFillRebase()
    const minimum = evaluation.phase === 'running' ? (evaluation.startTs ?? 0) : 0
    const targetTimestamp = Math.max(timestamp, minimum, evaluation.phase === 'running' ? this.snapshot.cursorTs : 0)
    this.setSnapshot({ status: 'loading' }, true)
    try {
      if (!this.source || targetTimestamp < this.source.firstTs || targetTimestamp > this.source.lastTs) {
        this.source = new BarSource(await fetchBarsAt(symbol.symbol, replayBaseTimeframe(symbol), targetTimestamp, 3000, 10000))
      }
      this.cursorIndex = alignment === 'ceil'
        ? this.source.findIndexAtOrAfter(targetTimestamp)
        : this.source.findIndex(targetTimestamp)
      this.startIndex = this.cursorIndex
      this.resetFillEngine()
      this.recenterViewportCache()
      this.rebuildChart()
      const cursorTs = this.source.at(this.cursorIndex)?.ts ?? targetTimestamp
      await this.refreshAuxiliaryViewsAtCursor(cursorTs)
      this.setSnapshot({ status: 'ready', cursorTs }, true)
      for (const view of this.views.all()) {
        const viewSymbol = view.symbol()
        if (viewSymbol) this.ensureSymbolFill(viewSymbol)
      }
      if (!isEvalActive()) this.fillSnapshots.set(this.cursorIndex, new Map(this.symbolFills))
      const activeView = this.views.active()
      if (activeView) this.activateChartView(activeView.id)
      await this.reconcileDrawings()
      await this.refreshIndicators()
      this.scheduleSecondsPaneRefresh(true)
    } catch (error) {
      this.setSnapshot({ status: 'error', error: error instanceof Error ? error.message : 'Seek failed' }, true)
    }
  }

  placeMarket(side: OrderSide): void {
    const symbol = this.tradingSymbol()
    if (!symbol || !this.canTrade()) return
    const source = this.sourceForSymbol(symbol.symbol)
    const lastBar = source ? this.barAtCursor(source) : this.snapshot.lastBar
    if (!lastBar) {
      this.setSnapshot({ error: 'No replay bar is available for the market ticket' }, true)
      return
    }
    this.orderDraft = createOrderTicketDraft(side, 'market', this.snapshot.qty, lastBar.closeTicks)
    this.syncChartTradingState(true)
    this.emitSnapshot(true)
  }
  placePending(side: OrderSide, type: Exclude<OrderType, 'market'>, price: number): void {
    const symbol = this.tradingSymbol()
    if (!symbol || !this.canTrade()) return
    this.orderDraft = createOrderTicketDraft(side, type, this.snapshot.qty, Math.round(price / symbol.tickSize))
    this.syncChartTradingState(true)
    this.emitSnapshot(true)
  }
  flatten(): void { this.mutateFill(flattenPosition) }
  reverse(): void { this.mutateFill(reversePosition) }
  cancelOrder(id: string): void { this.mutateFill((state) => cancelOrder(state, id)) }
  placeBracket(stopPrice: number, targetPrice: number): void {
    const symbol = this.tradingSymbol()
    if (!symbol) return
    this.mutateFill((state) => placeBracket(state, Math.round(stopPrice / symbol.tickSize), Math.round(targetPrice / symbol.tickSize)))
  }

  private canTrade(): boolean {
    const allowed = Boolean(this.snapshot.fill && this.snapshot.replayMode === 'active')
    if (!allowed) this.setSnapshot({ error: 'Start bar replay before placing orders' }, true)
    return allowed
  }

  private beginOrderEdit(id: string): void {
    const fill = this.snapshot.fill
    if (!fill || id.startsWith('ticket-')) return
    const draft = editOrderTicketDraft(fill.orders, id)
    if (!draft) return
    this.orderDraft = draft
    this.snapshot = { ...this.snapshot, qty: draft.qty }
    this.syncChartTradingState(true)
    this.emitSnapshot(true)
  }

  private moveOrderLine(id: string, price: number): void {
    const symbol = this.tradingSymbol()
    if (!symbol) return
    const ticks = Math.round(price / symbol.tickSize)
    if (this.orderDraft) {
      const role = id.includes('stop-loss') ? 'stopLoss' : id.includes('take-profit') ? 'takeProfit' : 'entry'
      this.orderDraft = setOrderTicketPrice(this.orderDraft, role satisfies OrderTicketRole, ticks)
      this.syncChartTradingState(true)
      this.emitSnapshot(true)
      return
    }
    this.amendOrderPrice(id, price)
  }

  private handleOrderLineAction(action: OrderLineAction): void {
    if (action.type === 'confirm') { this.confirmOrderTicket(); return }
    if (action.type === 'discard') { this.discardOrderTicket(); return }
    if (action.type === 'toggle-stop-loss' || action.type === 'toggle-take-profit') {
      if (!this.orderDraft) return
      this.orderDraft = toggleOrderTicketProtection(this.orderDraft, action.type === 'toggle-stop-loss' ? 'stopLoss' : 'takeProfit')
      this.syncChartTradingState(true)
      this.emitSnapshot(true)
      return
    }
    if (action.type === 'quantity') {
      if (!this.orderDraft) return
      this.setQty(action.qty)
      return
    }
    if (action.type === 'edit') { this.beginOrderEdit(action.orderId); return }
    if (!('orderId' in action)) return
    const orderId = action.orderId
    if (orderId === 'ticket-take-profit') {
      const draft = this.orderDraft
      if (draft && draft.takeProfitTicks !== null) this.orderDraft = toggleOrderTicketProtection(draft, 'takeProfit')
      this.syncChartTradingState(true)
      this.emitSnapshot(true)
      return
    }
    if (orderId === 'ticket-stop-loss') {
      const draft = this.orderDraft
      if (draft && draft.stopLossTicks !== null) this.orderDraft = toggleOrderTicketProtection(draft, 'stopLoss')
      this.syncChartTradingState(true)
      this.emitSnapshot(true)
      return
    }
    if (orderId === 'position') { this.flatten(); return }
    if (orderId.startsWith('ticket-')) { this.discardOrderTicket(); return }
    this.cancelOrder(orderId)
  }

  private confirmOrderTicket(): void {
    const draft = this.orderDraft
    if (!draft) return
    const error = validateOrderTicket(draft)
    if (error) { this.setSnapshot({ error }, true); return }
    if (this.snapshot.error) this.setSnapshot({ error: null }, true)
    this.orderDraft = null
    this.mutateFill((state) => {
      let next = state
      if (draft.mode === 'edit' && draft.sourceOrderId) next = cancelOrder(next, draft.sourceOrderId)
      return placeEntryBracket(next, {
        side: draft.side, type: draft.type, qty: draft.qty, priceTicks: draft.entryPriceTicks,
        stopLossTicks: draft.stopLossTicks ?? undefined,
        takeProfitTicks: draft.takeProfitTicks ?? undefined,
      })
    })
    this.syncChartTradingState(true)
  }

  private discardOrderTicket(): void {
    if (!this.orderDraft) return
    this.orderDraft = null
    this.syncChartTradingState(true)
    this.emitSnapshot(true)
  }

  setDrawingMode(mode: DrawingMode): void {
    this.setSnapshot({ drawingMode: mode }, true)
    void this.reconcileDrawings()
  }

  drawingTools(): DrawingToolDefinition[] { return this.views.active()?.adapter.drawingTools() ?? [] }
  setCursorMode(mode: ChartCursorMode): void {
    this.setDrawingTool(null)
    this.views.all().forEach((view) => {
      view.adapter.deselectDrawing()
      view.adapter.setCursorMode(mode)
    })
    this.setSnapshot({ cursorMode: mode, activeDrawingTool: null, selectedDrawing: null, drawingInspectorOpen: false }, true)
  }
  setDrawingTool(tool: string | null): void {
    if (tool) this.pause()
    if (tool && this.snapshot.drawingsHidden) this.setDrawingsHidden(false)
    if (tool && this.snapshot.cursorMode !== 'cross') this.views.all().forEach((view) => view.adapter.setCursorMode('cross'))
    this.views.active()?.adapter.setDrawingTool(tool)
    this.setSnapshot({ cursorMode: tool ? 'cross' : this.snapshot.cursorMode, activeDrawingTool: tool, areaZoomSelecting: false }, true)
  }
  deselectDrawing(): void { this.views.active()?.adapter.deselectDrawing() }
  deleteSelectedDrawing(): void { this.views.active()?.adapter.deleteSelectedDrawing() }
  lockSelectedDrawing(): void { this.views.active()?.adapter.lockSelectedDrawing() }
  deleteAllDrawings(): void { this.views.active()?.adapter.deleteAllDrawings() }
  updateSelectedDrawing(patch: DrawingAppearancePatch): void { this.views.active()?.adapter.updateSelectedDrawing(patch) }
  setNextDrawingAppearance(patch: DrawingAppearancePatch | null): void { this.views.active()?.adapter.setNextDrawingAppearance(patch) }
  copySelectedDrawing(): void {
    const drawing = this.views.active()?.adapter.copySelectedDrawing()
    if (drawing) this.drawingClipboard = structuredClone(drawing)
  }
  pasteDrawing(): void {
    if (this.drawingClipboard) this.views.active()?.adapter.pasteDrawing(structuredClone(this.drawingClipboard))
  }
  undoDrawing(): void { this.views.active()?.adapter.undoDrawing() }
  redoDrawing(): void { this.views.active()?.adapter.redoDrawing() }
  toggleDrawingsVisibility(): void { this.setDrawingsHidden(!this.snapshot.drawingsHidden) }
  setDrawingsHidden(hidden: boolean): void {
    this.views.all().forEach((view) => view.adapter.setDrawingsHidden(hidden))
    this.setSnapshot({ drawingsHidden: hidden, selectedDrawing: hidden ? null : this.snapshot.selectedDrawing, drawingInspectorOpen: hidden ? false : this.snapshot.drawingInspectorOpen }, true)
  }
  setAllDrawingsLocked(locked: boolean): void {
    this.views.all().forEach((view) => view.adapter.setAllDrawingsLocked(locked))
    this.setSnapshot({ drawingsLocked: locked, selectedDrawing: locked ? null : this.snapshot.selectedDrawing, drawingInspectorOpen: locked ? false : this.snapshot.drawingInspectorOpen }, true)
  }
  setKeepDrawing(enabled: boolean): void {
    this.views.all().forEach((view) => view.adapter.setKeepDrawing(enabled))
    this.setSnapshot({ keepDrawing: enabled }, true)
  }
  drawingCount(): number { return this.views.active()?.adapter.drawingCount() ?? 0 }
  moveChart(direction: 'left' | 'right', bars = 1): void {
    const adapter = this.views.active()?.adapter
    if (!adapter) return
    if (bars === 1 && adapter.nudgeSelectedDrawing(direction)) return
    adapter.panView(direction === 'left' ? -bars : bars)
  }
  nudgeDrawing(direction: 'up' | 'down'): boolean { return this.views.active()?.adapter.nudgeSelectedDrawing(direction) ?? false }
  zoomChart(factor: number): void { this.views.active()?.adapter.zoomView(factor) }
  beginAreaZoom(): void {
    this.pause()
    this.setDrawingTool(null)
    this.deselectDrawing()
    this.views.active()?.adapter.beginAreaZoom()
    this.setSnapshot({ areaZoomSelecting: true }, true)
  }
  resetAreaZoom(): void { this.views.active()?.adapter.resetAreaZoom() }
  toggleInvertScale(): void { this.views.active()?.adapter.toggleInvertScale() }
  togglePriceScaleMode(mode: 'logarithmic' | 'percentage'): void { this.views.active()?.adapter.togglePriceScaleMode(mode) }
  takeChartSnapshot(): void { this.views.active()?.adapter.takeSnapshot() }
  placePendingAtLast(side: OrderSide, type: Exclude<OrderType, 'market'>): void {
    const symbol = this.tradingSymbol()
    const source = symbol ? this.sourceForSymbol(symbol.symbol) : null
    const lastBar = source ? this.barAtCursor(source) : this.snapshot.lastBar
    if (!symbol || !lastBar) return
    this.placePending(side, type, lastBar.closeTicks * symbol.tickSize)
  }
  closeDrawingInspector(): void { this.setSnapshot({ drawingInspectorOpen: false }, true) }
  openDrawingInspector(): void {
    if (this.snapshot.selectedDrawing) this.setSnapshot({ drawingInspectorOpen: true }, true)
  }

  async resumeSession(session: ReplaySession): Promise<void> {
    if (isEvalActive()) {
      this.setSnapshot({ error: 'Finish or abandon the active evaluation before loading another replay session' }, true)
      return
    }
    await this.deactivateReplaySession('paused')
    const recoveryPoint = await this.resolveWorkspaceRecoveryPoint({ kind: 'replay', id: session.id })
    if (recoveryPoint) this.prepareWorkspaceRestore(recoveryPoint)
    const symbolCode = recoveryPoint?.symbol ?? session.symbol
    const symbol = this.snapshot.symbols.find((item) => item.symbol === symbolCode)
    if (!symbol) {
      this.setSnapshot({ error: `Session symbol ${symbolCode} is unavailable` }, true)
      return
    }
    let trades: ClosedTrade[]
    try {
      trades = await fetchTrades(session.id)
    } catch {
      if (!recoveryPoint) {
        this.setSnapshot({ error: 'This session could not be activated because its trade history is unavailable.' }, true)
        return
      }
      trades = []
    }
    this.retainedSessionTrades = []
    const checkpoint = recoveryPoint?.cursorTs ?? (session.cursorTs || session.startTs)
    const hasRecoveryTrades = recoveryPoint ? Object.values(recoveryPoint.fills).some((fill) => fill.trades.length > 0) : false
    const resolution = trades.length === 0 && !hasRecoveryTrades
      ? await this.resolveDataTimestamp(symbol, checkpoint, 'nearest')
      : { timestamp: checkpoint, calendarAvailable: true }
    const desiredTimeframe = recoveryPoint?.layout.panes[recoveryPoint.layout.activePaneId]?.timeframe ?? session.tf
    if (this.snapshot.symbol?.symbol !== symbol.symbol) {
      const active = this.views.active()
      if (active) active.timeframe = desiredTimeframe
      this.setSnapshot({ symbol, timeframe: desiredTimeframe }, true)
      await this.loadSymbol(symbol, resolution.timestamp)
    } else if (this.snapshot.timeframe !== desiredTimeframe) {
      await this.setTimeframe(desiredTimeframe)
    }
    await this.seek(resolution.timestamp)
    if (this.snapshot.status !== 'ready' || !this.snapshot.fill) return
    this.setSnapshot({ sessionId: session.id, sessionStatus: 'active', replayMode: 'active', replayStartTs: session.startTs }, true)
    if (recoveryPoint) {
      this.prepareWorkspaceRestore(recoveryPoint)
      this.restoreWorkspaceRuntime(recoveryPoint)
    } else {
      const fill = restoreReplayRuntime(this.snapshot.fill, session, trades)
      this.retainedSessionTrades = fill.trades
      const indicators = restoreReplayIndicators(session)
      this.snapshot = { ...this.snapshot, fill, indicators, stats: calculateTradeStats(fill.trades) }
      this.symbolFills.clear()
      this.symbolFills.set(fill.config.symbol, fill)
      this.fillSnapshots.clear()
      this.fillSnapshots.set(this.cursorIndex, new Map(this.symbolFills))
    }
    const fill = this.snapshot.fill
    if (!fill) return
    this.persistedTrades = fill.trades
    await patchSession(session.id, { status: 'active', cursorTs: this.snapshot.cursorTs, equityCents: fill.equityCents, config: serializeReplayRuntime(fill, this.snapshot.indicators) })
    this.syncChartTradingState(true)
    this.views.setReplaySelection({ mode: 'active', timestamp: session.startTs })
    const latestTrade = fill.trades.reduce<EngineTrade | null>((latest, trade) => !latest || trade.exitTs > latest.exitTs ? trade : latest, null)
    this.views.focusTime(latestTrade?.exitTs ?? resolution.timestamp)
    await this.refreshIndicators()
    this.resetAllChartViews()
    if (!resolution.calendarAvailable) this.setSnapshot({ error: 'The trading calendar is unavailable; the chart opened on the closest bar returned by history.' }, true)
  }

  async syncEvaluationSession(): Promise<void> {
    const evaluation = getEvalState()
    if (evaluation.phase !== 'running' || evaluation.startTs === null) return
    const recoveryPoint = evaluation.accountId ? await this.resolveWorkspaceRecoveryPoint({ kind: 'eval', id: evaluation.accountId }) : null
    if (recoveryPoint) this.prepareWorkspaceRestore(recoveryPoint)
    const recoveredSymbol = recoveryPoint ? this.snapshot.symbols.find((item) => item.symbol === recoveryPoint.symbol) : null
    const symbol = recoveredSymbol ?? this.views.active()?.symbol() ?? this.snapshot.symbol ?? this.snapshot.symbols.find((item) => item.symbol === 'NQ') ?? this.snapshot.symbols[0]
    if (!symbol) return
    const checkpoint = recoveryPoint?.cursorTs ?? evaluation.lastCursorTs ?? evaluation.startTs
    const recoveredTrades = recoveryPoint ? Object.values(recoveryPoint.fills).flatMap((fill) => fill.trades) : []
    const latestTradeTs = recoveredTrades.reduce<number | null>((latest, trade) => latest === null || trade.exitTs > latest ? trade.exitTs : latest, null)
      ?? evaluation.trades.reduce<number | null>((latest, trade) => latest === null || trade.exitTime > latest ? trade.exitTime : latest, null)
    const resolution = latestTradeTs !== null
      ? { timestamp: checkpoint, calendarAvailable: true }
      : await this.resolveDataTimestamp(symbol, checkpoint, 'at-or-after')
    this.setSnapshot({ symbol, activeSymbol: symbol }, true)
    await this.loadSymbol(symbol, resolution.timestamp)
    if (this.snapshot.status !== 'ready') return
    this.setSnapshot({ replayMode: 'active', replayStartTs: evaluation.startTs }, true)
    if (recoveryPoint) {
      this.prepareWorkspaceRestore(recoveryPoint)
      this.restoreWorkspaceRuntime(recoveryPoint)
    }
    this.views.setReplaySelection({ mode: 'active', timestamp: evaluation.startTs })
    this.views.focusTime(latestTradeTs ?? resolution.timestamp)
    this.resetAllChartViews()
    if (!resolution.calendarAvailable) this.setSnapshot({ error: 'The trading calendar is unavailable; the evaluation opened on the closest bar returned by history.' }, true)
    await this.ensureEvaluationSession()
  }

  /**
   * Points the snapshot at the backend session backing this evaluation
   * account. The debounced persistence machinery keys purely off
   * `snapshot.sessionId`, so this is what makes eval trades reach the
   * server at all. The id is durable in the eval store, so resuming an
   * account reuses its session rather than minting a second one that would
   * receive a duplicate copy of the same journal.
   */
  private async ensureEvaluationSession(): Promise<void> {
    const evaluation = getEvalState()
    const symbol = this.snapshot.symbol
    if (evaluation.phase !== 'running' || !evaluation.config || evaluation.startTs === null || !symbol) return
    try {
      let sessionId = evaluation.sessionId
      if (!sessionId) {
        sessionId = await createSession(symbol.symbol, this.views.active()?.timeframe ?? this.snapshot.timeframe, evaluation.startTs, {
          kind: 'eval',
          initialBalanceCents: Math.round(evaluation.config.accountSize * 100),
          name: evaluation.name?.trim() || (evaluation.accountId ? `#${shortEvalAccountHash(evaluation.accountId)}` : undefined),
        })
        evaluation.attachSession(sessionId)
      }
      this.persistedTrades = null
      this.setSnapshot({ sessionId, sessionStatus: 'active' }, true)
      const fill = this.snapshot.fill
      if (fill) {
        await patchSession(sessionId, {
          cursorTs: this.snapshot.cursorTs,
          equityCents: fill.equityCents,
          status: 'active',
          config: serializeReplayRuntime(fill, this.snapshot.indicators),
        })
      }
    } catch {
      this.setSnapshot({ error: 'Evaluation could not be saved to the server. It will continue locally.' }, true)
    }
  }

  private async resolveDataTimestamp(symbol: SymbolMeta, timestamp: number, direction: NearestDataDirection): Promise<DataTimestampResolution> {
    const baseTimeframe = replayBaseTimeframe(symbol)
    const range = symbol.ranges[baseTimeframe]
    if (!range) return { timestamp, calendarAvailable: false }
    const bounded = Math.max(range.from, Math.min(timestamp, range.to))
    try {
      const calendar = await fetchCalendar(symbol.symbol, baseTimeframe, range.from, range.to)
      return { timestamp: nearestDataTimestamp(calendar, bounded, direction) ?? bounded, calendarAvailable: true }
    } catch {
      return { timestamp: bounded, calendarAvailable: false }
    }
  }

  private async loadSymbol(symbol: SymbolMeta, requestedStart?: number): Promise<void> {
    if (this.views.size() === 0) return
    this.abortSourcePrefetch()
    this.abortViewportLoads()
    this.views.setReplaySelection({ mode: 'inactive' })
    this.setSnapshot({ status: 'loading', error: null, eagerState: 'idle', sessionId: null, sessionStatus: null, replayMode: 'inactive', replayStartTs: null }, true)
    try {
      const baseTimeframe = replayBaseTimeframe(symbol)
      const range = symbol.ranges[baseTimeframe]
      if (!range) throw new Error(`${symbol.symbol} has no ${baseTimeframe} data range`)
      const fallbackStart = Math.max(range.from, range.to - 5 * 86400)
      const start = Math.min(range.to, Math.max(range.from, requestedStart ?? fallbackStart))
      const frame = await fetchBarsAt(symbol.symbol, baseTimeframe, start, 3000, 10000)
      this.source = new BarSource(frame)
      this.cursorIndex = this.source.findIndex(start)
      this.startIndex = this.cursorIndex
      this.resetFillEngine()
      this.recenterViewportCache()
      const targetViews = this.views.all().filter((view) => !view.isInitialized() || view.followsReplaySymbol())
      await Promise.all(targetViews.map(async (view) => {
        if (!view.isInitialized()) await view.initialize(symbol)
        else if (view.symbol()?.symbol !== symbol.symbol) view.changeSymbol(symbol, [], undefined, true)
      }))
      const cursorTs = this.source.at(this.cursorIndex)?.ts ?? start
      const raw = this.rawHistory()
      await Promise.all(targetViews.map(async (view) => {
        const displayBars = await this.loadInitialDisplayHistory(view.id, view.timeframe, symbol, raw, cursorTs)
        view.rebuild(raw, symbol, false, displayBars)
      }))
      await this.refreshAuxiliaryViewsAtCursor(cursorTs)
      this.snapshot = { ...this.snapshot, cursorTs }
      const evaluation = getEvalState()
      for (const view of this.views.all()) {
        const viewSymbol = view.symbol()
        if (viewSymbol) this.ensureSymbolFill(viewSymbol)
      }
      const activeSymbol = this.tradingSymbol()
      const activeFill = activeSymbol ? this.ensureSymbolFill(activeSymbol) : null
      this.snapshot = { ...this.snapshot, fill: activeFill, evalFill: evaluation.phase === 'running' ? this.aggregateEvaluationFill() : null }
      const last = this.source.at(this.cursorIndex)
      const activeSource = activeSymbol ? this.sourceForSymbol(activeSymbol.symbol) : null
      const activeLast = activeSource && activeSource.count > 0 && cursorTs >= activeSource.firstTs
        ? activeSource.at(activeSource.findIndex(cursorTs)) ?? null
        : null
      this.snapshot = { ...this.snapshot, cursorTs, lastBar: activeLast ?? last }
      this.syncChartTradingState(true)
      const evaluationActive = evaluation.phase === 'running'
      const replayMode: ReplayMode = evaluationActive ? 'active' : 'inactive'
      const replayStartTs = evaluationActive ? evaluation.startTs : null
      this.setSnapshot({ status: 'ready', cursorTs, sessionId: null, sessionStatus: null, timeframe: this.views.active()?.timeframe ?? this.snapshot.timeframe, replayMode, replayStartTs }, true)
      this.views.setReplaySelection(replayMode === 'active' && replayStartTs !== null ? { mode: 'active', timestamp: replayStartTs } : { mode: 'inactive' })
      await this.reconcileDrawings()
      await this.refreshIndicators()
      this.setSnapshot({ eagerState: 'ready' }, true)
    } catch (error) {
      this.setSnapshot({ status: 'error', error: error instanceof Error ? error.message : `Could not load ${symbol.symbol}` }, true)
    }
  }

  private bindView(view: ChartViewController): void {
    const ownsTradingSurface = (): boolean => this.views.active()?.id === view.id
    view.adapter.onOrderLineMove((id, price) => { if (ownsTradingSurface()) this.moveOrderLine(id, price) })
    view.adapter.onOrderLineDragStart((id) => { if (ownsTradingSurface()) this.beginOrderEdit(id) })
    view.adapter.onOrderLineAction((action) => { if (ownsTradingSurface()) this.handleOrderLineAction(action) })
    view.adapter.onChartOrder((side, type, price) => { if (ownsTradingSurface()) this.placePending(side, type, price) })
    view.adapter.onDrawingsChanged((drawingId) => this.handleViewDrawingsChanged(view.id, drawingId))
    view.adapter.onDrawingSelection((drawing) => { if (this.views.active()?.id === view.id) this.handleDrawingSelection(drawing) })
    view.adapter.onDrawingEditRequest((drawing) => { if (this.views.active()?.id === view.id) this.setSnapshot({ selectedDrawing: drawing, drawingInspectorOpen: true }, true) })
    view.adapter.onDrawingToolChanged((tool) => { if (this.views.active()?.id === view.id) this.setSnapshot({ activeDrawingTool: tool }, true) })
    view.adapter.onAreaZoomChanged((state) => { if (this.views.active()?.id === view.id) this.setSnapshot({ areaZoomSelecting: state.selecting, areaZoomed: state.zoomed }, true) })
    view.adapter.onViewportDemand((demand) => { void this.handleViewportDemand(view.id, demand) })
    view.adapter.onCrosshairSync((state) => { if (this.syncFlags.crosshair) this.views.syncCrosshair(view.id, state) })
    view.adapter.onViewportSync((state) => {
      if (!this.syncFlags.dateRange) return
      this.views.syncViewport(view.id, this.syncFlags.lockZoom ? state : { time: state.time })
    })
    view.adapter.onReplayBarSelect((timestamp) => { void this.selectReplayBar(timestamp) })
    view.setReplaySelection(this.currentReplaySelectionState())
  }

  private currentReplaySelectionState(): ReplaySelectionState {
    if (this.snapshot.replayMode === 'selecting') return { mode: 'selecting' }
    if (this.snapshot.replayMode === 'active' && this.snapshot.replayStartTs !== null) {
      return { mode: 'active', timestamp: this.snapshot.replayStartTs }
    }
    return { mode: 'inactive' }
  }

  private tradingSymbol(): SymbolMeta | null {
    return this.views.active()?.symbol() ?? this.snapshot.symbol
  }

  private sourceForSymbol(symbolCode: string): BarSource | null {
    if (this.snapshot.symbol?.symbol === symbolCode) return this.source
    return this.auxiliarySources.get(symbolCode) ?? null
  }

  private pruneInactiveSymbolCaches(): void {
    const retainedSymbols = new Set<string>()
    const replaySymbol = this.snapshot.symbol?.symbol
    if (replaySymbol) retainedSymbols.add(replaySymbol)
    for (const view of this.views.all()) {
      const symbol = view.symbol()?.symbol
      if (symbol) retainedSymbols.add(symbol)
    }
    const retainedAuxiliarySymbols = new Set(
      [...retainedSymbols].filter((symbol) => symbol !== replaySymbol),
    )
    pruneSymbolCache(this.auxiliarySources, retainedAuxiliarySymbols)
    pruneSymbolCache(this.drawingDocuments, retainedSymbols)
  }

  private barAtCursor(source: BarSource): Bar1m | null {
    if (source.count === 0 || this.snapshot.cursorTs < source.firstTs) return null
    return source.at(source.findIndex(this.snapshot.cursorTs)) ?? null
  }

  private createSymbolFill(symbol: SymbolMeta, current: Bar1m | null): FillEngineState {
    const evaluation = getEvalState()
    const evalLimit = evaluation.phase === 'running' ? (evaluation.config?.maxPositionSize ?? 0) : 0
    const maxContracts = evalLimit > 0 ? Math.min(MAX_REPLAY_CONTRACTS, evalLimit) : MAX_REPLAY_CONTRACTS
    const fill = createFillEngine({
      symbol: symbol.symbol,
      tickValueCents: Math.round(symbol.tickSize * symbol.pointValue * 100),
      commissionPerSideCents: Math.round(symbol.commissionPerSide * 100),
      slippageTicks: symbol.defaultSlippageTicks,
      maxContracts,
      startingEquityCents: REPLAY_STARTING_EQUITY_CENTS,
    })
    return current ? stepFillEngine(fill, current) : fill
  }

  private ensureSymbolFill(symbol: SymbolMeta): FillEngineState | null {
    const existing = this.symbolFills.get(symbol.symbol)
    if (existing) return existing
    const source = this.sourceForSymbol(symbol.symbol)
    if (!source) return null
    const fill = this.createSymbolFill(symbol, this.barAtCursor(source))
    this.symbolFills.set(symbol.symbol, fill)
    return fill
  }

  private aggregateEvaluationFill(): EvalFillState | null {
    if (this.symbolFills.size === 0) return null
    const fills = [...this.symbolFills.values()]
    const realizedCents = fills.reduce((total, fill) => total + fill.realizedCents, 0)
    const unrealizedCents = fills.reduce((total, fill) => total + fill.unrealizedCents, 0)
    return {
      realizedCents,
      equityCents: REPLAY_STARTING_EQUITY_CENTS + realizedCents + unrealizedCents,
      trades: fills.flatMap((fill) => fill.trades),
    }
  }

  private closedTradeCount(fills: Map<string, FillEngineState> = this.symbolFills): number {
    let count = 0
    for (const fill of fills.values()) count += fill.trades.length
    return count
  }

  private currentSnapshotOwner(): SessionSnapshotOwner | null {
    const evaluation = getEvalState()
    if (evaluation.phase === 'running' && evaluation.accountId) return { kind: 'eval', id: evaluation.accountId }
    return this.snapshot.sessionId ? { kind: 'replay', id: this.snapshot.sessionId } : null
  }

  /**
   * Picks the better of the local (localStorage) and backend recovery
   * points for owner. The local read stays the offline-safe default:
   * fetchRemoteWorkspaceSnapshot never throws and returns null on any
   * failure or timeout, so an unreachable backend just falls back to
   * whatever this browser already had.
   */
  private async resolveWorkspaceRecoveryPoint(owner: SessionSnapshotOwner): Promise<SessionWorkspaceSnapshot | null> {
    const local = loadSessionWorkspaceSnapshot(owner)
    const remote = await fetchRemoteWorkspaceSnapshot(owner)
    if (!remote) return local
    if (!local) return remote.snapshot
    return compareSnapshotRank(remote.snapshot, local) > 0 ? remote.snapshot : local
  }

  private captureWorkspaceRecoveryPoint(
    reason: SessionWorkspaceSnapshot['reason'],
    checkpoint?: { cursorTs: number; fills: Map<string, FillEngineState> },
  ): void {
    const owner = this.currentSnapshotOwner()
    const layout = captureChartWorkspaceState()
    const symbol = this.snapshot.symbol
    if (!owner || !layout || !symbol) return

    const drawings: Record<string, SerializedDrawing[]> = {}
    for (const [drawingSymbol, document] of this.drawingDocuments) drawings[drawingSymbol] = structuredClone(document.drawings)
    for (const view of this.views.all()) {
      const viewSymbol = view.symbol()
      if (viewSymbol) drawings[viewSymbol.symbol] = structuredClone(view.adapter.getDrawings())
    }
    const viewports = Object.fromEntries(this.views.all().map((view) => [view.id, { time: view.adapter.visibleRange() }]))
    const fills = Object.fromEntries(
      [...(checkpoint?.fills ?? this.symbolFills)].map(([fillSymbol, fill]) => [fillSymbol, structuredClone(fill)]),
    )
    const recoveryPoint: SessionWorkspaceSnapshot = {
      version: 1,
      owner,
      reason,
      capturedAt: Date.now(),
      cursorTs: checkpoint?.cursorTs ?? this.snapshot.cursorTs,
      symbol: symbol.symbol,
      layout,
      viewports,
      drawings,
      fills,
      indicators: structuredClone(this.snapshot.indicators),
      preferences: {
        speed: this.snapshot.speed,
        stepTimeframe: this.snapshot.stepTimeframe,
        qty: this.snapshot.qty,
        drawingMode: this.snapshot.drawingMode,
        keepDrawing: this.snapshot.keepDrawing,
        drawingsLocked: this.snapshot.drawingsLocked,
        drawingsHidden: this.snapshot.drawingsHidden,
        indicatorsHidden: this.snapshot.indicatorsHidden,
      },
    }
    if (!saveSessionWorkspaceSnapshot(recoveryPoint)) {
      this.setSnapshot({ error: 'The local recovery snapshot could not be saved. Check browser site-storage permissions.' }, true)
    }
    // Local write is already the source of truth for this browser; the
    // backend mirror is a best-effort durable copy for other browsers/a
    // reinstall, fired regardless of whether the local save above succeeded.
    syncWorkspaceSnapshot(recoveryPoint)
  }

  private prepareWorkspaceRestore(recoveryPoint: SessionWorkspaceSnapshot): void {
    this.pendingWorkspaceRestore = recoveryPoint
    restoreChartWorkspaceState(recoveryPoint.layout)
    this.setMarketSession(recoveryPoint.layout.marketSession)
    this.setSyncFlags(recoveryPoint.layout.syncFlags)
    for (const [symbol, drawings] of Object.entries(recoveryPoint.drawings)) {
      const existing = this.drawingDocuments.get(this.drawingDocumentKey(symbol)) ?? this.emptyDrawingDocument()
      existing.drawings = structuredClone(drawings)
      existing.previousIds = new Set(drawings.map((drawing) => drawing.id))
      const bucket = recoveryPoint.owner.kind === 'replay'
        ? `session:${recoveryPoint.owner.id}`
        : `eval:${recoveryPoint.owner.id}`
      existing.buckets = new Map(drawings.map((drawing) => [drawing.id, bucket]))
      this.drawingDocuments.set(this.drawingDocumentKey(symbol), existing)
    }
  }

  private restoreWorkspaceRuntime(recoveryPoint: SessionWorkspaceSnapshot): void {
    this.symbolFills = new Map(Object.entries(structuredClone(recoveryPoint.fills)))
    const activeSymbol = this.tradingSymbol() ?? this.snapshot.symbol
    const fill = activeSymbol ? this.symbolFills.get(activeSymbol.symbol) ?? null : null
    this.retainedSessionTrades = fill?.trades ?? []
    this.orderDraft = null
    this.snapshot = {
      ...this.snapshot,
      fill,
      evalFill: isEvalActive() ? this.aggregateEvaluationFill() : null,
      stats: fill ? calculateTradeStats(fill.trades) : EMPTY_STATS,
      indicators: structuredClone(recoveryPoint.indicators),
      speed: recoveryPoint.preferences.speed,
      stepTimeframe: recoveryPoint.preferences.stepTimeframe,
      qty: recoveryPoint.preferences.qty,
      drawingMode: recoveryPoint.preferences.drawingMode,
      keepDrawing: recoveryPoint.preferences.keepDrawing,
      drawingsLocked: recoveryPoint.preferences.drawingsLocked,
      drawingsHidden: recoveryPoint.preferences.drawingsHidden,
      indicatorsHidden: recoveryPoint.preferences.indicatorsHidden,
    }
    this.fillSnapshots.clear()
    this.fillSnapshots.set(this.cursorIndex, new Map(this.symbolFills))
    this.views.all().forEach((view) => {
      view.adapter.setKeepDrawing(recoveryPoint.preferences.keepDrawing)
      view.adapter.setAllDrawingsLocked(recoveryPoint.preferences.drawingsLocked)
      view.adapter.setDrawingsHidden(recoveryPoint.preferences.drawingsHidden)
      this.applyWorkspaceRestoreToView(view)
    })
    this.syncChartTradingState(true)
  }

  private applyWorkspaceRestoreToView(view: ChartViewController): void {
    const recoveryPoint = this.pendingWorkspaceRestore
    const owner = this.currentSnapshotOwner()
    if (!recoveryPoint || !owner || owner.kind !== recoveryPoint.owner.kind || owner.id !== recoveryPoint.owner.id) return
    const symbol = view.symbol()
    const drawings = symbol ? recoveryPoint.drawings[symbol.symbol] : undefined
    if (drawings) {
      this.syncingDrawings = true
      view.adapter.loadDrawings(structuredClone(drawings))
      this.syncingDrawings = false
    }
    view.resetView()
  }

  private resetAllChartViews(): void {
    this.views.all().forEach((view) => view.resetView())
  }

  private normalizeReplaySelectionTimestamp(timestamp: number): number {
    if (!this.source || timestamp < this.source.firstTs || timestamp > this.source.lastTs) return timestamp
    const index = this.source.findIndex(timestamp)
    const current = this.source.at(index)
    const next = this.source.at(index + 1)
    return current && current.ts < timestamp && next ? next.ts : current?.ts ?? timestamp
  }

  private handleDrawingSelection(drawing: DrawingAppearance | null): void {
    this.setSnapshot({
      selectedDrawing: drawing,
      drawingInspectorOpen: drawing?.id === this.snapshot.selectedDrawing?.id ? this.snapshot.drawingInspectorOpen : false,
    }, true)
  }

  private resetFillEngine(): void {
    const symbol = this.snapshot.symbol
    if (!symbol) return
    this.orderDraft = null
    const current = this.source?.at(this.cursorIndex) ?? null
    const seeded = this.createSymbolFill(symbol, current)
    this.symbolFills.clear()
    this.symbolFills.set(symbol.symbol, seeded)
    this.snapshot = { ...this.snapshot, fill: seeded, evalFill: isEvalActive() ? this.aggregateEvaluationFill() : null, stats: EMPTY_STATS, lastBar: current }
    // A reset re-anchors the session, so every earlier snapshot is stale.
    this.fillSnapshots.clear()
    this.fillSnapshots.set(this.cursorIndex, new Map(this.symbolFills))
  }

  private frame = (now: number): void => {
    if (!this.snapshot.playing) return
    const started = performance.now()
    const elapsed = Math.min(now - this.lastFrameAt, 250)
    this.lastFrameAt = now
    this.accumulator += elapsed
    const stepMs = 1000 / this.snapshot.speed
    const ticks = Math.floor(this.accumulator / stepMs)
    if (ticks > 0) {
      this.accumulator -= ticks * stepMs
      this.advance(ticks * this.stepBars())
    }
    const duration = performance.now() - started
    this.recordFrame(duration)
    this.emitSnapshot(false)
    if (this.snapshot.playing) this.animationFrame = requestAnimationFrame(this.frame)
  }

  private advance(steps: number): void {
    if (!this.source || !this.snapshot.fill || this.views.size() === 0) return
    const previousCursorTs = this.snapshot.cursorTs
    const rawBars: Bar1m[] = []
    let processed = 0
    let tradeCheckpoint: { cursorTs: number; fills: Map<string, FillEngineState> } | null = null
    for (let index = 0; index < steps; index += 1) {
      const bar = this.source.at(this.cursorIndex + 1)
      if (!bar) break
      this.cursorIndex += 1
      const tradesBeforeBar = this.closedTradeCount()
      for (const [fillSymbol, currentFill] of this.symbolFills) {
        const source = this.sourceForSymbol(fillSymbol)
        if (!source) continue
        const bars = fillSymbol === this.snapshot.symbol?.symbol
          ? [bar]
          : this.sourceBarsBetween(source, currentFill.lastTs, bar.ts)
        let nextFill = currentFill
        for (const symbolBar of bars) nextFill = stepFillEngine(nextFill, symbolBar)
        this.symbolFills.set(fillSymbol, nextFill)
      }
      if (this.closedTradeCount() > tradesBeforeBar) {
        tradeCheckpoint = { cursorTs: bar.ts, fills: new Map(this.symbolFills) }
      }
      if (!isEvalActive()) this.fillSnapshots.set(this.cursorIndex, new Map(this.symbolFills))
      rawBars.push(bar)
      this.viewportCache.append(bar)
      processed += 1
    }
    if (processed === 0) {
      this.resumeAfterSourcePrefetch = this.resumeAfterSourcePrefetch || this.snapshot.playing
      void this.prefetchSource(true)
      this.pause()
      this.setSnapshot({ status: 'buffering', error: 'Replay reached the end of the loaded data window' }, true)
      return
    }
    this.pruneFillSnapshots()
    let viewBudget = this.views.size()
    if (this.snapshot.playing && this.snapshot.speed * this.stepBars() >= HIGH_THROUGHPUT_BARS_PER_SECOND && this.views.size() > 1) {
      // Lightweight Charts paints on the animation frame after a series
      // update. Leave the following frame free for that paint, then rotate
      // to the next pane; this keeps pointer/input frames responsive while
      // every pane catches up from its lossless raw-bar queue on pause.
      viewBudget = this.highSpeedChartFrame % 2 === 0 ? 1 : 0
      this.highSpeedChartFrame += 1
    }
    const symbolCode = this.snapshot.symbol?.symbol
    if (symbolCode) this.views.pushRawBars(rawBars, symbolCode, viewBudget)
    const current = this.source.at(this.cursorIndex)
    const cursorTs = current?.ts ?? this.snapshot.cursorTs
    for (const [auxiliarySymbol, auxiliarySource] of this.auxiliarySources) {
      if (auxiliarySymbol === symbolCode) continue
      const auxiliaryBars = this.sourceBarsBetween(auxiliarySource, previousCursorTs, cursorTs)
      if (auxiliaryBars.length > 0) this.views.pushRawBars(auxiliaryBars, auxiliarySymbol, viewBudget)
    }
    const activeSymbol = this.tradingSymbol()
    const activeFill = activeSymbol ? this.symbolFills.get(activeSymbol.symbol) ?? null : null
    const activeSource = activeSymbol ? this.sourceForSymbol(activeSymbol.symbol) : null
    const activeBar = activeSource && cursorTs >= activeSource.firstTs
      ? activeSource.at(activeSource.findIndex(cursorTs)) ?? null
      : current
    this.snapshot = {
      ...this.snapshot,
      fill: activeFill,
      evalFill: isEvalActive() ? this.aggregateEvaluationFill() : null,
      lastBar: activeBar,
      cursorTs,
      stats: activeFill ? calculateTradeStats(activeFill.trades) : EMPTY_STATS,
    }
    this.syncChartTradingState()
    this.scheduleSessionPersist()
    this.scheduleIndicatorRefresh()
    this.scheduleSecondsPaneRefresh()
    if (tradeCheckpoint) this.captureWorkspaceRecoveryPoint('trade-close', tradeCheckpoint)
    void this.prefetchSource()
  }

  private abortSourcePrefetch(): void {
    this.sourcePrefetchController?.abort()
    this.sourcePrefetchController = null
    this.sourcePrefetchPromise = null
    this.resumeAfterSourcePrefetch = false
  }

  private prefetchSource(force = false): Promise<void> {
    if (this.sourcePrefetchPromise) return this.sourcePrefetchPromise
    const source = this.source
    const symbol = this.snapshot.symbol
    const baseTimeframe = symbol ? replayBaseTimeframe(symbol) : '1m'
    const range = symbol?.ranges[baseTimeframe]
    if (!source || !symbol || !range || source.count === 0 || source.lastTs >= range.to) return Promise.resolve()
    const remaining = source.count - this.cursorIndex - 1
    if (!force && remaining > SOURCE_PREFETCH_REMAINING_BARS) return Promise.resolve()

    const controller = new AbortController()
    this.sourcePrefetchController = controller
    const cursorTs = this.snapshot.cursorTs
    const promise = fetchBarsAt(
      symbol.symbol,
      baseTimeframe,
      source.lastTs,
      0,
      SOURCE_PREFETCH_PAGE_BARS,
      controller.signal,
    ).then((frame) => {
      if (controller.signal.aborted || this.source !== source || this.snapshot.symbol?.symbol !== symbol.symbol) return
      const merged = source.append(frame)
      if (merged === source) return
      this.source = merged
      this.cursorIndex = merged.findIndex(cursorTs)
      if (this.snapshot.status === 'buffering') this.setSnapshot({ status: 'ready', error: null }, true)
      if (this.resumeAfterSourcePrefetch) {
        this.resumeAfterSourcePrefetch = false
        this.play()
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
      if (this.snapshot.status === 'buffering') {
        this.setSnapshot({ error: error instanceof Error ? error.message : 'Could not load more replay data' }, true)
      }
    }).finally(() => {
      if (this.sourcePrefetchController === controller) this.sourcePrefetchController = null
      if (this.sourcePrefetchPromise === promise) this.sourcePrefetchPromise = null
    })
    this.sourcePrefetchPromise = promise
    return promise
  }

  private rebuildChart(): void {
    const source = this.source
    const symbol = this.snapshot.symbol
    if (!source || !symbol || this.views.size() === 0) return
    this.views.rebuildSymbol(this.rawHistory(), symbol, true)
    const last = source.at(this.cursorIndex)
    const cursorTs = last?.ts ?? this.snapshot.cursorTs
    this.rebuildAuxiliaryCharts(cursorTs, true)
    this.snapshot = { ...this.snapshot, cursorTs, lastBar: last }
    this.syncChartTradingState()
  }

  private rebuildSimulation(): void {
    this.resetFillEngine()
    if (!this.source || !this.snapshot.fill) return
    let fill = this.snapshot.fill
    for (let index = this.startIndex + 1; index <= this.cursorIndex; index += 1) {
      const bar = this.source.at(index)
      if (bar) fill = stepFillEngine(fill, bar)
    }
    this.snapshot = { ...this.snapshot, fill, stats: calculateTradeStats(fill.trades) }
  }

  private mutateFill(mutator: (state: FillEngineState) => FillEngineState): void {
    if (!this.canTrade()) return
    const symbol = this.tradingSymbol()
    if (!symbol) return
    const currentFill = this.symbolFills.get(symbol.symbol) ?? this.ensureSymbolFill(symbol)
    if (!currentFill) return
    try {
      const tradesBeforeMutation = this.closedTradeCount()
      const fill = mutator(currentFill)
      this.symbolFills.set(symbol.symbol, fill)
      this.snapshot = { ...this.snapshot, fill, evalFill: isEvalActive() ? this.aggregateEvaluationFill() : null, error: null }
      // Orders placed while parked on this bar belong to this bar's state,
      // so a later step-back onto it restores them too.
      if (!isEvalActive()) this.fillSnapshots.set(this.cursorIndex, new Map(this.symbolFills))
      this.syncChartTradingState()
      this.emitSnapshot(true)
      if (this.closedTradeCount() > tradesBeforeMutation) this.captureWorkspaceRecoveryPoint('trade-close')
    } catch (error) {
      this.setSnapshot({ error: error instanceof Error ? error.message : 'Trading action failed' }, true)
    }
  }

  private amendOrderPrice(id: string, price: number): void {
    const symbol = this.tradingSymbol()
    if (!symbol) return
    this.mutateFill((state) => amendOrder(state, id, Math.round(price / symbol.tickSize)))
  }

  private priceFormatterFor(decimals: number): Intl.NumberFormat {
    if (this.priceFormatterCache?.decimals !== decimals) {
      this.priceFormatterCache = {
        decimals,
        formatter: new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
      }
    }
    return this.priceFormatterCache.formatter
  }

  private syncChartTradingState(force = false): void {
    const fill = this.snapshot.fill
    const symbol = this.tradingSymbol()
    if (this.views.size() === 0 || !fill || !symbol) return
    const fillTradeIds = new Set(fill.trades.map((trade) => trade.id))
    const retainedTrades = isEvalActive()
      ? []
      : this.retainedSessionTrades.filter((trade) => (
        trade.symbol === symbol.symbol
        && trade.exitTs <= this.snapshot.cursorTs
        && !fillTradeIds.has(trade.id)
      ))
    const retainedTradeKey = retainedTrades.map((trade) => `${trade.id}:${trade.exitTs}`).join('|')
    const positionQty = fill.position?.qty ?? null
    const positionPrice = fill.position?.avgPriceTicks ?? null

    // Markers/connections are O(closed trades) work — walking the journal,
    // folding in eval visuals, sorting — and are independent of unrealized
    // P&L, so they only need to be rebuilt when the trade set itself changed
    // (a new close, a rewind restoring an older journal, or the symbol
    // switching under this pane). unrealizedCents instead changes on nearly
    // every replay bar while a position is open; folding it into one combined
    // guard meant re-walking and re-sorting the whole trade history on every
    // such bar for a P&L number that only the position line displays.
    const tradesChanged = force
      || this.projectedTrades !== fill.trades
      || this.projectedRetainedTradeKey !== retainedTradeKey
      || this.projectedTradeSymbol !== symbol.symbol
    const linesChanged = tradesChanged
      || this.projectedOrders !== fill.orders
      || this.projectedPositionQty !== positionQty
      || this.projectedPositionPrice !== positionPrice
      || this.projectedUnrealizedCents !== fill.unrealizedCents
      || this.projectedOrderDraft !== this.orderDraft
    if (!linesChanged) return

    if (tradesChanged) {
      this.projectedTrades = fill.trades
      this.projectedRetainedTradeKey = retainedTradeKey
      this.projectedTradeSymbol = symbol.symbol
      const markers: TradeMarker[] = []
      const connections: TradeConnection[] = []
      const priceFormatter = this.priceFormatterFor(symbol.priceDecimals)
      for (const trade of [...fill.trades, ...retainedTrades]) {
        const entryPrice = trade.entryPriceTicks * symbol.tickSize
        const exitPrice = trade.exitPriceTicks * symbol.tickSize
        const tradeColor = trade.side === 'long' ? '#089981' : '#f23645'
        markers.push({ time: trade.entryTs, price: entryPrice, text: `${trade.side === 'long' ? '+' : '-'}${trade.qty} @ ${priceFormatter.format(entryPrice)}`, color: tradeColor, shape: trade.side === 'long' ? 'arrowUp' : 'arrowDown' })
        markers.push({ time: trade.exitTs, price: exitPrice, text: `${trade.side === 'long' ? '-' : '+'}${trade.qty} @ ${priceFormatter.format(exitPrice)}`, color: tradeColor, shape: 'circle' })
        connections.push({
          entryTime: trade.entryTs,
          entryPrice,
          exitTime: trade.exitTs,
          exitPrice,
          priceDecimals: symbol.priceDecimals,
          side: trade.side,
          initialStop: trade.initialStopTicks === null ? null : trade.initialStopTicks * symbol.tickSize,
          initialTakeProfit: trade.initialTakeProfitTicks === null ? null : trade.initialTakeProfitTicks * symbol.tickSize,
          protectionAdjustments: trade.protectionAdjustments.map((adjustment) => ({
            role: adjustment.role,
            time: adjustment.ts,
            price: adjustment.priceTicks * symbol.tickSize,
          })),
          exitReason: trade.exitReason,
        })
      }
      const savedEvalVisuals = this.evalTradeVisuals(symbol, priceFormatter, fill.trades)
      markers.push(...savedEvalVisuals.markers)
      connections.push(...savedEvalVisuals.connections)
      markers.sort((left, right) => left.time - right.time)
      this.projectedMarkers = markers
      this.projectedConnections = connections
    }

    this.projectedOrders = fill.orders
    this.projectedPositionQty = positionQty
    this.projectedPositionPrice = positionPrice
    this.projectedUnrealizedCents = fill.unrealizedCents
    this.projectedOrderDraft = this.orderDraft
    const lines: OrderLine[] = []
    for (const order of fill.orders) {
      if (order.priceTicks === null || order.type === 'market') continue
      if (this.orderDraft?.sourceOrderIds.includes(order.id)) continue
      const price = order.priceTicks * symbol.tickSize
      lines.push({
        id: order.id,
        price,
        label: order.role === 'stopLoss' ? 'Stop Loss' : order.role === 'takeProfit' ? 'Take Profit' : `${order.side === 'buy' ? 'Buy' : 'Sell'} ${order.type === 'limit' ? 'Limit' : 'Stop'}`,
        color: order.role === 'stopLoss' ? '#ff9800' : order.role === 'takeProfit' ? '#089981' : '#2962ff',
        kind: order.role === 'stopLoss' ? 'stopLoss' : order.role === 'takeProfit' ? 'takeProfit' : order.type,
        editable: true,
        role: order.role,
        stage: 'working',
        qty: order.qty,
        priceLabel: price.toFixed(symbol.priceDecimals),
        maxQuantity: MAX_REPLAY_CONTRACTS,
      })
    }
    if (this.orderDraft) {
      const draft = this.orderDraft
      const toLine = (role: OrderTicketRole, priceTicks: number, color: string, label: string, kind: OrderLine['kind']): OrderLine => ({
        id: `ticket-${role === 'stopLoss' ? 'stop-loss' : role === 'takeProfit' ? 'take-profit' : 'entry'}`,
        price: priceTicks * symbol.tickSize,
        label,
        color,
        kind,
        editable: role !== 'entry' || draft.type !== 'market',
        side: draft.side,
        role,
        stage: 'draft',
        qty: draft.qty,
        priceLabel: (priceTicks * symbol.tickSize).toFixed(symbol.priceDecimals),
        showControls: role === 'entry',
        protectionEnabled: { stopLoss: draft.stopLossTicks !== null, takeProfit: draft.takeProfitTicks !== null },
        maxQuantity: MAX_REPLAY_CONTRACTS,
      })
      const entryColor = draft.side === 'buy' ? '#2962ff' : '#f23645'
      const orderTypeLabel = draft.type === 'market' ? 'Market' : draft.type === 'limit' ? 'Limit' : 'Stop'
      lines.push(toLine('entry', draft.entryPriceTicks, entryColor, `${draft.side === 'buy' ? 'Buy' : 'Sell'} ${orderTypeLabel}`, draft.type))
      if (draft.takeProfitTicks !== null) lines.push(toLine('takeProfit', draft.takeProfitTicks, '#089981', 'Take Profit', 'takeProfit'))
      if (draft.stopLossTicks !== null) lines.push(toLine('stopLoss', draft.stopLossTicks, '#ff9800', 'Stop Loss', 'stopLoss'))
    }
    if (fill.position) {
      const pnl = fill.unrealizedCents
      lines.unshift({
        id: 'position', price: fill.position.avgPriceTicks * symbol.tickSize,
        label: `${pnl >= 0 ? '+' : '−'}${(Math.abs(pnl) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${symbol.currency}`,
        color: pnl >= 0 ? '#2962ff' : '#f23645', kind: 'position', editable: false,
        role: 'position', stage: 'position', qty: Math.abs(fill.position.qty),
        priceLabel: (fill.position.avgPriceTicks * symbol.tickSize).toFixed(symbol.priceDecimals),
      })
    }
    this.views.syncTrading(symbol.symbol, lines, this.projectedMarkers, this.projectedConnections)
  }

  // The fill engine restarts clean on every seek, so eval trades recorded
  // before the cursor only exist in the eval store — project them too.
  private evalTradeVisuals(symbol: SymbolMeta, priceFormatter: Intl.NumberFormat, fillTrades: EngineTrade[]): { markers: TradeMarker[]; connections: TradeConnection[] } {
    const evaluation = getEvalState()
    if (evaluation.trades.length === 0) return { markers: [], connections: [] }
    const fillTradeIds = new Set(fillTrades.map((trade) => trade.id))
    const markers: TradeMarker[] = []
    const connections: TradeConnection[] = []
    for (const trade of evaluation.trades) {
      if (trade.symbol !== symbol.symbol) continue
      if (trade.entryPriceTicks === undefined || trade.exitPriceTicks === undefined) continue
      if (trade.id && fillTradeIds.has(trade.id)) continue
      const entryTime = trade.entryTime ?? trade.exitTime
      const entryPrice = trade.entryPriceTicks * symbol.tickSize
      const exitPrice = trade.exitPriceTicks * symbol.tickSize
      const tradeColor = trade.side === 'short' ? '#f23645' : '#089981'
      const qty = trade.qty ?? 1
      markers.push({ time: entryTime, price: entryPrice, text: `${trade.side === 'short' ? '-' : '+'}${qty} @ ${priceFormatter.format(entryPrice)}`, color: tradeColor, shape: trade.side === 'short' ? 'arrowDown' : 'arrowUp' })
      markers.push({ time: trade.exitTime, price: exitPrice, text: `${trade.side === 'short' ? '+' : '-'}${qty} @ ${priceFormatter.format(exitPrice)}`, color: tradeColor, shape: 'circle' })
      connections.push({
        entryTime,
        entryPrice,
        exitTime: trade.exitTime,
        exitPrice,
        priceDecimals: symbol.priceDecimals,
        side: trade.side,
        initialStop: trade.initialStopTicks == null ? null : trade.initialStopTicks * symbol.tickSize,
        initialTakeProfit: trade.initialTakeProfitTicks == null ? null : trade.initialTakeProfitTicks * symbol.tickSize,
        protectionAdjustments: trade.protectionAdjustments?.map((adjustment) => ({
          role: adjustment.role,
          time: adjustment.ts,
          price: adjustment.priceTicks * symbol.tickSize,
        })) ?? [],
        exitReason: trade.exitReason ?? 'manual',
      })
    }
    return { markers, connections }
  }

  private rawHistory(_timeframe?: Timeframe): Bar1m[] {
    const cursorTs = this.source?.at(this.cursorIndex)?.ts ?? this.snapshot.cursorTs
    return this.viewportCache.values(cursorTs || Number.MAX_SAFE_INTEGER)
  }

  private rawHistoryFromSource(source: BarSource, cursorTs: number): Bar1m[] {
    if (source.count === 0 || cursorTs < source.firstTs) return []
    const end = source.findIndex(cursorTs)
    const from = Math.max(0, end - MAX_VIEWPORT_RAW_BARS + 1)
    const bars: Bar1m[] = []
    for (let index = from; index <= end; index += 1) {
      const bar = source.at(index)
      if (bar && bar.ts <= cursorTs) bars.push(bar)
    }
    return bars
  }

  private sourceBarsBetween(source: BarSource, fromExclusive: number, toInclusive: number): Bar1m[] {
    if (source.count === 0 || toInclusive <= fromExclusive || toInclusive < source.firstTs || fromExclusive >= source.lastTs) return []
    const bars: Bar1m[] = []
    let index = source.findIndexAtOrAfter(fromExclusive + 1)
    while (index < source.count) {
      const bar = source.at(index)
      if (!bar || bar.ts > toInclusive) break
      if (bar.ts > fromExclusive) bars.push(bar)
      index += 1
    }
    return bars
  }

  private auxiliaryViews(): ChartViewController[] {
    const replaySymbol = this.snapshot.symbol?.symbol
    return this.views.all().filter((view) => {
      const symbol = view.symbol()?.symbol
      return Boolean(symbol && symbol !== replaySymbol)
    })
  }

  private rebuildAuxiliaryCharts(cursorTs: number, preserveViewport: boolean): void {
    for (const view of this.auxiliaryViews()) {
      const symbol = view.symbol()
      const source = symbol ? this.auxiliarySources.get(symbol.symbol) : undefined
      if (!symbol || !source) continue
      view.rebuild(this.rawHistoryFromSource(source, cursorTs), symbol, preserveViewport)
      view.syncEconomicEventMarkers(this.economicEventMarkers)
    }
  }

  private async refreshAuxiliaryViewsAtCursor(cursorTs: number): Promise<void> {
    const views = this.auxiliaryViews()
    if (views.length === 0) return
    const symbols = new Map<string, SymbolMeta>()
    for (const view of views) {
      const symbol = view.symbol()
      if (symbol) symbols.set(symbol.symbol, symbol)
    }
    await Promise.all([...symbols.values()].map(async (symbol) => {
      const source = this.auxiliarySources.get(symbol.symbol)
      if (source && cursorTs >= source.firstTs && cursorTs <= source.lastTs) return
      const frame = await fetchBarsAt(symbol.symbol, replayBaseTimeframe(symbol), cursorTs, 3000, 10000)
      this.auxiliarySources.set(symbol.symbol, new BarSource(frame))
    }))
    await Promise.all(views.map(async (view) => {
      const symbol = view.symbol()
      const source = symbol ? this.auxiliarySources.get(symbol.symbol) : undefined
      if (!symbol || !source) return
      const raw = this.rawHistoryFromSource(source, cursorTs)
      const displayBars = await this.loadInitialDisplayHistory(view.id, view.timeframe, symbol, raw, cursorTs)
      view.rebuild(raw, symbol, true, displayBars)
      view.syncEconomicEventMarkers(this.economicEventMarkers)
    }))
  }

  private async loadInitialDisplayHistory(
    viewId: string,
    timeframe: Timeframe,
    symbol: SymbolMeta,
    raw: Bar1m[],
    cursorTs = this.snapshot.cursorTs,
  ): Promise<DisplayBar[] | undefined> {
    const estimatedBars = raw.length / Math.max(1, timeframeSeconds(timeframe) / timeframeSeconds(replayBaseTimeframe(symbol)))
    if (estimatedBars >= VIEWPORT_PAGE_BARS) return undefined
    const controller = new AbortController()
    this.timeframeControllers.get(viewId)?.abort()
    this.timeframeControllers.set(viewId, controller)
    try {
      const page = await this.viewportClient.load({
        symbol: symbol.symbol,
        visibleTimeframe: timeframe,
        direction: 'before',
        anchorTs: cursorTs,
        pageBars: VIEWPORT_PAGE_BARS,
        maxTs: cursorTs,
        tickSize: symbol.tickSize,
        marketSession: this.marketSession,
      }, controller.signal)
      if (controller.signal.aborted || this.timeframeControllers.get(viewId) !== controller) return undefined
      return page.bars.filter((bar) => bar.time <= cursorTs)
    } catch {
      return undefined
    } finally {
      if (this.timeframeControllers.get(viewId) === controller) this.timeframeControllers.delete(viewId)
    }
  }

  private recenterViewportCache(): void {
    if (!this.source) return
    const from = Math.max(0, this.cursorIndex - MAX_VIEWPORT_RAW_BARS + 1)
    const bars: Bar1m[] = []
    for (let index = from; index <= this.cursorIndex; index += 1) {
      const bar = this.source.at(index)
      if (bar) bars.push(bar)
    }
    // Built by walking BarSource forward, so already ascending by ts.
    this.viewportCache.replaceSorted(bars)
    this.snapshot = { ...this.snapshot, viewportCachedBars: this.viewportCache.count }
  }

  private ensureCursorViewport(): void {
    if (this.viewportCache.contains(this.snapshot.cursorTs)) return
    this.recenterViewportCache()
    this.rebuildChart()
  }

  private abortViewportLoads(): void {
    this.viewportControllers.forEach((controller) => controller.abort())
    this.viewportControllers.clear()
  }

  private async handleViewportDemand(viewId: string, demand: ViewportDemand): Promise<void> {
    const view = this.views.get(viewId)
    const symbol = view?.symbol() ?? null
    if (!view || this.views.active()?.id !== viewId || !symbol || this.snapshot.status !== 'ready') return
    // Bound paging by whichever raw dataset this pane's own timeframe
    // aggregates from — a seconds-unit pane's earliest available bucket is
    // ranges['5s'], not ranges['1m'] (see bars.BaseTimeframe server-side).
    const range = symbol.ranges[parseTimeframe(view.timeframe)?.unit === 's' ? '5s' : '1m']
    if (!range) return
    if (demand.direction === 'before' && demand.anchorTs <= range.from) return
    if (demand.direction === 'after') {
      const cursorBar = this.source?.at(this.cursorIndex)
      const cursorBucket = cursorBar
        ? aggregateRange([cursorBar], view.timeframe, symbol, symbol.tickSize)[0]?.time ?? this.snapshot.cursorTs
        : this.snapshot.cursorTs
      if (demand.anchorTs >= cursorBucket) return // current forming bucket / replay spoiler guard
    }

    const now = performance.now()
    if (now - (this.viewportLastRequestAt.get(demand.direction) ?? -Number.MAX_SAFE_INTEGER) < 750) return
    this.viewportLastRequestAt.set(demand.direction, now)

    this.abortViewportLoads()
    const controller = new AbortController()
    this.viewportControllers.set(demand.direction, controller)
    const pageBars = VIEWPORT_PAGE_BARS
    this.setSnapshot({ eagerState: 'loading' }, true)
    try {
      const page = await this.viewportClient.load({
        symbol: symbol.symbol,
        visibleTimeframe: view.timeframe,
        direction: demand.direction,
        anchorTs: demand.anchorTs,
        pageBars,
        maxTs: this.snapshot.cursorTs,
        tickSize: symbol.tickSize,
        marketSession: this.marketSession,
      }, controller.signal)
      if (controller.signal.aborted || view.symbol()?.symbol !== symbol.symbol) return
      const spoilerSafeBars = page.bars.filter((bar) => bar.time <= this.snapshot.cursorTs)
      this.views.mergeViewportPage(viewId, spoilerSafeBars, demand.direction)
      this.reloadDrawingDocumentForView(symbol.symbol, viewId)
      this.setSnapshot({ eagerState: 'ready', viewportCachedBars: this.viewportCache.count }, true)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      this.setSnapshot({ eagerState: 'error', error: error instanceof Error ? error.message : 'Could not load chart history' }, true)
    } finally {
      if (this.viewportControllers.get(demand.direction) === controller) this.viewportControllers.delete(demand.direction)
    }
  }

  private scheduleSessionPersist(): void {
    if (!this.snapshot.sessionId || this.snapshot.sessionStatus !== 'active') return
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.setSnapshot({ persistencePending: true }, false)
    this.persistTimer = setTimeout(() => {
      const { sessionId, cursorTs, fill, sessionStatus } = this.snapshot
      if (!sessionId || !fill || sessionStatus !== 'active') return
      void Promise.all([
        patchSession(sessionId, { cursorTs, equityCents: fill.equityCents, status: 'active', config: serializeReplayRuntime(fill, this.snapshot.indicators) }),
        this.persistJournal(sessionId, fill),
      ])
        .then(() => this.setSnapshot({ persistencePending: false }, true))
        .catch(() => this.setSnapshot({ persistencePending: true }, true))
    }, 1000)
  }

  /**
   * Sends the journal only when it actually changed. `fill.trades` is
   * replaced wholesale by the immutable engine whenever a trade closes (or a
   * step-back restores an earlier list), so reference identity is an exact
   * change test — no per-trade bookkeeping needed.
   */
  private persistJournal(sessionId: string, fill: FillEngineState): Promise<unknown> {
    if (this.persistedTrades === fill.trades) return Promise.resolve()
    const journal = fill.trades
    return putTrades(sessionId, journal.map((trade) => ({ ...trade, sessionId, createdAt: trade.exitTs })))
      .then(() => {
        this.persistedTrades = journal
        this.retainedSessionTrades = journal
      })
  }

  /**
   * Bounds the snapshot ring to the same window the raw bar cache keeps.
   *
   * Peels only the leading run of now-too-old entries instead of scanning
   * every key: fillSnapshots' insertion order is always ascending (see the
   * field's own doc comment for why), so the oldest survivor is always
   * first, and the loop can stop the instant it sees one that's still in
   * bounds. The previous version scanned the entire map on every call — up
   * to ~6,000 keys, every single replay frame — to find and delete the one
   * entry that had just aged out.
   */
  private pruneFillSnapshots(): void {
    if (this.fillSnapshots.size <= MAX_FILL_SNAPSHOTS) return
    const floor = this.cursorIndex - MAX_FILL_SNAPSHOTS
    for (const index of this.fillSnapshots.keys()) {
      if (index >= floor) break
      this.fillSnapshots.delete(index)
    }
  }

  private handlePageHide = (): void => {
    void this.checkpointSession('paused')
  }

  private async checkpointSession(status: 'paused' | 'stopped'): Promise<boolean> {
    const { sessionId, cursorTs, fill } = this.snapshot
    if (!sessionId || !fill) return true
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    try {
      // The journal endpoint only accepts an active session. Persist it
      // before changing the session status so the final trade cannot race
      // the pause/stop request.
      await this.persistJournal(sessionId, fill)
      await patchSession(sessionId, {
        cursorTs,
        equityCents: fill.equityCents,
        status,
        config: serializeReplayRuntime(fill, this.snapshot.indicators),
      })
      return true
    } catch {
      this.setSnapshot({ error: 'Session could not be saved. It remains open so you can retry.', persistencePending: true }, true)
      return false
    }
  }

  private async deactivateReplaySession(
    status: 'paused' | 'stopped',
    options: { returnToLatest?: boolean; drawingsFlushed?: boolean; snapshotOnExit?: boolean } = {},
  ): Promise<void> {
    cancelAnimationFrame(this.animationFrame)
    this.views.flushRawBars()
    this.highSpeedChartFrame = 0
    const detachedSessionId = this.snapshot.sessionId
    const hadSession = detachedSessionId !== null
    this.setSnapshot({ playing: false }, true)
    if (!options.drawingsFlushed && !await this.flushDrawingPersistence()) {
      this.setSnapshot({ error: 'Session drawings could not be saved. The session remains open so you can retry.' }, true)
      return
    }
    if (options.snapshotOnExit) this.captureWorkspaceRecoveryPoint('explicit-exit')
    this.cancelActiveOrders()
    if (!await this.checkpointSession(status)) return
    this.createSessionOnSelection = false
    this.orderDraft = null
    this.setSnapshot({ playing: false, sessionStatus: hadSession ? status : null, replayMode: 'inactive', replayStartTs: null }, true)
    this.syncChartTradingState(true)
    this.views.setReplaySelection({ mode: 'inactive' })
    if (this.snapshot.sessionId === detachedSessionId && this.snapshot.sessionStatus === status) {
      this.setSnapshot({ sessionId: null, sessionStatus: null, persistencePending: false }, true)
    }
    if (options.returnToLatest) await this.resetChartToLatest()
  }

  private async resetChartToLatest(): Promise<void> {
    const symbol = this.snapshot.symbol
    const latest = symbol?.ranges[symbol ? replayBaseTimeframe(symbol) : '1m']?.to
    if (!symbol || latest === undefined) return
    this.views.active()?.adapter.setDrawingTool(null)
    this.views.active()?.adapter.deselectDrawing()
    this.setSnapshot({ activeDrawingTool: null, selectedDrawing: null, drawingInspectorOpen: false }, true)
    await this.loadSymbol(symbol, latest)
  }

  private cancelActiveOrders(): void {
    let changed = this.orderDraft !== null
    this.orderDraft = null
    for (const [symbol, fill] of this.symbolFills) {
      const next = cancelAllOrders(fill)
      if (next !== fill) changed = true
      this.symbolFills.set(symbol, next)
    }
    const activeSymbol = this.tradingSymbol()
    const activeFill = activeSymbol ? this.symbolFills.get(activeSymbol.symbol) ?? null : null
    this.snapshot = { ...this.snapshot, fill: activeFill, evalFill: isEvalActive() ? this.aggregateEvaluationFill() : null }
    if (!isEvalActive() && changed) this.fillSnapshots.set(this.cursorIndex, new Map(this.symbolFills))
    if (changed) {
      this.syncChartTradingState(true)
      this.emitSnapshot(true)
    }
  }

  private async reconcileDrawings(viewId?: string): Promise<void> {
    const requestedView = viewId ? this.views.get(viewId) : null
    const symbol = requestedView?.symbol() ?? this.snapshot.symbol
    if (!symbol) return
    const targets = requestedView
      ? [requestedView]
      : this.views.all().filter((view) => view.symbol()?.symbol === symbol.symbol)
    try {
      // No createdTf filter: the canonical drawing document belongs to the
      // symbol/session, then each pane projects epoch/price anchors to its TF.
      const requests = [fetchDrawings(`global:${symbol.symbol}`, symbol.symbol, [])]
      if (this.snapshot.sessionId) requests.push(fetchDrawings(`session:${this.snapshot.sessionId}`, symbol.symbol, [], this.snapshot.cursorTs))
      const groups = await Promise.all(requests)
      const byId = new Map<string, PersistedDrawing>()
      for (const drawing of groups.flat()) {
        if (drawing.deleted) continue
        if (this.snapshot.drawingMode === 'replay' && drawing.createdAtCursor > this.snapshot.cursorTs) continue
        byId.set(drawing.id, drawing)
      }
      const drawings = [...byId.values()].map((drawing) => JSON.parse(drawing.payload) as SerializedDrawing)
      const document: DrawingDocument = {
        buckets: new Map([...byId.values()].map((drawing) => [drawing.id, drawing.bucket])),
        previousIds: new Set(drawings.map((drawing) => drawing.id)),
        createdTimeframes: new Map([...byId.values()].map((drawing) => [drawing.id, drawing.createdTf])),
        drawings,
      }
      this.drawingDocuments.set(this.drawingDocumentKey(symbol.symbol), document)
      this.syncingDrawings = true
      for (const view of targets) view.adapter.loadDrawings(drawings)
      this.syncingDrawings = false
    } catch {
      this.syncingDrawings = false
      // Drawing persistence is non-blocking; local drawing remains available.
    }
  }

  private reloadDrawingDocumentForView(symbol: string, viewId: string): boolean {
    const document = this.drawingDocuments.get(this.drawingDocumentKey(symbol))
    const view = this.views.get(viewId)
    if (!document || !view) return false
    this.syncingDrawings = true
    view.adapter.loadDrawings(document.drawings)
    this.syncingDrawings = false
    return true
  }

  private cancelPendingTimeframeSwitch(viewId: string): void {
    const pending = this.pendingTimeframeSwitches.get(viewId)
    if (pending) {
      clearTimeout(pending)
      this.pendingTimeframeSwitches.delete(viewId)
    }
    this.timeframeControllers.get(viewId)?.abort()
    this.timeframeControllers.delete(viewId)
  }

  private handleViewDrawingsChanged(viewId: string, drawingId?: string): void {
    if (this.syncingDrawings) return
    const source = this.views.get(viewId)
    if (!source) return
    const projected = source.adapter.getDrawings()
    const symbol = source.symbol()
    let serialized = projected
    if (symbol) {
      const key = this.drawingDocumentKey(symbol.symbol)
      const existing = this.drawingDocuments.get(key) ?? this.emptyDrawingDocument()
      if (drawingId) {
        const canonical = new Map(existing.drawings.map((drawing) => [drawing.id, drawing]))
        const changed = projected.find((drawing) => drawing.id === drawingId)
        if (changed) canonical.set(drawingId, changed)
        else canonical.delete(drawingId)
        existing.drawings = [...canonical.values()]
      } else {
        existing.drawings = projected
      }
      serialized = existing.drawings
      this.drawingDocuments.set(key, existing)
    }
    this.syncingDrawings = true
    for (const view of this.views.all()) {
      if (view.id !== viewId && view.symbol()?.symbol === symbol?.symbol) view.adapter.loadDrawings(serialized)
    }
    this.syncingDrawings = false
    this.scheduleDrawingPersist(viewId)
  }

  private scheduleDrawingPersist(viewId: string): void {
    if (this.snapshot.replayMode === 'active' && !isEvalActive() && !this.snapshot.sessionId) return
    if (this.drawingTimer) clearTimeout(this.drawingTimer)
    this.pendingDrawingViewId = viewId
    this.drawingTimer = setTimeout(() => {
      const pending = this.pendingDrawingViewId
      this.drawingTimer = null
      this.pendingDrawingViewId = null
      if (pending) void this.persistDrawings(pending)
    }, 500)
  }

  private async flushDrawingPersistence(): Promise<boolean> {
    if (this.drawingTimer) {
      clearTimeout(this.drawingTimer)
      this.drawingTimer = null
    }
    const pending = this.pendingDrawingViewId
    this.pendingDrawingViewId = null
    return pending ? this.persistDrawings(pending) : true
  }

  private async persistDrawings(viewId: string): Promise<boolean> {
    if (this.snapshot.replayMode === 'active' && !isEvalActive() && !this.snapshot.sessionId) return true
    const view = this.views.get(viewId)
    const symbol = view?.symbol() ?? null
    if (!view || !symbol) return true
    const key = this.drawingDocumentKey(symbol.symbol)
    const document = this.drawingDocuments.get(key) ?? this.emptyDrawingDocument()
    const current = document.drawings
    const now = Math.floor(Date.now() / 1000)
    const currentIds = new Set(current.map((drawing) => drawing.id))
    const deltas: PersistedDrawing[] = current.map((drawing) => {
      const anchor = drawing.anchors[0]
      const bucket = document.buckets.get(drawing.id)
        ?? (this.snapshot.drawingMode === 'analysis' ? `global:${symbol.symbol}` : `session:${this.snapshot.sessionId ?? 'offline'}`)
      document.buckets.set(drawing.id, bucket)
      return {
        id: drawing.id, bucket, symbol: symbol.symbol, anchorTs: Number(anchor?.time ?? this.snapshot.cursorTs),
        createdAtCursor: this.snapshot.cursorTs, createdTf: document.createdTimeframes.get(drawing.id) ?? view.timeframe,
        payload: JSON.stringify(drawing), deleted: false, updatedAt: now,
      }
    })
    for (const id of document.previousIds) {
      if (currentIds.has(id)) continue
      deltas.push({
        id, bucket: document.buckets.get(id) ?? `global:${symbol.symbol}`, symbol: symbol.symbol,
        anchorTs: 0, createdAtCursor: this.snapshot.cursorTs, createdTf: document.createdTimeframes.get(id) ?? view.timeframe,
        payload: '{}', deleted: true, updatedAt: now,
      })
    }
    document.previousIds = currentIds
    document.drawings = current
    for (const drawing of current) {
      if (!document.createdTimeframes.has(drawing.id)) document.createdTimeframes.set(drawing.id, view.timeframe)
    }
    this.drawingDocuments.set(key, document)
    if (deltas.length === 0) return true
    try {
      await upsertDrawings(deltas)
      return true
    } catch {
      return false
    }
  }

  private emptyDrawingDocument(): DrawingDocument {
    return { buckets: new Map(), previousIds: new Set(), createdTimeframes: new Map(), drawings: [] }
  }

  private drawingDocumentKey(symbol: string): string { return symbol }

  /**
   * Records one frame's duration into a fixed ring buffer. Deliberately
   * does no percentile work: the previous version copied and sorted the
   * whole 120-sample window on every animation frame, which measured 17 µs
   * per frame — by far the largest fixed cost in the replay loop, and
   * entirely wasted, since the metrics are only ever read by a listener
   * that fires at most 10x/s.
   */
  private recordFrame(duration: number): void {
    this.frameSamples[this.frameSampleCursor] = duration
    this.frameSampleCursor = (this.frameSampleCursor + 1) % FRAME_SAMPLE_WINDOW
    if (this.frameSampleCount < FRAME_SAMPLE_WINDOW) this.frameSampleCount += 1
    this.frameMetricsStale = true
  }

  /** Computes the percentiles recordFrame deferred, at emit rate. */
  private flushFrameMetrics(): void {
    if (!this.frameMetricsStale) return
    this.frameMetricsStale = false
    const samples = this.frameSampleCount
    if (samples === 0) return
    // Ring order is irrelevant to a percentile, and the valid entries are
    // always [0, samples) — the cursor only wraps once the window is full.
    const sorted = this.frameSortScratch.subarray(0, samples)
    sorted.set(this.frameSamples.subarray(0, samples))
    sorted.sort()
    const metric = (ratio: number): number => sorted[Math.min(samples - 1, Math.floor(samples * ratio))] ?? 0
    this.snapshot = {
      ...this.snapshot,
      frameMetrics: { p50: metric(0.5), p95: metric(0.95), max: sorted[samples - 1] ?? 0, samples },
    }
  }

  private setSnapshot(patch: Partial<ReplaySnapshot>, immediate: boolean): void {
    this.snapshot = { ...this.snapshot, ...patch }
    if ('error' in patch || patch.status === 'error') {
      if (this.transientErrorTimer) clearTimeout(this.transientErrorTimer)
      this.transientErrorTimer = null
      const message = patch.error
      if (message && this.snapshot.status !== 'error') {
        this.transientErrorTimer = setTimeout(() => {
          this.transientErrorTimer = null
          if (this.snapshot.error !== message || this.snapshot.status === 'error') return
          this.setSnapshot({ error: null }, true)
        }, TRANSIENT_ERROR_TIMEOUT_MS)
      }
    }
    this.emitSnapshot(immediate)
  }
  private emitSnapshot(immediate: boolean): void {
    const now = performance.now()
    if (!immediate && now - this.lastEmitAt < 100) return
    this.lastEmitAt = now
    this.flushFrameMetrics()
    for (const listener of this.listeners) listener()
  }
}

export const replayEngine = new ReplayEngine()
