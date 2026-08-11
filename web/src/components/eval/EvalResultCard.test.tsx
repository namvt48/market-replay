import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EVAL_PRESETS, evalStatus, fundedConfig, newRuntime } from '../../eval/rules'
import { EvalResultCard } from './EvalResultCard'

afterEach(cleanup)

const config = EVAL_PRESETS[0]
const runtime = { ...newRuntime(config), outcome: 'failed' as const, failReason: 'daily' as const, failedAt: 100 }
const status = evalStatus(config, runtime, { balance: 95_000, equity: 95_000, trades: [] })

function resultCard(onClose = vi.fn()) {
  return <EvalResultCard verdict="failed" failReason="daily" config={config} runtime={runtime} status={status} endingEquity={95_000} onRetry={vi.fn()} onGoFunded={vi.fn()} onAbandon={vi.fn()} onClose={onClose} />
}

describe('EvalResultCard', () => {
  it('traps keyboard focus inside the modal and restores prior focus on unmount', async () => {
    const user = userEvent.setup()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const rendered = render(resultCard())
    expect(screen.getByRole('dialog')).toHaveFocus()

    const first = screen.getByRole('button', { name: 'Close result' })
    first.focus()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()

    rendered.unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(resultCard(onClose))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('continues a passed two-step challenge to verification', async () => {
    const user = userEvent.setup()
    const challenge = { ...EVAL_PRESETS[0], minTradingDays: 0 }
    const passedRuntime = { ...newRuntime(challenge), outcome: 'passed' as const, passedAt: 200 }
    const passedStatus = evalStatus(challenge, passedRuntime, { balance: 110000, equity: 110000, trades: [] })
    const onGoVerification = vi.fn()
    render(<EvalResultCard verdict="passed" failReason={null} config={challenge} runtime={passedRuntime} status={passedStatus} endingEquity={110000} onRetry={vi.fn()} onGoVerification={onGoVerification} onGoFunded={vi.fn()} onAbandon={vi.fn()} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Continue to verification/i }))
    expect(onGoVerification).toHaveBeenCalledOnce()
  })

  it('shows funded payout history in the terminal outcome', () => {
    const funded = fundedConfig(EVAL_PRESETS[2])
    const fundedRuntime = { ...newRuntime(funded, 1), outcome: 'failed' as const, failReason: 'total' as const, failedAt: 300, payoutsTaken: 1 }
    const fundedStatus = evalStatus(funded, fundedRuntime, { balance: 49000, equity: 49000, trades: [] })
    render(<EvalResultCard
      verdict="failed"
      failReason="total"
      config={funded}
      runtime={fundedRuntime}
      status={fundedStatus}
      endingEquity={49000}
      payoutHistory={[{ id: 'p-1', firm: funded.firm, requestedAt: 200, grossAmount: 1000, traderAmount: 1000, profitSplit: 100, balanceAfter: 52600, payoutNumber: 1 }]}
      onRetry={vi.fn()}
      onGoFunded={vi.fn()}
      onAbandon={vi.fn()}
      onClose={vi.fn()}
    />)

    expect(screen.getByText('FUNDED ACCOUNT FAILED')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Payout history' })).toBeVisible()
    expect(screen.getByText('$1,000')).toBeVisible()
  })
})
