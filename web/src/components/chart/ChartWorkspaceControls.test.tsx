import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChartWorkspaceProvider } from '../../chart-workspace/ChartWorkspaceContext'
import { useUiStore } from '../../store/ui-store'
import { ChartWorkspaceControls } from './ChartWorkspaceControls'

const engineMocks = vi.hoisted(() => ({ activateChartView: vi.fn(), setMarketSession: vi.fn(), setSyncFlags: vi.fn() }))
vi.mock('../../replay/replay-engine', () => ({ replayEngine: engineMocks }))

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
  useUiStore.setState({ activeTf: '1m', activePaneId: 'pane-1' })
})
afterEach(cleanup)

describe('ChartWorkspaceControls', () => {
  it('switches the shared market session from the visible toolbar control', async () => {
    const user = userEvent.setup()
    render(<ChartWorkspaceProvider><ChartWorkspaceControls /></ChartWorkspaceProvider>)

    const eth = screen.getByRole('button', { name: 'Electronic trading hours (ETH)' })
    const rth = screen.getByRole('button', { name: 'Regular trading hours (RTH)' })
    expect(eth).toHaveAttribute('aria-pressed', 'true')
    expect(rth).toHaveAttribute('aria-pressed', 'false')

    await user.click(rth)

    expect(rth).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(engineMocks.setMarketSession).toHaveBeenLastCalledWith('rth'))
  })

  it('toggles crosshair, date-range and zoom synchronization independently', async () => {
    const user = userEvent.setup()
    render(<ChartWorkspaceProvider><ChartWorkspaceControls /></ChartWorkspaceProvider>)

    const crosshair = screen.getByRole('button', { name: 'Sync crosshair across charts' })
    const dateRange = screen.getByRole('button', { name: 'Sync date range across charts' })
    const lockZoom = screen.getByRole('button', { name: 'Lock zoom across charts' })
    expect(crosshair).toHaveAttribute('aria-pressed', 'true')
    expect(dateRange).toHaveAttribute('aria-pressed', 'true')
    expect(lockZoom).toHaveAttribute('aria-pressed', 'false')

    await user.click(crosshair)
    await user.click(dateRange)
    await user.click(lockZoom)

    expect(crosshair).toHaveAttribute('aria-pressed', 'false')
    expect(dateRange).toHaveAttribute('aria-pressed', 'false')
    expect(lockZoom).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(engineMocks.setSyncFlags).toHaveBeenLastCalledWith({ crosshair: false, dateRange: false, lockZoom: true }))
  })
})
