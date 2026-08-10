import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVAL_PRESETS, customConfig, newRuntime, shortEvalAccountHash } from '../../eval/rules'
import { getEvalState, useEvalStore } from '../../store/eval-store'
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
    expect(screen.getByText('$101,250')).toBeVisible()
    expect(screen.getByText('LONG')).toBeVisible()
    expect(screen.getAllByText('$1,000')).toHaveLength(2)
    expect(screen.getByText('MFE 16t · MAE 4t')).toBeVisible()
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

  it('hides account metrics until Start Eval is pressed', async () => {
    const user = userEvent.setup()
    getEvalState().createEvaluation(EVAL_PRESETS[0], 'NQ', '2024-01-15', START_TS)
    render(<EvaluationPanel />)

    expect(screen.getAllByText('READY').length).toBeGreaterThan(0)
    expect(screen.getByText('This account has not started.')).toBeVisible()
    expect(screen.queryByText('Balance')).not.toBeInTheDocument()
    expect(screen.queryByText('TRADE HISTORY')).not.toBeInTheDocument()
    expect(replayMocks.syncEvaluationSession).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Start Eval' }))

    expect(getEvalState()).toMatchObject({ phase: 'running', needsFillRebase: false })
    expect(screen.getAllByText('LIVE').length).toBeGreaterThan(0)
    expect(screen.getByText('Balance')).toBeVisible()
    expect(screen.getByText('TRADE HISTORY')).toBeVisible()
    expect(replayMocks.syncEvaluationSession).toHaveBeenCalledOnce()
  })

  it('resumes a previous account directly without an Open account step', async () => {
    const user = userEvent.setup()
    getEvalState().startEvaluation(EVAL_PRESETS[0], 'NQ', '2024-01-15', START_TS)
    const previousAccountId = getEvalState().accountId
    getEvalState().startEvaluation(EVAL_PRESETS[2], 'ES', '2024-01-16', START_TS + 86400)
    render(<EvaluationPanel />)

    await user.click(screen.getByRole('button', { name: /FTMO 100K.*NQ/ }))
    expect(screen.queryByRole('button', { name: 'Open account' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resume Eval' }))

    expect(getEvalState()).toMatchObject({ accountId: previousAccountId, instrument: 'NQ', phase: 'running', needsFillRebase: true })
    expect(replayMocks.syncEvaluationSession).toHaveBeenCalledOnce()
  })
})
