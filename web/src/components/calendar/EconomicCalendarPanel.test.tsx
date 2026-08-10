import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EconMeta, EconWeek } from '../../api/types'
import { EconomicCalendarPanel } from './EconomicCalendarPanel'

const apiMocks = vi.hoisted(() => ({ fetchEconWeek: vi.fn(), fetchEconMeta: vi.fn() }))
const replaySnapshot = {
  cursorTs: 1_786_377_600,
  symbol: { sessionTz: 'America/New_York' },
}

vi.mock('../../api/client', () => ({
  fetchEconMeta: apiMocks.fetchEconMeta,
  fetchEconWeek: apiMocks.fetchEconWeek,
}))
vi.mock('../../replay/use-replay', () => ({
  useReplaySelector: (selector: (snapshot: typeof replaySnapshot) => unknown) => selector(replaySnapshot),
}))

const meta: EconMeta = {
  available: true,
  count: 9,
  firstTs: 1_786_334_400,
  lastTs: 1_787_544_000,
  countries: ['EU', 'US'],
}

const week: EconWeek = {
  weekStart: 1_786_334_400,
  weekEnd: 1_786_939_200,
  timeZone: 'America/New_York',
  cursorTs: replaySnapshot.cursorTs,
  events: [
    {
      id: 'us-ism', ts: replaySnapshot.cursorTs - 3_600, country: 'US', currency: 'USD',
      title: 'ISM Manufacturing PMI', importance: 'medium', forecast: '50.5', previous: '49.8', released: true, actual: '51.0',
    },
    {
      id: 'us-jolts', ts: replaySnapshot.cursorTs + 3_600, country: 'US', currency: 'USD',
      title: 'JOLTS Job Openings', importance: 'high', forecast: '7.40M', previous: '7.30M', released: false,
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  replaySnapshot.cursorTs = week.cursorTs
  apiMocks.fetchEconWeek.mockResolvedValue(week)
})

afterEach(cleanup)

describe('EconomicCalendarPanel', () => {
  it('renders the replay week without revealing an unreleased actual', async () => {
    render(<EconomicCalendarPanel meta={meta} />)

    expect(await screen.findByText('ISM Manufacturing PMI')).toBeVisible()
    expect(screen.getByText('51.0')).toBeVisible()
    expect(screen.getByText('JOLTS Job Openings')).toBeVisible()
    expect(screen.getByText('NEXT')).toBeVisible()
    expect(screen.getByLabelText('Actual not released')).toHaveTextContent('—')
    expect(apiMocks.fetchEconWeek).toHaveBeenCalledWith(expect.objectContaining({
      at: week.cursorTs,
      cursorTs: week.cursorTs,
      timeZone: 'America/New_York',
    }), expect.any(AbortSignal))
  })

  it('pages by server-provided week bounds while preserving the replay cursor', async () => {
    const user = userEvent.setup()
    const nextWeek = { ...week, weekStart: week.weekEnd, weekEnd: week.weekEnd + 604_800, events: [] }
    apiMocks.fetchEconWeek.mockResolvedValueOnce(week).mockResolvedValueOnce(nextWeek)
    render(<EconomicCalendarPanel meta={meta} />)
    await screen.findByText('ISM Manufacturing PMI')

    await user.click(screen.getByRole('button', { name: 'Next calendar week' }))

    await waitFor(() => expect(apiMocks.fetchEconWeek).toHaveBeenLastCalledWith(expect.objectContaining({
      at: week.weekEnd,
      cursorTs: week.cursorTs,
    }), expect.any(AbortSignal)))
    expect(await screen.findByRole('button', { name: 'Return to replay week' })).toBeVisible()
  })

  it('refetches at a known release boundary and then reveals the actual', async () => {
    const releasedWeek: EconWeek = {
      ...week,
      cursorTs: week.events[1].ts,
      events: week.events.map((event) => event.id === 'us-jolts' ? { ...event, released: true, actual: '7.52M' } : event),
    }
    apiMocks.fetchEconWeek.mockResolvedValueOnce(week).mockResolvedValueOnce(releasedWeek)
    const view = render(<EconomicCalendarPanel meta={meta} />)
    await screen.findByText('JOLTS Job Openings')

    replaySnapshot.cursorTs = week.events[1].ts
    view.rerender(<EconomicCalendarPanel meta={meta} />)

    expect(await screen.findByText('7.52M')).toBeVisible()
    expect(apiMocks.fetchEconWeek).toHaveBeenLastCalledWith(expect.objectContaining({
      cursorTs: week.events[1].ts,
    }), expect.any(AbortSignal))
  })

  it('sends impact and country filters through the week request', async () => {
    const user = userEvent.setup()
    render(<EconomicCalendarPanel meta={meta} />)
    await screen.findByText('ISM Manufacturing PMI')

    await user.selectOptions(screen.getByLabelText('Minimum importance'), 'high')
    await user.selectOptions(screen.getByLabelText('Country'), 'EU')

    await waitFor(() => expect(apiMocks.fetchEconWeek).toHaveBeenLastCalledWith(expect.objectContaining({
      minImportance: 'high',
      countries: ['EU'],
    }), expect.any(AbortSignal)))
  })
})
