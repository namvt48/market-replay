import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SymbolMeta } from '../api/types'
import type { Bar1m } from '../fill-engine/types'
import { aggregateRange } from './aggregate'

const symbol: SymbolMeta = {
  symbol: 'NQ', name: 'Nasdaq', kind: 'future', tickSize: 0.25, pointValue: 20,
  currency: 'USD', priceDecimals: 2, sessionTz: 'America/New_York', rollRule: 'volume',
  commissionPerSide: 2.09, defaultSlippageTicks: 1, ranges: {},
}
const bars: Bar1m[] = [
  { ts: 0, openTicks: 400, highTicks: 404, lowTicks: 396, closeTicks: 402, volume: 10 },
  { ts: 60, openTicks: 402, highTicks: 408, lowTicks: 400, closeTicks: 406, volume: 20 },
  { ts: 300, openTicks: 406, highTicks: 410, lowTicks: 404, closeTicks: 408, volume: 30 },
]

describe('aggregateRange', () => {
  afterEach(() => vi.restoreAllMocks())

  it('updates a forming display candle from the underlying 1m stream', () => {
    const result = aggregateRange(bars, '5m', symbol, symbol.tickSize)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ time: 0, open: 100, high: 102, low: 99, close: 101.5, volume: 30 })
    expect(result[1]).toMatchObject({ time: 300, open: 101.5, close: 102, volume: 30 })
  })

  it('aggregates a custom intraday resolution', () => {
    const result = aggregateRange(bars, '2m', symbol, symbol.tickSize)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ time: 0, open: 100, close: 101.5, volume: 30 })
    expect(result[1]).toMatchObject({ time: 240, open: 101.5, close: 102, volume: 30 })
  })

  it('filters ETH bars and anchors RTH candles at the 09:30 cash open', () => {
    const at = (iso: string, offset: number): Bar1m => ({ ...bars[0], ts: Date.parse(iso) / 1000, openTicks: 400 + offset, closeTicks: 402 + offset })
    const result = aggregateRange([
      at('2026-08-10T13:29:00Z', 0),
      at('2026-08-10T13:30:00Z', 1),
      at('2026-08-10T14:29:00Z', 2),
      at('2026-08-10T14:30:00Z', 3),
      at('2026-08-10T20:00:00Z', 4),
    ], '1h', symbol, symbol.tickSize, 'rth')

    expect(result.map((bar) => bar.time)).toEqual([
      Date.parse('2026-08-10T13:30:00Z') / 1000,
      Date.parse('2026-08-10T14:30:00Z') / 1000,
    ])
    expect(result[0]).toMatchObject({ open: 100.25, close: 101 })
  })

  it('timestamps an RTH daily candle at the same trading day cash open', () => {
    const result = aggregateRange([
      { ...bars[0], ts: Date.parse('2026-08-10T13:30:00Z') / 1000 },
      { ...bars[1], ts: Date.parse('2026-08-10T19:59:00Z') / 1000 },
    ], '1d', symbol, symbol.tickSize, 'rth')

    expect(result).toHaveLength(1)
    expect(result[0]?.time).toBe(Date.parse('2026-08-10T13:30:00Z') / 1000)
  })

  it('uses one stable daily candle timestamp for partial pages from the same futures session', () => {
    const firstPage = aggregateRange([{ ...bars[0], ts: Date.UTC(2026, 6, 30, 14, 0) / 1000 }], '1d', symbol, symbol.tickSize)
    const secondPage = aggregateRange([{ ...bars[1], ts: Date.UTC(2026, 6, 30, 16, 0) / 1000 }], '1d', symbol, symbol.tickSize)

    expect(firstPage[0]?.time).toBe(secondPage[0]?.time)
    expect(firstPage[0]?.time).toBe(Date.UTC(2026, 6, 29, 22, 0) / 1000)
  })

  it('uses calendar-aligned week and month buckets across partial pages', () => {
    const tuesday = { ...bars[0], ts: Date.UTC(2026, 6, 28, 14, 0) / 1000 }
    const thursday = { ...bars[1], ts: Date.UTC(2026, 6, 30, 14, 0) / 1000 }
    const nextMonday = { ...bars[2], ts: Date.UTC(2026, 7, 3, 14, 0) / 1000 }

    const firstWeek = aggregateRange([tuesday], '1w', symbol, symbol.tickSize)
    const sameWeek = aggregateRange([thursday], '1w', symbol, symbol.tickSize)
    const followingWeek = aggregateRange([nextMonday], '1w', symbol, symbol.tickSize)
    expect(firstWeek[0]?.time).toBe(sameWeek[0]?.time)
    expect(followingWeek[0]?.time).not.toBe(firstWeek[0]?.time)

    const july = aggregateRange([thursday], '1M', symbol, symbol.tickSize)
    const august = aggregateRange([nextMonday], '1M', symbol, symbol.tickSize)
    expect(august[0]?.time).not.toBe(july[0]?.time)
    expect(july[0]?.time).toBe(Date.UTC(2026, 5, 30, 22, 0) / 1000)
  })

  it('reuses one timezone formatter while aggregating a daily range', () => {
    const uncachedTimezoneSymbol = { ...symbol, sessionTz: 'Etc/UTC' }
    const NativeDateTimeFormat = Intl.DateTimeFormat
    const nativeFormatter = new NativeDateTimeFormat('en-CA', {
      timeZone: uncachedTimezoneSymbol.sessionTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    const formatToParts = vi.fn(nativeFormatter.formatToParts.bind(nativeFormatter))
    const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function DateTimeFormat(locales, options) {
      void locales
      void options
      return { formatToParts } as unknown as Intl.DateTimeFormat
    })

    aggregateRange(bars, '1d', uncachedTimezoneSymbol, uncachedTimezoneSymbol.tickSize)

    expect(formatter).toHaveBeenCalledTimes(1)
    expect(formatToParts).toHaveBeenCalledTimes(1)
  })
})
