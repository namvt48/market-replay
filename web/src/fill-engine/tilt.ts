import type { EngineTrade, ProtectionAdjustment } from './types'

export type PsychologyProfile = 'composed' | 'size-chaser' | 'revenge-risk' | 'plan-drifter'

export interface TiltAnalysis {
  tiltScore: number
  slTamperingScore: number
  sizingConsistency: number
  antiStreakScore: number
  postLossSizeEscalations: number
  rapidReentriesAfterLoss: number
  profile: PsychologyProfile
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0
  const mean = average(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1))
}

function stopMovedAway(trade: EngineTrade, adjustment: ProtectionAdjustment): boolean {
  if (adjustment.role !== 'stopLoss' || trade.initialStopTicks === null) return false
  return trade.side === 'long' ? adjustment.priceTicks < trade.initialStopTicks : adjustment.priceTicks > trade.initialStopTicks
}

export function analyzeTilt(trades: EngineTrade[]): TiltAnalysis {
  const ordered = trades.toSorted((a, b) => a.entryTs - b.entryTs)
  const quantities = ordered.map((trade) => trade.qty)
  const meanQty = average(quantities)
  const coefficientOfVariation = meanQty === 0 ? 0 : standardDeviation(quantities) / meanQty
  let losingStreak = 0
  let postLossSizeEscalations = 0
  let rapidReentriesAfterLoss = 0
  let tamperedStops = 0
  let antiStreakEvents = 0
  ordered.forEach((trade, index) => {
    const previous = ordered[index - 1]
    if (previous?.realizedCents !== undefined && previous.realizedCents < 0) losingStreak += 1
    else if (previous) losingStreak = 0
    const recentMeanQty = average(ordered.slice(Math.max(0, index - 8), index).map((item) => item.qty)) || meanQty
    if (losingStreak >= 2 && trade.qty > recentMeanQty * 1.25) postLossSizeEscalations += 1
    if (previous && previous.realizedCents < 0 && trade.entryTs - previous.exitTs <= 15 * 60) rapidReentriesAfterLoss += 1
    if (losingStreak >= 2 && trade.qty <= recentMeanQty && (!previous || trade.entryTs - previous.exitTs > 15 * 60)) antiStreakEvents += 1
    tamperedStops += trade.protectionAdjustments.filter((adjustment) => stopMovedAway(trade, adjustment)).length
  })
  const opportunityCount = Math.max(1, ordered.length)
  const sizingConsistency = Math.max(0, 100 - coefficientOfVariation * 100)
  const slTamperingScore = Math.min(100, tamperedStops / opportunityCount * 400)
  const escalationScore = postLossSizeEscalations / opportunityCount * 600
  const reentryScore = rapidReentriesAfterLoss / opportunityCount * 350
  const tiltScore = Math.min(100, escalationScore + reentryScore + slTamperingScore * 0.25)
  const antiStreakScore = Math.min(100, 60 + antiStreakEvents / Math.max(1, postLossSizeEscalations + antiStreakEvents) * 40 - tiltScore * 0.25)
  const profile: PsychologyProfile = slTamperingScore >= 35
    ? 'plan-drifter'
    : escalationScore >= 30 && reentryScore >= 15
      ? 'revenge-risk'
      : coefficientOfVariation >= 0.35
        ? 'size-chaser'
        : 'composed'
  return { tiltScore, slTamperingScore, sizingConsistency, antiStreakScore, postLossSizeEscalations, rapidReentriesAfterLoss, profile }
}
