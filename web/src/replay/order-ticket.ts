import type { OrderSide, WorkingOrder } from '../fill-engine/types'

export type PendingOrderType = 'limit' | 'stop'
export type OrderTicketRole = 'entry' | 'stopLoss' | 'takeProfit'

export interface OrderTicketDraft {
  mode: 'create' | 'edit'
  sourceOrderId: string | null
  sourceOrderIds: string[]
  side: OrderSide
  type: PendingOrderType
  qty: number
  entryPriceTicks: number
  stopLossTicks: number | null
  takeProfitTicks: number | null
}

const DEFAULT_PROTECTION_DISTANCE_TICKS = 20

export function createOrderTicketDraft(
  side: OrderSide,
  type: PendingOrderType,
  qty: number,
  entryPriceTicks: number,
): OrderTicketDraft {
  return {
    mode: 'create', sourceOrderId: null, sourceOrderIds: [], side, type, qty,
    entryPriceTicks, stopLossTicks: null, takeProfitTicks: null,
  }
}

export function editOrderTicketDraft(orders: WorkingOrder[], selectedId: string): OrderTicketDraft | null {
  const selected = orders.find((order) => order.id === selectedId)
  if (!selected) return null
  const entry = selected.role === 'entry'
    ? selected
    : selected.parentId
      ? orders.find((order) => order.id === selected.parentId)
      : undefined
  if (!entry || entry.priceTicks === null || entry.type === 'market') return null
  const family = orders.filter((order) => order.id === entry.id || order.parentId === entry.id)
  return {
    mode: 'edit', sourceOrderId: entry.id, sourceOrderIds: family.map((order) => order.id),
    side: entry.side, type: entry.type, qty: entry.qty, entryPriceTicks: entry.priceTicks,
    stopLossTicks: family.find((order) => order.role === 'stopLoss')?.priceTicks ?? null,
    takeProfitTicks: family.find((order) => order.role === 'takeProfit')?.priceTicks ?? null,
  }
}

export function setOrderTicketQuantity(draft: OrderTicketDraft, qty: number, maxContracts: number): OrderTicketDraft {
  return { ...draft, qty: Math.max(1, Math.min(maxContracts, Math.round(qty))) }
}

export function setOrderTicketPrice(draft: OrderTicketDraft, role: OrderTicketRole, priceTicks: number): OrderTicketDraft {
  if (role === 'entry') return { ...draft, entryPriceTicks: priceTicks }
  if (role === 'stopLoss') return { ...draft, stopLossTicks: priceTicks }
  return { ...draft, takeProfitTicks: priceTicks }
}

export function toggleOrderTicketProtection(draft: OrderTicketDraft, role: 'stopLoss' | 'takeProfit'): OrderTicketDraft {
  const direction = draft.side === 'buy' ? 1 : -1
  if (role === 'stopLoss') {
    return {
      ...draft,
      stopLossTicks: draft.stopLossTicks === null
        ? draft.entryPriceTicks - direction * DEFAULT_PROTECTION_DISTANCE_TICKS
        : null,
    }
  }
  return {
    ...draft,
    takeProfitTicks: draft.takeProfitTicks === null
      ? draft.entryPriceTicks + direction * DEFAULT_PROTECTION_DISTANCE_TICKS
      : null,
  }
}

export function validateOrderTicket(draft: OrderTicketDraft): string | null {
  const buy = draft.side === 'buy'
  if (draft.stopLossTicks !== null && (buy ? draft.stopLossTicks >= draft.entryPriceTicks : draft.stopLossTicks <= draft.entryPriceTicks)) {
    return `Stop loss must be ${buy ? 'below' : 'above'} the entry price`
  }
  if (draft.takeProfitTicks !== null && (buy ? draft.takeProfitTicks <= draft.entryPriceTicks : draft.takeProfitTicks >= draft.entryPriceTicks)) {
    return `Take profit must be ${buy ? 'above' : 'below'} the entry price`
  }
  return null
}
