import { describe, expect, it } from 'vitest'
import { calculateEdgeStats } from './edge-stat'

describe('calculateEdgeStats', () => {
  it('enforces the minimum sample guardrail', () => {
    expect(calculateEdgeStats(Array.from({ length: 49 }, () => 1)).verdict).toBe('insufficient')
  })

  it('distinguishes supported edge, no evidence, and payoff-implied zero edge', () => {
    const supported = calculateEdgeStats([...Array.from({ length: 60 }, () => 2), ...Array.from({ length: 40 }, () => -1)])
    const balanced = calculateEdgeStats([...Array.from({ length: 50 }, () => 1), ...Array.from({ length: 50 }, () => -1)])
    const belowBreakeven = calculateEdgeStats(Array.from({ length: 60 }, (_, index) => index % 2 === 0 ? 1 : 2), { winRate: 0.2, avgWinR: 1, avgLossR: 1 })
    expect(supported.verdict).toBe('edge')
    expect(supported.pValue).toBeLessThan(0.05)
    expect(balanced.verdict).toBe('no-evidence')
    expect(belowBreakeven.verdict).toBe('zero-edge')
  })

  it('does not treat zero outcomes as losses and uses unconditional rates for breakeven', () => {
    const result = calculateEdgeStats([...Array.from({ length: 60 }, () => 1), ...Array.from({ length: 20 }, () => -1), ...Array.from({ length: 120 }, () => 0)])
    expect(result.winRate).toBe(0.3)
    expect(result.lossRate).toBe(0.1)
    expect(result.breakevenRate).toBeCloseTo(0.2)
    expect(result.verdict).toBe('edge')
    expect(result.pValue).toBeLessThan(0.05)
  })

  it('does not claim statistical proof from a degenerate sample', () => {
    const result = calculateEdgeStats(Array.from({ length: 60 }, () => 1))
    expect(result.tStat).toBeNull()
    expect(result.pValue).toBeNull()
    expect(result.verdict).toBe('no-evidence')
  })

  it('keeps payoff undefined without losses and defines the all-loss breakeven boundary', () => {
    const winners = calculateEdgeStats(Array.from({ length: 60 }, () => 1))
    const losers = calculateEdgeStats(Array.from({ length: 60 }, () => -1))
    expect(winners.avgRR).toBeNull()
    expect(winners.breakevenRate).toBeNull()
    expect(losers.avgRR).toBe(0)
    expect(losers.breakevenRate).toBe(1)
    expect(losers.verdict).toBe('no-evidence')
  })
})
