import type { BarFrame } from '../api/binary-frame'
import { fetchChartBarsAt } from '../api/client'
import type { Timeframe } from '../api/types'
import type { Bar1m } from '../fill-engine/types'
import type { DisplayBar, ViewportDirection } from './chart-adapter'

export const MAX_VIEWPORT_RAW_BARS = 6_000
export const MAX_VIEWPORT_DISPLAY_BARS = 6_000
export const VIEWPORT_PAGE_BARS = 240

export interface ViewportDataRequest {
  symbol: string
  visibleTimeframe: Timeframe
  direction: ViewportDirection
  anchorTs: number
  pageBars: number
  maxTs: number
  tickSize: number
}

export interface ViewportDataPage {
  bars: DisplayBar[]
  hasMore: boolean
}

/** Stable FE contract: the HTTP implementation can be replaced when BE adds a dedicated viewport endpoint. */
export interface ViewportDataClient {
  load(request: ViewportDataRequest, signal: AbortSignal): Promise<ViewportDataPage>
}

export class HttpViewportDataClient implements ViewportDataClient {
  async load(request: ViewportDataRequest, signal: AbortSignal): Promise<ViewportDataPage> {
    const before = request.direction === 'before' ? request.pageBars : 0
    const after = request.direction === 'after' ? request.pageBars : 0
    const ticks = await fetchChartBarsAt(
      request.symbol,
      request.visibleTimeframe,
      request.anchorTs,
      before,
      after,
      request.maxTs,
      signal,
    )
    const bars = ticks.map((bar) => ({
      time: bar.time,
      open: bar.openTicks * request.tickSize,
      high: bar.highTicks * request.tickSize,
      low: bar.lowTicks * request.tickSize,
      close: bar.closeTicks * request.tickSize,
      volume: bar.volume,
    }))
    return { bars, hasMore: bars.length >= request.pageBars }
  }
}

export function frameBars(frame: BarFrame, minTs = 0, maxTs = Number.MAX_SAFE_INTEGER): Bar1m[] {
  const bars: Bar1m[] = []
  for (let index = 0; index < frame.count; index += 1) {
    const ts = frame.ts[index]
    if (ts < minTs || ts > maxTs) continue
    bars.push({
      ts,
      openTicks: frame.open[index],
      highTicks: frame.high[index],
      lowTicks: frame.low[index],
      closeTicks: frame.close[index],
      volume: frame.volume[index],
    })
  }
  return bars
}

function mergeSorted(left: Bar1m[], right: Bar1m[]): Bar1m[] {
  const merged: Bar1m[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length || rightIndex < right.length) {
    const leftBar = left[leftIndex]
    const rightBar = right[rightIndex]
    if (!rightBar || (leftBar && leftBar.ts < rightBar.ts)) {
      merged.push(leftBar)
      leftIndex += 1
    } else if (!leftBar || rightBar.ts < leftBar.ts) {
      merged.push(rightBar)
      rightIndex += 1
    } else {
      merged.push(rightBar)
      leftIndex += 1
      rightIndex += 1
    }
  }
  return merged
}

export class BoundedBarCache {
  private bars: Bar1m[] = []
  readonly maxBars: number
  /**
   * append() only trims once the buffer overshoots maxBars by this much,
   * batching the O(n) slice instead of paying it on every single append —
   * during fast replay (500x) append() runs ~500/s, and slicing the full
   * ~6,000-bar buffer on every one of those was measurable, avoidable
   * churn for removing exactly one excess bar each time.
   */
  private readonly trimThreshold: number

  constructor(maxBars = MAX_VIEWPORT_RAW_BARS) {
    if (!Number.isInteger(maxBars) || maxBars < 1) throw new Error('BoundedBarCache maxBars must be a positive integer')
    this.maxBars = maxBars
    this.trimThreshold = maxBars + Math.max(1, Math.ceil(maxBars * 0.1))
  }

  get count(): number { return this.bars.length }
  get firstTs(): number { return this.bars[0]?.ts ?? 0 }
  get lastTs(): number { return this.bars.at(-1)?.ts ?? 0 }
  get estimatedPayloadBytes(): number { return this.bars.length * 24 }

  reset(frame: BarFrame, maxTs = Number.MAX_SAFE_INTEGER): void {
    this.bars = frameBars(frame, 0, maxTs).slice(-this.maxBars)
  }

  replace(bars: Bar1m[]): void {
    this.bars = [...bars].sort((a, b) => a.ts - b.ts).slice(-this.maxBars)
  }

  /**
   * replace() for input already ascending by ts — which is what every
   * in-engine caller has, since the bars come straight out of BarSource's
   * ts-sorted frame. Skips an O(n log n) sort (with a JS comparator call
   * per compare) of an already-sorted 6,000-bar array, paid on every seek,
   * symbol load and step-back.
   */
  replaceSorted(bars: Bar1m[]): void {
    this.bars = bars.length > this.maxBars ? bars.slice(-this.maxBars) : [...bars]
  }

  merge(frame: BarFrame, direction: ViewportDirection, focusTs: number, maxTs: number): number {
    const incoming = frameBars(frame, 0, maxTs)
    if (incoming.length === 0) return 0
    const previous = new Set(this.bars.map((bar) => bar.ts))
    const merged = mergeSorted(this.bars, incoming)
    if (merged.length <= this.maxBars) {
      this.bars = merged
    } else {
      const focusIndex = Math.max(0, merged.findIndex((bar) => bar.ts >= focusTs))
      const barsBeforeFocus = Math.floor(this.maxBars * (direction === 'before' ? 0.34 : 0.66))
      const start = Math.max(0, Math.min(merged.length - this.maxBars, focusIndex - barsBeforeFocus))
      this.bars = merged.slice(start, start + this.maxBars)
    }
    return this.bars.reduce((count, bar) => count + (previous.has(bar.ts) ? 0 : 1), 0)
  }

  append(bar: Bar1m): void {
    const last = this.bars.at(-1)
    if (last?.ts === bar.ts) this.bars[this.bars.length - 1] = bar
    else if (!last || bar.ts > last.ts) this.bars.push(bar)
    else this.bars = mergeSorted(this.bars, [bar])
    if (this.bars.length > this.trimThreshold) this.bars = this.bars.slice(-this.maxBars)
  }

  values(maxTs = Number.MAX_SAFE_INTEGER): Bar1m[] {
    if (this.lastTs <= maxTs) return [...this.bars]
    return this.bars.filter((bar) => bar.ts <= maxTs)
  }

  contains(timestamp: number): boolean { return this.firstTs <= timestamp && timestamp <= this.lastTs }
}
