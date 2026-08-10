import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EVAL_PRESETS, evalStatus, newRuntime } from '../../eval/rules'
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
})
