import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '../../store/ui-store'
import { Sidebar } from './Sidebar'

const calendarFeature = vi.hoisted(() => ({ available: false, retry: vi.fn() }))
const evalState = vi.hoisted(() => ({ phase: 'idle' }))
const replaySnapshot = {
  fill: null,
  symbol: null,
  lastBar: null,
  qty: 1,
  status: 'ready',
  replayMode: 'inactive',
  sessionStatus: null,
  sessionId: null,
}

vi.mock('../calendar/EconomicCalendarPanel', () => ({
  EconomicCalendarPanel: () => <div>Economic calendar panel</div>,
  CalendarErrorPanel: () => <div>Calendar error panel</div>,
}))
vi.mock('../calendar/use-econ-meta', () => ({
  useEconMeta: () => ({
    state: { status: 'success', data: { available: calendarFeature.available, count: 9, firstTs: 1, lastTs: 2, countries: ['US'] } },
    retry: calendarFeature.retry,
  }),
}))
vi.mock('../eval/EvaluationPanel', () => ({ EvaluationPanel: () => <div>Evaluation panel</div> }))
vi.mock('../live/LivePanel', () => ({ LivePanel: () => <div>Live panel</div> }))
vi.mock('../sessions/SessionsPanel', () => ({ SessionsPanel: () => <div>Sessions panel</div> }))
vi.mock('../review/ReviewPanel', () => ({ ReviewPanel: () => <div>Review panel</div> }))
vi.mock('../../replay/use-replay', () => ({
  useReplaySelector: (selector: (snapshot: typeof replaySnapshot) => unknown) => selector(replaySnapshot),
}))
vi.mock('../../replay/replay-engine', () => ({ replayEngine: {
  placeMarket: vi.fn(), setQty: vi.fn(), placeBracket: vi.fn(), flatten: vi.fn(), reverse: vi.fn(), cancelOrder: vi.fn(),
} }))
vi.mock('../../store/eval-store', () => ({
  useEvalStore: (selector: (state: { accountId: null; phase: string }) => unknown) => selector({ accountId: null, phase: evalState.phase }),
  loadEvalAccounts: () => [],
}))

beforeEach(() => {
  calendarFeature.available = false
  evalState.phase = 'idle'
  useUiStore.setState({ sidebarOpen: true, sidebarTab: 'sessions', reviewSource: null })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [
    { id: 'journal-1', type: 'session', title: 'Verified journal', subtitle: 'March 2025', status: 'completed', tradeCount: 24, startedAt: null, endedAt: null },
    { id: 'eval-1', type: 'evaluation', title: '50K evaluation', subtitle: 'Active account', status: 'active', tradeCount: 12, startedAt: null, endedAt: null },
  ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Sidebar economic calendar tab', () => {
  it('hides Calendar when the optional dataset is unavailable', () => {
    render(<Sidebar />)
    expect(screen.queryByRole('tab', { name: 'Calendar' })).not.toBeInTheDocument()
  })

  it('shows Calendar from metadata and opens the weekly panel', async () => {
    const user = userEvent.setup()
    calendarFeature.available = true
    render(<Sidebar />)

    const labels = [...screen.getByRole('navigation', { name: 'Workspace panels' }).querySelectorAll('button')].map((button) => button.textContent)
    expect(labels).toEqual(['Sessions', 'Eval', 'Live', 'Calendar'])

    await user.click(screen.getByRole('tab', { name: 'Calendar' }))

    expect(screen.getByText('Economic calendar panel')).toBeVisible()
  })

  it('removes Analytics from the sidebar while gracefully rendering an old persisted analytics tab as Sessions', () => {
    useUiStore.setState({ sidebarOpen: true, sidebarTab: 'analytics', reviewSource: null })
    render(<Sidebar />)

    expect(screen.queryByRole('tab', { name: 'Analytics' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Sessions panel')).toBeVisible()
  })

  it('keeps Review contextual and removes the obsolete Trade tab', () => {
    render(<Sidebar />)
    expect(screen.getByRole('tab', { name: 'Sessions' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Journal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Trade' })).not.toBeInTheDocument()
  })

  it('replaces the tab list with a review bar and returns to the sessions tab on Back', async () => {
    const user = userEvent.setup()
    useUiStore.setState({ sidebarOpen: true, sidebarTab: 'review', reviewSource: { id: 's1', type: 'session', title: 'S1' } })
    render(<Sidebar />)

    expect(screen.getByRole('button', { name: 'Back to Sessions' })).toBeVisible()
    expect(screen.getByText('Review')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back to Sessions' }))
    expect(useUiStore.getState().sidebarTab).toBe('sessions')
  })

  it('returns to the evaluation tab from review when the source is an evaluation', async () => {
    const user = userEvent.setup()
    useUiStore.setState({ sidebarOpen: true, sidebarTab: 'review', reviewSource: { id: 'e1', type: 'evaluation', title: 'E1' } })
    render(<Sidebar />)

    expect(screen.getByRole('button', { name: 'Back to Eval' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Back to Sessions' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back to Eval' }))
    expect(useUiStore.getState().sidebarTab).toBe('evaluation')
  })

  it('moves tab activation with ArrowRight and keeps roving focus', async () => {
    const user = userEvent.setup()
    calendarFeature.available = true
    render(<Sidebar />)

    const sessionsTab = screen.getByRole('tab', { name: 'Sessions' })
    expect(sessionsTab).toHaveAttribute('tabindex', '0')
    sessionsTab.focus()
    await user.keyboard('{ArrowRight}')

    const evalTab = screen.getByRole('tab', { name: 'Evaluation accounts' })
    expect(evalTab).toHaveFocus()
    expect(evalTab).toHaveAttribute('aria-selected', 'true')
    expect(useUiStore.getState().sidebarTab).toBe('evaluation')
  })

  it('marks the Eval tab live with an accessible name and indicator dot while running', () => {
    evalState.phase = 'running'
    render(<Sidebar />)

    const evalTab = screen.getByRole('tab', { name: 'Evaluation accounts, live' })
    expect(evalTab).toContainElement(document.querySelector('[data-tab-id="evaluation"] span[aria-hidden="true"].bg-active'))
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true')
  })
})
