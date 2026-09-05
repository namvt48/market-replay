import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClosedTrade, ReplaySession } from '../../api/types'
import type { AnalyticsSource } from '../../api/analytics'
import { LiveAccountsScreen } from './LiveAccountsScreen'
import type { LiveCalendarReport } from './live-calendar'

const clientMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  fetchSessions: vi.fn(),
  patchSession: vi.fn(),
  deleteSession: vi.fn(),
  fetchTrades: vi.fn(),
}))
const analyticsMocks = vi.hoisted(() => ({
  fetchAnalyticsSources: vi.fn(),
  fetchAnalyticsPerformance: vi.fn(),
}))
const storeMocks = vi.hoisted(() => ({
  loadLiveTemplates: vi.fn(),
  createLiveTemplate: vi.fn(),
}))
const detailProps = vi.hoisted(() => ({ latest: {} as Record<string, unknown> }))

vi.mock('../../api/client', () => ({
  createSession: clientMocks.createSession,
  fetchSessions: clientMocks.fetchSessions,
  patchSession: clientMocks.patchSession,
  deleteSession: clientMocks.deleteSession,
  fetchTrades: clientMocks.fetchTrades,
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
  LiveJournalDetail: (props: { sessionId: string; title: string; stage: string; onDelete: () => Promise<void> }) => {
    detailProps.latest = props
    return (
      <div data-testid="live-journal-detail" data-session-id={props.sessionId} data-title={props.title} data-stage={props.stage}>
        <button type="button" onClick={() => void props.onDelete()}>Delete account</button>
      </div>
    )
  },
  StatCard: ({ label, value }: { label: string; value: string }) => <div data-testid="stat-card" data-label={label} data-value={value} />,
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
  PerformanceCalendar: ({ entries, initialDate, onSelectDate }: { entries: unknown[]; initialDate: string; onSelectDate?: (date: string) => void }) => (
    <div data-testid="performance-calendar" data-entries={entries.length} data-initial-date={initialDate}><button type="button" onClick={() => onSelectDate?.('2026-01-05')}>Open calendar day</button></div>
  ),
}))
vi.mock('../analytics/InteractiveAnalyticsCharts', () => ({
  LineChart: ({ values }: { values: number[] }) => <div data-testid="equity-chart" data-points={values.length} />,
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
    overview: { accountBalance: 10100, totalPnl: 100, winRate: 50, totalTrades: 4 },
    riskReward: { series: { actual: [], ideal: [], missed: [] }, averageRr: 1.25 },
    equityCurve: [{ tradeIndex: 0, tradeId: null, closedAt: null, cumulativePnl: 0, balance: 10100 }],
    calendar: [{ date: '2026-01-05', trades: 1, wins: 1, losses: 0, breakeven: 0, pnl: 25, pnlPercent: 0.25, endingBalance: 10100 }],
  }
}

function equityPerformance(closed: boolean): LiveCalendarReport {
  return {
    ...performance(),
    equityCurve: closed
      ? [
        { tradeIndex: 0, tradeId: 't1', closedAt: '2026-01-05T10:00:00Z', cumulativePnl: 0, balance: 10100 },
        { tradeIndex: 1, tradeId: 't2', closedAt: '2026-01-06T10:00:00Z', cumulativePnl: 25, balance: 10125 },
      ]
      : [{ tradeIndex: 0, tradeId: null, closedAt: null, cumulativePnl: 0, balance: 10100 }],
  }
}

function calendarTrade(): ClosedTrade {
  const exitTs = Date.UTC(2026, 0, 5, 14, 30)
  return {
    id: 'trade-day-1', sessionId: 'live-1', symbol: 'NQ', side: 'long', qty: 2,
    entryTs: exitTs - 1_800_000, entryPriceTicks: 20_000, exitTs, exitPriceTicks: 20_100,
    realizedCents: 12500, feesCents: 0, mfeTicks: 0, maeTicks: 0, rMultiple: null,
    initialStopTicks: null, initialTakeProfitTicks: null, protectionAdjustments: [], exitReason: 'manual', createdAt: exitTs,
  }
}

function renderScreen(): void {
  render(<LiveAccountsScreen />)
}

beforeEach(() => {
  clientMocks.createSession.mockReset().mockResolvedValue(undefined)
  clientMocks.patchSession.mockReset().mockResolvedValue(undefined)
  clientMocks.deleteSession.mockReset().mockResolvedValue(undefined)
  clientMocks.fetchTrades.mockReset().mockResolvedValue([])
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
  detailProps.latest = {}
})

afterEach(cleanup)

describe('LiveAccountsScreen', () => {
  it('renders every live account with stage badge, net P&L and analytics action', async () => {
    renderScreen()

    expect(await screen.findByText('Account A')).toBeInTheDocument()
    expect(screen.getByText('Funded B')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark Account A funded' })).toHaveTextContent('EVAL')
    expect(screen.getByRole('button', { name: 'Mark Funded B eval' })).toHaveTextContent('FUNDED')
    expect(screen.queryByText('3 trades')).not.toBeInTheDocument()
    expect(screen.queryByText('5 trades')).not.toBeInTheDocument()
    expect(screen.getAllByText('Net P&L')).toHaveLength(2)
    expect(screen.getAllByText('+$100.00')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Open analytics for Account A' })).toHaveAttribute('href', '/analytics?analytics=live-1&sourceType=live')
  })

  it('shows inline stats for an account when its row is clicked, and collapses again', async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('button', { name: 'Show stats for Account A' }))
    expect(screen.getByRole('button', { name: 'Show stats for Account A' })).toHaveAttribute('aria-expanded', 'true')

    const cards = screen.getAllByTestId('stat-card')
    expect(cards).toHaveLength(4)
    expect(cards[1]).toHaveAttribute('data-label', 'Win rate')
    expect(cards[1]).toHaveAttribute('data-value', '50.0%')
    expect(cards[3]).toHaveAttribute('data-label', 'Avg R')
    expect(cards[3]).toHaveAttribute('data-value', '+1.25R')

    await user.click(screen.getByRole('button', { name: 'Show stats for Account A' }))
    expect(screen.getByRole('button', { name: 'Show stats for Account A' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryAllByTestId('stat-card')).toHaveLength(0)
  })

  it('plots closed-trade equity points inside the inline stats', async () => {
    analyticsMocks.fetchAnalyticsPerformance.mockReset()
      .mockImplementation((_: string, id: string) => Promise.resolve({ ...equityPerformance(id === 'live-1'), source: { id } }))
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('button', { name: 'Show stats for Account A' }))
    expect(screen.getByTestId('equity-chart')).toHaveAttribute('data-points', '2')
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

  it('opens the account detail popup from the Detail button with the account stage', async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('button', { name: 'Open details for Account A' }))

    const detail = screen.getByTestId('live-journal-detail')
    expect(detail).toHaveAttribute('data-session-id', 'live-1')
    expect(detail).toHaveAttribute('data-title', 'Account A')
    expect(detail).toHaveAttribute('data-stage', 'eval')
    expect(screen.queryByText('Win rate')).not.toBeInTheDocument()
  })

  it('closes the popup and deletes the account after confirmation', async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('button', { name: 'Open details for Account A' }))
    expect(screen.getByTestId('live-journal-detail')).toBeInTheDocument()

    // The popup's onDelete removes the account and closes itself.
    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    await waitFor(() => expect(clientMocks.deleteSession).toHaveBeenCalledWith('live-1'))
    await waitFor(() => expect(screen.queryByTestId('live-journal-detail')).not.toBeInTheDocument())
  })

  it('renders a performance calendar merged across all accounts', async () => {
    renderScreen()

    await screen.findByText('Account A')

    await waitFor(() => expect(screen.getByTestId('performance-calendar')).toHaveAttribute('data-entries', '1'))
    expect(screen.getByTestId('performance-calendar')).toHaveAttribute('data-initial-date', '2026-01-05')
  })

  it('opens a calendar day dialog grouped by account and its trades', async () => {
    clientMocks.fetchTrades.mockImplementation((id: string) => Promise.resolve(id === 'live-1' ? [calendarTrade()] : []))
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('button', { name: 'Open calendar day' }))
    expect(await screen.findByRole('heading', { name: 'Trades · Jan 5, 2026' })).toBeVisible()
    expect(screen.getByText('NQ · Long')).toBeVisible()
    expect(screen.getByText('+$125.00')).toBeVisible()
    expect(clientMocks.fetchTrades).toHaveBeenCalledWith('live-1')
    expect(clientMocks.fetchTrades).toHaveBeenCalledWith('live-2')
  })

  it('keeps the performance calendar visible when no accounts exist', async () => {
    clientMocks.fetchSessions.mockReset().mockResolvedValue([])
    analyticsMocks.fetchAnalyticsSources.mockReset().mockResolvedValue([])

    renderScreen()

    expect(await screen.findByText(/No live accounts yet/)).toBeInTheDocument()
    expect(screen.getByTestId('performance-calendar')).toHaveAttribute('data-entries', '0')
    expect(screen.getByTestId('performance-calendar')).toHaveAttribute('data-initial-date', new Date().toISOString().slice(0, 10))
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
