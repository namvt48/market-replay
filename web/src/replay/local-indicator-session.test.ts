import { describe, expect, it } from 'vitest'
import type { ChartBarTicks } from '../api/types'
import { isIndicatorHistoryPrefix, sessionDayKey } from './local-indicator-session'

function bar(timestamp: string, closeTicks: number): ChartBarTicks {
  return {
    time: Date.parse(timestamp) / 1000,
    openTicks: closeTicks,
    highTicks: closeTicks + 1,
    lowTicks: closeTicks - 1,
    closeTicks,
    volume: 1,
  }
}

describe('indicator session-day ordering', () => {
  it.each([
    ['day 9 to 10', '2026-08-09T12:00:00Z', '2026-08-10T12:00:00Z'],
    ['September to October', '2026-09-30T12:00:00Z', '2026-10-01T12:00:00Z'],
  ])('orders %s chronologically', (_boundary, previous, next) => {
    const previousKey = sessionDayKey(Date.parse(previous) / 1000, 'UTC', false)
    const nextKey = sessionDayKey(Date.parse(next) / 1000, 'UTC', false)
    expect(previousKey < nextKey).toBe(true)
  })

  it.each([
    ['day 9 to 10', '2026-08-08T12:00:00Z', '2026-08-09T12:00:00Z', '2026-08-10T12:00:00Z'],
    ['September to October', '2026-09-29T12:00:00Z', '2026-09-30T12:00:00Z', '2026-10-01T12:00:00Z'],
  ])('invalidates changed daily history at the %s boundary', (_boundary, earlierDay, changedDay, currentDay) => {
    const previousBars = [bar(changedDay, 100)]
    const bars = [...previousBars, bar(currentDay, 101)]
    const previousDailyBars = [bar(earlierDay, 120), bar(changedDay, 130)]
    const dailyBars = [previousDailyBars[0], { ...previousDailyBars[1], highTicks: 140 }]

    expect(isIndicatorHistoryPrefix(previousBars, previousDailyBars, bars, dailyBars, 'UTC', false)).toBe(false)
  })

  it('assigns a futures bar at 18:00 to the next session day across month end', () => {
    const timestamp = Date.parse('2026-09-30T22:00:00Z') / 1000 // 18:00 in New York
    expect(sessionDayKey(timestamp, 'America/New_York', true)).toBe(20261001)
  })
})
