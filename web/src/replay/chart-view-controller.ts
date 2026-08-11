import type { SymbolMeta, Timeframe } from '../api/types'
import type { Bar1m } from '../fill-engine/types'
import { buildDisplayHistory, DisplayAggregator } from './aggregate'
import type { ChartAdapter, ChartCrosshairSync, ChartViewportSync, DisplayBar, EconomicEventMarker, HistoryUpdateOptions, OrderLine, ReplaySelectionState, TradeConnection, TradeMarker, ViewportDirection } from './chart-adapter'
import type { ChartPaneSettings } from './chart-settings-store'
import type { HoverBarStore } from './hover-bar-store'
import { isRegularTradingHours, marketSessionIncludes, nextRegularTradingTimestamp, type MarketSession } from './market-session'
import { timeframeSeconds } from './timeframe'
import { MAX_VIEWPORT_DISPLAY_BARS } from './viewport-data'

const FUTURE_WHITESPACE_BARS = 192
const FUTURE_WHITESPACE_REFRESH_BARS = 96
const DISPLAY_HISTORY_TRIM_THRESHOLD = MAX_VIEWPORT_DISPLAY_BARS + Math.ceil(MAX_VIEWPORT_DISPLAY_BARS * 0.1)

export interface ChartViewControllerOptions {
  id: string
  element: HTMLElement
  adapter: ChartAdapter
  timeframe: Timeframe
  settings: ChartPaneSettings
  marketSession: MarketSession
  hoverStore: HoverBarStore
  followsReplaySymbol?: boolean
}

export class ChartViewController {
  readonly id: string
  readonly element: HTMLElement
  readonly adapter: ChartAdapter
  readonly hoverStore: HoverBarStore
  timeframe: Timeframe
  settings: ChartPaneSettings
  private marketSession: MarketSession
  private aggregator: DisplayAggregator | null = null
  private displayHistory: DisplayBar[] = []
  private spacerThroughTime = 0
  private spacerInterval = 0
  private initialized = false
  private pendingRawBars: Bar1m[] = []
  private spacerTimes: number[] = []
  private economicEventMarkers: EconomicEventMarker[] = []
  private followsReplay = true

  constructor(options: ChartViewControllerOptions) {
    this.id = options.id
    this.element = options.element
    this.adapter = options.adapter
    this.timeframe = options.timeframe
    this.settings = options.settings
    this.marketSession = options.marketSession
    this.hoverStore = options.hoverStore
    this.followsReplay = options.followsReplaySymbol ?? true
  }

  async initialize(symbol: SymbolMeta): Promise<void> {
    await this.adapter.init(this.element, symbol, this.timeframe)
    this.currentSymbol = symbol
    this.adapter.applyAppearance(this.settings.appearance)
    this.adapter.setDisplayTimezone(this.settings.timezone)
    this.initialized = true
  }

  isInitialized(): boolean { return this.initialized }

  rebuild(raw: Bar1m[], symbol: SymbolMeta, preserveViewport = false, displayBars?: DisplayBar[]): void {
    this.pendingRawBars = []
    const history = buildDisplayHistory(raw, this.timeframe, symbol, symbol.tickSize, this.marketSession)
    const remoteHistory = this.sessionSafeDisplayBars(displayBars, symbol)
    this.displayHistory = remoteHistory && remoteHistory.length > 0 ? remoteHistory : history.bars
    this.publishHistory({ preserveViewport, resetView: !preserveViewport })
    this.syncSpacerTimes(true)
    this.aggregator = history.aggregator
  }

  mergeViewportPage(page: DisplayBar[], direction: ViewportDirection): void {
    const symbol = this.currentSymbol
    const safePage = symbol ? this.sessionSafeDisplayBars(page, symbol) ?? [] : page
    const byTime = new Map(this.displayHistory.map((bar) => [bar.time, bar]))
    for (const bar of safePage) if (!byTime.has(bar.time)) byTime.set(bar.time, bar)
    const merged = [...byTime.values()].sort((left, right) => left.time - right.time)
    if (merged.length <= MAX_VIEWPORT_DISPLAY_BARS) this.displayHistory = merged
    else if (direction === 'after') this.displayHistory = merged.slice(-MAX_VIEWPORT_DISPLAY_BARS)
    else this.displayHistory = merged.slice(0, MAX_VIEWPORT_DISPLAY_BARS)
    this.publishHistory({ preserveViewport: true })
    this.syncSpacerTimes()
    this.publishEconomicEventMarkers()
  }

  /**
   * Hands the adapter its own copy of the display history. pushRawBars
   * mutates the controller's array in place every frame, so an adapter that
   * kept the array it was given (a test double recording calls, say) would
   * otherwise observe it changing underneath. This runs on rebuild/merge —
   * seek, timeframe switch, viewport page — never per frame.
   */
  private publishHistory(options: HistoryUpdateOptions): void {
    this.adapter.setHistory([...this.displayHistory], options)
  }

  pushRawBars(rawBars: Bar1m[]): void {
    if (!this.aggregator) return
    const previousTailTime = this.displayHistory.at(-1)?.time
    const batch = this.pendingRawBars.length > 0 ? [...this.pendingRawBars, ...rawBars] : rawBars
    this.pendingRawBars = []
    const displayBars = [] as ReturnType<DisplayAggregator['push']>['forming'][]
    for (const raw of batch) {
      if (!this.currentSymbol || !marketSessionIncludes(raw.ts, this.marketSession, this.currentSymbol)) continue
      const result = this.aggregator.push(raw)
      const last = displayBars.at(-1)
      if (last?.time === result.forming.time) displayBars[displayBars.length - 1] = result.forming
      else displayBars.push(result.forming)
    }
    if (displayBars.length === 0) return

    // Replay only ever advances forward in time, so displayBars is always
    // at-or-after the current tail (either updating the still-forming
    // bucket or appending new ones after it) — a plain array copy +
    // append/update skips the Map build + hash + sort the fallback below
    // needs every animation frame regardless of batch size. Still O(n) for
    // the copy, but a copy is a fresh array (never mutating the one
    // already handed to adapter.setHistory/pushBars — see golden rule on
    // immutability), so no aliasing hazard. Falls back to the original
    // full merge+sort if the forward-only invariant is ever violated, so
    // out-of-order input still produces correct (if unoptimized) output
    // rather than silently dropping/misordering bars.
    const tailTime = this.displayHistory.at(-1)?.time
    const inOrder = tailTime === undefined || displayBars.every((bar, index) => bar.time >= (index === 0 ? tailTime : displayBars[index - 1].time))

    if (inOrder) {
      // Appended in place. displayHistory is private and only ever leaves
      // this class through publishHistory(), which copies — so no consumer
      // can be holding the array this mutates. The previous version rebuilt
      // the whole (up to 6,000-bar) array on every animation frame, for
      // every pane, to add one or two bars.
      const history = this.displayHistory
      for (const bar of displayBars) {
        if (history.length > 0 && history[history.length - 1].time === bar.time) history[history.length - 1] = bar
        else history.push(bar)
      }
      // Trimming is batched the same way BoundedBarCache batches it: paying
      // an O(n) copy to drop a single bar, every frame, is the exact cost
      // this branch exists to avoid.
      if (history.length > DISPLAY_HISTORY_TRIM_THRESHOLD) {
        this.displayHistory = history.slice(-MAX_VIEWPORT_DISPLAY_BARS)
      }
    } else {
      const byTime = new Map(this.displayHistory.map((bar) => [bar.time, bar]))
      for (const bar of displayBars) byTime.set(bar.time, bar)
      this.displayHistory = [...byTime.values()].sort((left, right) => left.time - right.time).slice(-MAX_VIEWPORT_DISPLAY_BARS)
    }
    this.adapter.pushBars(displayBars)
    if (this.displayHistory.at(-1)?.time !== previousTailTime) this.syncSpacerTimes()
  }

  queueRawBars(rawBars: Bar1m[]): void { this.pendingRawBars.push(...rawBars) }
  flushRawBars(): void { if (this.pendingRawBars.length > 0) this.pushRawBars([]) }

  async changeTimeframe(timeframe: Timeframe, symbol: SymbolMeta, raw: Bar1m[], displayBars?: DisplayBar[]): Promise<void> {
    this.timeframe = timeframe
    if (!this.initialized) await this.initialize(symbol)
    this.rebuild(raw, symbol, false, displayBars)
  }

  changeSymbol(symbol: SymbolMeta, raw: Bar1m[], displayBars?: DisplayBar[], followsReplaySymbol = false): void {
    this.followsReplay = followsReplaySymbol
    this.adapter.setSymbol(symbol)
    this.rebuild(raw, symbol, false, displayBars)
  }

  symbol(): SymbolMeta | null { return this.currentSymbol }
  followsReplaySymbol(): boolean { return this.followsReplay }

  applySettings(settings: ChartPaneSettings): void {
    this.settings = settings
    this.adapter.applyAppearance(settings.appearance)
    this.adapter.setDisplayTimezone(settings.timezone)
  }

  setMarketSession(marketSession: MarketSession): void { this.marketSession = marketSession }

  private currentSymbol: SymbolMeta | null = null

  private sessionSafeDisplayBars(displayBars: DisplayBar[] | undefined, symbol: SymbolMeta): DisplayBar[] | undefined {
    this.currentSymbol = symbol
    if (!displayBars || this.marketSession === 'eth') return displayBars
    // Viewport pages are aggregated for the requested market session by the
    // server. Keep the defensive timestamp filter for 1m callers while
    // trusting higher-timeframe RTH OHLC that cannot be reconstructed from
    // the short replay-side raw window.
    return timeframeSeconds(this.timeframe) === 60
      ? displayBars.filter((bar) => isRegularTradingHours(bar.time, symbol.sessionTz))
      : displayBars
  }

  syncTrading(lines: OrderLine[], markers: TradeMarker[], connections: TradeConnection[]): void {
    this.adapter.setOrderLines(lines)
    this.adapter.setTradeMarkers(markers)
    this.adapter.setTradeConnections(connections.map((connection) => ({
      ...connection,
      entryTime: this.projectTimestamp(connection.entryTime),
      exitTime: this.projectTimestamp(connection.exitTime),
    })))
  }

  syncEconomicEventMarkers(markers: EconomicEventMarker[]): void {
    this.economicEventMarkers = markers
    this.publishSpacerTimes()
    this.publishEconomicEventMarkers()
  }

  private publishSpacerTimes(): void {
    const historyTail = this.displayHistory.at(-1)?.time ?? 0
    const distantEvents = this.economicEventMarkers
      .map((marker) => marker.time)
      .filter((time) => Number.isFinite(time) && time > historyTail && time > this.spacerThroughTime)
    const merged = [...new Set([...this.spacerTimes, ...distantEvents])].sort((left, right) => left - right)
    this.adapter.setSpacerTimes(merged)
  }

  private publishEconomicEventMarkers(): void {
    const times = this.displayHistory.length > 0
      ? [...this.displayHistory.map((bar) => bar.time), ...this.spacerTimes]
      : this.spacerTimes
    if (times.length === 0) {
      this.adapter.setEconomicEventMarkers([])
      return
    }
    const first = times[0]
    const last = times.at(-1) ?? first
    const projected = this.economicEventMarkers.map((marker) => {
      if (marker.time < first || marker.time > last) return marker
      let low = 0
      let high = times.length
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2)
        if (times[middle] < marker.time) low = middle + 1
        else high = middle
      }
      const after = Math.min(times.length - 1, low)
      const before = Math.max(0, after - 1)
      const interval = timeframeSeconds(this.timeframe)
      const gap = times[after] - times[before]
      const projectedTime = gap <= interval * 1.5
        ? times[before]
        : Math.abs(times[after] - marker.time) < Math.abs(times[before] - marker.time) ? times[after] : times[before]
      return { ...marker, time: projectedTime }
    })
    this.adapter.setEconomicEventMarkers(projected.sort((left, right) => left.time - right.time || left.id.localeCompare(right.id)))
  }

  private projectTimestamp(timestamp: number): number {
    if (this.displayHistory.length === 0) return timestamp
    const firstTime = this.displayHistory[0]?.time
    const lastTime = this.displayHistory.at(-1)?.time
    const interval = timeframeSeconds(this.timeframe)
    if (firstTime === undefined || lastTime === undefined || timestamp < firstTime || timestamp >= lastTime + interval) return timestamp
    let low = 0
    let high = this.displayHistory.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (this.displayHistory[middle].time <= timestamp) low = middle + 1
      else high = middle
    }
    return this.displayHistory[Math.max(0, low - 1)]?.time ?? timestamp
  }

  resetView(): void { this.adapter.resetView() }
  focusTime(timestamp: number): void { this.adapter.focusTime(timestamp) }
  setCrosshairSync(state: ChartCrosshairSync | null): void {
    if (!state || this.displayHistory.length === 0) {
      this.adapter.setCrosshairSync(state)
      return
    }
    let low = 0
    let high = this.displayHistory.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (this.displayHistory[middle].time <= state.time) low = middle + 1
      else high = middle
    }
    const index = Math.max(0, Math.min(this.displayHistory.length - 1, low - 1))
    this.adapter.setCrosshairSync({ ...state, time: this.displayHistory[index].time })
  }
  setViewportSync(state: ChartViewportSync): void { this.adapter.setViewportSync(state) }
  setReplaySelection(state: ReplaySelectionState): void { this.adapter.setReplaySelection(state) }

  private syncSpacerTimes(force = false): void {
    const lastTime = this.displayHistory.at(-1)?.time
    if (lastTime === undefined) {
      this.adapter.setSpacerTimes([])
      this.spacerTimes = []
      this.spacerThroughTime = 0
      this.spacerInterval = 0
      return
    }
    const interval = timeframeSeconds(this.timeframe)
    const reserveBars = this.spacerInterval === interval
      ? Math.floor((this.spacerThroughTime - lastTime) / interval)
      : 0
    if (!force && reserveBars >= FUTURE_WHITESPACE_REFRESH_BARS) return
    const times: number[] = []
    let nextTime = lastTime
    for (let index = 0; index < FUTURE_WHITESPACE_BARS; index += 1) {
      nextTime = this.marketSession === 'rth' && interval < 86_400 && this.currentSymbol
        ? nextRegularTradingTimestamp(nextTime, interval, this.currentSymbol.sessionTz)
        : nextTime + interval
      times.push(nextTime)
    }
    this.spacerTimes = times
    this.spacerThroughTime = times.at(-1) ?? lastTime
    this.spacerInterval = interval
    this.publishSpacerTimes()
    this.publishEconomicEventMarkers()
  }

  destroy(): void {
    this.pendingRawBars = []
    this.displayHistory = []
    this.spacerThroughTime = 0
    this.spacerInterval = 0
    this.spacerTimes = []
    this.economicEventMarkers = []
    this.adapter.destroy()
    this.hoverStore.destroy()
    this.initialized = false
  }
}
