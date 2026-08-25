import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsScreen } from './AnalyticsScreen'
import { drawdownFixture, edgeFixture, executionFixture, monteFixture, performanceFixture, rrFixture, stopLossFixture } from './analytics-fixtures'
import { useReviewStore } from '../../store/review-store'
import { EVAL_PRESETS, newRuntime } from '../../eval/rules'
import { getEvalState, useEvalStore } from '../../store/eval-store'
import type { AnalyticsPerformance } from '../../api/analytics'

function jsonResponse(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
function installAnalyticsApi(performance: AnalyticsPerformance = performanceFixture, stopLoss = stopLossFixture, riskReward = rrFixture): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/sources')) return jsonResponse({ items: [
      { id: 'source-1', type: 'session', title: 'Opening range', subtitle: '64 trades', status: 'paused', tradeCount: 64, startedAt: null, endedAt: null },
      { id: 'eval-2', type: 'evaluation', title: '#EVAL02', subtitle: '60 trades', status: 'stopped', tradeCount: 60, startedAt: null, endedAt: null },
    ] })
    if (url.includes('/performance')) return jsonResponse(performance)
    if (url.includes('/drawdown')) return jsonResponse(drawdownFixture)
    if (url.includes('/edge')) return jsonResponse(edgeFixture)
    if (url.includes('/execution-discipline')) return jsonResponse(executionFixture)
    if (url.includes('/stop-loss')) return jsonResponse(stopLoss)
    if (url.includes('/risk-reward')) return jsonResponse(riskReward)
    if (url.includes('/monte-carlo')) return jsonResponse(monteFixture)
    return jsonResponse({ items: [] })
  }))
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
beforeEach(() => { window.history.replaceState({}, '', '/?analytics=source-1&sourceType=session'); localStorage.clear(); getEvalState().abandon(); useReviewStore.setState({ documents: {}, tagGroups: [] }); installAnalyticsApi() })

describe('AnalyticsScreen', () => {
  it('keeps the analytics scroll gutter stable while switching tabs', () => {
    render(<AnalyticsScreen />)
    expect(document.querySelector('.scrollbar-gutter-stable')).not.toBeNull()
  })

  it('renders performance data returned by the analytics API', async () => {
    render(<AnalyticsScreen />)
    expect(await screen.findByRole('heading', { name: 'Profit and loss' })).toBeVisible()
    expect(screen.getAllByText('$101,250.00')[0]).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Performance calendar' })).toBeVisible()
  })

  it('navigates the performance calendar by month and year', async () => {
    const user = userEvent.setup()
    render(<AnalyticsScreen />)

    const heading = await screen.findByRole('heading', { name: 'Performance calendar' })
    const calendar = heading.closest('section')
    expect(calendar).not.toBeNull()
    if (!calendar) return

    const metric = within(calendar).getByRole('combobox', { name: 'Calendar metric' })
    expect(within(calendar).queryByText(/Initial balance|Current balance/i)).not.toBeInTheDocument()
    await user.selectOptions(metric, 'percent')
    expect(within(calendar).getAllByText('1.25%')).not.toHaveLength(0)
    await user.selectOptions(metric, 'riskReward')
    expect(within(calendar).getAllByText('2.00 RR')).not.toHaveLength(0)
    await user.click(within(calendar).getByRole('button', { name: 'Next month' }))
    expect(within(calendar).getByRole('status', { name: 'Calendar period' })).toHaveTextContent('April 2025')
    await user.click(within(calendar).getByRole('button', { name: 'Year view' }))
    await user.click(within(calendar).getByRole('button', { name: 'Next year' }))
    expect(within(calendar).getByRole('status', { name: 'Calendar period' })).toHaveTextContent('2026')
  })

  it('offers a grouped source switcher in the report header', async () => {
    render(<AnalyticsScreen />)

    const source = await screen.findByRole('combobox', { name: 'Analytics source' })
    expect(source).toHaveValue('session:source-1')
    expect(screen.getByRole('group', { name: 'Eval accounts' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Replay sessions' })).toBeVisible()
    expect(screen.getByRole('option', { name: '#EVAL02' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Opening range' })).toBeVisible()
  })

  it('renders exact account objectives for an evaluation analytics source', async () => {
    const user = userEvent.setup()
    const config = { ...EVAL_PRESETS[1], phase: 'funded' as const }
    const startTs = 1_705_276_800
    const evaluationPerformance: AnalyticsPerformance = {
      ...performanceFixture,
      source: { ...performanceFixture.source, type: 'evaluation', initialBalance: config.accountSize, title: config.firm },
      overview: { ...performanceFixture.overview, totalPnl: -2_061.30, pnlPercent: -4.12, accountBalance: 47_938.70, winRate: 15.63, totalTrades: 32, longTrades: 14, shortTrades: 18 },
      equityCurve: [
        { tradeIndex: 0, tradeId: null, closedAt: null, cumulativePnl: 0, balance: 50_000 },
        { tradeIndex: 1, tradeId: 't1', closedAt: '2024-01-15T14:00:00Z', cumulativePnl: -400, balance: 49_600 },
        { tradeIndex: 2, tradeId: 't2', closedAt: '2024-01-16T15:15:00Z', cumulativePnl: -2_061.30, balance: 47_938.70 },
      ],
      winners: { ...performanceFixture.winners, total: 5 },
      losers: { ...performanceFixture.losers, total: 27 },
    }
    vi.unstubAllGlobals()
    installAnalyticsApi(evaluationPerformance)
    window.history.replaceState({}, '', '/?analytics=source-1&sourceType=evaluation')
    getEvalState().startEvaluation(config, null, '2024-01-15', startTs, 'America/New_York')
    getEvalState().attachSession('source-1')
    useEvalStore.setState({
      runtime: { ...newRuntime(config, startTs), peakEquity: 50_500, lastEquity: 47_938.70 },
      lastCursorTs: startTs + 17 * 86_400 + 13 * 3_600,
      lastEvalBalance: 47_938.70,
      lastEvalEquity: 47_938.70,
      trades: [{ id: 't1', exitTime: startTs + 3_600, realizedCents: -206_130, qty: 2 }],
    })
    getEvalState().exitEvaluation()

    render(<AnalyticsScreen />)

    expect(await screen.findByRole('heading', { name: 'Profit and loss' })).toBeVisible()
    const objectivesHeading = screen.getByRole('heading', { name: 'Challenge objectives' })
    expect(objectivesHeading).toBeVisible()
    const objectives = objectivesHeading.closest('section')
    expect(objectives).not.toBeNull()
    expect(screen.queryByText(/payout eligibility|funded account rules|verification objectives/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Max daily loss' })).toBeVisible()
    expect(screen.getByText('$1,000')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Max trailing loss' })).toBeVisible()
    expect(screen.getByText('$2,000')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Profit target' })).toBeVisible()
    expect(screen.getByText('$3,000')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Consistency limit' })).toBeVisible()
    if (objectives) expect(within(objectives).getByText('50%')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Max position size' })).toBeVisible()
    expect(screen.getByText('5 contracts')).toBeVisible()
    expect(screen.getByText('5W / 27L')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Expectancy & profit factor' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Performance calendar' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Average trade frequency' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Day' }))
    expect(screen.getByRole('img', { name: /Evaluation profit and loss curve for Day period/ })).toBeVisible()
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
    expect(screen.queryByText(/Simulations use .* completed trades/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('N. simulations')).toHaveValue(25)
    expect(screen.getByLabelText('Trades per sim')).toHaveValue(10)
    expect(screen.getByLabelText('Start balance $')).toHaveValue(101_300)
    expect(screen.getByLabelText('Win rate')).toHaveValue(50)
    await user.click(screen.getByRole('button', { name: /Start simulation/ }))
    expect(await screen.findByText('Simulation results')).toBeVisible()
  })

  it('does not show an alert for a small number of excluded simulation trades', async () => {
    const user = userEvent.setup()
    vi.unstubAllGlobals()
    installAnalyticsApi(performanceFixture, stopLossFixture, {
      ...rrFixture,
      includedTrades: 32,
      excludedTrades: { noInitialStop: 8, invalidRisk: 0, missingMarketData: 0 },
    })
    render(<AnalyticsScreen />)

    await user.click(screen.getByRole('tab', { name: 'Simulation' }))
    expect(await screen.findByRole('table', { name: 'Risk-reward simulation results' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an honest empty state when the selected source has no user-created tags', async () => {
    const user = userEvent.setup()
    render(<AnalyticsScreen />)
    await user.click(screen.getByRole('tab', { name: 'Tags' }))
    expect(screen.getByRole('heading', { name: 'No tagged trades yet' })).toBeVisible()
  })
})
