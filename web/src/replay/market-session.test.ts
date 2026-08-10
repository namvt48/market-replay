import { describe, expect, it } from 'vitest'
import { isRegularTradingHours, nextRegularTradingTimestamp } from './market-session'

const seconds = (iso: string): number => Date.parse(iso) / 1000

describe('regular trading hours', () => {
  it('uses the 09:30 inclusive and 16:00 exclusive New York window', () => {
    expect(isRegularTradingHours(seconds('2026-08-10T13:29:00Z'), 'America/New_York')).toBe(false)
    expect(isRegularTradingHours(seconds('2026-08-10T13:30:00Z'), 'America/New_York')).toBe(true)
    expect(isRegularTradingHours(seconds('2026-08-10T19:59:00Z'), 'America/New_York')).toBe(true)
    expect(isRegularTradingHours(seconds('2026-08-10T20:00:00Z'), 'America/New_York')).toBe(false)
  })

  it('tracks daylight saving time and excludes weekends', () => {
    expect(isRegularTradingHours(seconds('2026-01-05T14:30:00Z'), 'America/New_York')).toBe(true)
    expect(isRegularTradingHours(seconds('2026-01-05T13:30:00Z'), 'America/New_York')).toBe(false)
    expect(isRegularTradingHours(seconds('2026-08-09T13:30:00Z'), 'America/New_York')).toBe(false)
  })

  it('skips the overnight and weekend gap when projecting chart whitespace', () => {
    const fridayClose = seconds('2026-08-14T19:59:00Z')
    expect(nextRegularTradingTimestamp(fridayClose, 60, 'America/New_York')).toBe(seconds('2026-08-17T13:30:00Z'))
    expect(nextRegularTradingTimestamp(seconds('2026-08-10T18:30:00Z'), 5 * 3600, 'America/New_York')).toBe(seconds('2026-08-11T13:30:00Z'))
  })
})
