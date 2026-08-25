import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { edgeFixture } from './analytics-fixtures'
import { EdgeTab } from './EdgeTab'

afterEach(cleanup)

describe('EdgeTab', () => {
  it('renders verdict, uncertainty, robustness, and sizing evidence', async () => {
    render(<EdgeTab report={edgeFixture} />)
    expect(screen.getByRole('heading', { name: /Edge verdict/ })).toBeVisible()
    expect(screen.getByRole('heading', { name: /Expectancy and validity/ })).toBeVisible()
    expect(screen.getByRole('heading', { name: /Walk-forward robustness/ })).toBeVisible()
    expect(screen.getByRole('heading', { name: /Position sizing/ })).toBeVisible()
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'About Edge verdict' }))
    const verdictTooltip = await screen.findByRole('tooltip', { name: /verdict combines sample size/i })
    await waitFor(() => expect(verdictTooltip.parentElement).toBe(document.body))
    expect(verdictTooltip).toHaveClass('fixed', 'z-[140]')
    const band = screen.getByRole('img', { name: /Expectancy 90 percent confidence interval/ })
    fireEvent.pointerMove(band, { clientX: 100, clientY: 20 })
    expect(screen.getByText('90% bootstrap interval').closest('[role="tooltip"]')).toHaveTextContent('Observed')
  })

  it('shows every Kelly eligibility check in a compact status strip', () => {
    render(<EdgeTab report={edgeFixture} />)

    const checks = screen.getByRole('status', { name: 'Kelly eligibility' })
    expect(checks).toHaveTextContent(/Sample size\s*80\/50/)
    expect(checks).toHaveTextContent(/Statistical evidence\s*p 0\.030/)
    expect(checks).toHaveTextContent(/Breakeven\s*52\.0% > 40\.0%/)
    expect(checks).toHaveTextContent(/OOS expectancy\s*0\.15R/)
    expect(checks).toHaveTextContent(/Payoff ratio\s*1\.50R/)
  })
})
