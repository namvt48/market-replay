import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsScreen } from './AnalyticsScreen'
import { drawdownFixture, edgeFixture, executionFixture, monteFixture, performanceFixture, rrFixture, stopLossFixture } from './analytics-fixtures'
import { useReviewStore } from '../../store/review-store'

function jsonResponse(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
function installAnalyticsApi(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/performance')) return jsonResponse(performanceFixture)
    if (url.includes('/drawdown')) return jsonResponse(drawdownFixture)
    if (url.includes('/edge')) return jsonResponse(edgeFixture)
    if (url.includes('/execution-discipline')) return jsonResponse(executionFixture)
    if (url.includes('/stop-loss')) return jsonResponse(stopLossFixture)
    if (url.includes('/risk-reward')) return jsonResponse(rrFixture)
    if (url.includes('/monte-carlo')) return jsonResponse(monteFixture)
    return jsonResponse({ items: [] })
  }))
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
beforeEach(() => { window.history.replaceState({}, '', '/?analytics=source-1&sourceType=session'); localStorage.clear(); useReviewStore.setState({ documents: {}, tagGroups: [] }); installAnalyticsApi() })

describe('AnalyticsScreen', () => {
  it('renders performance data returned by the analytics API', async () => {
    render(<AnalyticsScreen />)
    expect(await screen.findByRole('heading', { name: 'Profit and loss' })).toBeVisible()
    expect(screen.getAllByText('$101,250.00')[0]).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Performance calendar' })).toBeVisible()
  })

  it('loads drawdown only when its tab is selected', async () => {
    const user = userEvent.setup()
    render(<AnalyticsScreen />)
    await user.click(screen.getByRole('tab', { name: 'Drawdown' }))
    expect(await screen.findByRole('heading', { name: /Drawdown on equity/ })).toBeVisible()
    expect(screen.getByRole('img', { name: /Drawdown on equity in dollars/ })).toBeVisible()
  })

  it('runs all simulations through backend endpoints', async () => {
    const user = userEvent.setup()
    render(<AnalyticsScreen />)
    await user.click(screen.getByRole('tab', { name: 'Simulation' }))
    expect(await screen.findByRole('table', { name: 'Stop loss simulation results' })).toBeVisible()
    expect(await screen.findByRole('table', { name: 'Risk-reward simulation results' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Start simulation/ }))
    expect(await screen.findByText('Simulation results')).toBeVisible()
  })

  it('shows an honest empty state when the selected source has no user-created tags', async () => {
    const user = userEvent.setup()
    render(<AnalyticsScreen />)
    await user.click(screen.getByRole('tab', { name: 'Tags' }))
    expect(screen.getByRole('heading', { name: 'No tagged trades yet' })).toBeVisible()
  })
})
