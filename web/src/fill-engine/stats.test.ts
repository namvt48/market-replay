import { describe, expect, it } from 'vitest'
import type { EngineTrade } from './types'
import { calculateTradeStats } from './stats'

function trade(realizedCents: number): EngineTrade {
  return {
    id: String(realizedCents), symbol: 'NQ', side: 'long', qty: 1, entryTs: 0, entryPriceTicks: 0,
    exitTs: 1, exitPriceTicks: 0, realizedCents, feesCents: 0, mfeTicks: 0, maeTicks: 0,
    rMultiple: null, initialStopTicks: null, initialTakeProfitTicks: null, protectionAdjustments: [], exitReason: 'manual',
  }
}

describe('calculateTradeStats', () => {
  it('preserves fractional-cent mean expectancy', () => {
    const stats = calculateTradeStats([trade(1), trade(0)])
    expect(stats.expectancyCents).toBe(0.5)
  })
})
