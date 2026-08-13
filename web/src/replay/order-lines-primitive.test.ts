import { describe, expect, it } from 'vitest'
import type { OrderLine } from './chart-adapter'
import { draftOrderControls, draftOrderRangePairs } from './order-lines-primitive'

const line = (patch: Partial<OrderLine>): OrderLine => ({
  id: 'ticket-entry', price: 100, label: 'Buy Limit', color: '#2962ff', kind: 'limit', editable: true,
  role: 'entry', stage: 'draft', qty: 1, priceLabel: '100.00', ...patch,
})

describe('order range overlay', () => {
  it('uses the compact Buy/Sell, TP, SL control sequence from the original ticket', () => {
    expect(draftOrderControls(line({ side: 'buy', protectionEnabled: { takeProfit: false, stopLoss: false } }))).toEqual([
      { label: 'Buy', type: 'confirm', width: 38, active: true, color: '#2962ff' },
      { label: 'TP', type: 'toggle-take-profit', width: 34, active: false, color: '#089981' },
      { label: 'SL', type: 'toggle-stop-loss', width: 34, active: false, color: '#ff9800' },
    ])
    expect(draftOrderControls(line({ side: 'sell' }))[0]).toEqual({
      label: 'Sell', type: 'confirm', width: 38, active: true, color: '#f23645',
    })
  })

  it('pairs draft TP and SL with entry using their semantic translucent colors', () => {
    expect(draftOrderRangePairs([
      line({}),
      line({ id: 'ticket-take-profit', role: 'takeProfit', kind: 'takeProfit', price: 120, color: '#089981' }),
      line({ id: 'ticket-stop-loss', role: 'stopLoss', kind: 'stopLoss', price: 90, color: '#ff9800' }),
    ])).toEqual([
      { role: 'takeProfit', entryPrice: 100, legPrice: 120, fill: 'rgba(8, 153, 129, 0.10)' },
      { role: 'stopLoss', entryPrice: 100, legPrice: 90, fill: 'rgba(255, 152, 0, 0.09)' },
    ])
  })

  it('does not shade confirmed working orders', () => {
    expect(draftOrderRangePairs([
      line({ stage: 'working' }),
      line({ id: 'take-profit', role: 'takeProfit', kind: 'takeProfit', stage: 'working', price: 120 }),
    ])).toEqual([])
  })
})
