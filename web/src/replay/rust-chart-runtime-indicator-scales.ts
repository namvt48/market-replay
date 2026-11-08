import type { RustChartLayout } from './rust-chart-painter'
import {
  createRustIndicatorScale,
  rustIndicatorPaneRange,
  type RustIndicatorRange,
  type RustIndicatorScale,
  type RustIndicatorScaleMode,
  type RustIndicatorSeries,
} from './rust-chart-indicator-painter'

export interface IndicatorPriceScaleOptions {
  autoScale: boolean
  invertScale: boolean
  mode: RustIndicatorScaleMode
}

interface IndicatorScaleHost {
  engineTimeToX(timestamp: number): number | null
  flushEngine(): void
  getIndicatorPaneSeries(): readonly RustIndicatorSeries[]
  getLayout(): RustChartLayout | null
  getUsedPaneIndices(): readonly number[]
  schedule(): void
}

function timestamp(time: RustIndicatorSeries['data'][number]['time']): number {
  if (typeof time === 'number') return time
  if (typeof time === 'string') return Math.floor(Date.parse(time) / 1000)
  return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000)
}

export class RustIndicatorPaneScales {
  private readonly manualRanges = new Map<number, RustIndicatorRange>()
  private readonly priceScaleOptions = new Map<number, IndicatorPriceScaleOptions>()

  private readonly host: IndicatorScaleHost
  constructor(host: IndicatorScaleHost) { this.host = host }

  options(paneIndex: number): IndicatorPriceScaleOptions {
    return this.priceScaleOptions.get(paneIndex) ?? { autoScale: true, invertScale: false, mode: 0 }
  }

  manualRangesView(): ReadonlyMap<number, RustIndicatorRange> {
    return this.manualRanges
  }

  private scaleBase(paneIndex: number): number | null {
    const layout = this.host.getLayout()
    if (!layout) return null
    let earliestX = Infinity
    let base: number | null = null
    for (const item of this.host.getIndicatorPaneSeries()) {
      if (item.paneIndex !== paneIndex) continue
      for (const datum of item.data) {
        const value = datum.value ?? datum.close
        const x = value === undefined ? null : this.host.engineTimeToX(timestamp(datum.time))
        if (value === undefined || !Number.isFinite(value) || x === null || x < 0 || x > layout.plotWidth || x >= earliestX) continue
        earliestX = x
        base = value
      }
    }
    return base === null || base === 0 ? null : base
  }

  scale(paneIndex: number): RustIndicatorScale {
    return createRustIndicatorScale(this.options(paneIndex).mode, this.scaleBase(paneIndex))
  }

  range(paneIndex: number): RustIndicatorRange | null {
    const manual = this.manualRanges.get(paneIndex)
    if (manual) return manual
    const layout = this.host.getLayout()
    if (!layout) return null
    this.host.flushEngine()
    return rustIndicatorPaneRange(
      paneIndex,
      this.host.getIndicatorPaneSeries(),
      this.host.engineTimeToX,
      layout.plotWidth,
    )
  }

  private scaledRange(paneIndex: number, scale: RustIndicatorScale): RustIndicatorRange | null {
    const manual = this.manualRanges.get(paneIndex)
    if (manual) {
      const from = scale.toScale(manual.min)
      const to = scale.toScale(manual.max)
      if (from === null || to === null || !Number.isFinite(from) || !Number.isFinite(to) || from === to) return null
      return { min: Math.min(from, to), max: Math.max(from, to) }
    }
    const layout = this.host.getLayout()
    if (!layout) return null
    this.host.flushEngine()
    return rustIndicatorPaneRange(
      paneIndex,
      this.host.getIndicatorPaneSeries(),
      this.host.engineTimeToX,
      layout.plotWidth,
      scale.toScale,
    )
  }

  priceToCoordinate(paneIndex: number, price: number): number | null {
    const pane = this.host.getLayout()?.indicatorPanes.find((item) => item.index === paneIndex)
    const scale = this.scale(paneIndex)
    const range = this.scaledRange(paneIndex, scale)
    const scaledPrice = scale.toScale(price)
    if (!pane || !range || scaledPrice === null || !Number.isFinite(scaledPrice) || range.max <= range.min) return null
    const fraction = this.options(paneIndex).invertScale
      ? (scaledPrice - range.min) / (range.max - range.min)
      : (range.max - scaledPrice) / (range.max - range.min)
    return fraction * pane.height
  }

  coordinateToPrice(paneIndex: number, y: number): number | null {
    const pane = this.host.getLayout()?.indicatorPanes.find((item) => item.index === paneIndex)
    const scale = this.scale(paneIndex)
    const range = this.scaledRange(paneIndex, scale)
    if (!pane || !range || !(pane.height > 0) || !Number.isFinite(y) || range.max <= range.min) return null
    const fraction = Math.max(0, Math.min(1, y / pane.height))
    const scaled = this.options(paneIndex).invertScale
      ? range.min + fraction * (range.max - range.min)
      : range.max - fraction * (range.max - range.min)
    return scale.fromScale(scaled)
  }

  setAutoScale(paneIndex: number, autoScale: boolean): void {
    const options = this.options(paneIndex)
    if (options.autoScale === autoScale) return
    if (autoScale) this.manualRanges.delete(paneIndex)
    else {
      const range = this.range(paneIndex)
      if (range) this.manualRanges.set(paneIndex, range)
    }
    this.priceScaleOptions.set(paneIndex, { ...options, autoScale })
    this.host.schedule()
  }

  priceScaleApi(paneIndex: number) {
    return {
      width: () => this.host.getLayout()?.priceAxisWidth ?? 0,
      options: () => this.options(paneIndex),
      applyOptions: (next: Record<string, unknown>) => {
        if (typeof next.autoScale === 'boolean') this.setAutoScale(paneIndex, next.autoScale)
        const current = this.options(paneIndex)
        const mode = next.mode
        this.priceScaleOptions.set(paneIndex, { ...current,
          ...(typeof next.invertScale === 'boolean' ? { invertScale: next.invertScale } : {}),
          ...(mode === 0 || mode === 1 || mode === 2 ? { mode } : {}) })
        this.host.schedule()
      },
      setVisibleRange: (range: { from: number; to: number }) => {
        if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from >= range.to) return
        this.manualRanges.set(paneIndex, { min: range.from, max: range.to })
        this.priceScaleOptions.set(paneIndex, { ...this.options(paneIndex), autoScale: false })
        this.host.schedule()
      },
      getVisibleRange: () => {
        const range = this.range(paneIndex)
        return range ? { from: range.min, to: range.max } : null
      },
      setAutoScale: (on: boolean) => this.setAutoScale(paneIndex, on),
    }
  }

  zoom(paneIndex: number, factor: number, y: number): void {
    const layout = this.host.getLayout()
    const pane = layout?.indicatorPanes.find((item) => item.index === paneIndex)
    const scale = this.scale(paneIndex)
    const range = this.scaledRange(paneIndex, scale)
    if (!pane || !range || !Number.isFinite(factor) || factor <= 0) return
    const fraction = Math.max(0, Math.min(1, (y - pane.top) / pane.height))
    const inverted = this.options(paneIndex).invertScale
    const anchorFraction = inverted ? fraction : 1 - fraction
    const anchor = range.min + (range.max - range.min) * anchorFraction
    const span = (range.max - range.min) * factor
    const min = scale.fromScale(anchor - anchorFraction * span)
    const max = scale.fromScale(anchor + (1 - anchorFraction) * span)
    if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max) || min === max) return
    this.manualRanges.set(paneIndex, { min: Math.min(min, max), max: Math.max(min, max) })
    this.priceScaleOptions.set(paneIndex, { ...this.options(paneIndex), autoScale: false })
    this.host.schedule()
  }

  reset(paneIndex: number): void {
    this.manualRanges.delete(paneIndex)
    this.priceScaleOptions.set(paneIndex, { ...this.options(paneIndex), autoScale: true })
    this.host.schedule()
  }

  prune(): void {
    const usedPanes = new Set(this.host.getUsedPaneIndices())
    for (const paneIndex of this.manualRanges.keys()) {
      if (!usedPanes.has(paneIndex)) this.manualRanges.delete(paneIndex)
    }
    for (const paneIndex of this.priceScaleOptions.keys()) {
      if (!usedPanes.has(paneIndex)) this.priceScaleOptions.delete(paneIndex)
    }
  }
}
