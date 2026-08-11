import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '../store/ui-store'
import { useEvalStore } from '../store/eval-store'
import { TopBar } from './TopBar'

const replayMocks = vi.hoisted(() => ({ beginReplaySelection: vi.fn(), requestChartViewSymbol: vi.fn() }))
const workspaceMocks = vi.hoisted(() => ({ dispatch: vi.fn() }))
const snapshot = {
  status: 'ready',
  symbols: [{ symbol: 'NQ' }, { symbol: 'ES' }],
  symbol: { symbol: 'NQ' },
  eagerState: 'ready',
  viewportCachedBars: 0,
  replayMode: 'inactive',
}
vi.mock('../replay/use-replay', () => ({
  useReplaySnapshot: () => snapshot,
  useReplaySelector: (select: (value: typeof snapshot) => unknown) => select(snapshot),
}))
vi.mock('../replay/replay-engine', () => ({ replayEngine: { selectSymbol: vi.fn(), requestChartViewSymbol: replayMocks.requestChartViewSymbol, beginReplaySelection: replayMocks.beginReplaySelection } }))
vi.mock('../chart-workspace/use-chart-workspace', () => ({
  useChartWorkspace: () => ({ state: { activePaneId: 'pane-1' }, dispatch: workspaceMocks.dispatch }),
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
    workspaceMocks.dispatch.mockReset()
    useUiStore.setState({ activeTf: '1w' })
    useEvalStore.setState({ phase: 'idle' })
  })
  afterEach(cleanup)

  it('keeps an unstarred active timeframe visible and selected', () => {
    render(<TopBar />)

    expect(screen.getByRole('button', { name: '1w', pressed: true })).toBeVisible()
  })

  it('uses the shared title and control typography roles', () => {
    render(<TopBar />)

    expect(screen.getByText('MARKET REPLAY').closest('a')).toHaveClass('hidden', 'sm:flex', 'text-ui-title')
    expect(screen.getByRole('button', { name: '1w', pressed: true })).toHaveClass('text-ui-control')
    expect(screen.getByRole('button', { name: 'Start bar replay' })).toHaveClass('text-ui-control')
    expect(screen.queryByText(/bars · bounded/i)).not.toBeInTheDocument()
  })

  it('enters bar-selection mode from the Replay command', async () => {
    const user = userEvent.setup()
    render(<TopBar />)

    await user.click(screen.getByRole('button', { name: 'Start bar replay' }))
    expect(replayMocks.beginReplaySelection).toHaveBeenCalledOnce()
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

    const symbol = screen.getByRole('combobox', { name: 'Symbol' })
    expect(symbol).toBeEnabled()
    await user.selectOptions(symbol, 'ES')
    expect(workspaceMocks.dispatch).toHaveBeenCalledWith({ type: 'set-pane-symbol', paneId: 'pane-1', symbol: 'ES' })
    expect(replayMocks.requestChartViewSymbol).toHaveBeenCalledWith('pane-1', 'ES')
  })
})
