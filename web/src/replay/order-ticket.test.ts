import { describe, expect, it } from 'vitest'
import type { WorkingOrder } from '../fill-engine/types'
import {
  createOrderTicketDraft,
  editOrderTicketDraft,
  setOrderTicketPrice,
  setOrderTicketQuantity,
  toggleOrderTicketProtection,
  validateOrderTicket,
} from './order-ticket'

describe('order ticket state', () => {
  it('creates protection on the correct side of a buy or sell entry', () => {
    let buy = createOrderTicketDraft('buy', 'limit', 2, 100)
    buy = toggleOrderTicketProtection(toggleOrderTicketProtection(buy, 'takeProfit'), 'stopLoss')
    expect(buy).toMatchObject({ qty: 2, takeProfitTicks: 120, stopLossTicks: 80 })
    expect(validateOrderTicket(buy)).toBeNull()

    let sell = createOrderTicketDraft('sell', 'stop', 1, 100)
    sell = toggleOrderTicketProtection(toggleOrderTicketProtection(sell, 'takeProfit'), 'stopLoss')
    expect(sell).toMatchObject({ takeProfitTicks: 80, stopLossTicks: 120 })
    expect(validateOrderTicket(sell)).toBeNull()
  })

  it('uses the same draggable protection draft for market tickets', () => {
    let market = createOrderTicketDraft('buy', 'market', 1, 100)
    market = toggleOrderTicketProtection(toggleOrderTicketProtection(market, 'takeProfit'), 'stopLoss')
    expect(market).toMatchObject({ type: 'market', takeProfitTicks: 120, stopLossTicks: 80 })
    expect(validateOrderTicket(market)).toBeNull()
  })

  it('clamps quantity and updates only the dragged leg', () => {
    let draft = createOrderTicketDraft('buy', 'limit', 1, 100)
    draft = toggleOrderTicketProtection(draft, 'takeProfit')
    draft = setOrderTicketQuantity(draft, 2_000, 1_000)
    draft = setOrderTicketPrice(draft, 'takeProfit', 140)
    expect(draft).toMatchObject({ qty: 1_000, entryPriceTicks: 100, takeProfitTicks: 140 })
  })

  it('reconstructs an editable pending bracket from persisted working orders', () => {
    const order = (patch: Partial<WorkingOrder>): WorkingOrder => ({
      id: 'entry', side: 'buy', type: 'limit', role: 'entry', qty: 2, priceTicks: 100,
      createdAtTs: 0, ocoGroup: null, active: true, parentId: null, ...patch,
    })
    const draft = editOrderTicketDraft([
      order({}),
      order({ id: 'sl', side: 'sell', type: 'stop', role: 'stopLoss', priceTicks: 90, active: false, parentId: 'entry', ocoGroup: 'bracket-entry' }),
      order({ id: 'tp', side: 'sell', role: 'takeProfit', priceTicks: 120, active: false, parentId: 'entry', ocoGroup: 'bracket-entry' }),
    ], 'tp')
    expect(draft).toMatchObject({ mode: 'edit', sourceOrderId: 'entry', sourceOrderIds: ['entry', 'sl', 'tp'], stopLossTicks: 90, takeProfitTicks: 120 })
  })
})
