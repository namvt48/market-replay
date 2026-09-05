import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '../store/ui-store'
import { useEvalStore } from '../store/eval-store'
import { TopBar } from './TopBar'

const replayMocks = vi.hoisted(() => ({ beginReplaySelection: vi.fn(), requestChartViewSymbol: vi.fn(), selectSymbol: vi.fn().mockResolvedValue(undefined) }))
const workspaceMocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {
    activePaneId: 'pane-1',
    timezone: { kind: 'preset' as const, id: 'ET' as const },
    syncFlags: { crosshair: true, dateRange: true, lockZoom: false },
    panes: { 'pane-1': { id: 'pane-1' }, 'pane-2': { id: 'pane-2' } },
    root: { kind: 'split', id: 'root', orientation: 'horizontal', ratio: 0.5, first: { kind: 'pane', paneId: 'pane-1' }, second: { kind: 'pane', paneId: 'pane-2' } },
  },
}))
const snapshot = {
  status: 'ready',
  symbols: [
    { symbol: 'NQ', name: 'E-mini Nasdaq-100 Futures', kind: 'future', currency: 'USD', tickSize: 0.25, pointValue: 20, priceDecimals: 2, sessionTz: 'America/New_York', rollRule: '', commissionPerSide: 2.09, defaultSlippageTicks: 1, ranges: {} },
    { symbol: 'ES', name: 'E-mini S&P 500 Futures', kind: 'future', currency: 'USD', tickSize: 0.25, pointValue: 50, priceDecimals: 2, sessionTz: 'America/New_York', rollRule: '', commissionPerSide: 2.09, defaultSlippageTicks: 1, ranges: {} },
  ],
  symbol: { symbol: 'NQ' },
  eagerState: 'ready',
  viewportCachedBars: 0,
  replayMode: 'inactive',
  sessionId: null as string | null,
  sessionName: null as string | null,
  sessionStatus: null as 'active' | 'paused' | 'stopped' | null,
}
vi.mock('../replay/use-replay', () => ({
  useReplaySnapshot: () => snapshot,
  useReplaySelector: (select: (value: typeof snapshot) => unknown) => select(snapshot),
}))
vi.mock('../replay/replay-engine', () => ({ replayEngine: { selectSymbol: replayMocks.selectSymbol, requestChartViewSymbol: replayMocks.requestChartViewSymbol, beginReplaySelection: replayMocks.beginReplaySelection } }))
vi.mock('../chart-workspace/use-chart-workspace', () => ({
  useChartWorkspace: () => ({ state: workspaceMocks.state, dispatch: workspaceMocks.dispatch }),
}))
vi.mock('./timeframe/use-timeframe-preferences', () => ({
  useTimeframePreferences: () => ({ starredTimeframes: ['1m', '5m', '15m', '1h', '1d'], customTimeframes: [] }),
}))
vi.mock('./chart/LayoutMenu', () => ({ LayoutMenu: () => <button type="button">Layouts</button> }))
vi.mock('./chart/ChartWorkspaceControls', () => ({ ChartWorkspaceControls: () => <div aria-label="Shared chart controls" /> }))

describe('TopBar timeframe visibility', () => {
  beforeEach(() => {
    replayMocks.beginReplaySelection.mockReset()
    replayMocks.requestChartViewSymbol.mockReset()
    replayMocks.selectSymbol.mockReset().mockResolvedValue(undefined)
    workspaceMocks.dispatch.mockReset()
    workspaceMocks.state.activePaneId = 'pane-1'
    useUiStore.setState({ activeTf: '1w' })
    useEvalStore.setState({ phase: 'idle' })
    snapshot.sessionId = null
    snapshot.sessionName = null
    snapshot.sessionStatus = null
  })
  afterEach(cleanup)

  it('keeps an unstarred active timeframe visible and selected', () => {
    render(<TopBar />)

    expect(screen.getByRole('button', { name: '1w', pressed: true })).toBeVisible()
  })

  it('uses the shared title and control typography roles', () => {
    render(<TopBar />)

    const brand = screen.getByRole('link', { name: 'Market Replay chart workspace' })
    expect(brand).toHaveClass('flex', 'text-ui-title')
    expect(brand).not.toHaveClass('hidden')
    expect(brand.querySelector('[data-mark="market-replay-loop"]')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1w', pressed: true })).toHaveClass('text-ui-control')
    expect(screen.getByRole('button', { name: 'Start bar replay' })).toHaveClass('text-ui-control')
    expect(screen.queryByText(/bars · bounded/i)).not.toBeInTheDocument()
  })

  it('provides Analytics as a top-bar destination outside the sidebar', () => {
    render(<TopBar />)

    expect(screen.getByRole('link', { name: 'Open analytics' })).toHaveAttribute('href', '/analytics')
  })

  it('provides Live as a top-bar destination outside the sidebar', () => {
    render(<TopBar />)

    const live = screen.getByRole('link', { name: 'Open live accounts' })
    expect(live).toHaveAttribute('href', '/live')
    expect(live).toHaveTextContent('Live')
  })

  it('orders workspace tools, live execution, analytics, then utilities', () => {
    render(<TopBar />)

    const controls = screen.getByLabelText('Workspace controls')
    const live = screen.getByRole('link', { name: 'Open live accounts' })
    const analytics = screen.getByRole('link', { name: 'Open analytics' })
    const settings = screen.getByRole('button', { name: 'Workspace settings' })
    expect(live.compareDocumentPosition(analytics) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(analytics.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(controls).toContainElement(live)
  })

  it('shows the active replay session name in the top bar', () => {
    snapshot.sessionId = 'session-1'
    snapshot.sessionName = 'New York open'
    snapshot.sessionStatus = 'active'

    render(<TopBar />)

    expect(screen.getByLabelText('Active replay session')).toHaveTextContent('New York open')
    expect(screen.getByText('Session')).toBeVisible()
  })

  it('enters bar-selection mode from the Replay command', async () => {
    const user = userEvent.setup()
    render(<TopBar />)

    await user.click(screen.getByRole('button', { name: 'Start bar replay' }))
    expect(replayMocks.beginReplaySelection).toHaveBeenCalledOnce()
  })

  it('changes one timezone for the whole chart workspace', async () => {
    const user = userEvent.setup()
    render(<TopBar />)

    expect(screen.queryByRole('button', { name: 'Workspace timezone: ET' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Workspace settings' }))
    await user.click(await screen.findByRole('button', { name: /^Timezone/ }))
    await user.click(screen.getByRole('radio', { name: /PT.*Los Angeles/ }))

    expect(workspaceMocks.dispatch).toHaveBeenCalledWith({ type: 'set-timezone', timezone: { kind: 'preset', id: 'PT' } })
  })

  it('hides the Replay command while an evaluation is running', () => {
    useEvalStore.setState({ phase: 'running' })
    render(<TopBar />)

    expect(screen.queryByRole('button', { name: 'Start bar replay' })).not.toBeInTheDocument()
    expect(replayMocks.beginReplaySelection).not.toHaveBeenCalled()
  })

  it('keeps symbol switching available while an evaluation is running', async () => {
    const user = userEvent.setup()
    useEvalStore.setState({ phase: 'running' })
    render(<TopBar />)

    const symbol = screen.getByRole('button', { name: 'Change symbol, current NQ' })
    expect(symbol).toBeEnabled()
    await user.click(symbol)
    await user.click(await screen.findByRole('button', { name: /Select ES, E-mini S&P 500 Futures/i }))
    expect(workspaceMocks.dispatch).toHaveBeenCalledWith({ type: 'set-pane-symbol', paneId: 'pane-1', symbol: 'ES' })
    expect(replayMocks.requestChartViewSymbol).toHaveBeenCalledWith('pane-1', 'ES')
  })

  it('routes the top symbol selector to the active chart while preserving its timeframe', async () => {
    const user = userEvent.setup()
    workspaceMocks.state.activePaneId = 'pane-2'
    render(<TopBar />)

    await user.click(screen.getByRole('button', { name: 'Change symbol, current NQ' }))
    await user.click(await screen.findByRole('button', { name: /Select ES, E-mini S&P 500 Futures/i }))

    expect(workspaceMocks.dispatch).toHaveBeenCalledWith({ type: 'set-pane-symbol', paneId: 'pane-2', symbol: 'ES' })
    await waitFor(() => expect(replayMocks.requestChartViewSymbol).toHaveBeenCalledWith('pane-2', 'ES'))
  })

  it('removes the heavy blue focus outline from the symbol browser search field', async () => {
    const user = userEvent.setup()
    render(<TopBar />)

    await user.click(screen.getByRole('button', { name: 'Change symbol, current NQ' }))

    expect(await screen.findByRole('textbox', { name: 'Search symbols' })).toHaveClass('focus-visible:!outline-none')
  })

  it('falls back to the top-left chart when the stored active chart is unavailable', async () => {
    const user = userEvent.setup()
    workspaceMocks.state.activePaneId = 'missing-pane'
    render(<TopBar />)

    await user.click(screen.getByRole('button', { name: 'Change symbol, current NQ' }))
    await user.click(await screen.findByRole('button', { name: /Select ES, E-mini S&P 500 Futures/i }))

    expect(workspaceMocks.dispatch).toHaveBeenCalledWith({ type: 'set-pane-symbol', paneId: 'pane-1', symbol: 'ES' })
    await waitFor(() => expect(replayMocks.requestChartViewSymbol).toHaveBeenCalledWith('pane-1', 'ES'))
  })
})
