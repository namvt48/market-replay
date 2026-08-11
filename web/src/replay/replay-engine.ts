import type { DrawingToolDefinition, SerializedDrawing } from 'lightweight-charts-drawing'
import {
  createSession,
  fetchBarsAt,
  fetchCalendar,
  fetchDrawings,
  fetchSessions,
  fetchSymbols,
  fetchTrades,
  patchSession,
  putTrades,
  upsertDrawings,
} from '../api/client'
import type { ClosedTrade, PersistedDrawing, ReplaySession, SymbolMeta, Timeframe } from '../api/types'
import { DEFAULT_CHART_SYNC_FLAGS, type ChartSyncFlags } from '../chart-workspace/types'
import {
  amendOrder,
  cancelAllOrders,
  cancelOrder,
  createFillEngine,
  flattenPosition,
  placeBracket,
  placeEntryBracket,
  placeOrder,
  reversePosition,
  stepFillEngine,
} from '../fill-engine/engine'
import { calculateTradeStats, type TradeStats } from '../fill-engine/stats'
import type { Bar1m, EngineTrade, FillEngineState, OrderSide, OrderType } from '../fill-engine/types'
import { getEvalState, isEvalActive, type EvalFillState } from '../store/eval-store'
import { aggregateRange } from './aggregate'
import { BarSource } from './bar-source'
import { timeframeSeconds } from './timeframe'
import { restoreReplayRuntime, serializeReplayRuntime } from './session-state'
import type { ChartAdapter, DisplayBar, EconomicEventMarker, OrderLine, OrderLineAction, ReplaySelectionState, TradeConnection, TradeMarker, ViewportDemand, ViewportDirection } from './chart-adapter'
import type { ChartPaneSettings } from './chart-settings-store'
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
export const STEP_TIMEFRAMES = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '4h'] as const
export type ReplayStepTimeframe = (typeof STEP_TIMEFRAMES)[number]
const HIGH_THROUGHPUT_BARS_PER_SECOND = 100
const TIMEFRAME_SWITCH_SETTLE_MS = 48
const MAX_REPLAY_CONTRACTS = 1_000
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
  activeDrawingTool: string | null
  selectedDrawing: DrawingAppearance | null
  drawingInspectorOpen: boolean
  persistencePending: boolean
}

const initialSnapshot: ReplaySnapshot = {
  status: 'idle', error: null, symbols: [], symbol: null, activeSymbol: null, timeframe: '1m', cursorTs: 0,
  replayMode: 'inactive', replayStartTs: null, playing: false, speed: 1, stepTimeframe: '1m', qty: 1, eagerState: 'idle', viewportCachedBars: 0, sessionId: null, sessionStatus: null, fill: null, evalFill: null,
  stats: EMPTY_STATS, frameMetrics: { p50: 0, p95: 0, max: 0, samples: 0 }, lastBar: null,
  drawingMode: 'replay', activeDrawingTool: null, selectedDrawing: null, drawingInspectorOpen: false, persistencePending: false,
}

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
  /** Independent execution state per market, combined into one eval account. */
  private evaluationFills = new Map<string, FillEngineState>()
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
   */
  private fillSnapshots = new Map<number, FillEngineState>()
  /** Last journal handed to the backend, by reference — the engine's immutability makes identity a valid "unchanged" test. */
  private persistedTrades: FillEngineState['trades'] | null = null
  private projectedOrders: FillEngineState['orders'] | null = null
  private projectedTrades: FillEngineState['trades'] | null = null
  private projectedPositionQty: number | null = null
  private projectedPositionPrice: number | null = null
  private projectedUnrealizedCents: number | null = null
  private projectedOrderDraft: OrderTicketDraft | null = null
  private orderDraft: OrderTicketDraft | null = null
  private drawingClipboard: SerializedDrawing | null = null
  private pendingTimeframeSwitches = new Map<string, ReturnType<typeof setTimeout>>()
  private timeframeControllers = new Map<string, AbortController>()
  private createSessionOnSelection = false
  private marketSession: MarketSession = DEFAULT_MARKET_SESSION
  private syncFlags: ChartSyncFlags = { ...DEFAULT_CHART_SYNC_FLAGS }
  private economicEventMarkers: EconomicEventMarker[] = []

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
    this.views.register(view)
    this.bindView(view)
    if (!this.bootstrapPromise && this.snapshot.symbols.length === 0) this.bootstrapPromise = this.bootstrap()
    if (this.bootstrapPromise) await this.bootstrapPromise
    const symbol = this.snapshot.symbol
    if (symbol && this.source && !view.isInitialized()) {
      await view.initialize(symbol)
      const raw = this.rawHistory()
      const displayBars = await this.loadInitialDisplayHistory(view.id, view.timeframe, symbol, raw)
      view.rebuild(raw, symbol, false, displayBars)
      view.setReplaySelection(this.currentReplaySelectionState())
      view.syncEconomicEventMarkers(this.economicEventMarkers)
      this.syncChartTradingState(true)
      await this.reconcileDrawings(id)
    }
    if (symbolCode && view.symbol()?.symbol !== symbolCode) await this.setChartViewSymbol(id, symbolCode)
  }

  unregisterChartView(id: string): void {
    this.cancelPendingTimeframeSwitch(id)
    this.views.unregister(id)
  }

  activateChartView(id: string): void {
    if (!this.views.activate(id)) return
    const view = this.views.active()
    if (!view) return
    if (isEvalActive()) {
      this.orderDraft = null
      const symbol = view.symbol() ?? this.snapshot.symbol
      const fill = symbol ? this.ensureEvaluationFill(symbol) : null
      const source = symbol ? this.sourceForSymbol(symbol.symbol) : null
      const lastBar = source ? this.barAtCursor(source) : null
      this.setSnapshot({ activeSymbol: symbol, timeframe: view.timeframe, fill, evalFill: this.aggregateEvaluationFill(), lastBar, stats: fill ? calculateTradeStats(fill.trades) : EMPTY_STATS, selectedDrawing: null, drawingInspectorOpen: false, activeDrawingTool: null }, true)
      this.syncChartTradingState(true)
      return
    }
    this.setSnapshot({ activeSymbol: view.symbol() ?? this.snapshot.symbol, timeframe: view.timeframe, selectedDrawing: null, drawingInspectorOpen: false, activeDrawingTool: null }, true)
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
    this.syncFlags = { ...syncFlags }
  }
  resetChartView(id: string): void { this.views.resetView(id) }

  setEconomicEventMarkers(markers: EconomicEventMarker[]): void {
    this.economicEventMarkers = markers
    this.views.syncEconomicEventMarkers(markers)
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
    if (this.persistTimer) clearTimeout(this.persistTimer)
    if (this.drawingTimer) clearTimeout(this.drawingTimer)
    if (this.transientErrorTimer) clearTimeout(this.transientErrorTimer)
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
          : fetchBarsAt(symbol.symbol, '1m', this.snapshot.cursorTs, 3000, 10000, controller.signal).then((frame) => new BarSource(frame)),
      ])
      if (controller.signal.aborted || this.timeframeControllers.get(id) !== controller) return
      if (auxiliarySource) this.auxiliarySources.set(symbol.symbol, auxiliarySource)
      const raw = isReplaySymbol && this.source
        ? this.rawHistory()
        : auxiliarySource ? this.rawHistoryFromSource(auxiliarySource, this.snapshot.cursorTs) : []
      view.changeSymbol(symbol, raw, page.bars.filter((bar) => bar.time <= this.snapshot.cursorTs))
      view.setReplaySelection(this.currentReplaySelectionState())
      view.syncEconomicEventMarkers(this.economicEventMarkers)
      if (isEvalActive()) {
        this.ensureEvaluationFill(symbol)
        if (this.views.active()?.id === id) this.activateChartView(id)
        else this.syncChartTradingState(true)
      } else if (this.snapshot.symbol?.symbol === symbol.symbol) this.syncChartTradingState(true)
      else view.syncTrading([], [], [])
      if (!this.reloadDrawingDocumentForView(symbol.symbol, id)) await this.reconcileDrawings(id)
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
    cancelAnimationFrame(this.animationFrame)
    this.animationFrame = requestAnimationFrame(this.frame)
  }
  pause(): void {
    cancelAnimationFrame(this.animationFrame)
    this.views.flushRawBars()
    this.highSpeedChartFrame = 0
    this.setSnapshot({ playing: false }, true)
    this.scheduleSessionPersist()
  }

  /** Number of underlying 1-minute bars the current step-timeframe covers. */
  private stepBars(): number {
    return Math.max(1, Math.round(timeframeSeconds(this.snapshot.stepTimeframe) / 60))
  }

  stepForward(): void { this.pause(); this.ensureCursorViewport(); this.advance(this.stepBars()); this.emitSnapshot(true) }
  stepBack(): void {
    if (isEvalActive()) return
    this.pause()
    if (!this.source || this.cursorIndex <= 0) return
    const steps = Math.min(this.stepBars(), this.cursorIndex)
    const targetIndex = this.cursorIndex - steps
    const restored = this.fillSnapshots.get(targetIndex)
    if (!restored && (this.snapshot.fill?.trades.length ?? 0) > 0) {
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
      this.snapshot = { ...this.snapshot, fill: restored, stats: calculateTradeStats(restored.trades) }
      this.orderDraft = null
    } else {
      // No session in progress (plain browsing) — nothing to preserve.
      this.rebuildSimulation()
    }
    this.rebuildChart()
    this.syncChartTradingState(true)
    this.scheduleSessionPersist()
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
    await this.seek(selectedTimestamp, 'ceil')
    if (this.snapshot.status !== 'ready') return
    const replayStartTs = this.snapshot.cursorTs
    let sessionId: string | null = null
    let sessionStatus: ReplaySession['status'] | null = null
    if (shouldCreateSession && !isEvalActive() && this.snapshot.symbol) {
      try {
        sessionId = await createSession(this.snapshot.symbol.symbol, this.views.active()?.timeframe ?? this.snapshot.timeframe, replayStartTs)
        sessionStatus = 'active'
        this.persistedTrades = null
        if (this.snapshot.fill) {
          await patchSession(sessionId, { equityCents: this.snapshot.fill.equityCents, status: 'active', config: serializeReplayRuntime(this.snapshot.fill) })
        }
      } catch {
        sessionId = null
        sessionStatus = null
        this.setSnapshot({ error: 'Session could not be created. This replay will remain temporary.' }, true)
      }
    }
    this.setSnapshot({ replayMode: 'active', replayStartTs, sessionId, sessionStatus }, true)
    this.views.setReplaySelection({ mode: 'active', timestamp: replayStartTs })
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
    void this.deactivateReplaySession('paused', { returnToLatest: true })
  }

  pauseReplaySession(): Promise<void> { return this.deactivateReplaySession('paused', { returnToLatest: true }) }
  stopReplaySession(): Promise<void> { return this.deactivateReplaySession('stopped', { returnToLatest: true }) }
  async exitEvaluation(): Promise<void> {
    if (!isEvalActive()) return
    this.cancelActiveOrders()
    if (!await this.flushDrawingPersistence()) {
      this.setSnapshot({ error: 'Evaluation drawings could not be saved. Exit was cancelled so you can retry.' }, true)
      return
    }
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
        this.source = new BarSource(await fetchBarsAt(symbol.symbol, '1m', targetTimestamp, 3000, 10000))
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
      await this.reconcileDrawings()
    } catch (error) {
      this.setSnapshot({ status: 'error', error: error instanceof Error ? error.message : 'Seek failed' }, true)
    }
  }

  placeMarket(side: OrderSide): void { this.mutateFill((state) => placeOrder(state, { side, type: 'market', qty: this.snapshot.qty })) }
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
  setDrawingTool(tool: string | null): void {
    if (tool) this.pause()
    this.views.active()?.adapter.setDrawingTool(tool)
    this.setSnapshot({ activeDrawingTool: tool }, true)
  }
  deselectDrawing(): void { this.views.active()?.adapter.deselectDrawing() }
  deleteSelectedDrawing(): void { this.views.active()?.adapter.deleteSelectedDrawing() }
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
  toggleDrawingsVisibility(): void { this.views.active()?.adapter.toggleDrawingsVisibility() }
  moveChart(direction: 'left' | 'right', bars = 1): void {
    const adapter = this.views.active()?.adapter
    if (!adapter) return
    if (bars === 1 && adapter.nudgeSelectedDrawing(direction)) return
    adapter.panView(direction === 'left' ? -bars : bars)
  }
  nudgeDrawing(direction: 'up' | 'down'): boolean { return this.views.active()?.adapter.nudgeSelectedDrawing(direction) ?? false }
  zoomChart(factor: number): void { this.views.active()?.adapter.zoomView(factor) }
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

  async resumeSession(session: ReplaySession): Promise<void> {
    if (isEvalActive()) {
      this.setSnapshot({ error: 'Finish or abandon the active evaluation before loading another replay session' }, true)
      return
    }
    await this.deactivateReplaySession('paused')
    const symbol = this.snapshot.symbols.find((item) => item.symbol === session.symbol)
    if (!symbol) {
      this.setSnapshot({ error: `Session symbol ${session.symbol} is unavailable` }, true)
      return
    }
    let trades: ClosedTrade[]
    try {
      trades = await fetchTrades(session.id)
    } catch {
      this.setSnapshot({ error: 'This session could not be activated because its trade history is unavailable.' }, true)
      return
    }
    const checkpoint = session.cursorTs || session.startTs
    const resolution = trades.length === 0
      ? await this.resolveDataTimestamp(symbol, checkpoint, 'nearest')
      : { timestamp: checkpoint, calendarAvailable: true }
    if (this.snapshot.symbol?.symbol !== symbol.symbol) {
      const active = this.views.active()
      if (active) active.timeframe = session.tf
      this.setSnapshot({ symbol, timeframe: session.tf }, true)
      await this.loadSymbol(symbol, resolution.timestamp)
    } else if (this.snapshot.timeframe !== session.tf) {
      await this.setTimeframe(session.tf)
    }
    await this.seek(resolution.timestamp)
    if (this.snapshot.status !== 'ready' || !this.snapshot.fill) return
    const fill = restoreReplayRuntime(this.snapshot.fill, session, trades)
    this.snapshot = { ...this.snapshot, fill, stats: calculateTradeStats(fill.trades) }
    this.persistedTrades = fill.trades
    this.fillSnapshots.clear()
    this.fillSnapshots.set(this.cursorIndex, fill)
    await patchSession(session.id, { status: 'active', cursorTs: this.snapshot.cursorTs, equityCents: fill.equityCents, config: serializeReplayRuntime(fill) })
    this.setSnapshot({ sessionId: session.id, sessionStatus: 'active', replayMode: 'active', replayStartTs: session.startTs }, true)
    this.syncChartTradingState(true)
    this.views.setReplaySelection({ mode: 'active', timestamp: session.startTs })
    const latestTrade = trades.reduce<ClosedTrade | null>((latest, trade) => !latest || trade.exitTs > latest.exitTs ? trade : latest, null)
    this.views.focusTime(latestTrade?.exitTs ?? resolution.timestamp)
    if (!resolution.calendarAvailable) this.setSnapshot({ error: 'The trading calendar is unavailable; the chart opened on the closest bar returned by history.' }, true)
  }

  async syncEvaluationSession(): Promise<void> {
    const evaluation = getEvalState()
    if (evaluation.phase !== 'running' || evaluation.startTs === null) return
    const symbol = this.views.active()?.symbol() ?? this.snapshot.symbol ?? this.snapshot.symbols.find((item) => item.symbol === 'NQ') ?? this.snapshot.symbols[0]
    if (!symbol) return
    const checkpoint = evaluation.lastCursorTs ?? evaluation.startTs
    const latestTrade = evaluation.trades.reduce<(typeof evaluation.trades)[number] | null>((latest, trade) => !latest || trade.exitTime > latest.exitTime ? trade : latest, null)
    const resolution = latestTrade
      ? { timestamp: checkpoint, calendarAvailable: true }
      : await this.resolveDataTimestamp(symbol, checkpoint, 'at-or-after')
    this.setSnapshot({ symbol, activeSymbol: symbol }, true)
    await this.loadSymbol(symbol, resolution.timestamp)
    if (this.snapshot.status !== 'ready') return
    this.setSnapshot({ replayMode: 'active', replayStartTs: evaluation.startTs }, true)
    this.views.setReplaySelection({ mode: 'active', timestamp: evaluation.startTs })
    this.views.focusTime(latestTrade?.exitTime ?? resolution.timestamp)
    if (!resolution.calendarAvailable) this.setSnapshot({ error: 'The trading calendar is unavailable; the evaluation opened on the closest bar returned by history.' }, true)
  }

  private async resolveDataTimestamp(symbol: SymbolMeta, timestamp: number, direction: NearestDataDirection): Promise<DataTimestampResolution> {
    const range = symbol.ranges['1m']
    if (!range) return { timestamp, calendarAvailable: false }
    const bounded = Math.max(range.from, Math.min(timestamp, range.to))
    try {
      const calendar = await fetchCalendar(symbol.symbol, '1m', range.from, range.to)
      return { timestamp: nearestDataTimestamp(calendar, bounded, direction) ?? bounded, calendarAvailable: true }
    } catch {
      return { timestamp: bounded, calendarAvailable: false }
    }
  }

  private async loadSymbol(symbol: SymbolMeta, requestedStart?: number): Promise<void> {
    if (this.views.size() === 0) return
    this.abortViewportLoads()
    this.views.setReplaySelection({ mode: 'inactive' })
    this.setSnapshot({ status: 'loading', error: null, eagerState: 'idle', sessionId: null, sessionStatus: null, replayMode: 'inactive', replayStartTs: null }, true)
    try {
      const range = symbol.ranges['1m']
      if (!range) throw new Error(`${symbol.symbol} has no 1m data range`)
      const fallbackStart = Math.max(range.from, range.to - 5 * 86400)
      const start = Math.min(range.to, Math.max(range.from, requestedStart ?? fallbackStart))
      const frame = await fetchBarsAt(symbol.symbol, '1m', start, 3000, 10000)
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
      if (evaluation.phase === 'running') {
        for (const view of this.views.all()) {
          const viewSymbol = view.symbol()
          if (viewSymbol) this.ensureEvaluationFill(viewSymbol)
        }
        const activeSymbol = this.tradingSymbol()
        const activeFill = activeSymbol ? this.ensureEvaluationFill(activeSymbol) : null
        this.snapshot = { ...this.snapshot, fill: activeFill, evalFill: this.aggregateEvaluationFill() }
      }
      const last = this.source.at(this.cursorIndex)
      const activeSource = evaluation.phase === 'running' && this.tradingSymbol()
        ? this.sourceForSymbol(this.tradingSymbol()?.symbol ?? '')
        : null
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
      this.setSnapshot({ eagerState: 'ready' }, true)
    } catch (error) {
      this.setSnapshot({ status: 'error', error: error instanceof Error ? error.message : `Could not load ${symbol.symbol}` }, true)
    }
  }

  private bindView(view: ChartViewController): void {
    const ownsReplayStream = (): boolean => isEvalActive()
      ? this.views.active()?.id === view.id
      : view.symbol()?.symbol === this.snapshot.symbol?.symbol
    view.adapter.onOrderLineMove((id, price) => { if (ownsReplayStream()) this.moveOrderLine(id, price) })
    view.adapter.onOrderLineDragStart((id) => { if (ownsReplayStream()) this.beginOrderEdit(id) })
    view.adapter.onOrderLineAction((action) => { if (ownsReplayStream()) this.handleOrderLineAction(action) })
    view.adapter.onChartOrder((side, type, price) => { if (ownsReplayStream()) this.placePending(side, type, price) })
    view.adapter.onDrawingsChanged((drawingId) => this.handleViewDrawingsChanged(view.id, drawingId))
    view.adapter.onDrawingSelection((drawing) => { if (this.views.active()?.id === view.id) this.handleDrawingSelection(drawing) })
    view.adapter.onDrawingEditRequest((drawing) => { if (this.views.active()?.id === view.id) this.setSnapshot({ selectedDrawing: drawing, drawingInspectorOpen: true }, true) })
    view.adapter.onDrawingToolChanged((tool) => { if (this.views.active()?.id === view.id) this.setSnapshot({ activeDrawingTool: tool }, true) })
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
    return isEvalActive()
      ? this.views.active()?.symbol() ?? this.snapshot.symbol
      : this.snapshot.symbol
  }

  private sourceForSymbol(symbolCode: string): BarSource | null {
    if (this.snapshot.symbol?.symbol === symbolCode) return this.source
    return this.auxiliarySources.get(symbolCode) ?? null
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
      startingEquityCents: 1_000_000,
    })
    return current ? stepFillEngine(fill, current) : fill
  }

  private ensureEvaluationFill(symbol: SymbolMeta): FillEngineState | null {
    const existing = this.evaluationFills.get(symbol.symbol)
    if (existing) return existing
    const source = this.sourceForSymbol(symbol.symbol)
    if (!source) return null
    const fill = this.createSymbolFill(symbol, this.barAtCursor(source))
    this.evaluationFills.set(symbol.symbol, fill)
    return fill
  }

  private aggregateEvaluationFill(): EvalFillState | null {
    if (this.evaluationFills.size === 0) return null
    const fills = [...this.evaluationFills.values()]
    const realizedCents = fills.reduce((total, fill) => total + fill.realizedCents, 0)
    const unrealizedCents = fills.reduce((total, fill) => total + fill.unrealizedCents, 0)
    return {
      realizedCents,
      equityCents: 1_000_000 + realizedCents + unrealizedCents,
      trades: fills.flatMap((fill) => fill.trades),
    }
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
    if (isEvalActive()) {
      this.evaluationFills.clear()
      this.evaluationFills.set(symbol.symbol, seeded)
    } else {
      this.evaluationFills.clear()
    }
    this.snapshot = { ...this.snapshot, fill: seeded, evalFill: isEvalActive() ? this.aggregateEvaluationFill() : null, stats: EMPTY_STATS, lastBar: current }
    // A reset re-anchors the session, so every earlier snapshot is stale.
    this.fillSnapshots.clear()
    this.fillSnapshots.set(this.cursorIndex, seeded)
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
    let fill = isEvalActive()
      ? this.evaluationFills.get(this.snapshot.symbol?.symbol ?? '') ?? this.snapshot.fill
      : this.snapshot.fill
    let processed = 0
    for (let index = 0; index < steps; index += 1) {
      const bar = this.source.at(this.cursorIndex + 1)
      if (!bar) break
      this.cursorIndex += 1
      if (!isEvalActive()) {
        fill = stepFillEngine(fill, bar)
        this.fillSnapshots.set(this.cursorIndex, fill)
      }
      rawBars.push(bar)
      this.viewportCache.append(bar)
      processed += 1
    }
    if (processed === 0) {
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
    if (isEvalActive()) {
      for (const [fillSymbol, currentFill] of this.evaluationFills) {
        const source = this.sourceForSymbol(fillSymbol)
        if (!source) continue
        const bars = fillSymbol === this.snapshot.symbol?.symbol
          ? rawBars
          : this.sourceBarsBetween(source, previousCursorTs, cursorTs)
        let nextFill = currentFill
        for (const bar of bars) nextFill = stepFillEngine(nextFill, bar)
        this.evaluationFills.set(fillSymbol, nextFill)
      }
      const activeSymbol = this.tradingSymbol()
      const activeFill = activeSymbol ? this.evaluationFills.get(activeSymbol.symbol) ?? null : null
      const activeSource = activeSymbol ? this.sourceForSymbol(activeSymbol.symbol) : null
      const activeBar = activeSource ? this.barAtCursor(activeSource) : current
      this.snapshot = {
        ...this.snapshot,
        fill: activeFill,
        evalFill: this.aggregateEvaluationFill(),
        lastBar: activeBar,
        cursorTs,
        stats: activeFill ? calculateTradeStats(activeFill.trades) : EMPTY_STATS,
      }
    } else {
      this.snapshot = { ...this.snapshot, fill, evalFill: null, lastBar: current, cursorTs, stats: calculateTradeStats(fill.trades) }
    }
    this.syncChartTradingState()
    this.scheduleSessionPersist()
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
    const currentFill = this.snapshot.fill
    if (!currentFill) return
    try {
      const fill = mutator(currentFill)
      const symbol = this.tradingSymbol()
      if (isEvalActive() && symbol) this.evaluationFills.set(symbol.symbol, fill)
      this.snapshot = { ...this.snapshot, fill, evalFill: isEvalActive() ? this.aggregateEvaluationFill() : null, error: null }
      // Orders placed while parked on this bar belong to this bar's state,
      // so a later step-back onto it restores them too.
      this.fillSnapshots.set(this.cursorIndex, fill)
      this.syncChartTradingState()
      this.emitSnapshot(true)
    } catch (error) {
      this.setSnapshot({ error: error instanceof Error ? error.message : 'Trading action failed' }, true)
    }
  }

  private amendOrderPrice(id: string, price: number): void {
    const symbol = this.tradingSymbol()
    if (!symbol) return
    this.mutateFill((state) => amendOrder(state, id, Math.round(price / symbol.tickSize)))
  }

  private syncChartTradingState(force = false): void {
    const fill = this.snapshot.fill
    const symbol = this.tradingSymbol()
    if (this.views.size() === 0 || !fill || !symbol) return
    const positionQty = fill.position?.qty ?? null
    const positionPrice = fill.position?.avgPriceTicks ?? null
    if (!force
      && this.projectedOrders === fill.orders
      && this.projectedTrades === fill.trades
      && this.projectedPositionQty === positionQty
      && this.projectedPositionPrice === positionPrice
      && this.projectedUnrealizedCents === fill.unrealizedCents
      && this.projectedOrderDraft === this.orderDraft) return
    this.projectedOrders = fill.orders
    this.projectedTrades = fill.trades
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
        editable: true,
        role,
        stage: 'draft',
        qty: draft.qty,
        priceLabel: (priceTicks * symbol.tickSize).toFixed(symbol.priceDecimals),
        showControls: role === 'entry',
        protectionEnabled: { stopLoss: draft.stopLossTicks !== null, takeProfit: draft.takeProfitTicks !== null },
        maxQuantity: MAX_REPLAY_CONTRACTS,
      })
      lines.push(toLine('entry', draft.entryPriceTicks, '#2962ff', `${draft.side === 'buy' ? 'Buy' : 'Sell'} ${draft.type === 'limit' ? 'Limit' : 'Stop'}`, draft.type))
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
    const markers: TradeMarker[] = []
    const connections: TradeConnection[] = []
    const priceFormatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: symbol.priceDecimals,
      maximumFractionDigits: symbol.priceDecimals,
    })
    for (const trade of fill.trades) {
      const entryPrice = trade.entryPriceTicks * symbol.tickSize
      const exitPrice = trade.exitPriceTicks * symbol.tickSize
      const tradeColor = trade.side === 'long' ? '#089981' : '#f23645'
      markers.push({ time: trade.entryTs, price: entryPrice, text: `${trade.side === 'long' ? '+' : '-'}${trade.qty} @ ${priceFormatter.format(entryPrice)}`, color: tradeColor, shape: trade.side === 'long' ? 'arrowUp' : 'arrowDown' })
      markers.push({ time: trade.exitTs, price: exitPrice, text: `${trade.side === 'long' ? '-' : '+'}${trade.qty} @ ${priceFormatter.format(exitPrice)}`, color: tradeColor, shape: 'circle' })
      connections.push({ entryTime: trade.entryTs, entryPrice, exitTime: trade.exitTs, exitPrice })
    }
    const savedEvalVisuals = this.evalTradeVisuals(symbol, priceFormatter, fill.trades)
    markers.push(...savedEvalVisuals.markers)
    connections.push(...savedEvalVisuals.connections)
    markers.sort((left, right) => left.time - right.time)
    this.views.syncTrading(symbol.symbol, lines, markers, connections)
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
      connections.push({ entryTime, entryPrice, exitTime: trade.exitTime, exitPrice })
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
      const frame = await fetchBarsAt(symbol.symbol, '1m', cursorTs, 3000, 10000)
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
    const estimatedBars = raw.length / Math.max(1, timeframeSeconds(timeframe) / 60)
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
    const range = symbol.ranges['1m']
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
        patchSession(sessionId, { cursorTs, equityCents: fill.equityCents, status: 'active', config: serializeReplayRuntime(fill) }),
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
      .then(() => { this.persistedTrades = journal })
  }

  /** Bounds the snapshot ring to the same window the raw bar cache keeps. */
  private pruneFillSnapshots(): void {
    if (this.fillSnapshots.size <= MAX_FILL_SNAPSHOTS) return
    const floor = this.cursorIndex - MAX_FILL_SNAPSHOTS
    for (const index of this.fillSnapshots.keys()) {
      if (index < floor) this.fillSnapshots.delete(index)
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
        config: serializeReplayRuntime(fill),
      })
      return true
    } catch {
      this.setSnapshot({ error: 'Session could not be saved. It remains open so you can retry.', persistencePending: true }, true)
      return false
    }
  }

  private async deactivateReplaySession(
    status: 'paused' | 'stopped',
    options: { returnToLatest?: boolean; drawingsFlushed?: boolean } = {},
  ): Promise<void> {
    cancelAnimationFrame(this.animationFrame)
    this.views.flushRawBars()
    this.highSpeedChartFrame = 0
    this.cancelActiveOrders()
    const detachedSessionId = this.snapshot.sessionId
    const hadSession = detachedSessionId !== null
    this.setSnapshot({ playing: false }, true)
    if (!options.drawingsFlushed && !await this.flushDrawingPersistence()) {
      this.setSnapshot({ error: 'Session drawings could not be saved. The session remains open so you can retry.' }, true)
      return
    }
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
    const latest = symbol?.ranges['1m']?.to
    if (!symbol || latest === undefined) return
    this.views.active()?.adapter.setDrawingTool(null)
    this.views.active()?.adapter.deselectDrawing()
    this.setSnapshot({ activeDrawingTool: null, selectedDrawing: null, drawingInspectorOpen: false }, true)
    await this.loadSymbol(symbol, latest)
  }

  private cancelActiveOrders(): void {
    if (isEvalActive() && this.evaluationFills.size > 0) {
      let changed = this.orderDraft !== null
      this.orderDraft = null
      for (const [symbol, fill] of this.evaluationFills) {
        const next = cancelAllOrders(fill)
        if (next !== fill) changed = true
        this.evaluationFills.set(symbol, next)
      }
      const activeSymbol = this.tradingSymbol()
      const activeFill = activeSymbol ? this.evaluationFills.get(activeSymbol.symbol) ?? null : null
      this.snapshot = { ...this.snapshot, fill: activeFill, evalFill: this.aggregateEvaluationFill() }
      if (changed) {
        this.syncChartTradingState(true)
        this.emitSnapshot(true)
      }
      return
    }
    const fill = this.snapshot.fill
    const hadDraft = this.orderDraft !== null
    this.orderDraft = null
    if (!fill) {
      if (hadDraft) this.syncChartTradingState(true)
      return
    }
    const nextFill = cancelAllOrders(fill)
    if (nextFill !== fill) {
      this.snapshot = { ...this.snapshot, fill: nextFill }
      this.fillSnapshots.set(this.cursorIndex, nextFill)
    }
    if (nextFill !== fill || hadDraft) {
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
