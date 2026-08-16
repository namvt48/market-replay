import { describe, expect, it } from 'vitest'
import { calculateEdgeStats } from './edge-stat'

describe('calculateEdgeStats', () => {
  it('enforces the minimum sample guardrail', () => {
    expect(calculateEdgeStats(Array.from({ length: 49 }, () => 1)).verdict).toBe('insufficient')
  })

  it('distinguishes supported edge, no evidence, and payoff-implied zero edge', () => {
    const supported = calculateEdgeStats([...Array.from({ length: 60 }, () => 2), ...Array.from({ length: 40 }, () => -1)])
    const balanced = calculateEdgeStats([...Array.from({ length: 50 }, () => 1), ...Array.from({ length: 50 }, () => -1)])
    const belowBreakeven = calculateEdgeStats(Array.from({ length: 60 }, () => 1), { winRate: 0.2, avgWinR: 1, avgLossR: 1 })
    expect(supported.verdict).toBe('edge')
    expect(supported.pValue).toBeLessThan(0.05)
    expect(balanced.verdict).toBe('no-evidence')
    expect(belowBreakeven.verdict).toBe('zero-edge')
  })

  it('handles a zero standard deviation without NaN', () => {
    const result = calculateEdgeStats(Array.from({ length: 60 }, () => 1))
    expect(result.tStat).toBe(Number.POSITIVE_INFINITY)
    expect(result.pValue).toBe(0)
  })
})
