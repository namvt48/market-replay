import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { executionFixture } from './analytics-fixtures'
import { ExecutionDisciplineTab } from './ExecutionDisciplineTab'

afterEach(cleanup)

describe('ExecutionDisciplineTab', () => {
  it('switches between execution, decision, and psychology evidence', async () => {
    const user = userEvent.setup()
    render(<ExecutionDisciplineTab report={executionFixture} />)
    expect(screen.getByRole('heading', { name: /Execution quality/ })).toBeVisible()
    expect(screen.getByRole('img', { name: /Maximum favorable excursion distribution/ })).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Decision quality' }))
    expect(screen.getByRole('heading', { name: /Decision matrix/ })).toBeVisible()
    expect(screen.getByText('Good loss')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Psychology' }))
    expect(screen.getByRole('heading', { name: /Behavior under pressure/ })).toBeVisible()
    expect(screen.getByRole('meter', { name: 'Sizing consistency' })).toBeVisible()
  })
})
