import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReplaySession } from '../../api/types'
import type { AnalyticsSource } from '../../api/analytics'
import { LiveAccountsScreen } from './LiveAccountsScreen'
import type { LiveCalendarReport } from './live-calendar'

const clientMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  fetchSessions: vi.fn(),
  patchSession: vi.fn(),
}))
const analyticsMocks = vi.hoisted(() => ({
  fetchAnalyticsSources: vi.fn(),
  fetchAnalyticsPerformance: vi.fn(),
}))
const storeMocks = vi.hoisted(() => ({
  loadLiveTemplates: vi.fn(),
  createLiveTemplate: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  createSession: clientMocks.createSession,
  fetchSessions: clientMocks.fetchSessions,
  patchSession: clientMocks.patchSession,
}))
vi.mock('../../api/analytics', () => ({
  fetchAnalyticsSources: analyticsMocks.fetchAnalyticsSources,
  fetchAnalyticsPerformance: analyticsMocks.fetchAnalyticsPerformance,
}))
vi.mock('../../store/live-store', () => ({
  loadLiveTemplates: storeMocks.loadLiveTemplates,
  createLiveTemplate: storeMocks.createLiveTemplate,
}))
vi.mock('./LiveJournalDetail', () => ({
  LiveJournalDetail: ({ sessionId, title }: { sessionId: string; title: string }) => (
    <div data-testid="live-journal-detail" data-session-id={sessionId} data-title={title} />
  ),
}))
vi.mock('./JournalComposer', () => ({
  JournalComposer: () => <div data-testid="journal-composer" />,
}))
vi.mock('./TemplateEditor', () => ({
  TemplateEditor: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>Close template editor</button>
  ),
}))
vi.mock('../analytics/PerformanceCalendar', () => ({
  PerformanceCalendar: ({ entries, initialDate }: { entries: unknown[]; initialDate: string }) => (
    <div data-testid="performance-calendar" data-entries={entries.length} data-initial-date={initialDate} />
  ),
}))

function liveSession(id: string, name: string, config: Record<string, unknown> | null = null): ReplaySession {
  return {
    id, name, symbol: 'LIVE', tf: '1d', startTs: 1, cursorTs: 1, equityCents: 1_000_000,
    status: 'active', kind: 'live', config, createdAt: 1, updatedAt: 1,
  }
}

function source(id: string, title: string, tradeCount: number): AnalyticsSource {
  return {
    id, type: 'live', title, subtitle: '', status: 'active', tradeCount, startedAt: null, endedAt: null,
  }
}

function performance(): LiveCalendarReport {
  return {
    source: { id: 'live-1' },
    overview: { accountBalance: 10100, totalPnl: 100 },
    riskReward: { series: { actual: [], ideal: [], missed: [] } },
    calendar: [{ date: '2026-01-05', trades: 1, wins: 1, losses: 0, breakeven: 0, pnl: 25, pnlPercent: 0.25, endingBalance: 10100 }],
  }
}

function renderScreen(): void {
  render(<LiveAccountsScreen />)
}

beforeEach(() => {
  clientMocks.createSession.mockReset().mockResolvedValue(undefined)
  clientMocks.patchSession.mockReset().mockResolvedValue(undefined)
  clientMocks.fetchSessions.mockReset().mockResolvedValue([
    liveSession('live-1', 'Account A'),
    liveSession('live-2', 'Funded B', { stage: 'funded' }),
  ])
  analyticsMocks.fetchAnalyticsSources.mockReset().mockResolvedValue([
    source('live-1', 'Account A', 3),
    source('live-2', 'Funded B', 5),
  ])
  analyticsMocks.fetchAnalyticsPerformance.mockReset()
    .mockImplementation((_: string, id: string) => Promise.resolve({ ...performance(), source: { id } }))
  storeMocks.loadLiveTemplates.mockReset().mockReturnValue([])
  storeMocks.createLiveTemplate.mockReset()
})

afterEach(cleanup)

describe('LiveAccountsScreen', () => {
  it('renders every live account with stage badge, trade count and pnl', async () => {
    renderScreen()

    expect(await screen.findByText('Account A')).toBeInTheDocument()
    expect(screen.getByText('Funded B')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark Account A funded' })).toHaveTextContent('EVAL')
    expect(screen.getByRole('button', { name: 'Mark Funded B eval' })).toHaveTextContent('FUNDED')
    expect(screen.getByText('3 trades')).toBeInTheDocument()
    expect(screen.getByText('5 trades')).toBeInTheDocument()
    expect(screen.getAllByText('$100')).toHaveLength(2)
  })

  it('disables account creation until a name is typed', async () => {
    const user = userEvent.setup()
    renderScreen()

    await screen.findByText('Account A')
    await user.click(screen.getByRole('button', { name: 'Create live account' }))

    const create = screen.getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: 'Account name' }), 'Two')
    expect(create).toBeEnabled()
    await user.click(create)

    await waitFor(() => expect(clientMocks.createSession).toHaveBeenCalledWith('LIVE', '1d', expect.any(Number), {
      kind: 'live', initialBalanceCents: 1_000_000, name: 'Two',
    }))
  })

  it('creates an account from just a name and closes the form', async () => {
    const user = userEvent.setup()
    renderScreen()

    await screen.findByText('Account A')
    await user.click(screen.getByRole('button', { name: 'Create live account' }))
    await user.type(screen.getByRole('textbox', { name: 'Account name' }), 'Month one')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(clientMocks.createSession).toHaveBeenCalledWith('LIVE', '1d', expect.any(Number), {
      kind: 'live', initialBalanceCents: 1_000_000, name: 'Month one',
    }))
    expect(clientMocks.fetchSessions).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('textbox', { name: 'Account name' })).not.toBeInTheDocument()
  })

  it('toggles an account stage between eval and funded', async () => {
    const user = userEvent.setup()
    renderScreen()

    const evalBadge = await screen.findByRole('button', { name: 'Mark Account A funded' })
    await user.click(evalBadge)
    await waitFor(() => expect(clientMocks.patchSession).toHaveBeenCalledWith('live-1', { config: { stage: 'funded' } }))

    const fundedBadge = await screen.findByRole('button', { name: 'Mark Funded B eval' })
    await user.click(fundedBadge)
    await waitFor(() => expect(clientMocks.patchSession).toHaveBeenCalledWith('live-2', { config: { stage: 'eval' } }))
  })

  it('opens the trade-entry dialog for the clicked account', async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByText('Account A'))

    const detail = screen.getByTestId('live-journal-detail')
    expect(detail).toHaveAttribute('data-session-id', 'live-1')
    expect(detail).toHaveAttribute('data-title', 'Account A')
  })

  it('renders a performance calendar merged across all accounts', async () => {
    renderScreen()

    await screen.findByText('Account A')

    await waitFor(() => expect(screen.getByTestId('performance-calendar')).toHaveAttribute('data-entries', '1'))
    expect(screen.getByTestId('performance-calendar')).toHaveAttribute('data-initial-date', '2026-01-05')
  })

  it('shows an empty state without the calendar when no accounts exist', async () => {
    clientMocks.fetchSessions.mockReset().mockResolvedValue([])
    analyticsMocks.fetchAnalyticsSources.mockReset().mockResolvedValue([])

    renderScreen()

    expect(await screen.findByText(/No live accounts yet/)).toBeInTheDocument()
    expect(screen.queryByTestId('performance-calendar')).not.toBeInTheDocument()
  })

  it('opens the stats template editor from the header', async () => {
    const user = userEvent.setup()
    renderScreen()

    await screen.findByText('Account A')
    await user.click(screen.getByRole('button', { name: 'Create stats template' }))

    expect(storeMocks.createLiveTemplate).toHaveBeenCalledWith('Untitled stats template')
    expect(screen.getByRole('button', { name: 'Close template editor' })).toBeVisible()
  })
})