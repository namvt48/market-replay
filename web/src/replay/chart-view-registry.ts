import type { SymbolMeta } from '../api/types'
import type { Bar1m } from '../fill-engine/types'
import type { ChartCrosshairSync, ChartViewportSync, DisplayBar, OrderLine, ReplaySelectionState, TradeMarker, ViewportDirection } from './chart-adapter'
import { ChartViewController } from './chart-view-controller'

export class ChartViewRegistry {
  private views = new Map<string, ChartViewController>()
  private activeId: string | null = null
  private requestedActiveId: string | null = null
  private flushCursor = 0

  register(view: ChartViewController): void {
    this.views.get(view.id)?.destroy()
    this.views.set(view.id, view)
    if (this.requestedActiveId === view.id || this.activeId === null) this.activeId = view.id
  }

  unregister(id: string): void {
    const view = this.views.get(id)
    if (!view) return
    view.destroy()
    this.views.delete(id)
    if (this.activeId === id) this.activeId = this.views.keys().next().value ?? null
    if (this.requestedActiveId === id) this.requestedActiveId = this.activeId
  }

  activate(id: string): boolean {
    this.requestedActiveId = id
    if (!this.views.has(id)) return false
    this.activeId = id
    return true
  }

  active(): ChartViewController | null { return this.activeId ? this.views.get(this.activeId) ?? null : null }
  get(id: string): ChartViewController | null { return this.views.get(id) ?? null }
  all(): ChartViewController[] { return [...this.views.values()] }
  size(): number { return this.views.size }

  async initializeAll(symbol: SymbolMeta): Promise<void> { await Promise.all(this.all().map((view) => view.initialize(symbol))) }
  rebuildAll(raw: Bar1m[], symbol: SymbolMeta, preserveViewport = false): void {
    this.views.forEach((view) => view.rebuild(raw, symbol, preserveViewport))
  }
  mergeViewportPage(id: string, page: DisplayBar[], direction: ViewportDirection): void {
    this.views.get(id)?.mergeViewportPage(page, direction)
  }
  pushRawBars(raw: Bar1m[], viewBudget = this.views.size): void {
    const views = this.all()
    if (views.length === 0) return
    if (viewBudget >= views.length) {
      views.forEach((view) => view.pushRawBars(raw))
      return
    }
    views.forEach((view) => view.queueRawBars(raw))
    const budget = Math.max(0, viewBudget)
    for (let index = 0; index < budget; index += 1) views[(this.flushCursor + index) % views.length]?.flushRawBars()
    this.flushCursor = (this.flushCursor + budget) % views.length
  }
  flushRawBars(): void { this.views.forEach((view) => view.flushRawBars()) }
  syncTrading(lines: OrderLine[], markers: TradeMarker[]): void { this.views.forEach((view) => view.syncTrading(lines, markers)) }
  focusTime(timestamp: number): void { this.views.forEach((view) => view.focusTime(timestamp)) }
  resetView(id: string): void { this.views.get(id)?.resetView() }
  syncCrosshair(sourceId: string, state: ChartCrosshairSync | null): void {
    this.views.forEach((view, id) => { if (id !== sourceId) view.setCrosshairSync(state) })
  }
  syncViewport(sourceId: string, state: ChartViewportSync): void {
    this.views.forEach((view, id) => { if (id !== sourceId) view.setViewportSync(state) })
  }
  setReplaySelection(state: ReplaySelectionState): void { this.views.forEach((view) => view.setReplaySelection(state)) }

  destroy(): void {
    this.views.forEach((view) => view.destroy())
    this.views.clear()
    this.activeId = null
    this.requestedActiveId = null
  }
}
