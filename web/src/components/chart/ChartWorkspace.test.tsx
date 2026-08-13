import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, type ReactNode } from 'react'
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
const popoutMocks = vi.hoisted(() => ({
  window: { closed: false, close: vi.fn(), focus: vi.fn() },
  root: document.createElement('div'),
  open: vi.fn(),
  lifecycle: [] as string[],
}))
vi.mock('../../replay/replay-engine', () => ({ replayEngine: engineMocks }))
vi.mock('../../replay/use-replay', () => ({
  useReplaySelector: (select: (snapshot: typeof workspaceReplay.snapshot) => unknown) => select(workspaceReplay.snapshot),
}))
vi.mock('./DrawingToolbar', () => ({
  DrawingToolbar: ({ disabled }: { disabled?: boolean }) => <nav aria-label="Drawing tools" data-disabled={disabled} />,
}))
vi.mock('./chart-popout', () => ({ openChartPopout: (...args: [string, string]) => popoutMocks.open(...args) }))
vi.mock('./ChartPopoutWindow', () => ({
  ChartPopoutWindow: ({ children }: { children: ReactNode }) => {
    useEffect(() => () => {
      popoutMocks.lifecycle.push('portal-cleanup')
      window.setTimeout(() => popoutMocks.window.close(), 0)
    }, [])
    return <div data-testid="chart-popout">{children}</div>
  },
}))
vi.mock('./ChartTile', () => ({
  ChartTile: ({ pane, active, maximized, detached, onActivate, onToggleMaximize, onPopOut }: { pane: { id: string; timeframe: string; settings: { appearance: { backgroundColor: string } } }; active: boolean; maximized: boolean; detached?: boolean; onActivate: () => void; onToggleMaximize: () => void; onPopOut?: () => void }) => {
    useEffect(() => () => { if (detached) popoutMocks.lifecycle.push('chart-cleanup') }, [detached])
    return (
      <div data-testid="chart-tile" data-pane={pane.id} data-active={active} data-maximized={maximized} data-detached={detached} data-background={pane.settings.appearance.backgroundColor}>
        <button type="button" onClick={onActivate}>{pane.id} {pane.timeframe}</button>
        <button type="button" onClick={onToggleMaximize}>Maximize {pane.id}</button>
        {onPopOut ? <button type="button" onClick={onPopOut}>Pop out {pane.id}</button> : null}
      </div>
    )
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440, writable: true })
  useUiStore.setState({ activeTf: '1m', activePaneId: 'pane-1', maximizedPaneId: null })
  popoutMocks.window.closed = false
  popoutMocks.lifecycle.length = 0
  popoutMocks.window.close.mockImplementation(() => { popoutMocks.lifecycle.push('window-close') })
  popoutMocks.open.mockReturnValue({ window: popoutMocks.window, root: popoutMocks.root })
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

  it('moves a pane into a linked window and restores it when requested', async () => {
    const user = userEvent.setup()
    render(<ChartWorkspaceProvider><ChartWorkspace /></ChartWorkspaceProvider>)

    await user.click(screen.getByRole('button', { name: 'Pop out pane-1' }))

    expect(popoutMocks.open).toHaveBeenCalledWith('pane-1', 'Chart · 1m')
    expect(screen.getByRole('region', { name: '1m chart open in another window' })).toBeInTheDocument()
    expect(screen.getByTestId('chart-popout')).toBeInTheDocument()
    expect(screen.getByTestId('chart-tile')).toHaveAttribute('data-detached', 'true')

    await user.click(screen.getByRole('button', { name: 'Focus window' }))
    expect(popoutMocks.window.focus).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Bring back' }))

    await waitFor(() => expect(popoutMocks.window.close).toHaveBeenCalled())
    expect(popoutMocks.lifecycle.indexOf('window-close')).toBeGreaterThan(popoutMocks.lifecycle.indexOf('chart-cleanup'))
    expect(screen.queryByRole('region', { name: '1m chart open in another window' })).not.toBeInTheDocument()
    expect(screen.getByTestId('chart-tile')).toHaveAttribute('data-detached', 'false')
  })

  it('reflows the remaining charts to fill the space freed by a popped-out pane', async () => {
    const user = userEvent.setup()
    render(<WorkspaceHarness />)
    await user.click(screen.getByRole('button', { name: 'Chart layouts' }))
    await user.click(screen.getByRole('button', { name: '4 charts' }))
    expect(screen.getAllByTestId('chart-tile')).toHaveLength(4)
    expect(screen.getAllByRole('separator')).toHaveLength(3)

    await user.click(screen.getByText('Pop out pane-2'))

    const mainTiles = screen.getAllByTestId('chart-tile').filter((tile) => tile.getAttribute('data-detached') !== 'true')
    expect(mainTiles.map((tile) => tile.getAttribute('data-pane'))).toEqual(['pane-1', 'pane-3', 'pane-4'])
    expect(screen.getAllByRole('separator')).toHaveLength(2)
    expect(screen.queryByRole('region', { name: '1m chart open in another window' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Return 1m chart to workspace' }))
    await waitFor(() => expect(screen.getAllByTestId('chart-tile').filter((tile) => tile.getAttribute('data-detached') !== 'true')).toHaveLength(4))
    expect(screen.getAllByRole('separator')).toHaveLength(3)
  })

  it('leaves maximize mode and fills the workspace when the maximized pane is popped out', async () => {
    const user = userEvent.setup()
    render(<WorkspaceHarness />)
    await user.click(screen.getByRole('button', { name: 'Chart layouts' }))
    await user.click(screen.getByRole('button', { name: '4 charts' }))
    await user.click(screen.getByRole('button', { name: 'Maximize pane-3' }))

    await user.click(screen.getByRole('button', { name: 'Pop out pane-3' }))

    const mainTiles = screen.getAllByTestId('chart-tile').filter((tile) => tile.getAttribute('data-detached') !== 'true')
    expect(mainTiles.map((tile) => tile.getAttribute('data-pane'))).toEqual(['pane-1', 'pane-2', 'pane-4'])
    expect(screen.queryByRole('region', { name: '1m chart open in another window' })).not.toBeInTheDocument()
    expect(useUiStore.getState().maximizedPaneId).toBeNull()
  })

  it('selects the next visible tab when the active mobile chart is popped out', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375, writable: true })
    const user = userEvent.setup()
    render(<WorkspaceHarness />)
    await user.click(screen.getByRole('button', { name: 'Chart layouts' }))
    await user.click(screen.getByRole('button', { name: '4 charts' }))

    await user.click(screen.getByRole('button', { name: 'Pop out pane-1' }))

    const mainTiles = screen.getAllByTestId('chart-tile').filter((tile) => tile.getAttribute('data-detached') !== 'true')
    expect(mainTiles.map((tile) => tile.getAttribute('data-pane'))).toEqual(['pane-2'])
    expect(screen.getAllByRole('button', { name: '1m' })).toHaveLength(3)
    expect(screen.queryByRole('region', { name: '1m chart open in another window' })).not.toBeInTheDocument()
    expect(useUiStore.getState().activePaneId).toBe('pane-2')
  })
})
