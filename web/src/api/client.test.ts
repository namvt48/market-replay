import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchChartBarsAt, fetchEconWeek, fetchIndicators, runIndicator } from './client'
const indicatorMocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  run: vi.fn(),
}))

vi.mock('../replay/local-indicator-engine', () => ({
  localIndicatorCatalog: indicatorMocks.catalog,
  runLocalIndicator: indicatorMocks.run,
}))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  indicatorMocks.catalog.mockReset()
  indicatorMocks.run.mockReset()
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

  it('loads local descriptors and runs against spoiler-safe display bars', async () => {
    const descriptor = [{
      id: 'gb69-cbmor', name: 'GB69 CB MOR Range & Levels', version: 1,
      meta: { onMainPanel: true, format: 'inherit' },
      inputs: [{ kind: 'bool', key: 'show_lines', label: 'Show lines', default: true }],
    }]
    const result = { draws: [{ id: 1, kind: 'ray' as const, t0: 120, y0: 100, style: {} }], plots: [], onMainPanel: true }
    indicatorMocks.catalog.mockResolvedValue(descriptor)
    indicatorMocks.run.mockResolvedValue(result)
    const symbol = {
      symbol: 'NQ', name: 'Nasdaq', kind: 'future', tickSize: 0.25, pointValue: 20,
      currency: 'USD', priceDecimals: 2, sessionTz: 'America/New_York', rollRule: '',
      commissionPerSide: 0, defaultSlippageTicks: 0, ranges: {},
    }
    const bars = [
      { time: 120, openTicks: 400, highTicks: 404, lowTicks: 396, closeTicks: 402, volume: 10 },
      { time: 600, openTicks: 401, highTicks: 405, lowTicks: 397, closeTicks: 403, volume: 11 },
      { time: 660, openTicks: 402, highTicks: 406, lowTicks: 398, closeTicks: 404, volume: 12 },
    ]
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([symbol]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(bars), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchIndicators()).resolves.toEqual(descriptor)
    await expect(runIndicator('NQ', '5m', 'gb69-cbmor', 600, { show_lines: false })).resolves.toEqual(result)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/symbols')
    const request = new URL(String(fetchMock.mock.calls[1]?.[0]), 'http://localhost')
    expect(request.pathname).toBe('/api/v1/chart-bars/at')
    expect(request.searchParams.get('at')).toBe('600')
    expect(request.searchParams.get('to')).toBe('600')
    expect(request.searchParams.get('before')).toBe('1500')
    expect(indicatorMocks.run).toHaveBeenCalledWith('NQ', '5m', 'gb69-cbmor', bars.slice(0, 2), { show_lines: false }, 0.25, 'America/New_York', [], true, undefined)
    expect(request.searchParams.get('indicatorWindow')).toBe('1')
  })

  it('coalesces concurrent indicator history requests for one replay cursor', async () => {
    const symbol = {
      symbol: 'NQ', name: 'Nasdaq', kind: 'future', tickSize: 0.25, pointValue: 20,
      currency: 'USD', priceDecimals: 2, sessionTz: 'America/New_York', rollRule: '',
      commissionPerSide: 0, defaultSlippageTicks: 0, ranges: {},
    }
    const bars = [{ time: 600, openTicks: 400, highTicks: 404, lowTicks: 396, closeTicks: 402, volume: 10 }]
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const path = new URL(String(input), 'http://localhost').pathname
      return new Response(JSON.stringify(path === '/api/v1/symbols' ? [symbol] : bars), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    indicatorMocks.run.mockResolvedValue({ draws: [], plots: [] })

    await Promise.all([
      runIndicator('NQ', '1m', 'ema', 600, {}),
      runIndicator('NQ', '1m', 'rsi', 600, {}),
    ])

    const chartRequests = fetchMock.mock.calls.filter(([input]) =>
      new URL(String(input), 'http://localhost').pathname === '/api/v1/chart-bars/at')
    expect(chartRequests).toHaveLength(1)
    expect(indicatorMocks.run).toHaveBeenCalledTimes(2)
  })

  it('does not start local calculation after the caller has aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(runIndicator('NQ', '1m', 'killzones', 900, {}, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(indicatorMocks.run).not.toHaveBeenCalled()
  })
})
