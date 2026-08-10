import { describe, expect, it } from 'vitest'
import { normalizeTimeframe, parseTimeframe, sortTimeframes, timeframeSchema, timeframeSeconds } from './timeframe'

describe('timeframe domain', () => {
  it('sorts mixed timeframe values from shortest to longest', () => {
    expect(sortTimeframes(['1M', '1d', '15m', '2w', '2h', '1m', '7m', '1h', '1w'])).toEqual(['1m', '7m', '15m', '1h', '2h', '1d', '1w', '2w', '1M'])
  })

  it.each([
    ['1m', 60, false], ['5m', 300, false], ['15m', 900, false], ['1h', 3600, false], ['12h', 43_200, false], ['1d', 86_400, true],
    ['1w', 604_800, false], ['2w', 1_209_600, false], ['1M', 2_592_000, false], ['3M', 7_776_000, false],
  ])('parses %s', (input, seconds, daily) => {
    expect(parseTimeframe(input)).toMatchObject({ seconds, isSessionDaily: daily })
    expect(timeframeSeconds(input as `${number}${'m' | 'h' | 'd' | 'w' | 'M'}`)).toBe(seconds)
  })

  it('canonicalizes equivalent intraday inputs', () => {
    expect(normalizeTimeframe(' 60m ')).toBe('1h')
    expect(normalizeTimeframe('120m')).toBe('2h')
    expect(normalizeTimeframe('1440m')).toBe('1440m')
    expect(normalizeTimeframe('2W')).toBe('2w')
    expect(normalizeTimeframe('3M')).toBe('3M')
  })

  it.each(['0m', '1441m', '0h', '13h', '2d', '0w', '53w', '0M', '13M', 'm5', '', '1.5h'])('rejects %s', (input) => {
    expect(parseTimeframe(input)).toBeNull()
    expect(timeframeSchema.safeParse(input).success).toBe(false)
  })
})
