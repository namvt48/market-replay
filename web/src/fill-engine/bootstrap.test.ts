import { describe, expect, it } from 'vitest'
import { bootstrapAnalytics } from './bootstrap'

describe('bootstrapAnalytics', () => {
  it('is deterministic for a fixed seed and orders every interval', () => {
    const values = [1.4, -0.8, 2.1, -1, 0.7, 1.2]
    const first = bootstrapAnalytics(values, { iterations: 400, seed: 42, confidence: 0.9 })
    const second = bootstrapAnalytics(values, { iterations: 400, seed: 42, confidence: 0.9 })
    expect(first).toEqual(second)
    for (const interval of [first.expectancy, first.maxDrawdown, first.sharpe]) {
      expect(interval.lower).toBeLessThanOrEqual(interval.median)
      expect(interval.median).toBeLessThanOrEqual(interval.upper)
    }
  })

  it('returns a stable zero result for an empty sample', () => {
    expect(bootstrapAnalytics([], { iterations: 100 }).expectancy).toEqual({ lower: 0, median: 0, upper: 0 })
  })
})
