import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChartWorkspaceProvider } from '../../chart-workspace/ChartWorkspaceContext'
import { useChartWorkspace } from '../../chart-workspace/use-chart-workspace'
import { paneIds } from '../../chart-workspace/layout-presets'
import { useUiStore } from '../../store/ui-store'
import { LayoutMenu } from './LayoutMenu'

const engineMocks = vi.hoisted(() => ({ activateChartView: vi.fn(), setMarketSession: vi.fn(), setSyncFlags: vi.fn() }))
vi.mock('../../replay/replay-engine', () => ({ replayEngine: engineMocks }))

function LayoutCount() {
  const { state } = useChartWorkspace()
  return <output aria-label="Chart count">{paneIds(state.root).length}</output>
}

beforeEach(() => {
  window.localStorage.clear()
  useUiStore.setState({ activeTf: '1m', activePaneId: 'pane-1' })
})
afterEach(cleanup)

describe('LayoutMenu', () => {
  it('moves presets into one icon menu and saves/loads named layouts', async () => {
    const user = userEvent.setup()
    render(<ChartWorkspaceProvider><LayoutMenu /><LayoutCount /></ChartWorkspaceProvider>)

    await user.click(screen.getByRole('button', { name: 'Chart layouts' }))
    await user.click(screen.getByRole('button', { name: '4 charts' }))
    expect(screen.getByRole('status', { name: 'Chart count' })).toHaveTextContent('4')

    await user.click(screen.getByRole('button', { name: 'Chart layouts' }))
    await user.type(screen.getByLabelText('Layout name'), 'Review desk')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(window.localStorage.getItem('market-replay:saved-chart-layouts')).toContain('Review desk')
    await user.click(screen.getByRole('button', { name: '1 chart' }))
    expect(screen.getByRole('status', { name: 'Chart count' })).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'Chart layouts' }))
    await user.click(screen.getByText('Review desk'))
    expect(screen.getByRole('status', { name: 'Chart count' })).toHaveTextContent('4')
  })

  it('adds charts past the old four-chart cap and removes back down without blocking', async () => {
    const user = userEvent.setup()
    render(<ChartWorkspaceProvider><LayoutMenu /><LayoutCount /></ChartWorkspaceProvider>)

    await user.click(screen.getByRole('button', { name: 'Chart layouts' }))
    await user.click(screen.getByRole('button', { name: '4 charts' }))

    await user.click(screen.getByRole('button', { name: 'Chart layouts' }))
    await user.click(screen.getByRole('button', { name: 'Add chart' }))
    await user.click(screen.getByRole('button', { name: 'Add chart' }))
    expect(screen.getByRole('status', { name: 'Chart count' })).toHaveTextContent('6')
    expect(screen.getByRole('button', { name: 'Add chart' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Remove active' }))
    expect(screen.getByRole('status', { name: 'Chart count' })).toHaveTextContent('5')
  })

  it('groups visual presets from one to eight charts and applies a non-default arrangement', async () => {
    const user = userEvent.setup()
    render(<ChartWorkspaceProvider><LayoutMenu /><LayoutCount /></ChartWorkspaceProvider>)

    await user.click(screen.getByRole('button', { name: 'Chart layouts' }))
    for (let count = 1; count <= 8; count += 1) {
      expect(screen.getByRole('group', { name: `${count} chart layout${count === 1 ? '' : 's'}` })).toBeInTheDocument()
    }
    expect(Array.from({ length: 8 }, (_, index) => within(screen.getByRole('group', { name: `${index + 1} chart layout${index === 0 ? '' : 's'}` })).getAllByRole('button').length)).toEqual([1, 2, 5, 10, 10, 6, 3, 4])
    const fiveChartGroup = screen.getByRole('group', { name: '5 chart layouts' })

    await user.click(within(fiveChartGroup).getByRole('button', { name: '5 charts, main right' }))

    expect(screen.getByRole('status', { name: 'Chart count' })).toHaveTextContent('5')
  })
})
