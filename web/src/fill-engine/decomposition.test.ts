import { describe, expect, it } from 'vitest'
import { decomposeEdge } from './decomposition'
import { engineTrade } from './decision-intelligence-fixtures'

describe('decomposeEdge', () => {
  it('detects an exit leak and concentrated winners', () => {
    const trades = Array.from({ length: 10 }, (_, index) => engineTrade({
      id: `trade-${index}`, rMultiple: index < 5 ? 1 : -0.5,
      realizedCents: index < 5 ? 10_000 : -5_000, mfeTicks: 60, maeTicks: 5,
    }))
    const result = decomposeEdge(trades)
    expect(result.timingFlag).toBe('exit-leak')
    expect(result.topNConcentrationPct).toBe(100)
    expect(result.concentrationFlag).toBe('concentrated')
  })
})
