import { describe, expect, it } from 'vitest'
import { calculateEdgeStats } from './edge-stat'
import { calculateKellySizing } from './kelly'

describe('calculateKellySizing', () => {
  it('withholds sizing until evidence passes', () => {
    const insufficient = calculateEdgeStats(Array.from({ length: 20 }, () => 1))
    expect(calculateKellySizing(insufficient)).toBeNull()
  })

  it('returns fractional Kelly within the product risk cap', () => {
    const edge = calculateEdgeStats([...Array.from({ length: 70 }, () => 2), ...Array.from({ length: 30 }, () => -1)])
    const sizing = calculateKellySizing(edge, { fraction: 0.25, maxRiskPerTrade: 0.02 })
    expect(sizing).not.toBeNull()
    expect(sizing?.suggestedRiskPerTrade).toBeLessThanOrEqual(0.02)
    expect(sizing?.fraction).toBe(0.25)
  })
})
