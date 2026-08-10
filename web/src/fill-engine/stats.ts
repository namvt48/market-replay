import type { EngineTrade } from './types'

export interface TradeStats {
  trades: number
  winRate: number
  netCents: number
  expectancyCents: number
  averageR: number | null
  profitFactor: number | null
}

export function calculateTradeStats(trades: EngineTrade[]): TradeStats {
  if (trades.length === 0) {
    return { trades: 0, winRate: 0, netCents: 0, expectancyCents: 0, averageR: null, profitFactor: null }
  }
  let wins = 0
  let netCents = 0
  let grossProfit = 0
  let grossLoss = 0
  let rTotal = 0
  let rCount = 0
  for (const trade of trades) {
    netCents += trade.realizedCents
    if (trade.realizedCents > 0) {
      wins += 1
      grossProfit += trade.realizedCents
    } else {
      grossLoss += Math.abs(trade.realizedCents)
    }
    if (trade.rMultiple !== null) {
      rTotal += trade.rMultiple
      rCount += 1
    }
  }
  return {
    trades: trades.length,
    winRate: wins / trades.length,
    netCents,
    expectancyCents: Math.round(netCents / trades.length),
    averageR: rCount > 0 ? rTotal / rCount : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
  }
}
