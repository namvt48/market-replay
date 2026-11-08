import type { RustChartEngine } from './rust-chart-engine'
import type { RuntimePriceScaleApi } from './rust-chart-runtime-types'

export interface RustRuntimePriceScaleHost {
  readonly engine: RustChartEngine
  getChartLayout(): { priceAxisWidth: number } | null
  getOptions(): Record<string, unknown>
  setOptions(options: Record<string, unknown>): void
  getManualRange(): { min: number; max: number } | null
  setManualRange(range: { min: number; max: number } | null): void
  invalidateEffectiveRange(): void
  applyEffectivePriceRange(): void
  schedule(): void
}

export function createRustRuntimePriceScale(host: RustRuntimePriceScaleHost): RuntimePriceScaleApi {
  const setAutoScale = (on: boolean): void => {
    const options = host.getOptions()
    if (on === (options.autoScale === true)) return
    if (on) host.setManualRange(null)
    else {
      const range = host.engine.priceRange()
      if (range) host.setManualRange({ min: range.min, max: range.max })
    }
    host.setOptions({ ...options, autoScale: on })
    host.invalidateEffectiveRange()
    host.applyEffectivePriceRange()
    host.schedule()
  }
  return {
    width: () => host.getChartLayout()?.priceAxisWidth ?? 0,
    options: () => host.getOptions(),
    applyOptions: (next: Record<string, unknown>) => {
      if (typeof next.autoScale === 'boolean') setAutoScale(next.autoScale)
      const current = host.getOptions()
      const previousMode = current.mode
      if (typeof next.mode === 'number' && next.mode !== previousMode && (next.mode === 2 || next.mode === 3)) setAutoScale(true)
      const options = { ...host.getOptions(), ...next }
      host.setOptions(options)
      const mode = options.mode === 1 ? 'logarithmic' : options.mode === 2 ? 'percentage' : 'normal'
      host.engine.setPriceScaleMode(mode)
      host.engine.setInvertedScale(options.invertScale === true)
      host.invalidateEffectiveRange()
      host.applyEffectivePriceRange()
      host.schedule()
    },
    setVisibleRange: (range: { from: number; to: number }) => {
      if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from >= range.to) return
      host.setManualRange({ min: range.from, max: range.to })
      host.setOptions({ ...host.getOptions(), autoScale: false })
      host.invalidateEffectiveRange()
      host.applyEffectivePriceRange()
      host.schedule()
    },
    getVisibleRange: () => {
      const range = host.engine.priceRange()
      return range ? { from: range.min, to: range.max } : null
    },
    setAutoScale,
  }
}
