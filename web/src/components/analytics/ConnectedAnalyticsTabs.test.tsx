import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { drawdownFixture } from './analytics-fixtures'
import { DrawdownTab } from './ConnectedAnalyticsTabs'
import { shouldShowCoverageWarning } from './coverage-warning'

afterEach(cleanup)

describe('analytics semantic presentation', () => {
  it('uses distinct semantic colors for drawdown, recovery, and frequency values', () => {
    render(<DrawdownTab report={drawdownFixture} />)

    const maxDrawdown = screen.getByText('Max drawdown').parentElement
    const recovery = screen.getByText('Time to recovery (days)').parentElement
    const frequency = screen.getByText('Drawdown frequency').parentElement
    expect(maxDrawdown).not.toBeNull()
    expect(recovery).not.toBeNull()
    expect(frequency).not.toBeNull()
    if (!maxDrawdown || !recovery || !frequency) return

    expect(within(maxDrawdown).getByText('-$250.00')).toHaveClass('text-loss-bright')
    expect(within(recovery).getByText('1.0')).toHaveClass('text-active-bright')
    expect(within(frequency).getByText('1')).toHaveClass('text-caution-bright')
  })

  it('shows a coverage warning only when exclusions are material', () => {
    expect(shouldShowCoverageWarning(32, 8)).toBe(false)
    expect(shouldShowCoverageWarning(48, 0)).toBe(false)
    expect(shouldShowCoverageWarning(6, 8)).toBe(true)
  })
})
