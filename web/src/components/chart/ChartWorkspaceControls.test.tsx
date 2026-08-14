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
  it('opens a compact market-session menu and switches the shared session', async () => {
    const user = userEvent.setup()
    render(<ChartWorkspaceProvider><ChartWorkspaceControls /></ChartWorkspaceProvider>)

    const trigger = screen.getByRole('button', { name: 'Market session: Electronic trading hours (ETH)' })
    expect(trigger).toHaveTextContent('ETH')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox', { name: 'Market session' })).not.toBeInTheDocument()

    await user.click(trigger)

    const menu = screen.getByRole('listbox', { name: 'Market session' })
    expect(menu.parentElement).toBe(document.body)
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['RTH', 'ETH'])
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('option', { name: 'Regular trading hours (RTH)' }))

    expect(menu).not.toBeInTheDocument()
    expect(trigger).toHaveTextContent('RTH')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(engineMocks.setMarketSession).toHaveBeenLastCalledWith('rth'))
  })

  it('closes the market-session menu with Escape and restores trigger focus', async () => {
    const user = userEvent.setup()
    render(<ChartWorkspaceProvider><ChartWorkspaceControls /></ChartWorkspaceProvider>)

    const trigger = screen.getByRole('button', { name: 'Market session: Electronic trading hours (ETH)' })
    await user.click(trigger)
    expect(screen.getByRole('option', { name: 'Electronic trading hours (ETH)' })).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox', { name: 'Market session' })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
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
