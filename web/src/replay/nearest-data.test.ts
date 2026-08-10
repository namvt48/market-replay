import { describe, expect, it } from 'vitest'
import type { CalendarEntry } from '../api/types'
import { nearestDataTimestamp } from './nearest-data'

const calendar: CalendarEntry[] = [
  { date: '2024-01-05', firstTs: 100, lastTs: 200, bars: 10 },
  { date: '2024-01-08', firstTs: 400, lastTs: 500, bars: 10 },
]

describe('nearest data timestamp', () => {
  it('keeps timestamps that already fall on a data day', () => {
    expect(nearestDataTimestamp(calendar, 150)).toBe(150)
  })

  it('selects the closest available day and prefers the next day on a tie', () => {
    expect(nearestDataTimestamp(calendar, 300)).toBe(400)
  })

  it('can preserve a forward-only evaluation anchor', () => {
    expect(nearestDataTimestamp(calendar, 250, 'at-or-after')).toBe(400)
    expect(nearestDataTimestamp(calendar, 600, 'at-or-after')).toBe(500)
  })

  it('ignores calendar entries without usable bars', () => {
    expect(nearestDataTimestamp([{ date: '2024-01-06', firstTs: 0, lastTs: 0, bars: 0 }], 100)).toBeNull()
  })
})
