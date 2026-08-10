import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClosedTrade, ReplaySession } from '../../api/types'
import { shortReplaySessionHash } from '../../replay/session-state'
import { SessionsPanel } from './SessionsPanel'
import { tradeHistoryCsv } from './trade-history-csv'

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
const sessionSnapshot = { sessionId: null, sessionStatus: null, fill: null }
vi.mock('../../replay/use-replay', () => ({
  useReplaySnapshot: () => sessionSnapshot,
  useReplaySelector: (select: (value: typeof sessionSnapshot) => unknown) => select(sessionSnapshot),
}))

const saved: ReplaySession = {
  id: '018f08de-1111-7222-8333-abcdef123456', symbol: 'NQ', tf: '5m', startTs: 1_700_000_000,
  cursorTs: 1_700_007_200, equityCents: 1_025_000, status: 'paused', config: {}, createdAt: 1_700_000_000, updatedAt: 1_700_007_200,
}
const trade: ClosedTrade = {
  id: 'trade-1', sessionId: saved.id, symbol: 'NQ', side: 'long', qty: 1,
  entryTs: saved.startTs, entryPriceTicks: 60000, exitTs: saved.startTs + 600,
  exitPriceTicks: 60020, realizedCents: 25_000, feesCents: 0, mfeTicks: 24, maeTicks: 3, rMultiple: 2, createdAt: saved.startTs + 600,
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
})

afterEach(cleanup)

describe('SessionsPanel', () => {
  it('shows a compact hash, lifecycle, core stats, and trade history', async () => {
    render(<SessionsPanel />)

    const hash = shortReplaySessionHash(saved.id)
    expect(await screen.findAllByText(new RegExp(`#${hash}`))).toHaveLength(1)
    expect(screen.getAllByText(/paused/i).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('$250.00')).length).toBeGreaterThan(0)
    expect(screen.getByText('100%')).toBeVisible()
    expect(screen.getByText('LONG')).toBeVisible()
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

  it('opens deletion from the session row context menu and requires confirmation', async () => {
    const user = userEvent.setup()
    render(<SessionsPanel />)
    const hash = shortReplaySessionHash(saved.id)
    const row = await screen.findByRole('button', { name: `Inspect NQ 5m session ${hash}` })
    fireEvent.contextMenu(row, { clientX: 120, clientY: 140 })

    await user.click(screen.getByRole('menuitem', { name: 'Delete session' }))
    expect(mocks.deleteSession).not.toHaveBeenCalled()
    await user.click(screen.getByRole('menuitem', { name: 'Confirm delete' }))
    expect(mocks.deleteSession).toHaveBeenCalledWith(saved.id)
  })

  it('marks only the Journal action as an explicit session creation', async () => {
    const user = userEvent.setup()
    render(<SessionsPanel />)
    await user.click(screen.getByRole('button', { name: 'New session' }))
    expect(mocks.beginReplaySelection).toHaveBeenCalledWith({ createSession: true })
  })

  it('exports complete trade rows as CSV', () => {
    const csv = tradeHistoryCsv(saved, [trade])
    expect(csv).toContain('session_id,symbol,side,quantity')
    expect(csv).toContain(`${saved.id},NQ,long,1`)
    expect(csv).toContain(',25000,0,24,3,2')
  })
})
