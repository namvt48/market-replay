import { describe, expect, it } from 'vitest'
import { bootstrapAnalytics } from './bootstrap'

describe('bootstrapAnalytics', () => {
  it('is deterministic for a fixed seed and orders every interval', () => {
    const values = [1.4, -0.8, 2.1, -1, 0.7, 1.2]
    const first = bootstrapAnalytics(values, { iterations: 400, seed: 42, confidence: 0.9 })
    const second = bootstrapAnalytics(values, { iterations: 400, seed: 42, confidence: 0.9 })
    expect(first).toEqual(second)
    for (const interval of [first.expectancy, first.maxDrawdown, first.tradeRSharpe]) {
      if (interval === null) continue
      expect(interval.lower).toBeLessThanOrEqual(interval.median)
      expect(interval.median).toBeLessThanOrEqual(interval.upper)
    }
  })

  it('returns a stable zero result for an empty sample', () => {
    expect(bootstrapAnalytics([], { iterations: 100 }).tradeRSharpe).toBeNull()
  })

  it('uses unannualized trade-R Sharpe and leaves constant-return Sharpe undefined', () => {
    const result = bootstrapAnalytics([1, 2], { iterations: 100, seed: 42 })
    expect(result.tradeRSharpe?.median).toBeCloseTo(1.5 / Math.sqrt(0.5))
    expect(bootstrapAnalytics([1, 1], { iterations: 100, seed: 42 }).tradeRSharpe).toBeNull()
  })
})
