import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineTrade } from '../../fill-engine/types'
import { useEvalStore } from '../../store/eval-store'
import { SessionProgressPanel } from './SessionProgressPanel'

const replayMocks = vi.hoisted(() => ({ exitReplay: vi.fn() }))
const snapshot = {
  sessionId: null as string | null,
  sessionName: null as string | null,
  sessionStatus: null as 'active' | 'paused' | 'stopped' | null,
  fill: null as { realizedCents: number; unrealizedCents: number; equityCents: number; trades: EngineTrade[] } | null,
  stats: { trades: 0, winRate: 0, netCents: 0, expectancyCents: 0, averageR: null as number | null, profitFactor: null as number | null },
}

vi.mock('../../replay/replay-engine', () => ({ replayEngine: replayMocks }))
vi.mock('../../replay/use-replay', () => ({
  useReplaySelector: (select: (value: typeof snapshot) => unknown) => select(snapshot),
}))

function trade(id: string, realizedCents: number, entryTs: number, exitTs: number, maeTicks = 4): EngineTrade {
  return { id, symbol: 'NQ', side: 'long', qty: 1, entryTs, exitTs, entryPriceTicks: 100, exitPriceTicks: 110, realizedCents, feesCents: 0, mfeTicks: 12, maeTicks, rMultiple: realizedCents > 0 ? 1.2 : -0.8, initialStopTicks: 90, initialTakeProfitTicks: 120, protectionAdjustments: [], exitReason: 'manual' }
}

describe('SessionProgressPanel', () => {
  beforeEach(() => {
    replayMocks.exitReplay.mockReset()
    useEvalStore.setState({ phase: 'idle' })
    snapshot.sessionId = null
    snapshot.sessionName = null
    snapshot.sessionStatus = null
    snapshot.fill = null
    snapshot.stats = { trades: 0, winRate: 0, netCents: 0, expectancyCents: 0, averageR: null, profitFactor: null }
  })

  afterEach(cleanup)

  it('shows the live replay name, controls, equity, and metrics', () => {
    snapshot.sessionId = 'session-1'
    snapshot.sessionName = 'New York open'
    snapshot.sessionStatus = 'active'
    snapshot.fill = { realizedCents: 12500, unrealizedCents: -2500, equityCents: 1_010_000, trades: [trade('win-1', 15_000, 0, 1_200), trade('loss-1', -2_500, 1_300, 2_500)] }
    snapshot.stats = { trades: 8, winRate: 0.625, netCents: 12500, expectancyCents: 1562, averageR: 0.42, profitFactor: 1.8 }

    render(<SessionProgressPanel />)

    expect(screen.getByRole('region', { name: 'Replay session progress' })).toBeVisible()
    expect(screen.getByText('New York open')).toBeVisible()
    expect(screen.getByText('Equity')).toBeVisible()
    expect(screen.getByText('$10,100')).toBeVisible()
    expect(screen.getByText('Realized P&L')).toBeVisible()
    expect(screen.getByText('Unrealized P&L')).toBeVisible()
    expect(screen.getByText('Closed trades')).toBeVisible()
    expect(screen.getByText('Win rate')).toBeVisible()
    expect(screen.getByText('Average R')).toBeVisible()
    expect(screen.getByText('Profit factor')).toBeVisible()
    expect(screen.getByText('Avg drawdown RR')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Winners performance' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Losers performance' })).toBeVisible()
  })

  it('collapses and restores the live replay strip', async () => {
    const user = userEvent.setup()
    snapshot.sessionId = 'session-1'
    snapshot.sessionStatus = 'active'
    snapshot.fill = { realizedCents: 0, unrealizedCents: 0, equityCents: 1_000_000, trades: [] }

    render(<SessionProgressPanel />)

    await user.click(screen.getByRole('button', { name: 'Hide replay session progress' }))
    expect(screen.getByRole('region', { name: 'Collapsed replay session progress' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Show replay session progress' }))
    expect(screen.getByRole('region', { name: 'Replay session progress' })).toBeVisible()
  })

  it('exits a replay session and remains hidden while an evaluation is running', async () => {
    const user = userEvent.setup()
    snapshot.sessionId = 'session-1'
    snapshot.sessionStatus = 'active'
    snapshot.fill = { realizedCents: 0, unrealizedCents: 0, equityCents: 1_000_000, trades: [] }
    const view = render(<SessionProgressPanel />)

    await user.click(screen.getByRole('button', { name: 'Exit replay session' }))
    expect(replayMocks.exitReplay).toHaveBeenCalledOnce()

    useEvalStore.setState({ phase: 'running' })
    view.rerender(<SessionProgressPanel />)
    expect(screen.queryByRole('region', { name: 'Replay session progress' })).not.toBeInTheDocument()
  })
})
