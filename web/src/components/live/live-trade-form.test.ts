import { describe, expect, it } from 'vitest'
import { buildTradeFromForm } from './live-trade-form'

describe('buildTradeFromForm', () => {
  it('computes long PnL = (exit - entry) * qty', () => {
    const t = buildTradeFromForm({ symbol: 'abc', side: 'long', qty: '2', entryPrice: '10', exitPrice: '11' })
    expect(t.realizedCents).toBe(200)
    expect(t.symbol).toBe('ABC')
  })
  it('computes short PnL negated', () => {
    const t = buildTradeFromForm({ symbol: 'abc', side: 'short', qty: '1', entryPrice: '11', exitPrice: '10' })
    expect(t.realizedCents).toBe(100)
  })
})