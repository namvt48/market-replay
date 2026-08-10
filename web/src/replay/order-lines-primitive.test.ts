import { describe, expect, it } from 'vitest'
import type { OrderLine } from './chart-adapter'
import { draftOrderRangePairs } from './order-lines-primitive'

const line = (patch: Partial<OrderLine>): OrderLine => ({
  id: 'ticket-entry', price: 100, label: 'Buy Limit', color: '#2962ff', kind: 'limit', editable: true,
  role: 'entry', stage: 'draft', qty: 1, priceLabel: '100.00', ...patch,
})

describe('order range overlay', () => {
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
