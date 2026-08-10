import { describe, expect, it } from 'vitest'
import { sessionDateValue, sessionOpenTimestamp } from './session-date'

describe('session calendar dates', () => {
  it('opens every selected New York date at 09:30 across DST', () => {
    expect(sessionOpenTimestamp('2024-01-02', 'America/New_York')).toBe(Date.parse('2024-01-02T14:30:00Z') / 1_000)
    expect(sessionOpenTimestamp('2024-07-02', 'America/New_York')).toBe(Date.parse('2024-07-02T13:30:00Z') / 1_000)
  })

  it('formats the selected day in the session timezone', () => {
    expect(sessionDateValue(Date.parse('2024-07-03T01:00:00Z') / 1_000, 'America/New_York')).toBe('2024-07-02')
  })

  it('rejects malformed calendar values', () => {
    expect(sessionOpenTimestamp('07/02/2024', 'America/New_York')).toBeNull()
  })
})
