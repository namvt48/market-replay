import type { RustChartEngine } from './rust-chart-engine'
import type { RustChartLayout } from './rust-chart-painter'
import type { RustIndicatorPaneScales } from './rust-chart-runtime-indicator-scales'
import {
  stamp,
  numberOption,
  type Handler,
  type RuntimeAttachedParams,
  type RuntimeDatum,
  type RuntimeMarker,
  type RuntimePriceFormatter,
  type RuntimePriceLine,
  type RuntimePriceScaleApi,
  type RuntimePrimitive,
  type RuntimeSeriesOptions,
  type SeriesKind,
} from './rust-chart-runtime-types'

export interface RuntimeSeriesHost {
  nextSeriesId(): number
  readonly series: Set<RuntimeSeries>
  readonly primitives: Set<{ primitive: RuntimePrimitive; series: RuntimeSeries }>
  readonly dataHandlers: Map<RuntimeSeries, Set<Handler<'full' | 'update'>>>
  readonly priceLines: Set<RuntimePriceLine>
  readonly panes: Map<number, { height: number; stretchFactor: number }>
  readonly engine: RustChartEngine
  readonly indicatorScales: RustIndicatorPaneScales
  getChartLayout(): RustChartLayout | null
  priceScaleApi(): RuntimePriceScaleApi
  attachedParams(seriesItem: RuntimeSeries): RuntimeAttachedParams
  paneApi(index: number): unknown
  notifyData(seriesItem: RuntimeSeries, scope: 'full' | 'update'): void
  markEngineDirty(): void
  sizeCanvas(): void
  onPrimitiveChanged(): void
  schedule(): void
  rebuildEngine(): void
  priceFormatter(options: RuntimeSeriesOptions): RuntimePriceFormatter
}

export class RuntimeSeries {
  readonly id: number
  version = 0
  readonly values: RuntimeDatum[] = []
  readonly markers: RuntimeMarker[] = []
  readonly attached = new Set<RuntimePrimitive>()
  readonly lines = new Set<RuntimePriceLine>()
  opts: RuntimeSeriesOptions
  paneIndex: number
  readonly kind: SeriesKind
  private readonly host: RuntimeSeriesHost

  constructor(host: RuntimeSeriesHost, kind: SeriesKind, opts: RuntimeSeriesOptions, paneIndex: number) {
    this.host = host
    this.id = host.nextSeriesId()
    this.kind = kind
    this.opts = { ...opts }
    this.paneIndex = paneIndex
    if (paneIndex > 0 && !host.panes.has(paneIndex)) host.panes.set(paneIndex, { height: 120, stretchFactor: 1 })
    host.series.add(this)
    host.markEngineDirty()
  }

  setData(data: RuntimeDatum[]): void {
    this.values.splice(0, this.values.length, ...data)
    this.version += 1
    this.host.notifyData(this, 'full')
    this.host.markEngineDirty()
  }
  update(data: RuntimeDatum): void {
    const time = stamp(data.time), last = this.values.at(-1)
    if (last && stamp(last.time) > time) throw new Error('Cannot update older chart data')
    if (last && stamp(last.time) === time) this.values[this.values.length - 1] = data
    else this.values.push(data)
    this.version += 1
    this.host.notifyData(this, 'update')
    this.host.markEngineDirty()
  }
  pop(count: number): RuntimeDatum[] {
    const removed = this.values.splice(Math.max(0, this.values.length - count), count)
    this.version += 1
    this.host.notifyData(this, 'full')
    this.host.markEngineDirty()
    return removed
  }
  data(): readonly RuntimeDatum[] { return this.values }
  dataByIndex(index: number): RuntimeDatum | null { return this.values[index] ?? null }
  applyOptions(next: RuntimeSeriesOptions): void {
    const wasVisible = this.opts.visible !== false
    this.opts = { ...this.opts, ...next }
    const isVisible = this.opts.visible !== false
    if (wasVisible && !isVisible) for (const primitive of this.attached) primitive.detached?.()
    else if (!wasVisible && isVisible) for (const primitive of this.attached) primitive.attached?.(this.host.attachedParams(this))
    this.host.markEngineDirty()
    if (wasVisible !== isVisible && this.paneIndex > 0) this.host.sizeCanvas()
  }
  options(): RuntimeSeriesOptions { return this.opts }
  attachPrimitive(primitive: RuntimePrimitive): void {
    if (this.attached.has(primitive)) return
    this.attached.add(primitive)
    this.host.primitives.add({ primitive, series: this })
    primitive.attached?.(this.host.attachedParams(this))
    this.host.onPrimitiveChanged()
  }
  detachPrimitive(primitive: RuntimePrimitive): void {
    if (!this.attached.delete(primitive)) return
    this.host.primitives.forEach((entry) => {
      if (entry.primitive === primitive && entry.series === this) this.host.primitives.delete(entry)
    })
    primitive.detached?.()
    this.host.onPrimitiveChanged()
  }
  detachAll(): void { for (const primitive of [...this.attached]) this.detachPrimitive(primitive) }
  getPane(): unknown { return this.host.paneApi(this.paneIndex) }
  priceScale(): RuntimePriceScaleApi {
    const isIndicatorPane = this.host.getChartLayout()?.indicatorPanes.some((pane) => pane.index === this.paneIndex) ?? false
    return isIndicatorPane ? this.host.indicatorScales.priceScaleApi(this.paneIndex) : this.host.priceScaleApi()
  }
  priceToCoordinate(price: number): number | null {
    const isIndicatorPane = this.host.getChartLayout()?.indicatorPanes.some((pane) => pane.index === this.paneIndex) ?? false
    return isIndicatorPane ? this.host.indicatorScales.priceToCoordinate(this.paneIndex, price) : this.host.engine.priceToY(price)
  }
  coordinateToPrice(y: number): number | null {
    const isIndicatorPane = this.host.getChartLayout()?.indicatorPanes.some((pane) => pane.index === this.paneIndex) ?? false
    return isIndicatorPane ? this.host.indicatorScales.coordinateToPrice(this.paneIndex, y) : this.host.engine.yToPrice(y)
  }
  priceFormatter(): RuntimePriceFormatter { return this.host.priceFormatter(this.opts) }
  barsInLogicalRange(range: { from: number; to: number }): { barsBefore: number; barsAfter: number; from: RuntimeDatum; to: RuntimeDatum } | null {
    const from = Math.max(0, Math.floor(range.from)), to = Math.min(this.values.length - 1, Math.ceil(range.to))
    return to < from ? null : { barsBefore: from, barsAfter: this.values.length - to - 1, from: this.values[from], to: this.values[to] }
  }
  subscribeDataChanged(handler: Handler<'full' | 'update'>): void {
    const handlers = this.host.dataHandlers.get(this) ?? new Set<Handler<'full' | 'update'>>()
    handlers.add(handler)
    this.host.dataHandlers.set(this, handlers)
  }
  unsubscribeDataChanged(handler: Handler<'full' | 'update'>): void { this.host.dataHandlers.get(this)?.delete(handler) }
  createPriceLine(lineOptions: Record<string, unknown>): RuntimePriceLine {
    const line = { price: numberOption(lineOptions.price, 0), options: { ...lineOptions } }
    this.lines.add(line)
    this.host.priceLines.add(line)
    this.host.schedule()
    return line
  }
  removePriceLine(line: RuntimePriceLine): void {
    this.lines.delete(line)
    this.host.priceLines.delete(line)
    this.host.schedule()
  }
  syncEngine(): void { this.host.rebuildEngine() }
  setMarkers(markers: readonly RuntimeMarker[]): void {
    this.markers.splice(0, this.markers.length, ...markers)
    this.host.schedule()
  }
}
