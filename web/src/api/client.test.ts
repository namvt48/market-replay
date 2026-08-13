import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchChartBarsAt, fetchEconWeek, fetchIndicators, runIndicator } from './client'

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
      }, {
        id: 'uk-holiday', ts: 1_786_724_000, country: 'UK', currency: 'GBP', title: 'Bank Holiday',
        importance: 'none', released: false,
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
    expect(week.events[1].importance).toBe('none')
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

  it('loads indicator descriptors and runs one at the spoiler-safe cursor', async () => {
    const descriptor = [{
      id: 'gb69-cbmor', name: 'GB69 CBMOR', version: 1,
      meta: { onMainPanel: true, format: 'inherit' },
      inputs: [{ kind: 'bool', key: 'show_lines', label: 'Show lines', default: true }],
    }]
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(descriptor), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        draws: [
          { id: 1, kind: 'ray', label: 'NY EQ', t0: 120, y0: 20_000, style: { linecolor: '#5b8cff' } },
          { id: 2, kind: 'vline', t0: 180, y0: 0, style: { linecolor: '#898c96' } },
          { id: 3, kind: 'marker', label: '⮝', t0: 240, y0: 20_100, style: { color: '#ff5563' } },
        ],
        plots: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchIndicators()).resolves.toEqual(descriptor)
    await expect(runIndicator('NQ', '5m', 'gb69-cbmor', 600, { show_lines: false })).resolves.toMatchObject({
      draws: [{ kind: 'ray' }, { kind: 'vline' }, { kind: 'marker' }],
    })

    const request = new URL(String(fetchMock.mock.calls[1]?.[0]), 'http://localhost')
    expect(request.searchParams.get('symbol')).toBe('NQ')
    expect(request.searchParams.get('tf')).toBe('5m')
    expect(request.searchParams.get('at')).toBe('600')
    expect(request.searchParams.get('to')).toBe('600')
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ inputs: { show_lines: false } })
  })
})
