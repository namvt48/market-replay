import type { ProtectionAdjustment, TradeExitReason } from '../fill-engine/types'

export type ReviewSourceType = 'session' | 'evaluation' | 'live'

export interface ReviewTrade {
  id: string
  sourceId: string
  sourceType: ReviewSourceType
  symbol: string
  side: 'long' | 'short'
  qty: number
  entryTs: number | null
  exitTs: number
  entryPriceTicks: number | null
  exitPriceTicks: number | null
  realizedCents: number
  feesCents: number
  mfeTicks: number
  maeTicks: number
  rMultiple: number | null
  initialStopTicks: number | null
  initialTakeProfitTicks: number | null
  protectionAdjustments: ProtectionAdjustment[]
  exitReason: TradeExitReason | null
}

export interface ReviewTradeSnapshot {
  id: string
  sourceId: string
  sourceType: ReviewSourceType
  symbol: string
  side: 'long' | 'short'
  exitTs: number
  realizedCents: number
  rMultiple: number | null
}

export function reviewTradeSnapshot(trade: ReviewTrade): ReviewTradeSnapshot {
  return {
    id: trade.id,
    sourceId: trade.sourceId,
    sourceType: trade.sourceType,
    symbol: trade.symbol,
    side: trade.side,
    exitTs: trade.exitTs,
    realizedCents: trade.realizedCents,
    rMultiple: trade.rMultiple,
  }
}

export function reviewDocumentKey(sourceType: ReviewSourceType, sourceId: string, tradeId: string): string {
  return `${sourceType}:${sourceId}:${tradeId}`
}
