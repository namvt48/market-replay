import { describe, expect, it } from 'vitest'
import type { ChartBarTicks } from '../api/types'
import { calculateLocalPlot } from './local-indicator-math'

const closes = (values: number[]): ChartBarTicks[] => values.map((closeTicks, index) => ({
  time: 1_700_000_000 + index * 60,
  openTicks: closeTicks,
  highTicks: closeTicks,
  lowTicks: closeTicks,
  closeTicks,
  volume: 1,
}))

describe('local indicator math', () => {
  it('waits for a full EMA seed and applies the recursive update in price units', () => {
    const bars = closes([100, 110, 120, 130])
    expect(calculateLocalPlot('ema', bars.slice(0, 2), 3, 0.25)).toEqual([])
    expect(calculateLocalPlot('ema', bars, 3, 0.25)).toEqual([
      { key: 'ema', time: bars[2].time, value: 27.5 },
      { key: 'ema', time: bars[3].time, value: 30 },
    ])
  })

  it('seeds Wilder RSI from exactly period changes and handles flat/all-loss windows', () => {
    const rising = closes([10, 11, 12, 13])
    expect(calculateLocalPlot('rsi', rising.slice(0, 3), 3, 1)).toEqual([])
    expect(calculateLocalPlot('rsi', rising, 3, 1)).toEqual([{ key: 'rsi', time: rising[3].time, value: 100 }])
    expect(calculateLocalPlot('rsi', closes([5, 5, 5]), 2, 1)[0].value).toBe(50)
    expect(calculateLocalPlot('rsi', closes([5, 4, 3]), 2, 1)[0].value).toBe(0)
  })
  it('rejects non-integral and out-of-range periods instead of emitting corrupted plots', () => {
    for (const period of [0, -1, 1.5, 501, Number.NaN]) {
      expect(() => calculateLocalPlot('ema', closes([100, 101]), period, 0.25)).toThrow('Invalid EMA period')
      expect(() => calculateLocalPlot('rsi', closes([100, 101]), period, 0.25)).toThrow('Invalid RSI period')
    }
  })
})
