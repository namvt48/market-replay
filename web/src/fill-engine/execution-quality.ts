import type { EngineTrade, TradeExitReason } from './types'

export interface ExecutionCostModel {
  tickValueCents: number
  spreadTicks: number
  slippageTicks: number
}

export interface ExecutionTradeQuality {
  tradeId: string
  realizedR: number
  mfeR: number
  mfePercentile: number
  captureRatio: number
}

export interface ExecutionQuality {
  trades: ExecutionTradeQuality[]
  averageMfePercentile: number
  averageCaptureRatio: number
  grossExpectancyR: number
  netExpectancyR: number
  breakevenNet: number
  edgeAfterCosts: boolean
  averageCostR: number
  exitReasonBreakdown: Record<TradeExitReason, number>
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function initialRiskTicks(trade: EngineTrade): number | null {
  if (trade.initialStopTicks === null) return null
  const value = Math.abs(trade.entryPriceTicks - trade.initialStopTicks)
  return value > 0 ? value : null
}

export function analyzeExecutionQuality(trades: EngineTrade[], costModel: ExecutionCostModel): ExecutionQuality {
  const candidates = trades.flatMap((trade) => {
    const risk = initialRiskTicks(trade)
    if (risk === null || trade.rMultiple === null) return []
    return [{ trade, realizedR: trade.rMultiple, mfeR: Math.max(0, trade.mfeTicks / risk), risk }]
  })
  const mfeDistribution = candidates.map((item) => item.mfeR).toSorted((a, b) => a - b)
  const tradeQuality = candidates.map((item) => {
    const notGreater = mfeDistribution.filter((value) => value <= Math.max(0, item.realizedR)).length
    return {
      tradeId: item.trade.id,
      realizedR: item.realizedR,
      mfeR: item.mfeR,
      mfePercentile: mfeDistribution.length === 0 ? 0 : notGreater / mfeDistribution.length * 100,
      captureRatio: item.mfeR === 0 ? 0 : item.realizedR / item.mfeR,
    }
  })
  const grossExpectancyR = average(candidates.map((item) => item.realizedR))
  const costRValues = candidates.map((item) => {
    const marketCostCents = (Math.max(0, costModel.spreadTicks) + Math.max(0, costModel.slippageTicks)) * Math.max(0, costModel.tickValueCents) * item.trade.qty
    const riskCents = item.risk * Math.max(0, costModel.tickValueCents) * item.trade.qty
    return riskCents === 0 ? 0 : (Math.max(0, item.trade.feesCents) + marketCostCents) / riskCents
  })
  const averageCostR = average(costRValues)
  const netExpectancyR = grossExpectancyR - averageCostR
  const wins = candidates.filter((item) => item.realizedR - averageCostR > 0).length
  const exitReasonBreakdown: Record<TradeExitReason, number> = { manual: 0, stopLoss: 0, takeProfit: 0 }
  trades.forEach((trade) => { exitReasonBreakdown[trade.exitReason] += 1 })
  return {
    trades: tradeQuality,
    averageMfePercentile: average(tradeQuality.map((item) => item.mfePercentile)),
    averageCaptureRatio: average(tradeQuality.map((item) => item.captureRatio)),
    grossExpectancyR,
    netExpectancyR,
    breakevenNet: candidates.length === 0 ? 0 : wins / candidates.length,
    edgeAfterCosts: netExpectancyR > 0,
    averageCostR,
    exitReasonBreakdown,
  }
}
