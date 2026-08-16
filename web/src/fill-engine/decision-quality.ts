import type { EngineTrade, ProtectionAdjustment } from './types'

export type DecisionClassification = 'goodWin' | 'goodLoss' | 'badWin' | 'badLoss'

export interface TradeDecisionQuality {
  tradeId: string
  classification: DecisionClassification
  adherenceScore: number
  tamperedStop: boolean
  tamperedTarget: boolean
}

export interface DecisionQuality {
  trades: TradeDecisionQuality[]
  matrix: Record<DecisionClassification, number>
  planAdherenceScore: number
  ruleFollowingDividendR: number
  ruleFollowingDividendCents: number
}

function movedAwayFromPlan(trade: EngineTrade, adjustment: ProtectionAdjustment): boolean {
  if (adjustment.role === 'stopLoss' && trade.initialStopTicks !== null) {
    return trade.side === 'long' ? adjustment.priceTicks < trade.initialStopTicks : adjustment.priceTicks > trade.initialStopTicks
  }
  if (adjustment.role === 'takeProfit' && trade.initialTakeProfitTicks !== null) {
    return trade.side === 'long' ? adjustment.priceTicks < trade.initialTakeProfitTicks : adjustment.priceTicks > trade.initialTakeProfitTicks
  }
  return false
}

function scoreTrade(trade: EngineTrade): TradeDecisionQuality {
  const harmful = trade.protectionAdjustments.filter((adjustment) => movedAwayFromPlan(trade, adjustment))
  const tamperedStop = harmful.some((adjustment) => adjustment.role === 'stopLoss')
  const tamperedTarget = harmful.some((adjustment) => adjustment.role === 'takeProfit')
  const adjustmentPenalty = Math.min(55, trade.protectionAdjustments.length * 7)
  const harmfulPenalty = Math.min(50, harmful.length * 25)
  const adherenceScore = Math.max(0, 100 - adjustmentPenalty - harmfulPenalty)
  const followedPlan = adherenceScore >= 70 && !tamperedStop
  const won = trade.realizedCents > 0
  const classification: DecisionClassification = followedPlan
    ? won ? 'goodWin' : 'goodLoss'
    : won ? 'badWin' : 'badLoss'
  return { tradeId: trade.id, classification, adherenceScore, tamperedStop, tamperedTarget }
}

export function analyzeDecisionQuality(trades: EngineTrade[]): DecisionQuality {
  const scored = trades.map(scoreTrade)
  const matrix: Record<DecisionClassification, number> = { goodWin: 0, goodLoss: 0, badWin: 0, badLoss: 0 }
  scored.forEach((trade) => { matrix[trade.classification] += 1 })
  const planAdherenceScore = scored.length === 0 ? 0 : scored.reduce((sum, trade) => sum + trade.adherenceScore, 0) / scored.length
  let dividendCents = 0
  let dividendR = 0
  scored.forEach((quality, index) => {
    if (quality.classification !== 'badLoss') return
    const trade = trades[index]
    if (!trade) return
    const actualR = trade.rMultiple ?? -1
    const plannedR = quality.tamperedStop ? -1 : actualR
    dividendR += plannedR - actualR
    const riskCents = Math.abs(actualR) > 1e-9 ? Math.abs(trade.realizedCents / actualR) : 0
    dividendCents += Math.round((plannedR - actualR) * riskCents)
  })
  return {
    trades: scored,
    matrix,
    planAdherenceScore,
    ruleFollowingDividendR: trades.length === 0 ? 0 : dividendR / trades.length,
    ruleFollowingDividendCents: trades.length === 0 ? 0 : Math.round(dividendCents / trades.length),
  }
}
