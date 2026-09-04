export interface TradeForm {
  symbol: string
  side: 'long' | 'short'
  qty: string
  entryPrice: string
  exitPrice: string
}

/** A closed-trade record built from user-entered dollar prices. Field names
 * follow the ClosedTrade wire shape (see web/src/api/types.ts) so the caller
 * can spread it into putTrades() — only sessionId/createdAt are injected at
 * write time, mirroring replay-engine.ts's journal write pattern. */
export interface BuiltTrade {
  id: string
  symbol: string
  side: 'long' | 'short'
  qty: number
  entryTs: number
  entryPriceTicks: number
  exitTs: number
  exitPriceTicks: number
  realizedCents: number
  feesCents: number
  mfeTicks: number
  maeTicks: number
  rMultiple: null
  initialStopTicks: null
  initialTakeProfitTicks: null
  protectionAdjustments: []
  exitReason: 'manual'
}

/** Dollars per tick — live journal prices are entered in dollars. */
const TICK_SIZE = 0.01

export function buildTradeFromForm(form: TradeForm): BuiltTrade {
  const qty = Math.max(1, Math.round(parseFloat(form.qty) || 1))
  const entry = parseFloat(form.entryPrice)
  const exit = parseFloat(form.exitPrice)
  const direction = form.side === 'long' ? 1 : -1
  const realizedDollars = direction * (exit - entry) * qty
  const now = Date.now()
  return {
    id: `live_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    symbol: form.symbol.trim().toUpperCase(),
    side: form.side,
    qty,
    entryTs: now,
    entryPriceTicks: Math.round(entry / TICK_SIZE),
    exitTs: now,
    exitPriceTicks: Math.round(exit / TICK_SIZE),
    realizedCents: Math.round(realizedDollars * 100),
    feesCents: 0,
    mfeTicks: 0,
    maeTicks: 0,
    rMultiple: null,
    initialStopTicks: null,
    initialTakeProfitTicks: null,
    protectionAdjustments: [],
    exitReason: 'manual',
  }
}