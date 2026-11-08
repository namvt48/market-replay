import type { LogicalRange, Time } from 'lightweight-charts'
import type { RustChartEngine } from './rust-chart-engine'
import { isSpacer } from './rust-chart-runtime-bars'
import type { RuntimeSeries } from './rust-chart-runtime-series'
import { asTime, stamp, toLogicalRange, type Handler, type NumericLogicalRange } from './rust-chart-runtime-types'

export interface RustRuntimeTimeScaleHost {
  readonly engine: RustChartEngine
  readonly logicalHandlers: Set<Handler<LogicalRange | null>>
  readonly timeHandlers: Set<Handler<{ from: Time; to: Time } | null>>
  getChartLayout(): { plotWidth: number } | null
  getOptions(): Record<string, unknown>
  updateTimeScaleOptions(next: Record<string, unknown>): void
  setSecondsVisible(value: boolean): void
  series(): Iterable<RuntimeSeries>
  getManualVisibleRange(): NumericLogicalRange | null
  setManualVisibleRange(range: NumericLogicalRange | null): void
  isFollowingRange(range: NumericLogicalRange | null): boolean
  flushEngine(): void
  schedule(): void
  emitRanges(): void
}

export function createRustRuntimeTimeScale(host: RustRuntimeTimeScaleHost) {
  const { engine } = host
  const setVisibleLogicalRange = (range: LogicalRange): void => {
    host.flushEngine()
    if (engine.setVisibleRange(range.from, range.to)) {
      const visible = engine.visibleRange()
      host.setManualVisibleRange(host.isFollowingRange(visible) ? null : visible)
      host.emitRanges()
      host.schedule()
    }
  }
  const fitContent = (): void => {
    host.flushEngine()
    const count = engine.barCount()
    if (count) {
      host.setManualVisibleRange(null)
      engine.setVisibleRange(0, count - 1)
      host.emitRanges()
      host.schedule()
    }
  }
  return {
    width: () => host.getChartLayout()?.plotWidth ?? 0,
    height: () => (host.getChartLayout() as { priceHeight?: number } | null)?.priceHeight ?? 0,
    options: () => (host.getOptions().timeScale ?? {}) as never,
    applyOptions: (next: Record<string, unknown>) => {
      host.updateTimeScaleOptions(next)
      if (typeof next.barSpacing === 'number') engine.setBarSpacing(next.barSpacing)
      if (typeof next.rightOffset === 'number') engine.setRightOffset(next.rightOffset)
      if (typeof next.secondsVisible === 'boolean') host.setSecondsVisible(next.secondsVisible)
      host.schedule()
    },
    getVisibleLogicalRange: () => { host.flushEngine(); return toLogicalRange(engine.visibleRange()) },
    setVisibleLogicalRange,
    getVisibleRange: () => {
      host.flushEngine()
      const range = engine.visibleRange()
      const from = range && engine.logicalToTime(range.from)
      const to = range && engine.logicalToTime(range.to)
      return from == null || to == null ? null : { from: asTime(from), to: asTime(to) }
    },
    setVisibleRange: (range: { from: Time; to: Time }) => {
      host.flushEngine()
      const from = engine.timeToLogical(stamp(range.from))
      const to = engine.timeToLogical(stamp(range.to))
      if (from != null && to != null) {
        const logicalRange = toLogicalRange({ from, to })
        if (logicalRange) setVisibleLogicalRange(logicalRange)
      }
    },
    timeToIndex: (time: Time, findNearest = false) => {
      host.flushEngine()
      const target = stamp(time)
      const exact = engine.timeToLogical(target)
      if (exact != null || !findNearest) return exact ?? null
      const active = [...host.series()].find((item) => (item.kind === 'candle' || item.kind === 'line') && !isSpacer(item) && item.opts.visible !== false)
      if (!active || active.values.length === 0) return null
      let lo = 0
      let hi = active.values.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (stamp(active.values[mid].time) < target) lo = mid + 1
        else hi = mid
      }
      const after = lo
      const before = Math.max(0, after - 1)
      const nearest = Math.abs(stamp(active.values[after].time) - target) < Math.abs(stamp(active.values[before].time) - target) ? after : before
      return engine.timeToLogical(stamp(active.values[nearest].time)) ?? null
    },
    timeToCoordinate: (time: Time) => { host.flushEngine(); return engine.timeToX(stamp(time)) ?? null },
    coordinateToTime: (x: number) => { host.flushEngine(); const value = engine.xToTime(x); return value == null ? null : asTime(value) },
    timeToLogical: (time: Time) => { host.flushEngine(); return engine.timeToLogical(stamp(time)) ?? null },
    coordinateToLogical: (x: number) => { host.flushEngine(); return engine.xToLogical(x) ?? null },
    logicalToCoordinate: (index: number) => { host.flushEngine(); return engine.logicalToX(index) ?? null },
    subscribeVisibleLogicalRangeChange: (handler: Handler<LogicalRange | null>) => host.logicalHandlers.add(handler),
    unsubscribeVisibleLogicalRangeChange: (handler: Handler<LogicalRange | null>) => host.logicalHandlers.delete(handler),
    subscribeVisibleTimeRangeChange: (handler: Handler<{ from: Time; to: Time } | null>) => host.timeHandlers.add(handler),
    unsubscribeVisibleTimeRangeChange: (handler: Handler<{ from: Time; to: Time } | null>) => host.timeHandlers.delete(handler),
    scrollToPosition: (position: number) => {
      host.flushEngine(); engine.setRightOffset(position)
      const visible = engine.visibleRange()
      host.setManualVisibleRange(host.isFollowingRange(visible) ? null : visible)
      host.emitRanges(); host.schedule()
    },
    scrollToRealTime: () => { host.flushEngine(); host.setManualVisibleRange(null); engine.setRightOffset(12); host.emitRanges(); host.schedule() },
    fitContent,
    resetTimeScale: fitContent,
    getScrollPosition: () => { host.flushEngine(); const range = engine.visibleRange(); return range ? engine.barCount() - 1 - range.to : 0 },
  }
}
