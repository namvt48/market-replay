import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '../../store/ui-store'
import { Sidebar } from './Sidebar'

const calendarFeature = vi.hoisted(() => ({ available: false, retry: vi.fn() }))
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
vi.mock('../sessions/SessionsPanel', () => ({ SessionsPanel: () => <div>Sessions panel</div> }))
vi.mock('../../replay/use-replay', () => ({
  useReplaySelector: (selector: (snapshot: typeof replaySnapshot) => unknown) => selector(replaySnapshot),
}))
vi.mock('../../replay/replay-engine', () => ({ replayEngine: {
  placeMarket: vi.fn(), setQty: vi.fn(), placeBracket: vi.fn(), flatten: vi.fn(), reverse: vi.fn(), cancelOrder: vi.fn(),
} }))
vi.mock('../../store/eval-store', () => ({
  useEvalStore: (selector: (state: { accountId: null }) => unknown) => selector({ accountId: null }),
}))

beforeEach(() => {
  calendarFeature.available = false
  useUiStore.setState({ sidebarOpen: true, sidebarTab: 'trade' })
})

afterEach(cleanup)

describe('Sidebar economic calendar tab', () => {
  it('hides Calendar when the optional dataset is unavailable', () => {
    render(<Sidebar />)
    expect(screen.queryByRole('button', { name: 'Calendar' })).not.toBeInTheDocument()
  })

  it('shows Calendar from metadata and opens the weekly panel', async () => {
    const user = userEvent.setup()
    calendarFeature.available = true
    render(<Sidebar />)

    await user.click(screen.getByRole('button', { name: 'Calendar' }))

    expect(screen.getByText('Economic calendar panel')).toBeVisible()
  })
})
