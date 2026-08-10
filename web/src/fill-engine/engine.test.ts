import { describe, expect, it } from 'vitest'
import {
  cancelOrder,
  createFillEngine,
  placeBracket,
  placeEntryBracket,
  placeOrder,
  stepFillEngine,
} from './engine'
import type { Bar1m, FillEngineState } from './types'

const config = {
  symbol: 'NQ', tickValueCents: 500, commissionPerSideCents: 209,
  slippageTicks: 1, maxContracts: 5, startingEquityCents: 1_000_000,
}
const bar = (ts: number, open: number, high = open, low = open, close = open): Bar1m => ({
  ts, openTicks: open, highTicks: high, lowTicks: low, closeTicks: close, volume: 100,
})

function visibleState(): FillEngineState {
  return stepFillEngine(createFillEngine(config), bar(60, 100, 102, 98, 101))
}

function longState(): FillEngineState {
  const pending = placeOrder(visibleState(), { side: 'buy', type: 'market', qty: 1 })
  return stepFillEngine(pending, bar(120, 100, 103, 99, 102))
}

describe('fill engine rules', () => {
  it('fills a market order only at the next bar open plus slippage', () => {
    const pending = placeOrder(visibleState(), { side: 'buy', type: 'market', qty: 1 })
    expect(pending.position).toBeNull()
    const filled = stepFillEngine(pending, bar(120, 100))
    expect(filled.position?.avgPriceTicks).toBe(101)
  })

  it('gives a buy limit the better opening price on a gap below', () => {
    const state = placeOrder(visibleState(), { side: 'buy', type: 'limit', qty: 1, priceTicks: 100 })
    expect(stepFillEngine(state, bar(120, 98, 101, 97, 100)).position?.avgPriceTicks).toBe(98)
  })

  it('gives a sell limit the better opening price on a gap above', () => {
    const state = placeOrder(visibleState(), { side: 'sell', type: 'limit', qty: 1, priceTicks: 100 })
    expect(stepFillEngine(state, bar(120, 102, 103, 99, 101)).position?.avgPriceTicks).toBe(102)
  })

  it('fills buy and sell stops pessimistically through a gap with slippage', () => {
    const buy = placeOrder(visibleState(), { side: 'buy', type: 'stop', qty: 1, priceTicks: 105 })
    expect(stepFillEngine(buy, bar(120, 108, 110, 107, 109)).position?.avgPriceTicks).toBe(109)
    const sell = placeOrder(visibleState(), { side: 'sell', type: 'stop', qty: 1, priceTicks: 95 })
    expect(stepFillEngine(sell, bar(120, 92, 94, 90, 91)).position?.avgPriceTicks).toBe(91)
  })

  it('resolves SL before TP when both touch inside one 1m bar', () => {
    const bracketed = placeBracket(longState(), 95, 105)
    const closed = stepFillEngine(bracketed, bar(180, 100, 106, 94, 102))
    expect(closed.position).toBeNull()
    expect(closed.trades[0].exitPriceTicks).toBe(94)
    expect(closed.orders).toHaveLength(0)
  })

  it('keeps bracket protection dormant until its pending entry fills', () => {
    const pending = placeEntryBracket(visibleState(), {
      side: 'buy', type: 'limit', qty: 2, priceTicks: 100,
      stopLossTicks: 95, takeProfitTicks: 105,
    })
    expect(pending.orders.map((order) => ({ role: order.role, active: order.active }))).toEqual([
      { role: 'entry', active: true },
      { role: 'stopLoss', active: false },
      { role: 'takeProfit', active: false },
    ])

    const untouched = stepFillEngine(pending, bar(120, 106, 108, 104, 107))
    expect(untouched.position).toBeNull()
    expect(untouched.orders).toHaveLength(3)

    const opened = stepFillEngine(untouched, bar(180, 100, 101, 99, 100))
    expect(opened.position?.qty).toBe(2)
    expect(opened.orders.map((order) => ({ role: order.role, active: order.active }))).toEqual([
      { role: 'stopLoss', active: true },
      { role: 'takeProfit', active: true },
    ])
  })

  it('cancels an unfilled entry together with its contingent protection', () => {
    const pending = placeEntryBracket(visibleState(), {
      side: 'sell', type: 'limit', qty: 1, priceTicks: 105,
      stopLossTicks: 110, takeProfitTicks: 95,
    })
    const cancelled = cancelOrder(pending, pending.orders[0].id)
    expect(cancelled.orders).toEqual([])
  })

  it('activates OCO protection and cancels its sibling after exit', () => {
    const pending = placeEntryBracket(visibleState(), {
      side: 'buy', type: 'limit', qty: 1, priceTicks: 100,
      stopLossTicks: 95, takeProfitTicks: 105,
    })
    const opened = stepFillEngine(pending, bar(120, 100, 101, 99, 100))
    const closed = stepFillEngine(opened, bar(180, 105, 106, 104, 105))
    expect(closed.position).toBeNull()
    expect(closed.orders).toEqual([])
    expect(closed.trades).toHaveLength(1)
  })

  it('calculates tick P&L and round-trip fees in integer cents', () => {
    const opened = longState() // filled at 101
    const exitPending = placeOrder(opened, { side: 'sell', type: 'market', qty: 1 })
    const closed = stepFillEngine(exitPending, bar(180, 110)) // filled at 109
    expect(closed.trades[0].realizedCents).toBe(8 * 500 - 418)
    expect(Number.isInteger(closed.equityCents)).toBe(true)
  })

  it('is deterministic for the same bars and order sequence', () => {
    const run = (): FillEngineState => {
      const opened = longState()
      return stepFillEngine(placeOrder(opened, { side: 'sell', type: 'market', qty: 1 }), bar(180, 110))
    }
    expect(run()).toEqual(run())
  })
})
