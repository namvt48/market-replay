import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BarFrame } from '../api/binary-frame'
import type { Bar1m } from '../fill-engine/types'
import { BoundedBarCache, frameBars, HttpViewportDataClient } from './viewport-data'

function bar1m(ts: number): Bar1m {
  return { ts, openTicks: ts + 1, highTicks: ts + 2, lowTicks: ts, closeTicks: ts + 1, volume: 10 }
}

const apiMocks = vi.hoisted(() => ({ fetchChartBarsAt: vi.fn() }))

vi.mock('../api/client', () => ({ fetchChartBarsAt: apiMocks.fetchChartBarsAt }))

function frame(times: number[]): BarFrame {
  return {
    count: times.length,
    tickNum: 1,
    tickDen: 4,
    ts: new Uint32Array(times),
    open: new Int32Array(times.map((time) => time + 1)),
    high: new Int32Array(times.map((time) => time + 2)),
    low: new Int32Array(times),
    close: new Int32Array(times.map((time) => time + 1)),
    volume: new Uint32Array(times.map(() => 10)),
  }
}

describe('BoundedBarCache', () => {
  beforeEach(() => apiMocks.fetchChartBarsAt.mockReset())

  it('deduplicates overlapping pages and never exceeds its memory budget', () => {
    const cache = new BoundedBarCache(5)
    cache.reset(frame([120, 180, 240]))
    cache.merge(frame([0, 60, 120, 180]), 'before', 120, 240)
    expect(cache.count).toBe(5)
    expect(cache.values().map((bar) => bar.ts)).toEqual([0, 60, 120, 180, 240])
    expect(cache.estimatedPayloadBytes).toBe(120)
  })

  it('shifts its bounded window in the requested direction', () => {
    const cache = new BoundedBarCache(4)
    cache.reset(frame([120, 180, 240, 300]))
    cache.merge(frame([0, 60, 120]), 'before', 120, 300)
    expect(cache.values().map((bar) => bar.ts)).toEqual([60, 120, 180, 240])
    cache.merge(frame([240, 300, 360, 420]), 'after', 240, 420)
    expect(cache.values().map((bar) => bar.ts)).toEqual([120, 180, 240, 300])
  })

  it('filters future bars at the replay cursor', () => {
    expect(frameBars(frame([60, 120, 180]), 0, 120).map((bar) => bar.ts)).toEqual([60, 120])
  })

  it('append() settles back to maxBars after overshooting by the trim slack', () => {
    const cache = new BoundedBarCache(5)
    for (let ts = 0; ts <= 600; ts += 60) cache.append(bar1m(ts))
    expect(cache.count).toBeLessThanOrEqual(6) // maxBars(5) + slack(1) ceiling
    expect(cache.values().map((bar) => bar.ts)).toEqual([360, 420, 480, 540, 600])
  })

  it('append() updates the tail bar in place instead of duplicating it', () => {
    const cache = new BoundedBarCache(5)
    cache.append(bar1m(0))
    cache.append(bar1m(60))
    cache.append({ ...bar1m(60), closeTicks: 999 })
    expect(cache.count).toBe(2)
    expect(cache.values().at(-1)?.closeTicks).toBe(999)
  })

  it('append() still sorts a genuinely out-of-order bar in (defensive fallback)', () => {
    const cache = new BoundedBarCache(5)
    cache.append(bar1m(60))
    cache.append(bar1m(120))
    cache.append(bar1m(0)) // arrives after 60/120 despite an earlier ts
    expect(cache.values().map((bar) => bar.ts)).toEqual([0, 60, 120])
  })

  it('loads one bounded display-timeframe page and converts ticks once', async () => {
    apiMocks.fetchChartBarsAt.mockResolvedValue([
      { time: 120, openTicks: 400, highTicks: 404, lowTicks: 396, closeTicks: 402, volume: 10 },
    ])
    const signal = new AbortController().signal
    const page = await new HttpViewportDataClient().load({
      symbol: 'NQ', visibleTimeframe: '1d', direction: 'before', anchorTs: 180,
      pageBars: 240, maxTs: 180, tickSize: 0.25,
    }, signal)

    expect(apiMocks.fetchChartBarsAt).toHaveBeenCalledWith('NQ', '1d', 180, 240, 0, 180, signal)
    expect(page.bars).toEqual([{ time: 120, open: 100, high: 101, low: 99, close: 100.5, volume: 10 }])
    expect(page.hasMore).toBe(false)
  })
})
