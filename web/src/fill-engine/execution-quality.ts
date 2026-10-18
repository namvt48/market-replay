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
  /** Fraction in [0, 1], calculated as the mean indicator(stressNetR > 0). */
  netWinRate: number
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
    if (risk === null || trade.rMultiple === null || !Number.isFinite(trade.rMultiple) ||
      !Number.isFinite(costModel.tickValueCents) || costModel.tickValueCents <= 0 || trade.qty <= 0) return []
    const riskCents = risk * costModel.tickValueCents * trade.qty
    if (!Number.isFinite(riskCents) || riskCents <= 0) return []
    const actualFeesR = Math.max(0, trade.feesCents) / riskCents
    return [{
      trade, realizedR: trade.rMultiple, grossR: trade.rMultiple + actualFeesR,
      mfeR: Math.max(0, trade.mfeTicks / risk), risk, actualFeesR,
    }]
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
  const grossExpectancyR = average(candidates.map((item) => item.grossR))
  const costRValues = candidates.map((item) => {
    const extraCostR = (Math.max(0, costModel.spreadTicks) + Math.max(0, costModel.slippageTicks)) / item.risk
    return item.actualFeesR + extraCostR
  })
  const netRs = candidates.map((item, index) => item.grossR - (costRValues[index] ?? 0))
  const averageCostR = average(costRValues)
  const netExpectancyR = average(netRs)
  const wins = netRs.filter((netR) => netR > 0).length
  const exitReasonBreakdown: Record<TradeExitReason, number> = { manual: 0, stopLoss: 0, takeProfit: 0 }
  trades.forEach((trade) => { exitReasonBreakdown[trade.exitReason] += 1 })
  return {
    trades: tradeQuality,
    averageMfePercentile: average(tradeQuality.map((item) => item.mfePercentile)),
    averageCaptureRatio: average(tradeQuality.map((item) => item.captureRatio)),
    grossExpectancyR,
    netExpectancyR,
    netWinRate: candidates.length === 0 ? 0 : wins / candidates.length,
    edgeAfterCosts: netExpectancyR > 0,
    averageCostR,
    exitReasonBreakdown,
  }
}
