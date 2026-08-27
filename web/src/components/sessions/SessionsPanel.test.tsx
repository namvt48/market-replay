import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClosedTrade, ReplaySession } from '../../api/types'
import { shortReplaySessionHash } from '../../replay/session-state'
import { useUiStore } from '../../store/ui-store'
import { SessionsPanel } from './SessionsPanel'
import { tradeHistoryCsv } from './trade-history-csv'

vi.mock('../../chart-workspace/use-chart-workspace', () => ({ useChartWorkspace: () => ({ state: { timezone: { kind: 'preset', id: 'ET' } } }) }))

const mocks = vi.hoisted(() => ({
  fetchSessions: vi.fn(),
  fetchTrades: vi.fn(),
  deleteSession: vi.fn(),
  deleteEmptySessions: vi.fn(),
  patchSession: vi.fn(),
  beginReplaySelection: vi.fn(),
  resumeSession: vi.fn(),
  pauseReplaySession: vi.fn(),
  stopReplaySession: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  fetchSessions: mocks.fetchSessions,
  fetchTrades: mocks.fetchTrades,
  deleteSession: mocks.deleteSession,
  deleteEmptySessions: mocks.deleteEmptySessions,
  patchSession: mocks.patchSession,
}))
vi.mock('../../replay/replay-engine', () => ({ replayEngine: {
  beginReplaySelection: mocks.beginReplaySelection,
  resumeSession: mocks.resumeSession,
  pauseReplaySession: mocks.pauseReplaySession,
  stopReplaySession: mocks.stopReplaySession,
} }))
const sessionSnapshot: { sessionId: string | null; sessionStatus: 'active' | 'paused' | 'stopped' | null; fill: null } = { sessionId: null, sessionStatus: null, fill: null }
vi.mock('../../replay/use-replay', () => ({
  useReplaySnapshot: () => sessionSnapshot,
  useReplaySelector: (select: (value: typeof sessionSnapshot) => unknown) => select(sessionSnapshot),
}))

const saved: ReplaySession = {
  id: '018f08de-1111-7222-8333-abcdef123456', name: '', symbol: 'NQ', tf: '5m', startTs: 1_700_000_000,
  cursorTs: 1_700_007_200, equityCents: 1_025_000, status: 'paused', kind: 'replay', config: {}, createdAt: 1_700_000_000, updatedAt: 1_700_007_200,
}
const trade: ClosedTrade = {
  id: 'trade-1', sessionId: saved.id, symbol: 'NQ', side: 'long', qty: 1,
  entryTs: saved.startTs, entryPriceTicks: 60000, exitTs: saved.startTs + 600,
  exitPriceTicks: 60020, realizedCents: 25_000, feesCents: 0, mfeTicks: 24, maeTicks: 3, rMultiple: 2, createdAt: saved.startTs + 600,
  initialStopTicks: null, initialTakeProfitTicks: null, protectionAdjustments: [], exitReason: 'manual',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchSessions.mockResolvedValue([saved])
  mocks.fetchTrades.mockResolvedValue([trade])
  mocks.deleteSession.mockResolvedValue(undefined)
  mocks.deleteEmptySessions.mockResolvedValue(0)
  mocks.patchSession.mockResolvedValue(undefined)
  mocks.resumeSession.mockResolvedValue(undefined)
  mocks.pauseReplaySession.mockResolvedValue(undefined)
  mocks.stopReplaySession.mockResolvedValue(undefined)
  sessionSnapshot.sessionId = null
  sessionSnapshot.sessionStatus = null
  sessionSnapshot.fill = null
  useUiStore.setState({ sidebarOpen: true, sidebarTab: 'sessions', reviewSource: null })
})

afterEach(cleanup)

describe('SessionsPanel', () => {
  it('shows a compact hash, lifecycle, core stats, and trade history', async () => {
    render(<SessionsPanel />)

    const hash = shortReplaySessionHash(saved.id)
    expect((await screen.findAllByText(new RegExp(`#${hash}`))).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/paused/i).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('$250.00')).length).toBeGreaterThan(0)
    expect(screen.getByText('100%')).toBeVisible()
    expect(screen.getByRole('table', { name: 'Trade history' })).toBeVisible()
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Trade', 'Time', 'MFE/MAE', 'P&L / R'])
    expect(screen.getByText('LONG')).toBeVisible()
  })

  it('keeps evaluation persistence records out of the replay Sessions tab', async () => {
    const evaluationSession: ReplaySession = {
      ...saved,
      id: 'eval-session-1111-7222-8333-abcdef123456',
      name: 'Evaluation account',
      kind: 'eval',
      updatedAt: saved.updatedAt + 1,
    }
    mocks.fetchSessions.mockResolvedValue([evaluationSession, saved])

    render(<SessionsPanel />)

    expect(await screen.findByRole('button', { name: `Inspect replay session #${shortReplaySessionHash(saved.id)}` })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Inspect replay session Evaluation account/ })).not.toBeInTheDocument()
    expect(mocks.fetchTrades).toHaveBeenCalledTimes(1)
    expect(mocks.fetchTrades).toHaveBeenCalledWith(saved.id)
  })

  it('keeps an empty session compact without a closed-trades empty state', async () => {
    mocks.fetchTrades.mockResolvedValue([])
    render(<SessionsPanel />)

    await screen.findByRole('button', { name: 'Activate' })
    expect(screen.getByText('0 closed')).toBeVisible()
    expect(screen.queryByText('No closed trades in this session.')).not.toBeInTheDocument()
  })

  it('activates only after the explicit Activate action', async () => {
    const user = userEvent.setup()
    render(<SessionsPanel />)
    await screen.findByRole('button', { name: 'Activate' })
    expect(mocks.resumeSession).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Activate' }))
    expect(mocks.resumeSession).toHaveBeenCalledWith(saved)
  })

  it('offers Review only for the active replay session', async () => {
    const user = userEvent.setup()
    sessionSnapshot.sessionId = saved.id
    sessionSnapshot.sessionStatus = 'active'
    render(<SessionsPanel />)

    const review = await screen.findByRole('button', { name: 'Review active session' })
    const activeRow = screen.getByRole('button', { name: `Inspect replay session #${shortReplaySessionHash(saved.id)}` })
    expect(activeRow).toHaveAttribute('aria-current', 'true')
    expect(activeRow).toHaveClass('bg-active/10')
    await user.click(review)

    expect(useUiStore.getState().sidebarTab).toBe('review')
    expect(useUiStore.getState().reviewSource).toMatchObject({ id: saved.id, type: 'session' })
  })

  it('opens deletion from the session row context menu and requires confirmation', async () => {
    const user = userEvent.setup()
    render(<SessionsPanel />)
    const hash = shortReplaySessionHash(saved.id)
    const row = await screen.findByRole('button', { name: `Inspect replay session #${hash}` })
    fireEvent.contextMenu(row, { clientX: 120, clientY: 140 })

    await user.click(screen.getByRole('menuitem', { name: 'Delete session' }))
    expect(mocks.deleteSession).not.toHaveBeenCalled()
    await user.click(screen.getByRole('menuitem', { name: 'Confirm delete' }))
    expect(mocks.deleteSession).toHaveBeenCalledWith(saved.id)
  })

  it('marks only the Journal action as an explicit session creation', async () => {
    const user = userEvent.setup()
    render(<SessionsPanel />)
    const newSession = screen.getByRole('button', { name: 'New session' })
    expect(newSession).toHaveClass('primary-button', 'h-7', 'px-2.5')
    expect(newSession.querySelector('svg')).toBeInTheDocument()
    expect(newSession).toHaveTextContent(/^New$/)
    await user.click(newSession)
    expect(mocks.beginReplaySelection).toHaveBeenCalledWith({ createSession: true })
  })

  it('renames a replay session and refreshes its persisted display name', async () => {
    const user = userEvent.setup()
    mocks.fetchSessions
      .mockResolvedValueOnce([saved])
      .mockResolvedValue([{ ...saved, name: 'London open practice' }])
    render(<SessionsPanel />)

    await user.click(await screen.findByRole('button', { name: 'Rename replay session' }))
    await user.type(screen.getByLabelText('Display name'), 'London open practice')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mocks.patchSession).toHaveBeenCalledWith(saved.id, { name: 'London open practice' })
    expect((await screen.findAllByText('London open practice')).length).toBeGreaterThan(0)
  })

  it('exports complete trade rows as CSV', () => {
    const csv = tradeHistoryCsv(saved, [trade])
    expect(csv).toContain('session_id,session_name,symbol,side,quantity')
    expect(csv).toContain(`${saved.id},#${shortReplaySessionHash(saved.id)},NQ,long,1`)
    expect(csv).toContain(',25000,0,24,3,2')
  })
})
