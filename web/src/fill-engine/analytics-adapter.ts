import type { EngineTrade, ProtectionAdjustment, TradeExitReason } from './types'

export interface AnalyticsTradeInput {
  id: string
  symbol: string
  side: 'long' | 'short'
  qty: number
  entryTs: number
  entryPriceTicks: number
  exitTs: number
  exitPriceTicks: number
  realizedCents: number
  feesCents?: number
  mfeTicks?: number
  maeTicks?: number
  rMultiple?: number | null
  initialStopTicks?: number | null
  initialTakeProfitTicks?: number | null
  protectionAdjustments?: ProtectionAdjustment[]
  exitReason?: TradeExitReason | string
}

function exitReason(value: string | undefined): TradeExitReason {
  if (value === 'stopLoss' || value === 'takeProfit') return value
  return 'manual'
}

export function tradesToEngineInput(trades: ReadonlyArray<EngineTrade | AnalyticsTradeInput>): EngineTrade[] {
  return trades.map((trade) => ({
    id: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    qty: Math.max(0, Math.round(trade.qty)),
    entryTs: trade.entryTs,
    entryPriceTicks: trade.entryPriceTicks,
    exitTs: trade.exitTs,
    exitPriceTicks: trade.exitPriceTicks,
    realizedCents: Math.round(trade.realizedCents),
    feesCents: Math.round(trade.feesCents ?? 0),
    mfeTicks: Math.max(0, trade.mfeTicks ?? 0),
    maeTicks: Math.max(0, trade.maeTicks ?? 0),
    rMultiple: trade.rMultiple === undefined || !Number.isFinite(trade.rMultiple) ? null : trade.rMultiple,
    initialStopTicks: trade.initialStopTicks ?? null,
    initialTakeProfitTicks: trade.initialTakeProfitTicks ?? null,
    protectionAdjustments: (trade.protectionAdjustments ?? []).map((adjustment) => ({ ...adjustment })),
    exitReason: exitReason(trade.exitReason),
  }))
}
