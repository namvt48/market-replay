import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EvalSetupScreen } from './EvalSetupScreen'

vi.mock('../../api/client', () => ({
  fetchSymbols: vi.fn().mockResolvedValue([]),
  fetchCalendar: vi.fn().mockResolvedValue([]),
}))

describe('EvalSetupScreen', () => {
  afterEach(cleanup)

  it('lets the trader configure or disable the consistency threshold', async () => {
    const user = userEvent.setup()
    render(<EvalSetupScreen />)
    const field = screen.getByRole('spinbutton', { name: 'Consistency max % (0 = none)' })

    expect(field).toHaveValue(0)
    await user.click(screen.getByRole('button', { name: 'TopStep 50K (EOD trail)' }))
    expect(field).toHaveValue(50)
    expect(screen.getByText(/best day ≤ 50% of net profit/)).toBeVisible()

    await user.clear(field)
    await user.type(field, '35')
    expect(field).toHaveValue(35)
    expect(screen.getByText(/best day ≤ 35% of net profit/)).toBeVisible()
  })
})
