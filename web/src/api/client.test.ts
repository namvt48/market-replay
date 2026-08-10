import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchChartBarsAt, fetchEconWeek } from './client'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('API client transient recovery', () => {
  it('retries an idempotent GET after one transient network failure', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const assertion = expect(fetchChartBarsAt('NQ', '1m', 120, 240, 0, 120)).resolves.toEqual([])
    await vi.runAllTimersAsync()

    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-transient client response', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValue(new Response('invalid timeframe', { status: 400, statusText: 'Bad Request' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchChartBarsAt('NQ', '1m', 120, 240, 0, 120)).rejects.toThrow('400 Bad Request')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps calendar week selection separate from the spoiler cursor', async () => {
    const payload = {
      weekStart: 1_786_334_400,
      weekEnd: 1_786_939_200,
      timeZone: 'America/New_York',
      cursorTs: 1_786_377_600,
      events: [{
        id: 'us-cpi', ts: 1_786_723_800, country: 'US', currency: 'USD', title: 'CPI m/m',
        importance: 'high', forecast: '0.2%', previous: '0.3%', released: false,
      }],
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const week = await fetchEconWeek({
      at: payload.weekEnd,
      cursorTs: payload.cursorTs,
      timeZone: payload.timeZone,
      minImportance: 'high',
      countries: ['US', 'EU'],
    })

    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost')
    expect(requested.searchParams.get('at')).toBe(String(payload.weekEnd))
    expect(requested.searchParams.get('cursorTs')).toBe(String(payload.cursorTs))
    expect(requested.searchParams.get('tz')).toBe(payload.timeZone)
    expect(requested.searchParams.getAll('country')).toEqual(['US', 'EU'])
    expect(Object.hasOwn(week.events[0], 'actual')).toBe(false)
  })

  it('rejects an actual value attached to an unreleased calendar event', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      weekStart: 1_786_334_400,
      weekEnd: 1_786_939_200,
      timeZone: 'America/New_York',
      cursorTs: 1_786_377_600,
      events: [{
        id: 'future-cpi', ts: 1_786_723_800, country: 'US', title: 'CPI m/m',
        importance: 'high', released: false, actual: '0.4%',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchEconWeek({
      at: 1_786_334_400,
      cursorTs: 1_786_377_600,
      timeZone: 'America/New_York',
    })).rejects.toThrow()
  })
})
