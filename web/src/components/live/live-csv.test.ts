import { describe, expect, it } from 'vitest'
import type { ClosedTrade } from '../../api/types'
import { liveTradesToCsv, parseLiveTradesCsv } from './live-csv'

function trade(overrides: Partial<ClosedTrade> = {}): ClosedTrade {
  const entryTs = Date.UTC(2026, 8, 4, 9, 30)
  return {
    id: 't1',
    sessionId: 'live-1',
    symbol: 'ES',
    side: 'long',
    qty: 2,
    entryTs,
    entryPriceTicks: 520000,
    exitTs: entryTs + 3_600_000,
    exitPriceTicks: 521000,
    realizedCents: 20000,
    feesCents: 500,
    mfeTicks: 100,
    maeTicks: 50,
    rMultiple: 2.4,
    initialStopTicks: null,
    initialTakeProfitTicks: null,
    protectionAdjustments: [],
    exitReason: 'manual',
    createdAt: entryTs,
    ...overrides,
  }
}

describe('liveTradesToCsv', () => {
  it('emits a header row followed by one row per trade', () => {
    const csv = liveTradesToCsv([trade()])
    const lines = csv.split('\n')
    expect(lines[0]).toContain('id,symbol,side,quantity')
    expect(lines[1]).toContain('ES,long,2,')
  })

  it('serializes prices as ticks and timestamps as ISO-8601', () => {
    const csv = liveTradesToCsv([trade()])
    const row = csv.split('\n')[1]
    expect(row).toContain('520000')
    expect(row).toContain('521000')
    expect(row).toContain('2026-09-04T09:30:00.000Z')
    expect(row).toContain('20000')
    expect(row).toContain('2.4')
  })

  it('quotes cells containing commas or quotes', () => {
    const csv = liveTradesToCsv([trade({ symbol: 'AAPL', id: 'a,"b' })])
    const row = csv.split('\n')[1]
    expect(row).toContain('"a,""b"')
  })

  it('serializes null r_multiple as an empty cell', () => {
    const csv = liveTradesToCsv([trade({ rMultiple: null })])
    const row = csv.split('\n')[1]
    const cells = row.split(',')
    expect(cells[12]).toBe('')
  })

  it('round-trips a full trade through export and import', () => {
    const original = trade()
    const parsed = parseLiveTradesCsv(liveTradesToCsv([original]))
    expect(parsed).toEqual([{
      id: 't1',
      symbol: 'ES',
      side: 'long',
      qty: 2,
      entryTs: original.entryTs,
      entryPriceTicks: 520000,
      exitTs: original.exitTs,
      exitPriceTicks: 521000,
      realizedCents: 20000,
      feesCents: 500,
      mfeTicks: 100,
      maeTicks: 50,
      rMultiple: 2.4,
      initialStopTicks: null,
      initialTakeProfitTicks: null,
      protectionAdjustments: [],
      exitReason: 'manual',
    }])
  })
})

describe('parseLiveTradesCsv', () => {
  it('skips the header line', () => {
    const csv = liveTradesToCsv([trade()])
    const parsed = parseLiveTradesCsv(csv)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.symbol).toBe('ES')
  })

  it('lowercases nothing, uppercases the symbol', () => {
    const parsed = parseLiveTradesCsv(`id,symbol,side,quantity,entry_time,entry_price_ticks,exit_time,exit_price_ticks,realized_cents,fees_cents,mfe_ticks,mae_ticks,r_multiple,exit_reason
x,es,long,1,2026-09-04T09:30:00.000Z,520000,2026-09-04T10:30:00.000Z,521000,100,0,10,5,1,manual`)
    expect(parsed[0]?.symbol).toBe('ES')
  })

  it('skips invalid rows: unknown symbol, bad side, missing price, bad timestamp, qty < 1', () => {
    const csv = `id,symbol,side,quantity,entry_time,entry_price_ticks,exit_time,exit_price_ticks,realized_cents,fees_cents,mfe_ticks,mae_ticks,r_multiple,exit_reason
a,,long,1,2026-09-04T09:30:00.000Z,520000,2026-09-04T10:30:00.000Z,521000,100,0,10,5,1,manual
b,ES,sideways,1,2026-09-04T09:30:00.000Z,520000,2026-09-04T10:30:00.000Z,521000,100,0,10,5,1,manual
c,ES,long,1,2026-09-04T09:30:00.000Z,not-a-number,2026-09-04T10:30:00.000Z,521000,100,0,10,5,1,manual
d,ES,long,1,2026-09-04T09:30:00.000Z,520000,not-a-time,521000,100,0,10,5,1,manual
e,ES,long,0,2026-09-04T09:30:00.000Z,520000,2026-09-04T10:30:00.000Z,521000,100,0,10,5,1,manual`
    const parsed = parseLiveTradesCsv(csv)
    expect(parsed).toHaveLength(0)
  })

  it('defaults missing optional numerics and regenerates missing ids', () => {
    const parsed = parseLiveTradesCsv(`id,symbol,side,quantity,entry_time,entry_price_ticks,exit_time,exit_price_ticks,realized_cents,fees_cents,mfe_ticks,mae_ticks,r_multiple,exit_reason
,ES,long,1,2026-09-04T09:30:00.000Z,520000,2026-09-04T10:30:00.000Z,521000,,,,,,stopLoss`)
    expect(parsed).toHaveLength(1)
    const row = parsed[0]!
    expect(row.id).toMatch(/^live_/)
    expect(row.realizedCents).toBe(0)
    expect(row.feesCents).toBe(0)
    expect(row.rMultiple).toBeNull()
    expect(row.exitReason).toBe('stopLoss')
  })
})