import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLayoutPreset } from '../../chart-workspace/layout-presets'
import { persistChartLayout } from '../../chart-workspace/layout-storage'
import { useUiStore } from '../../store/ui-store'
import { ChartWorkspace } from './ChartWorkspace'
import { ChartWorkspaceProvider } from '../../chart-workspace/ChartWorkspaceContext'
import { LayoutMenu } from './LayoutMenu'

function WorkspaceHarness() {
  return <ChartWorkspaceProvider><LayoutMenu /><ChartWorkspace /></ChartWorkspaceProvider>
}

const engineMocks = vi.hoisted(() => ({ activateChartView: vi.fn(), setMarketSession: vi.fn(), setSyncFlags: vi.fn() }))
const workspaceReplay = vi.hoisted(() => ({ snapshot: { status: 'ready', replayMode: 'inactive' } }))
vi.mock('../../replay/replay-engine', () => ({ replayEngine: engineMocks }))
vi.mock('../../replay/use-replay', () => ({
  useReplaySelector: (select: (snapshot: typeof workspaceReplay.snapshot) => unknown) => select(workspaceReplay.snapshot),
}))
vi.mock('./DrawingToolbar', () => ({
  DrawingToolbar: ({ disabled }: { disabled?: boolean }) => <nav aria-label="Drawing tools" data-disabled={disabled} />,
}))
vi.mock('./ChartTile', () => ({
  ChartTile: ({ pane, active, maximized, onActivate, onToggleMaximize }: { pane: { id: string; timeframe: string; settings: { appearance: { backgroundColor: string } } }; active: boolean; maximized: boolean; onActivate: () => void; onToggleMaximize: () => void }) => (
    <div data-testid="chart-tile" data-pane={pane.id} data-active={active} data-maximized={maximized} data-background={pane.settings.appearance.backgroundColor}>
      <button type="button" onClick={onActivate}>{pane.id} {pane.timeframe}</button>
      <button type="button" onClick={onToggleMaximize}>Maximize {pane.id}</button>
    </div>
  ),
}))

beforeEach(() => {
  window.localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440, writable: true })
  useUiStore.setState({ activeTf: '1m', activePaneId: 'pane-1', maximizedPaneId: null })
})
afterEach(cleanup)

describe('ChartWorkspace', () => {
  it('switches presets, activates panes and restores layout after reload', async () => {
    const user = userEvent.setup()
    const first = render(<WorkspaceHarness />)
    await user.click(screen.getByRole('button', { name: 'Chart layouts' }))
    await user.click(screen.getByRole('button', { name: '4 charts' }))
    expect(screen.getAllByTestId('chart-tile')).toHaveLength(4)
    expect(screen.getAllByRole('navigation', { name: 'Drawing tools' })).toHaveLength(1)
    expect(screen.getAllByRole('separator')).toHaveLength(3)
    await user.click(screen.getByText('pane-3 1m'))
    expect(engineMocks.activateChartView).toHaveBeenCalledWith('pane-3')
    first.unmount()
    render(<WorkspaceHarness />)
    expect(screen.getAllByTestId('chart-tile')).toHaveLength(4)
    expect(screen.getAllByRole('navigation', { name: 'Drawing tools' })).toHaveLength(1)
  })

  it('renders only the active pane with tabs on mobile', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375, writable: true })
    const user = userEvent.setup()
    render(<WorkspaceHarness />)
    await user.click(screen.getByRole('button', { name: 'Chart layouts' }))
    await user.click(screen.getByRole('button', { name: '4 charts' }))
    expect(screen.getAllByTestId('chart-tile')).toHaveLength(1)
    const tabs = screen.getAllByRole('button', { name: '1m' })
    expect(tabs).toHaveLength(4)
    await user.click(tabs[2])
    expect(screen.getByTestId('chart-tile')).toHaveAttribute('data-pane', 'pane-3')
  })

  it('temporarily maximizes one chart without mutating the saved layout', async () => {
    const user = userEvent.setup()
    render(<WorkspaceHarness />)
    await user.click(screen.getByRole('button', { name: 'Chart layouts' }))
    await user.click(screen.getByRole('button', { name: '4 charts' }))

    await user.click(screen.getByRole('button', { name: 'Maximize pane-3' }))
    expect(screen.getAllByTestId('chart-tile')).toHaveLength(1)
    expect(screen.getByTestId('chart-tile')).toHaveAttribute('data-pane', 'pane-3')

    await user.click(screen.getByRole('button', { name: 'Maximize pane-3' }))
    expect(screen.getAllByTestId('chart-tile')).toHaveLength(4)
  })

  it('starts at 1m even when the autosaved workspace ended on another timeframe', async () => {
    const persisted = createLayoutPreset('single')
    persisted.panes['pane-1'].timeframe = '45m'
    persistChartLayout(persisted)

    render(<ChartWorkspaceProvider><ChartWorkspace /></ChartWorkspaceProvider>)

    await waitFor(() => expect(useUiStore.getState().activeTf).toBe('1m'))
    expect(screen.getByTestId('chart-tile')).toHaveTextContent('pane-1 1m')
  })
})
