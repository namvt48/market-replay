import { describe, expect, it } from 'vitest'
import { buildTradeFromForm } from './live-trade-form'

describe('buildTradeFromForm', () => {
  it('computes long PnL = (exit - entry) * qty', () => {
    const t = buildTradeFromForm({ symbol: 'abc', side: 'long', qty: '2', entryPrice: '10', exitPrice: '11', stopLoss: '', takeProfit: '', entryTime: '', exitTime: '' })
    expect(t.realizedCents).toBe(200)
    expect(t.symbol).toBe('ABC')
  })
  it('computes short PnL negated', () => {
    const t = buildTradeFromForm({ symbol: 'abc', side: 'short', qty: '1', entryPrice: '11', exitPrice: '10', stopLoss: '', takeProfit: '', entryTime: '', exitTime: '' })
    expect(t.realizedCents).toBe(100)
  })
  it('keeps risk prices and execution times in the closed trade', () => {
    const t = buildTradeFromForm({ symbol: 'es', side: 'long', qty: '1', entryPrice: '100', exitPrice: '101', stopLoss: '99', takeProfit: '103', entryTime: '2026-09-02T09:30', exitTime: '2026-09-02T10:15' })
    expect(t.initialStopTicks).toBe(9900)
    expect(t.initialTakeProfitTicks).toBe(10300)
    expect(t.entryTs).toBe(Date.parse('2026-09-02T09:30'))
    expect(t.exitTs).toBe(Date.parse('2026-09-02T10:15'))
  })
})
