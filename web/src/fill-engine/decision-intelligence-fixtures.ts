import type { EngineTrade } from './types'

export function engineTrade(overrides: Partial<EngineTrade> = {}): EngineTrade {
  return {
    id: 'trade-1', symbol: 'NQ', side: 'long', qty: 1,
    entryTs: 1_700_000_000, entryPriceTicks: 1_000,
    exitTs: 1_700_003_600, exitPriceTicks: 1_020,
    realizedCents: 10_000, feesCents: 400,
    mfeTicks: 30, maeTicks: 5, rMultiple: 1,
    initialStopTicks: 980, initialTakeProfitTicks: 1_040,
    protectionAdjustments: [], exitReason: 'takeProfit',
    ...overrides,
  }
}
