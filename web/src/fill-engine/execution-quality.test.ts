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

  it('restores recorded commission before stress costs and classifies each trade independently', () => {
    const trades = [
      engineTrade({ id: 'long', side: 'long', qty: 1, rMultiple: 0.8, feesCents: 200, initialStopTicks: 980, entryPriceTicks: 1000 }),
      engineTrade({ id: 'short', side: 'short', qty: 1, rMultiple: 0.05, feesCents: 0, initialStopTicks: 1020, entryPriceTicks: 1000 }),
      engineTrade({ id: 'zero-fee', side: 'long', qty: 1, rMultiple: -0.1, feesCents: 0, initialStopTicks: 900, entryPriceTicks: 1000 }),
    ]
    const result = analyzeExecutionQuality(trades, { tickValueCents: 100, spreadTicks: 0, slippageTicks: 0 })
    expect(result.grossExpectancyR).toBeCloseTo((0.9 + 0.05 - 0.1) / 3)
    expect(result.averageCostR).toBeCloseTo(0.1 / 3)
    expect(result.netExpectancyR).toBeCloseTo((0.8 + 0.05 - 0.1) / 3)
    expect(result.netWinRate).toBeCloseTo(2 / 3)
    expect(result.grossExpectancyR - result.averageCostR).toBeCloseTo(result.netExpectancyR)
  })

  it('uses individual additional round-trip stress cost rather than average cost to determine net wins', () => {
    const trades = [
      engineTrade({ id: 'low-risk', rMultiple: 0.5, initialStopTicks: 999, entryPriceTicks: 1000, feesCents: 0 }),
      engineTrade({ id: 'high-risk', rMultiple: 0.2, initialStopTicks: 900, entryPriceTicks: 1000, feesCents: 0 }),
    ]
    const result = analyzeExecutionQuality(trades, { tickValueCents: 100, spreadTicks: 1, slippageTicks: 0 })
    expect(result.netWinRate).toBe(0.5)
  })
})
