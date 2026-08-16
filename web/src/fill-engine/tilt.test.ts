import { describe, expect, it } from 'vitest'
import { engineTrade } from './decision-intelligence-fixtures'
import { analyzeTilt } from './tilt'

describe('analyzeTilt', () => {
  it('detects size escalation and rapid re-entry after losses', () => {
    const start = 1_700_000_000
    const trades = [
      engineTrade({ id: 'loss-1', entryTs: start, exitTs: start + 600, realizedCents: -10_000, qty: 1 }),
      engineTrade({ id: 'loss-2', entryTs: start + 900, exitTs: start + 1_500, realizedCents: -10_000, qty: 1 }),
      engineTrade({ id: 'chase', entryTs: start + 1_800, exitTs: start + 2_400, realizedCents: 5_000, qty: 4 }),
    ]
    const result = analyzeTilt(trades)
    expect(result.postLossSizeEscalations).toBe(1)
    expect(result.rapidReentriesAfterLoss).toBe(2)
    expect(result.tiltScore).toBeGreaterThan(0)
  })
})
