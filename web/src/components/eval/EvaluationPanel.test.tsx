import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVAL_PRESETS, customConfig, dayKey, fundedConfig, newRuntime, shortEvalAccountHash } from '../../eval/rules'
import { getEvalState, loadEvalAccounts, useEvalStore } from '../../store/eval-store'
import { EvaluationPanel } from './EvaluationPanel'

const replayMocks = vi.hoisted(() => ({ syncEvaluationSession: vi.fn() }))

vi.mock('../../replay/replay-engine', () => ({ replayEngine: replayMocks }))
const evalSnapshot = { fill: null }
vi.mock('../../replay/use-replay', () => ({
  useReplaySnapshot: () => evalSnapshot,
  useReplaySelector: (select: (value: typeof evalSnapshot) => unknown) => select(evalSnapshot),
}))

const START_TS = 1705276800

describe('EvaluationPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    getEvalState().abandon()
    replayMocks.syncEvaluationSession.mockReset()
  })

  afterEach(cleanup)

  it('offers account creation when there are no saved evaluations', () => {
    render(<EvaluationPanel />)

    expect(screen.getByText('No evaluation accounts')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Create evaluation' })).toHaveAttribute('href', '/start/eval')
  })

  it('shows the active account metrics and its closed-trade history', () => {
    const config = EVAL_PRESETS[0]
    getEvalState().startEvaluation(config, 'NQ', '2024-01-15', START_TS)
    useEvalStore.setState({
      runtime: { ...newRuntime(config), peakEquity: 102000, lastEquity: 101250 },
      lastEvalBalance: 101000,
      lastEvalEquity: 101250,
      trades: [{
        id: 'trade-1',
        symbol: 'NQ',
        side: 'long',
        qty: 1,
        entryTime: START_TS,
        exitTime: START_TS + 3600,
        realizedCents: 100000,
        mfeTicks: 16,
        maeTicks: 4,
      }],
    })

    render(<EvaluationPanel />)

    const accountId = getEvalState().accountId
    if (!accountId) throw new Error('Expected an active evaluation account id')
    expect(screen.getAllByText('FTMO 100K (static)')).toHaveLength(2)
    expect(screen.getAllByText(`#${shortEvalAccountHash(accountId)}`)).toHaveLength(2)
    expect(screen.getAllByText('LIVE').length).toBeGreaterThan(0)
    const liveAccount = screen.getByRole('button', { name: /FTMO 100K.*All symbols/ })
    expect(liveAccount).toHaveAttribute('aria-current', 'true')
    expect(liveAccount).toHaveClass('bg-active/10')
    expect(screen.getByText('$101,250')).toBeVisible()
    expect(screen.getByText('TRADE HISTORY')).toBeVisible()
    expect(screen.getByText('LONG')).toBeVisible()
    expect(screen.getByText('1 NQ')).toBeVisible()
    expect(screen.getByText('+$1,000.00')).toBeVisible()
    const excursion = screen.getByLabelText('Maximum favorable excursion: 16 ticks. Maximum adverse excursion: 4 ticks.')
    expect(within(excursion).getByText('+16t')).toBeVisible()
    expect(within(excursion).getByText('−4t')).toBeVisible()
    expect(screen.getByLabelText(/Entry and exit time: Jan 15/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Create new evaluation account' })).toHaveAttribute('href', '/start/eval')
  })

  it('shows consistency progress without exceeding the accessible progress range', () => {
    const config = customConfig()
    getEvalState().startEvaluation(config, 'NQ', '2024-01-15', START_TS)
    useEvalStore.setState({
      lastEvalBalance: 54000,
      lastEvalEquity: 54000,
      trades: [{ exitTime: START_TS + 3600, realizedCents: 400000 }],
    })

    render(<EvaluationPanel />)

    expect(screen.getByText('100% / 40%')).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Consistency' })).toHaveAttribute('aria-valuenow', '100')
  })

  it('shows funded payout progress and exposes the request action when eligible', async () => {
    const user = userEvent.setup()
    const config = fundedConfig(EVAL_PRESETS[2])
    getEvalState().startEvaluation(config, 'NQ', '2024-01-15', START_TS)
    const trades = [0, 1, 2, 3, 4].map((index) => ({ exitTime: START_TS + index * 86400 + 3600, realizedCents: 80000 }))
    useEvalStore.setState({
      runtime: {
        ...newRuntime(config, START_TS),
        dayKey: dayKey(START_TS + 5 * 86400, config.dayResetHour),
        profitSinceLastPayout: 4000,
        winningDays: 5,
        bestDaySincePayout: 800,
      },
      lastEvalBalance: 54000,
      lastEvalEquity: 54000,
      trades,
    })

    render(<EvaluationPanel />)

    expect(screen.getByRole('heading', { name: 'Payout status' })).toBeVisible()
    expect(screen.getByText('ELIGIBLE')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Request payout' }))
    expect(getEvalState().runtime?.payoutsTaken).toBe(1)
    expect(screen.getByText('Payout #1 · 100% split')).toBeVisible()
  })

  it('hides account metrics until Start Eval is pressed', async () => {
    const user = userEvent.setup()
    getEvalState().createEvaluation(EVAL_PRESETS[0], 'NQ', '2024-01-15', START_TS)
    render(<EvaluationPanel />)

    expect(screen.getAllByText('READY').length).toBeGreaterThan(0)
    expect(screen.getByText('This account has not started.')).toBeVisible()
    expect(screen.queryByText('Balance')).not.toBeInTheDocument()
    expect(screen.getByText('TRADE HISTORY')).toBeVisible()
    expect(screen.getByText(/No closed trades yet/)).toBeVisible()
    expect(replayMocks.syncEvaluationSession).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Start Eval' }))

    expect(getEvalState()).toMatchObject({ phase: 'running', needsFillRebase: false })
    expect(screen.getAllByText('LIVE').length).toBeGreaterThan(0)
    expect(screen.getByText('Balance')).toBeVisible()
    expect(screen.getByText('TRADE HISTORY')).toBeVisible()
    expect(screen.getByText(/No closed trades yet/)).toBeVisible()
    expect(replayMocks.syncEvaluationSession).toHaveBeenCalledOnce()
  })

  it('lists a paused account trade history with side, size, times, P&L and extremes', async () => {
    const user = userEvent.setup()
    getEvalState().startEvaluation(EVAL_PRESETS[0], 'NQ', '2024-01-15', START_TS)
    useEvalStore.setState({
      lastEvalBalance: 97500,
      lastEvalEquity: 97500,
      trades: [{
        id: 'trade-paused-1',
        symbol: 'NQ',
        side: 'short',
        qty: 2,
        entryTime: START_TS,
        exitTime: START_TS + 1800,
        realizedCents: -250000,
        mfeTicks: 3,
        maeTicks: 9,
      }],
    })
    getEvalState().exitEvaluation()
    getEvalState().startEvaluation(EVAL_PRESETS[2], 'ES', '2024-01-16', START_TS + 86400)
    render(<EvaluationPanel />)

    await user.click(screen.getByRole('button', { name: /FTMO 100K.*All symbols/ }))

    expect(screen.getByText('TRADE HISTORY')).toBeVisible()
    expect(screen.getByText('SHORT')).toBeVisible()
    expect(screen.getByText('2 NQ')).toBeVisible()
    expect(screen.getByText('-$2,500')).toBeVisible()
    expect(screen.getByText('-$2,500.00')).toBeVisible()
    const excursion = screen.getByLabelText('Maximum favorable excursion: 3 ticks. Maximum adverse excursion: 9 ticks.')
    expect(within(excursion).getByText('+3t')).toBeVisible()
    expect(within(excursion).getByText('−9t')).toBeVisible()
  })

  it('resumes a previous account directly without an Open account step', async () => {
    const user = userEvent.setup()
    getEvalState().startEvaluation(EVAL_PRESETS[0], 'NQ', '2024-01-15', START_TS)
    const previousAccountId = getEvalState().accountId
    getEvalState().startEvaluation(EVAL_PRESETS[2], 'ES', '2024-01-16', START_TS + 86400)
    render(<EvaluationPanel />)

    await user.click(screen.getByRole('button', { name: /FTMO 100K.*All symbols/ }))
    expect(screen.queryByRole('button', { name: 'Open account' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resume Eval' }))

    expect(getEvalState()).toMatchObject({ accountId: previousAccountId, instrument: 'NQ', phase: 'running', needsFillRebase: true })
    expect(replayMocks.syncEvaluationSession).toHaveBeenCalledOnce()
  })

  it('requires two clicks to delete: first arms confirm, second deletes', async () => {
    const user = userEvent.setup()
    getEvalState().startEvaluation(EVAL_PRESETS[0], 'NQ', '2024-01-15', START_TS)
    const accountId = getEvalState().accountId
    getEvalState().exitEvaluation()
    render(<EvaluationPanel />)

    const deleteBtn = screen.getByRole('button', { name: /Delete FTMO.*evaluation/ })
    await user.click(deleteBtn)
    expect(screen.queryByRole('button', { name: /Delete FTMO.*evaluation/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirm delete FTMO.*evaluation/ })).toBeVisible()
    expect(loadEvalAccounts().some((account) => account.accountId === accountId)).toBe(true)

    await user.click(screen.getByRole('button', { name: /Confirm delete FTMO.*evaluation/ }))
    expect(loadEvalAccounts().some((account) => account.accountId === accountId)).toBe(false)
  })

  it('removes a deleted non-current account from the rendered list', async () => {
    const user = userEvent.setup()
    getEvalState().startEvaluation(EVAL_PRESETS[0], 'NQ', '2024-01-15', START_TS)
    const pausedAccountId = getEvalState().accountId
    if (!pausedAccountId) throw new Error('Expected a paused evaluation account id')
    getEvalState().startEvaluation(EVAL_PRESETS[2], 'ES', '2024-01-16', START_TS + 86400)
    render(<EvaluationPanel />)

    await user.click(screen.getByRole('button', { name: /FTMO 100K.*All symbols/ }))
    await user.click(screen.getByRole('button', { name: /Delete FTMO.*evaluation/ }))
    await user.click(screen.getByRole('button', { name: /Confirm delete FTMO.*evaluation/ }))

    expect(screen.queryByRole('button', { name: /FTMO 100K.*All symbols/ })).not.toBeInTheDocument()
    expect(loadEvalAccounts().some((account) => account.accountId === pausedAccountId)).toBe(false)
  })

  it('deletes a ready account via two clicks and removes it from the rendered list', async () => {
    const user = userEvent.setup()
    getEvalState().createEvaluation(EVAL_PRESETS[0], 'NQ', '2024-01-15', START_TS)
    const readyAccountId = getEvalState().accountId
    if (!readyAccountId) throw new Error('Expected a ready evaluation account id')
    render(<EvaluationPanel />)

    await user.click(screen.getByRole('button', { name: /Delete FTMO.*evaluation/ }))
    await user.click(screen.getByRole('button', { name: /Confirm delete FTMO.*evaluation/ }))

    expect(screen.queryByRole('button', { name: /FTMO 100K.*All symbols/ })).not.toBeInTheDocument()
    expect(loadEvalAccounts().some((account) => account.accountId === readyAccountId)).toBe(false)
  })
})
