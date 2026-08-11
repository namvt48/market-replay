import { describe, expect, it } from 'vitest'
import type { TradeConnection } from './chart-adapter'
import { TRADE_CONNECTION_DASH, TRADE_CONNECTION_STROKE, TradeConnectionsPrimitive } from './trade-connections-primitive'

const entry = { entryTime: 60, entryPrice: 100 }

describe('TradeConnectionsPrimitive', () => {
  it('keeps one quiet dashed connector per partial exit from the same entry', () => {
    const primitive = new TradeConnectionsPrimitive()
    const connections: TradeConnection[] = [
      { ...entry, exitTime: 120, exitPrice: 101 },
      { ...entry, exitTime: 180, exitPrice: 103 },
      { ...entry, exitTime: Number.NaN, exitPrice: 104 },
    ]

    primitive.setConnections(connections)

    expect(primitive.connections).toEqual(connections.slice(0, 2))
    expect(TRADE_CONNECTION_STROKE).toBe('rgba(163, 166, 175, 0.38)')
    expect(TRADE_CONNECTION_DASH).toEqual([4, 4])
    expect(primitive.paneViews()[0]?.zOrder?.()).toBe('bottom')
  })
})
