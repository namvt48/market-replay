import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DrawdownChart } from './AdvancedAnalyticsCharts'
import { LineChart } from './InteractiveAnalyticsCharts'

afterEach(cleanup)

describe('analytics chart tooltips', () => {
  it('portals performance tooltips above chart clipping and removes the native SVG tooltip', () => {
    const { container } = render(<LineChart values={[0, 100, -50]} ariaLabel="P&L curve" valueLabel="P&L" />)
    fireEvent.pointerMove(screen.getByRole('img', { name: /P&L curve/ }), { clientX: 240, clientY: 220 })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.parentElement).toBe(document.body)
    expect(tooltip).toHaveClass('fixed', 'z-[140]')
    expect(container.querySelector('svg title')).not.toBeInTheDocument()
  })

  it('portals drawdown tooltips above the bordered report panel', () => {
    const { container } = render(<DrawdownChart points={[
      { date: 'Trade 1', equity: 100_000, peak: 100_000, dollars: 0, percent: 0 },
      { date: 'Trade 2', equity: 98_000, peak: 100_000, dollars: -2_000, percent: -2 },
    ]} mode="dollar" />)
    fireEvent.pointerMove(screen.getByRole('img', { name: /Drawdown on equity in dollars/ }), { clientX: 320, clientY: 260 })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.parentElement).toBe(document.body)
    expect(tooltip).toHaveClass('fixed', 'z-[140]')
    expect(container.querySelector('svg title')).not.toBeInTheDocument()
  })
})
