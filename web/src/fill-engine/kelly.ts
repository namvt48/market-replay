import type { EdgeStats } from './edge-stat'

export interface KellySizing {
  method: 'binary-payoff-kelly-approximation'
  fStar: number
  fraction: number
  fFractional: number
  suggestedRiskPerTrade: number
  capped: boolean
}

export interface KellyOptions {
  fraction?: number
  maxRiskPerTrade?: number
}

export function calculateKellySizing(edge: EdgeStats, options: KellyOptions = {}): KellySizing | null {
  if (edge.verdict !== 'edge' || edge.avgRR === null || edge.avgRR <= 0 || edge.avgWinR <= 0 || edge.avgLossR <= 0 || edge.winRate <= 0 || edge.lossRate <= 0) return null
  const fraction = Math.min(0.5, Math.max(0.25, options.fraction ?? 0.25))
  const decisiveWinRate = edge.winRate / (edge.winRate + edge.lossRate)
  const decisiveLossRate = 1 - decisiveWinRate
  const fStar = Math.max(0, decisiveWinRate / edge.avgLossR - decisiveLossRate / edge.avgWinR)
  const fFractional = fStar * fraction
  const maximum = Math.min(0.05, Math.max(0.0025, options.maxRiskPerTrade ?? 0.02))
  return { method: 'binary-payoff-kelly-approximation', fStar, fraction, fFractional, suggestedRiskPerTrade: Math.min(maximum, fFractional), capped: fFractional > maximum }
}
