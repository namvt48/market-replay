import { describe, expect, it } from 'vitest'
import { engineTrade } from './decision-intelligence-fixtures'
import { analyzeExecutionQuality } from './execution-quality'

describe('analyzeExecutionQuality', () => {
  it('normalizes excursions and subtracts modeled costs from expectancy', () => {
    const trades = [
      engineTrade({ id: 'winner', rMultiple: 1, mfeTicks: 40, realizedCents: 10_000 }),
      engineTrade({ id: 'loser', rMultiple: -0.5, mfeTicks: 10, realizedCents: -5_000, exitReason: 'stopLoss' }),
    ]
    const result = analyzeExecutionQuality(trades, { tickValueCents: 500, spreadTicks: 0.25, slippageTicks: 0.25 })
    expect(result.trades[0]?.mfeR).toBe(2)
    expect(result.netExpectancyR).toBeLessThan(result.grossExpectancyR)
    expect(result.exitReasonBreakdown).toEqual({ manual: 0, stopLoss: 1, takeProfit: 1 })
  })
})
