import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVAL_PRESETS, customConfig, dayKey, fundedConfig, newRuntime } from '../../eval/rules'
import { getEvalState, useEvalStore } from '../../store/eval-store'
import { EvalProgressPanel } from './EvalProgressPanel'

const replayMocks = vi.hoisted(() => ({ exitEvaluation: vi.fn() }))
vi.mock('../../replay/replay-engine', () => ({
  replayEngine: { syncEvaluationSession: vi.fn(), exitEvaluation: replayMocks.exitEvaluation },
}))

const progressSnapshot = { fill: null }
vi.mock('../../replay/use-replay', () => ({
  useReplaySnapshot: () => progressSnapshot,
  useReplaySelector: (select: (value: typeof progressSnapshot) => unknown) => select(progressSnapshot),
}))

const START_TS = 1705276800

describe('EvalProgressPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    getEvalState().abandon()
    replayMocks.exitEvaluation.mockImplementation(async () => { getEvalState().exitEvaluation() })
  })

  afterEach(cleanup)

  it('does not consume workspace height without a started current account', () => {
    const empty = render(<EvalProgressPanel />)
    expect(screen.queryByRole('region', { name: 'Evaluation progress' })).not.toBeInTheDocument()

    getEvalState().createEvaluation(EVAL_PRESETS[0], 'NQ', '2024-01-15', START_TS)
    empty.rerender(<EvalProgressPanel />)
    expect(screen.queryByRole('region', { name: 'Evaluation progress' })).not.toBeInTheDocument()
  })

  it('shows the current account strip only after Start Eval', () => {
    getEvalState().createEvaluation(EVAL_PRESETS[0], 'NQ', '2024-01-15', START_TS)
    getEvalState().activateEvaluation()

    render(<EvalProgressPanel />)

    expect(screen.getByRole('region', { name: 'Evaluation progress' })).toBeVisible()
    expect(screen.getByText('FTMO 100K (static)')).toBeVisible()
    expect(screen.getByText('LIVE')).toBeVisible()
    expect(screen.getByText('All symbols')).toBeVisible()
    expect(screen.getAllByText('$100,000').length).toBeGreaterThan(0)
  })

  it('hides the account strip when the current account is paused', () => {
    getEvalState().startEvaluation(EVAL_PRESETS[0], 'NQ', '2024-01-15', START_TS)
    const accountId = getEvalState().accountId
    if (!accountId) throw new Error('Expected evaluation account id')
    getEvalState().restoreAccount(accountId)

    render(<EvalProgressPanel />)

    expect(screen.queryByRole('region', { name: 'Evaluation progress' })).not.toBeInTheDocument()
  })

  it('exits the live account without deleting its saved progress', async () => {
    const user = userEvent.setup()
    getEvalState().startEvaluation(EVAL_PRESETS[0], 'NQ', '2024-01-15', START_TS)
    const accountId = getEvalState().accountId
    if (!accountId) throw new Error('Expected evaluation account id')
    render(<EvalProgressPanel />)

    await user.click(screen.getByRole('button', { name: 'Exit evaluation' }))

    expect(replayMocks.exitEvaluation).toHaveBeenCalledOnce()
    expect(screen.queryByRole('region', { name: 'Evaluation progress' })).not.toBeInTheDocument()
    expect(getEvalState().phase).toBe('idle')
    expect(localStorage.getItem('replay:eval')).toBeNull()
    expect(localStorage.getItem('replay:eval:accounts')).toContain(accountId)
  })

  it('shows the consistency percentage and the profit still needed to satisfy it', () => {
    const config = customConfig()
    getEvalState().startEvaluation(config, 'NQ', '2024-01-15', START_TS)
    useEvalStore.setState({
      lastEvalBalance: 54000,
      lastEvalEquity: 54000,
      trades: [{ exitTime: START_TS + 3600, realizedCents: 400000 }],
    })

    render(<EvalProgressPanel />)

    expect(screen.getByText('Consistency')).toBeVisible()
    expect(screen.getByText('100% / 40%')).toBeVisible()
    expect(screen.getByText('$6,000 more net profit needed')).toBeVisible()
  })

  it('shows funded payout eligibility and records a request', async () => {
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

    render(<EvalProgressPanel />)

    expect(screen.getByText('Payout winning days')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Request $1,400 payout' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Request $1,400 payout' }))
    expect(await screen.findByText('$1,400 payout recorded after split.')).toBeVisible()
    expect(getEvalState().runtime?.payoutsTaken).toBe(1)
  })
})
