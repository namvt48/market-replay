import type { EngineTrade } from './types'

export type TimingFlag = 'balanced' | 'exit-leak' | 'entry-good' | 'entry-risk'
export type ConcentrationFlag = 'diversified' | 'watch' | 'concentrated'

export interface EdgeDecomposition {
  winRate: number
  averageWinR: number
  averageLossR: number
  payoffAsymmetry: number
  averageMfeR: number
  averageMaeR: number
  averageRealizedR: number
  captureRatio: number
  timingFlag: TimingFlag
  topN: number
  topNConcentrationPct: number
  concentrationFlag: ConcentrationFlag
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function riskTicks(trade: EngineTrade): number | null {
  if (trade.initialStopTicks === null) return null
  const distance = Math.abs(trade.entryPriceTicks - trade.initialStopTicks)
  return distance > 0 ? distance : null
}

export function decomposeEdge(trades: EngineTrade[], topN = 5): EdgeDecomposition {
  const rValues = trades.flatMap((trade) => trade.rMultiple === null || !Number.isFinite(trade.rMultiple) ? [] : [trade.rMultiple])
  const wins = rValues.filter((value) => value > 0)
  const losses = rValues.filter((value) => value < 0)
  const excursions = trades.flatMap((trade) => {
    const risk = riskTicks(trade)
    return risk === null ? [] : [{ mfe: Math.max(0, trade.mfeTicks / risk), mae: Math.max(0, trade.maeTicks / risk), realized: trade.rMultiple ?? 0 }]
  })
  const averageWinR = average(wins)
  const averageLossR = Math.abs(average(losses))
  const averageMfeR = average(excursions.map((item) => item.mfe))
  const averageMaeR = average(excursions.map((item) => item.mae))
  const averageRealizedR = average(rValues)
  const realizedPositive = Math.max(0, average(excursions.map((item) => item.realized)))
  const captureRatio = averageMfeR === 0 ? 0 : realizedPositive / averageMfeR
  const timingFlag: TimingFlag = averageMfeR > Math.max(0.5, averageRealizedR) * 2.1
    ? 'exit-leak'
    : averageMaeR <= 0.35 && averageRealizedR > 0
      ? 'entry-good'
      : averageMaeR > 0.8
        ? 'entry-risk'
        : 'balanced'
  const count = Math.max(1, Math.round(topN))
  const largest = rValues.filter((value) => value > 0).toSorted((a, b) => b - a).slice(0, count)
  const totalPositive = rValues.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const topNConcentrationPct = totalPositive === 0 ? 0 : largest.reduce((sum, value) => sum + value, 0) / totalPositive * 100
  const concentrationFlag: ConcentrationFlag = topNConcentrationPct >= 50 ? 'concentrated' : topNConcentrationPct >= 30 ? 'watch' : 'diversified'
  return {
    winRate: trades.length === 0 ? 0 : trades.filter((trade) => trade.realizedCents > 0).length / trades.length,
    averageWinR,
    averageLossR,
    payoffAsymmetry: averageLossR === 0 ? 0 : averageWinR / averageLossR,
    averageMfeR,
    averageMaeR,
    averageRealizedR,
    captureRatio,
    timingFlag,
    topN: count,
    topNConcentrationPct,
    concentrationFlag,
  }
}
