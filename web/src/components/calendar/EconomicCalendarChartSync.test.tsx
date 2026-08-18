import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EconWeek } from '../../api/types'
import { useUiStore } from '../../store/ui-store'
import { EconomicCalendarChartSync } from './EconomicCalendarChartSync'
import { economicCalendarWeekKey } from './calendar-week'

const apiMocks = vi.hoisted(() => ({ fetchEconWeek: vi.fn() }))
const engineMocks = vi.hoisted(() => ({ setEconomicEventMarkers: vi.fn() }))
const replaySnapshot = { cursorTs: Date.parse('2026-08-11T13:00:00Z') / 1000, symbol: { sessionTz: 'America/New_York' } }
const workspaceMock = {
  state: {
    activePaneId: 'pane-1',
    timezone: { kind: 'preset' as const, id: 'ET' as 'ET' | 'UTC' },
    panes: { 'pane-1': { settings: { timezone: { kind: 'preset' as const, id: 'ET' as 'ET' | 'UTC' } } } },
  },
}

vi.mock('../../api/client', () => ({ fetchEconWeek: apiMocks.fetchEconWeek }))
vi.mock('../../replay/replay-engine', () => ({ replayEngine: engineMocks }))
vi.mock('../../replay/use-replay', () => ({
  useReplaySelector: (selector: (snapshot: typeof replaySnapshot) => unknown) => selector(replaySnapshot),
}))
vi.mock('../../chart-workspace/use-chart-workspace', () => ({ useChartWorkspace: () => workspaceMock }))

const week: EconWeek = {
  weekStart: Date.parse('2026-08-10T04:00:00Z') / 1000,
  weekEnd: Date.parse('2026-08-17T04:00:00Z') / 1000,
  cursorTs: replaySnapshot.cursorTs,
  timeZone: 'America/New_York',
  events: [
    { id: 'past', ts: replaySnapshot.cursorTs - 3_600, country: 'US', title: 'Past', importance: 'low', released: true },
    { id: 'next', ts: replaySnapshot.cursorTs + 3_600, country: 'US', title: 'Next', importance: 'high', released: false },
    { id: 'same-time', ts: replaySnapshot.cursorTs + 3_600, country: 'US', title: 'Same time', importance: 'medium', released: false },
    { id: 'later', ts: replaySnapshot.cursorTs + 7_200, country: 'EU', title: 'Later', importance: 'medium', released: false },
  ],
}

const nextWeek: EconWeek = {
  ...week,
  weekStart: week.weekEnd,
  weekEnd: week.weekEnd + 604_800,
  events: [
    { id: 'next-week-cpi', ts: week.weekEnd + 3_600, country: 'US', title: 'Next week CPI', importance: 'high', released: false },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  replaySnapshot.cursorTs = Date.parse('2026-08-11T13:00:00Z') / 1000
  workspaceMock.state.timezone = { kind: 'preset', id: 'ET' }
  useUiStore.setState({ calendarImportance: 'high', calendarCountry: 'US' })
  apiMocks.fetchEconWeek.mockImplementation(async (query: { at: number }) => query.at >= week.weekEnd ? nextWeek : week)
})

afterEach(cleanup)

describe('EconomicCalendarChartSync', () => {
  it('uses the global workspace timezone for marker week requests', async () => {
    workspaceMock.state.timezone = { kind: 'preset', id: 'UTC' }
    workspaceMock.state.panes['pane-1'].settings.timezone = { kind: 'preset', id: 'ET' }
    render(<EconomicCalendarChartSync />)

    await waitFor(() => expect(apiMocks.fetchEconWeek).toHaveBeenNthCalledWith(1, expect.objectContaining({ timeZone: 'UTC' }), expect.any(AbortSignal)))
  })

  it('fetches the replay and following week, then advances the highlighted marker locally', async () => {
    const view = render(<EconomicCalendarChartSync />)
    await waitFor(() => expect(engineMocks.setEconomicEventMarkers).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'next', state: 'next' }),
      expect.objectContaining({ id: 'next-week-cpi', state: 'scheduled' }),
    ]))
    expect(apiMocks.fetchEconWeek).toHaveBeenNthCalledWith(1, expect.objectContaining({ countries: ['US'], minImportance: 'high' }), expect.any(AbortSignal))
    expect(apiMocks.fetchEconWeek).toHaveBeenNthCalledWith(2, expect.objectContaining({ at: week.weekEnd, countries: ['US'], minImportance: 'high' }), expect.any(AbortSignal))

    replaySnapshot.cursorTs = week.events[1].ts
    view.rerender(<EconomicCalendarChartSync />)

    await waitFor(() => expect(engineMocks.setEconomicEventMarkers).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'next', state: 'past' }),
      expect.objectContaining({ id: 'next-week-cpi', state: 'next' }),
    ]))
    expect(apiMocks.fetchEconWeek).toHaveBeenCalledTimes(2)
  })

  it('does not sort the stable event list again when only the cursor advances', async () => {
    const view = render(<EconomicCalendarChartSync />)
    await waitFor(() => expect(engineMocks.setEconomicEventMarkers).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'next', state: 'next' }),
      expect.objectContaining({ id: 'next-week-cpi', state: 'scheduled' }),
    ]))
    const sort = vi.spyOn(Array.prototype, 'sort')

    replaySnapshot.cursorTs = week.events[1].ts
    view.rerender(<EconomicCalendarChartSync />)

    await waitFor(() => expect(engineMocks.setEconomicEventMarkers).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'next', state: 'past' }),
      expect.objectContaining({ id: 'next-week-cpi', state: 'next' }),
    ]))
    expect(sort).not.toHaveBeenCalled()
    sort.mockRestore()
  })

  it('uses the same live impact and country filters as the Calendar panel', async () => {
    render(<EconomicCalendarChartSync />)
    await waitFor(() => expect(apiMocks.fetchEconWeek).toHaveBeenCalledTimes(2))
    apiMocks.fetchEconWeek.mockClear()

    useUiStore.getState().setCalendarImportance('medium')
    useUiStore.getState().setCalendarCountry('')

    await waitFor(() => expect(apiMocks.fetchEconWeek).toHaveBeenNthCalledWith(1, expect.objectContaining({
      minImportance: 'medium', countries: undefined,
    }), expect.any(AbortSignal)))
    await waitFor(() => expect(engineMocks.setEconomicEventMarkers).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'next' }),
      expect.objectContaining({ id: 'same-time' }),
      expect.objectContaining({ id: 'later' }),
      expect.objectContaining({ id: 'next-week-cpi' }),
    ]))
  })

  it('uses the local Monday across a daylight-saving week', () => {
    expect(economicCalendarWeekKey(Date.parse('2026-11-01T15:00:00Z') / 1000, 'America/New_York')).toBe('2026-10-26')
    expect(economicCalendarWeekKey(Date.parse('2026-11-02T15:00:00Z') / 1000, 'America/New_York')).toBe('2026-11-02')
  })
})
