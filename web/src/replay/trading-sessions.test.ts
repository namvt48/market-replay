import { describe, expect, it } from 'vitest'
import type { ChartBarTicks } from '../api/types'
import { calculateTradingSessions, tradingSessionsDescriptor } from './trading-sessions'

function bar(time: string, highTicks = 10, lowTicks = 5): ChartBarTicks {
  return { time: Date.parse(time) / 1000, openTicks: lowTicks, highTicks, lowTicks, closeTicks: lowTicks, volume: 1 }
}

const run = (bars: ChartBarTicks[], inputs: Record<string, string | number | boolean> = {}) =>
  calculateTradingSessions(bars, inputs, 0.25, '1h', 'UTC').draws

describe('Trading Sessions indicator', () => {
  it('follows London local session time across winter and summer DST', () => {
    const bars = [
      bar('2024-01-15T07:30:00Z'), bar('2024-01-15T08:30:00Z'), bar('2024-07-15T06:30:00Z'), bar('2024-07-15T07:30:00Z'),
    ]
    const draws = run(bars, { sydneyEnabled: false, tokyoEnabled: false, 'new-yorkEnabled': false, londonStart: 800, londonEnd: 1700 })
    expect(draws).toHaveLength(2)
    expect(draws.map((draw) => draw.t0)).toEqual([bars[1].time, bars[3].time])
  })

  it('groups an overnight session on its starting local date across midnight', () => {
    const bars = [
      bar('2024-01-08T21:30:00Z', 12),
      bar('2024-01-08T23:30:00Z', 15),
      bar('2024-01-09T01:00:00Z', 20),
      bar('2024-01-09T02:00:00Z', 18),
    ]
    const draws = run(bars, {
      sydneyEnabled: false, tokyoEnabled: false, londonEnabled: true,
      'new-yorkEnabled': false, londonStart: '22:00', londonEnd: '02:00',
    })
    expect(draws).toHaveLength(1)
    expect(draws[0]).toMatchObject({ t0: bars[1].time, t1: bars[3].time, y0: 5, y1: 1.25 })
  })

  it('uses only the supplied prefix and keeps overlapping sessions independent', () => {
    const prefix = [bar('2024-01-08T08:00:00Z', 12), bar('2024-01-08T09:00:00Z', 16)]
    const inputs = { sydneyEnabled: false, tokyoEnabled: false, londonStart: '08:00', londonEnd: '12:00', 'new-yorkEnabled': true, 'new-yorkStart': '08:00', 'new-yorkEnd': '12:00', 'new-yorkTimezone': 'UTC', retainedSessions: 5 }
    const first = run(prefix, inputs)
    const extended = run([...prefix, bar('2024-01-08T10:00:00Z', 100)], inputs)
    expect(first).toHaveLength(2)
    expect(first.every((draw) => draw.y0 === 4 && draw.t1 === prefix[1].time)).toBe(true)
    expect(extended.every((draw) => draw.y0 === 25)).toBe(true)
    expect(first[0].label).toBe('London')
    expect(first[1].label).toBe('New York')
  })

  it('publishes settings values in the format its time controls emit', () => {
    const enabled = tradingSessionsDescriptor.inputs.find((input) => input.key === 'londonEnabled')
    const start = tradingSessionsDescriptor.inputs.find((input) => input.key === 'londonStart')
    const end = tradingSessionsDescriptor.inputs.find((input) => input.key === 'londonEnd')
    expect(enabled).toMatchObject({ kind: 'bool', default: true })
    expect(start).toMatchObject({ kind: 'time', default: 800 })
    expect(end).toMatchObject({ kind: 'time', default: 1700 })
  })
})
