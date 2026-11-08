import { describe, expect, it } from 'vitest'
import type { ChartBarTicks, IndicatorDrawIntent, IndicatorInputValue } from '../api/types'
import { imDuyDescriptor, calculateImDuy } from './im-duy'

type Draw = IndicatorDrawIntent & { xOffset0?: number; xOffset1?: number }
const tick = 0.25
function bar(time: number, o: number, h: number, l: number, c: number): ChartBarTicks {
  return { time, openTicks: o / tick, highTicks: h / tick, lowTicks: l / tick, closeTicks: c / tick, volume: 1 }
}
function run(
  bars: ChartBarTicks[],
  overrides: Record<string, IndicatorInputValue> = {},
  tf: '1m' | '5m' | '1d' = '1m',
  dailyBars: ChartBarTicks[] = [],
  symbol = 'NQ',
  isFuture = false,
): Draw[] {
  const inputs: Record<string, IndicatorInputValue> = {
    showFractals: false, showSeparator: false, showDividerAndDow: false, showMacro: false,
    showKillzone: false, showOpenPrice: false, watermarkShow: false, showIpdaText: false,

    ...overrides,
  }
  return calculateImDuy(bars, inputs, tick, tf, 'America/New_York', isFuture, dailyBars, symbol).draws as Draw[]
}
function quietHTF(): Record<string, IndicatorInputValue> {
  return { htf1Show: true, htf1Timeframe: '5', htf1Count: 10, htf2Show: false, htf3Show: false, htf4Show: false, htf5Show: false, htf6Show: false, maxSets: 6, traceShow: false, dailyName: false, fvgShow: false, viShow: false }
}

describe("I'm Duy native calculation", () => {
  it('aggregates HTF candles from observed bars and updates the unfinished candle on a longer prefix', () => {
    const start = Date.UTC(2024, 0, 8, 14, 30) / 1000
    const bars = Array.from({ length: 5 }, (_, i) => bar(start + i * 60, 100 + i, 102 + i, 99 + i, 101 + i))
    const early = run(bars.slice(0, 4), quietHTF())
    const late = run(bars, quietHTF())
    const body = (draws: Draw[]): Draw => draws.find((d) => d.kind === 'rectangle')!
    expect(body(early)).toBeDefined()
    expect(body(late)).toBeDefined()
    expect(body(early).y1).not.toBe(body(late).y1)
    expect(body(late).t0).toBe(bars[4].time)
    expect(body(late).xOffset0).toBeGreaterThan(0)
    const wicks = late.filter((drawing) => drawing.kind === 'line')
    expect(wicks).toHaveLength(2)
    expect(wicks).toEqual(expect.arrayContaining([
      expect.objectContaining({ y0: 106, y1: 105 }),
      expect.objectContaining({ y0: 100, y1: 99 }),
    ]))
  })

  it('uses the chart’s futures bucket boundaries for daily, weekly, and intraday HTF candles', () => {
    const cases = [
      {
        timeframe: '1D',
        before: Date.UTC(2024, 0, 8, 22, 59) / 1000,
        after: Date.UTC(2024, 0, 8, 23, 0) / 1000,
      },
      {
        timeframe: '1W',
        before: Date.UTC(2024, 0, 7, 22, 59) / 1000,
        after: Date.UTC(2024, 0, 7, 23, 0) / 1000,
      },
      {
        timeframe: '240',
        before: Date.UTC(2024, 0, 8, 3, 59) / 1000,
        after: Date.UTC(2024, 0, 8, 4, 0) / 1000,
      },
    ] as const
    for (const { timeframe, before, after } of cases) {
      const drawings = run([
        bar(before, 100, 102, 99, 101),
        bar(after, 103, 105, 102, 104),
      ], {
        ...quietHTF(),
        htf1Timeframe: timeframe,
        customDaily: false,
      }, '1m', [], 'NQ', true)
      expect(drawings.filter((drawing) => drawing.kind === 'rectangle')).toHaveLength(2)
    }
  })

  it('shows weekday text when the Daily Divider & Days Of Week option is enabled', () => {
    const before = Date.UTC(2024, 0, 8, 16, 59) / 1000
    const noon = Date.UTC(2024, 0, 8, 17, 0) / 1000
    const drawings = run([
      bar(before, 100, 101, 99, 100),
      bar(noon, 100, 102, 99, 101),
    ], { showDividerAndDow: true, dailyName: false })
    expect(drawings.some((drawing) => drawing.kind === 'screenText' && drawing.label === 'Monday'
      && drawing.style.screenAnchor === 'bottom-center')).toBe(true)
  })

  it('marks a three-candle HTF fair-value gap but does not emit it when disabled', () => {
    const start = Date.UTC(2024, 0, 8, 14, 30) / 1000
    const flat = [110, 112, 109, 111]
    const separated = [118, 121, 115, 120]
    const groups = [flat, flat, separated, separated]
    const bars = groups.flatMap((values, group) =>
      Array.from({ length: 5 }, (_, offset) =>
        bar(start + (group * 5 + offset) * 60, values[0], values[1], values[2], values[3])))
    const withGap = run(bars, { ...quietHTF(), fvgShow: true, fvgColor: { r: 128, g: 128, b: 128, a: 0.2 } })
    const withoutGap = run(bars, { ...quietHTF(), fvgShow: false })
    expect(withGap.filter((drawing) =>
      drawing.kind === 'rectangle' && drawing.style.fillColor === 'rgba(128,128,128,0.2)',
    )).toHaveLength(2)
    expect(withoutGap.filter((drawing) =>
      drawing.kind === 'rectangle' && drawing.style.fillColor === 'rgba(128,128,128,0.2)',
    )).toHaveLength(0)
  })

  it('starts custom 8:30 daily candles at local 8:30 in both DST and standard time', () => {
    for (const [before, at] of [
      [Date.UTC(2024, 2, 11, 12, 29), Date.UTC(2024, 2, 11, 12, 30)],
      [Date.UTC(2024, 10, 4, 13, 29), Date.UTC(2024, 10, 4, 13, 30)],
    ]) {
      const bars = [bar(before / 1000, 100, 101, 99, 100), bar(at / 1000, 101, 102, 100, 101)]
      const draws = run(bars, { ...quietHTF(), htf1Timeframe: '1D', customDaily: true, customDailyAt: '8:30' })
      expect(draws.filter((d) => d.kind === 'rectangle')).toHaveLength(2)
    }
  })

  it('uses NY overnight session ranges and honors the killzone timeframe limit', () => {
    const start = Date.UTC(2024, 0, 8, 23, 0) / 1000 // 18:00 Monday in New York
    const bars = Array.from({ length: 3 }, (_, i) => bar(start + i * 60, 100 + i, 102 + i, 99 + i, 101 + i))
    const inLimit = run(bars, { ...quietHTF(), showKillzone: true, showKzBoxes: true, kz1Show: true, kz1Session: '1800-2000', kz2Show: false, kz3Show: false, kz4Show: false, kz5Show: false }, '1m')
    const aboveLimit = run(bars, { ...quietHTF(), showKillzone: true, showKzBoxes: true, kz1Show: true, kz1Session: '1800-2000', kz2Show: false, kz3Show: false, kz4Show: false, kz5Show: false, tfLimit: '1' }, '5m')
    expect(inLimit.some((d) => d.kind === 'rectangle')).toBe(true)
    expect(aboveLimit.some((d) => d.kind === 'rectangle')).toBe(false)
  })

  it('confirms strict fractal pivots only after right-side bars arrive', () => {
    const start = Date.UTC(2024, 0, 8, 14, 30) / 1000
    const values = [[10,11,9,10],[10,12,8,11],[10,12,8,10],[10,15,9,10],[10,12,8,9],[10,11,8,10],[10,11,8,10]]
    const beforeConfirmation = values.slice(0, 5).map((v, i) => bar(start + i * 60, v[0], v[1], v[2], v[3]))
    const confirmed = values.map((v, i) => bar(start + i * 60, v[0], v[1], v[2], v[3]))
    const opts = { showFractals: true, swingLength: 3 }
    expect(run(beforeConfirmation, opts).some((d) => d.kind === 'marker' && d.style.char === '⮝')).toBe(false)
    expect(run(confirmed, opts).some((d) => d.kind === 'marker' && d.style.char === '⮝')).toBe(true)
  })
  it('renders volume imbalance separately from fair-value gaps', () => {
    const start = Date.UTC(2024, 0, 8, 14, 30) / 1000
    const values = [
      [110, 112, 90, 111], [111, 112, 110, 111], [111, 112, 110, 111], [111, 112, 110, 111], [111, 112, 110, 111],
      [100, 105, 99, 101], [100, 105, 99, 101], [100, 105, 99, 101], [100, 105, 99, 101], [100, 105, 99, 101],
    ]
    const bars = values.map((v, i) => bar(start + i * 60, v[0], v[1], v[2], v[3]))
    const withVi = run(bars, { ...quietHTF(), viShow: true })
    const withoutVi = run(bars, { ...quietHTF(), viShow: false })
    expect(withVi.filter((d) => d.kind === 'rectangle').length).toBeGreaterThan(withoutVi.filter((d) => d.kind === 'rectangle').length)
  })

  it('aggregates weekly bars across day boundaries and emits an enabled NY macro window', () => {
    const monday = Date.UTC(2024, 0, 8, 7, 45) / 1000
    const weekBars = [bar(monday, 100, 102, 99, 101), bar(monday + 60, 101, 103, 100, 102), bar(monday + 86400, 102, 104, 101, 103)]
    const weekly = run(weekBars, { ...quietHTF(), htf1Timeframe: '1W' })
    expect(weekly.filter((d) => d.kind === 'rectangle')).toHaveLength(1)

    const macroBars = Array.from({ length: 3 }, (_, i) => bar(monday + i * 60, 100, 102 + i, 99, 101))
    const macro = run(macroBars, { showMacro: true, macro1: true, macroLabel: true, macroTime: true })
    expect(macro.some((d) => d.kind === 'marker' && d.label?.includes('02:45'))).toBe(true)
  })

  it('exposes the full family settings with Pine defaults', () => {
    const settings = new Map(imDuyDescriptor.inputs.map((input) => [input.key, input.default]))
    expect(settings.get('htf6Timeframe')).toBe('1W')
    expect(settings.get('macro18')).toBe(false)
    expect(settings.get('kz4Show')).toBe(false)
    expect(settings.get('ipdaType')).toBe('CLASSIC')
    expect(settings.has('session1Show')).toBe(false)
    expect(imDuyDescriptor.inputs.some((input) => input.group !== undefined && /^Session [A-T]$/.test(input.group))).toBe(false)
  })

  it('does not draw removed Session A–T custom ranges even with stale inputs', () => {
    const first = Date.UTC(2024, 2, 11, 12, 0) / 1000
    const bars = [
      bar(first, 100, 101, 99, 100),
      bar(first + 30 * 60, 100, 102, 99, 101),
      bar(first + 60 * 60, 101, 103, 100, 102),
    ]
    const draws = run(bars, {
      session1Show: true,
      session1Range: true,
      session1Time: '0800-0900',
      session1Text: 'Asian A',
    })
    expect(draws.some((draw) => draw.label === 'Asian A')).toBe(false)
  })

  it('uses only completed supplied daily history for IPDA and ends boxes on a seen bar', () => {
    const start = Date.UTC(2024, 0, 1) / 1000
    const daily = Array.from({ length: 62 }, (_, index) => bar(start + index * 86400, 100, index === 61 ? 900 : 120, 80, 100))
    const chart = [daily[59], daily[60]]
    const draws = run(chart, { ipdaType: 'CLASSIC+LTF', plotType: 'Boxes', ipda20Show: true, showIpdaText: true }, '5m', daily)
    const discount = draws.find((draw) => draw.kind === 'rectangle' && draw.label === 'IPDA20')
    expect(discount?.t0).toBe(daily[40].time)
    expect(discount?.t1).toBe(chart[0].time)
  })
  it('draws open price to the pane edge from its opening candle', () => {
    const first = Date.UTC(2024, 0, 8, 13, 29) / 1000
    const bars = Array.from({ length: 5 }, (_, index) =>
      bar(first + index * 60, 100 + index, 102 + index, 99 + index, 101 + index))
    const draws = run(bars, {
      showOpenPrice: true,
      open1Show: false,
      open2Show: true,
      open3Show: false,
      open4Show: false,
      open5Show: false,
    })
    const ray = draws.find((draw) => draw.kind === 'ray' && draw.t0 === bars[1].time)
    expect(ray).toMatchObject({
      y0: bars[1].openTicks * tick,
      label: '08:30',
    })
    expect(ray?.t1).toBeUndefined()
    expect(ray?.style?.labelPosition).toBe('right')
    expect(draws.some((draw) => draw.kind === 'marker' && draw.label === '08:30')).toBe(false)
  })

  it('renders the watermark in screen space with source ticker, minute suffix and date', () => {
    const time = Date.UTC(2024, 0, 8, 14, 30) / 1000
    const draws = run([bar(time, 100, 102, 99, 101)], { watermarkShow: true }, '1m')
    const screenDraws = draws.filter((draw) => draw.kind === 'screenText')
    expect(screenDraws.map((draw) => draw.label)).toContain('TEXT')
    expect(screenDraws.map((draw) => draw.label)).toContain('PATIENCE  |  DISCIPLINE  |  FEARLESS')
    expect(screenDraws.map((draw) => draw.label)).toContain('8/1/2024')
    expect(screenDraws.map((draw) => draw.label)).toContain('NQ | 1M')
    expect(screenDraws.find((draw) => draw.label === 'TEXT')?.style.screenAnchor).toBe('top-center')
    expect(screenDraws.find((draw) => draw.label === 'NQ | 1M')?.style.screenAnchor).toBe('bottom-center')
  })

  it('renders IPDA Table A and B as top-right rows in 60, 40, 20 order', () => {
    const start = Date.UTC(2024, 0, 1) / 1000
    const daily = Array.from({ length: 62 }, (_, index) =>
      bar(start + index * 86400, 100, 120, 80, 100))
    const chart = [daily[59], daily[60]]
    const tableA = run(chart, {
      ipdaType: 'CLASSIC+LTF', plotType: 'Table A', watermarkShow: false,
    }, '5m', daily)
    const cellsA = tableA.filter((draw) => draw.kind === 'screenText')
    expect(cellsA.filter((draw) => draw.label?.startsWith('IPDA')).map((draw) => draw.label))
      .toEqual(['IPDA60', 'IPDA40', 'IPDA20'])
    expect(cellsA.filter((draw) => draw.label === 'Premium')).toHaveLength(3)
    expect(cellsA.every((draw) => draw.style.screenAnchor === 'top-right')).toBe(true)

    const tableB = run(chart, {
      ipdaType: 'CLASSIC+LTF', plotType: 'Table B', watermarkShow: false,
    }, '5m', daily)
    expect(tableB.filter((draw) => draw.kind === 'screenText' && draw.label?.endsWith('%'))
      .map((draw) => draw.label)).toEqual(['50.0%', '50.0%', '50.0%'])
  })
})
