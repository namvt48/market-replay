import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVAL_PRESETS, customConfig, fundedConfig, newRuntime } from '../../eval/rules'
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
    expect(screen.queryByText('All symbols')).not.toBeInTheDocument()
    expect(screen.getAllByText('$100,000').length).toBeGreaterThan(0)
  })

  it('reuses module-level number formatters while rendering live ticks', () => {
    getEvalState().startEvaluation(EVAL_PRESETS[0], 'NQ', '2024-01-15', START_TS)
    const OriginalNumberFormat = Intl.NumberFormat
    const numberFormat = vi.spyOn(Intl, 'NumberFormat').mockImplementation(
      function NumberFormat(locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
        return new OriginalNumberFormat(locales, options)
      },
    )

    const view = render(<EvalProgressPanel />)
    useEvalStore.setState({ lastEvalBalance: 101000, lastEvalEquity: 101250 })
    view.rerender(<EvalProgressPanel />)

    expect(numberFormat).not.toHaveBeenCalled()
    numberFormat.mockRestore()
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

  it('does not expose payout controls for legacy funded account data', () => {
    const config = fundedConfig(EVAL_PRESETS[2])
    getEvalState().startEvaluation(config, 'NQ', '2024-01-15', START_TS)
    useEvalStore.setState({
      runtime: newRuntime(config, START_TS),
      lastEvalBalance: 54000,
      lastEvalEquity: 54000,
    })

    render(<EvalProgressPanel />)

    expect(screen.getByText('EVALUATION')).toBeVisible()
    expect(screen.queryByText(/payout|funded/i)).not.toBeInTheDocument()
  })
})
