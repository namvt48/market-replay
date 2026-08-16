import { describe, expect, it } from 'vitest'
import { analyzeDecisionQuality } from './decision-quality'
import { engineTrade } from './decision-intelligence-fixtures'

describe('analyzeDecisionQuality', () => {
  it('separates process quality from outcome and estimates the rule dividend', () => {
    const result = analyzeDecisionQuality([
      engineTrade({ id: 'good-win', realizedCents: 10_000, rMultiple: 1 }),
      engineTrade({ id: 'good-loss', realizedCents: -10_000, rMultiple: -1, exitReason: 'stopLoss' }),
      engineTrade({ id: 'bad-loss', realizedCents: -15_000, rMultiple: -1.5, protectionAdjustments: [{ role: 'stopLoss', ts: 2, priceTicks: 970 }], exitReason: 'stopLoss' }),
    ])
    expect(result.matrix).toEqual({ goodWin: 1, goodLoss: 1, badWin: 0, badLoss: 1 })
    expect(result.ruleFollowingDividendR).toBeGreaterThan(0)
    expect(result.planAdherenceScore).toBeLessThan(100)
  })
})
