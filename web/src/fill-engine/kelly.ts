import type { EdgeStats } from './edge-stat'

export interface KellySizing {
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
  if (edge.verdict !== 'edge' || edge.avgRR <= 0) return null
  const fraction = Math.min(0.5, Math.max(0.25, options.fraction ?? 0.25))
  const q = 1 - edge.winRate
  const fStar = Math.max(0, (edge.winRate * edge.avgRR - q) / edge.avgRR)
  const fFractional = fStar * fraction
  const maximum = Math.min(0.05, Math.max(0.0025, options.maxRiskPerTrade ?? 0.02))
  return { fStar, fraction, fFractional, suggestedRiskPerTrade: Math.min(maximum, fFractional), capped: fFractional > maximum }
}
