import { describe, expect, it } from 'vitest'
import { chartTimezoneDateValue, chartTimezoneDisplayTimestamp, chartTimezoneIntlContext, chartTimezoneQueryValue, formatChartTime, parseChartTimezone, timezoneLabel, type ChartTimezone } from './chart-timezone'

const epoch = (iso: string): number => Date.parse(iso) / 1000
const preset = (id: 'ET' | 'CT' | 'MT' | 'PT' | 'UTC'): ChartTimezone => ({ kind: 'preset', id })

describe('chart timezone formatting', () => {
  it('handles US daylight-saving spring and fall boundaries', () => {
    expect(formatChartTime(epoch('2024-03-10T06:30:00Z'), preset('ET'))).toContain('01:30')
    expect(formatChartTime(epoch('2024-03-10T07:30:00Z'), preset('ET'))).toContain('03:30')
    expect(formatChartTime(epoch('2024-11-03T05:30:00Z'), preset('ET'))).not.toMatch(/EDT|EST|:\d{2}:\d{2}/)
    expect(formatChartTime(epoch('2024-11-03T06:30:00Z'), preset('ET'))).toContain('2024')
  })

  it.each([
    ['CT', '2024-03-10T07:30:00Z', '01:30', '2024-03-10T08:30:00Z', '03:30'],
    ['MT', '2024-03-10T08:30:00Z', '01:30', '2024-03-10T09:30:00Z', '03:30'],
    ['PT', '2024-03-10T09:30:00Z', '01:30', '2024-03-10T10:30:00Z', '03:30'],
  ] as const)('handles %s spring DST rollover', (id, before, expectedBefore, after, expectedAfter) => {
    expect(formatChartTime(epoch(before), preset(id))).toContain(expectedBefore)
    expect(formatChartTime(epoch(after), preset(id))).toContain(expectedAfter)
  })

  it.each([
    ['CT', '19:00'], ['MT', '18:00'], ['PT', '17:00'], ['UTC', '01:00'],
  ] as const)('formats %s without changing the input epoch', (id, expected) => {
    const timestamp = epoch('2024-01-02T01:00:00Z')
    expect(formatChartTime(timestamp, preset(id))).toContain(expected)
    expect(timestamp).toBe(epoch('2024-01-02T01:00:00Z'))
  })

  it.each([[330, 'UTC+05:30'], [420, 'UTC+07:00'], [-480, 'UTC−08:00']] as const)('formats fixed offset %s', (minutes, label) => {
    const timezone: ChartTimezone = { kind: 'offset', minutes }
    expect(timezoneLabel(timezone)).toBe(label)
    expect(formatChartTime(epoch('2024-01-01T23:30:00Z'), timezone)).not.toContain(label)
  })

  it('provides matching calendar query and Intl contexts for chart timezones', () => {
    expect(chartTimezoneQueryValue(preset('ET'))).toBe('America/New_York')
    const fixed: ChartTimezone = { kind: 'offset', minutes: 450 }
    expect(chartTimezoneQueryValue(fixed)).toBe('UTC+07:30')
    expect(chartTimezoneIntlContext(fixed)).toEqual({ timeZone: 'UTC', offsetSeconds: 27_000 })
    expect(chartTimezoneDisplayTimestamp(epoch('2026-08-07T12:00:00Z'), fixed)).toBe(epoch('2026-08-07T19:30:00Z'))
  })

  it('derives date input values in the workspace timezone', () => {
    const timestamp = epoch('2026-08-07T22:30:00Z')
    expect(chartTimezoneDateValue(timestamp, preset('UTC'))).toBe('2026-08-07')
    expect(chartTimezoneDateValue(timestamp, { kind: 'offset', minutes: 420 })).toBe('2026-08-08')
  })

  it('recovers invalid persisted timezones', () => {
    expect(parseChartTimezone({ kind: 'offset', minutes: 841 })).toEqual({ kind: 'preset', id: 'ET' })
    expect(parseChartTimezone({ kind: 'preset', id: 'CET' })).toEqual({ kind: 'preset', id: 'ET' })
  })
})
