import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DrawdownChart } from './AdvancedAnalyticsCharts'
import { FrequencyChart, LineChart, SplitBars, VerticalBars } from './InteractiveAnalyticsCharts'

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

  it('uses a bounded set of clean quarter-step ticks for small positive ranges', () => {
    render(<VerticalBars data={[{ label: '09:00', value: 0.9 }]} ariaLabel="Risk reward by entry hour" valueSuffix="R" />)

    const chart = screen.getByRole('img', { name: 'Risk reward by entry hour' })
    const labels = [...chart.querySelectorAll('text')].map((item) => item.textContent)
    expect(labels.slice(0, 5)).toEqual(['0R', '0.25R', '0.5R', '0.75R', '1R'])
  })

  it('limits split performance axes to five symmetric gridline values', () => {
    render(<SplitBars data={[{ label: '09:00', profit: 5, loss: -3 }]} ariaLabel="Profit by entry hour" valueFormatter={(value) => `${value}R`} />)

    const chart = screen.getByRole('img', { name: 'Profit by entry hour' })
    const labels = [...chart.querySelectorAll('text')].map((item) => item.textContent)
    expect(labels.slice(0, 5)).toEqual(['-5R', '-2.5R', '0R', '2.5R', '5R'])
  })

  it('uses bounded clean ticks and reserves a readable left gutter on line charts', () => {
    render(<LineChart values={[-10_550, -8_000, 2_500]} ariaLabel="Evaluation P&L" valueFormatter={(value) => `$${value}`} />)

    const chart = screen.getByRole('img', { name: /Evaluation P&L/ })
    const labels = [...chart.querySelectorAll('text')].slice(0, 4)
    expect(labels.map((item) => item.textContent)).toEqual(['$-15000', '$-10000', '$-5000', '$0'])
    expect(labels.every((item) => Number(item.getAttribute('x')) >= 70)).toBe(true)
  })

  it('uses integer gridline labels for trades-per-day frequency charts', () => {
    render(<FrequencyChart labels={['Mon']} values={[4]} ariaLabel="Trades per day" />)

    const chart = screen.getByRole('img', { name: 'Trades per day' })
    const labels = [...chart.querySelectorAll('text')].map((item) => item.textContent)
    expect(labels.slice(0, 5)).toEqual(['0', '1', '2', '3', '4'])
  })
})
