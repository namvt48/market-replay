import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChartPaneState } from '../../chart-workspace/types'
import { DEFAULT_CHART_PANE_SETTINGS } from '../../replay/chart-settings-store'
import { ChartTile } from './ChartTile'

const lwcAdapterMocks = vi.hoisted(() => ({ syncContainerSize: vi.fn() }))
const timeframeMocks = vi.hoisted(() => ({
  snapshot: { starredTimeframes: ['5s', '1m', '5m', '1h'], customTimeframes: ['7m'] },
}))

const replayMocks = vi.hoisted(() => ({
  snapshot: {
    status: 'loading',
    symbol: { symbol: 'NQ', name: 'Nasdaq', priceDecimals: 2, ranges: { '5s': { from: 1, to: 2 } } },
    symbols: [
      { symbol: 'NQ', name: 'Nasdaq', priceDecimals: 2, ranges: { '5s': { from: 1, to: 2 } } },
      { symbol: 'ES', name: 'E-mini S&P', priceDecimals: 2, ranges: {} },
    ],
    error: null,
  },
  registerChartView: vi.fn(),
  unregisterChartView: vi.fn(),
  requestChartViewTimeframe: vi.fn(),
  updateChartViewSettings: vi.fn(),
  activateChartView: vi.fn(),
  resetChartView: vi.fn(),
  requestChartViewSymbol: vi.fn(),
}))

vi.mock('../../replay/use-replay', () => ({
  useReplaySnapshot: () => replayMocks.snapshot,
  useReplaySelector: (select: (value: typeof replayMocks.snapshot) => unknown) => select(replayMocks.snapshot),
}))
vi.mock('../../replay/replay-engine', () => ({ replayEngine: replayMocks }))
vi.mock('../../replay/lwc-adapter', () => ({ LwcAdapter: class { syncContainerSize = lwcAdapterMocks.syncContainerSize } }))
vi.mock('./OhlcLegend', () => ({ OhlcLegend: () => null }))
vi.mock('../timeframe/use-timeframe-preferences', () => ({ useTimeframePreferences: () => timeframeMocks.snapshot }))

const pane: ChartPaneState = {
  id: 'pane-1',
  symbol: 'NQ',
  timeframe: '1m',
  settings: DEFAULT_CHART_PANE_SETTINGS,
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ChartTile chart shell', () => {
  it('renders a foreground outline only around the selected chart', () => {
    const props = {
      pane,
      removable: false,
      maximized: false,
      onActivate: () => undefined,
      onToggleMaximize: () => undefined,
      onRemove: () => undefined,
      onSymbolChange: () => undefined,
      onTimeframeChange: () => undefined,
      onSettingsChange: () => undefined,
    }
    const { rerender } = render(<ChartTile {...props} active />)

    const activeChart = screen.getByRole('region', { name: '1m market chart, active' })
    expect(activeChart).toHaveAttribute('data-active-chart', 'true')
    expect(activeChart.querySelector('[data-active-chart-outline]')).toHaveClass('border-active/80')

    rerender(<ChartTile {...props} active={false} />)

    const inactiveChart = screen.getByRole('region', { name: '1m market chart' })
    expect(inactiveChart).toHaveAttribute('data-active-chart', 'false')
    expect(inactiveChart.querySelector('[data-active-chart-outline]')).toBeNull()
  })

  it('leaves drawing controls to the workspace while market data loads', () => {
    render(<ChartTile pane={pane} active removable={false} maximized={false} onActivate={() => undefined} onToggleMaximize={() => undefined} onRemove={() => undefined} onSymbolChange={() => undefined} onTimeframeChange={() => undefined} onSettingsChange={() => undefined} />)

    expect(screen.queryByRole('navigation', { name: 'Drawing tools' })).not.toBeInTheDocument()
    expect(screen.getByText('Loading market data…')).toBeInTheDocument()
  })

  it('offers Reset chart view from the chart context menu', async () => {
    const user = userEvent.setup()
    render(<ChartTile pane={pane} active removable={false} maximized={false} onActivate={() => undefined} onToggleMaximize={() => undefined} onRemove={() => undefined} onSymbolChange={() => undefined} onTimeframeChange={() => undefined} onSettingsChange={() => undefined} />)

    fireEvent.contextMenu(screen.getByRole('region', { name: '1m market chart, active' }), { clientX: 240, clientY: 180 })
    await user.click(screen.getByRole('menuitem', { name: 'Reset chart view' }))

    expect(replayMocks.resetChartView).toHaveBeenCalledWith('pane-1')
    expect(screen.queryByRole('menu', { name: 'Chart actions' })).not.toBeInTheDocument()
  })

  it('opens symbol and timeframe selection from the chart identity button', async () => {
    const user = userEvent.setup()
    const onSymbolChange = vi.fn()
    const onTimeframeChange = vi.fn()
    render(<ChartTile pane={pane} active removable={false} maximized={false} onActivate={() => undefined} onToggleMaximize={() => undefined} onRemove={() => undefined} onSymbolChange={onSymbolChange} onTimeframeChange={onTimeframeChange} onSettingsChange={() => undefined} />)

    await user.click(screen.getByRole('button', { name: 'NQ 1m chart symbol and timeframe' }))
    expect(screen.getByRole('combobox', { name: 'Chart timeframe' }).querySelectorAll('option')).toHaveLength(4)
    expect([...screen.getByRole('combobox', { name: 'Chart timeframe' }).querySelectorAll('option')].map((option) => option.value)).toEqual(['5s', '1m', '5m', '1h'])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Chart symbol' }), 'ES')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Chart timeframe' }), '5m')

    expect(onSymbolChange).toHaveBeenCalledWith('ES')
    expect(replayMocks.requestChartViewSymbol).toHaveBeenCalledWith('pane-1', 'ES')
    expect(onTimeframeChange).toHaveBeenCalledWith('5m')
    expect(screen.queryByRole('dialog', { name: 'Chart symbol and timeframe' })).not.toBeInTheDocument()
  })

  it('offers moving a chart to another browser window', async () => {
    const user = userEvent.setup()
    const onPopOut = vi.fn()
    render(<ChartTile pane={pane} active removable={false} maximized={false} onActivate={() => undefined} onToggleMaximize={() => undefined} onRemove={() => undefined} onSymbolChange={() => undefined} onTimeframeChange={() => undefined} onSettingsChange={() => undefined} onPopOut={onPopOut} />)

    await user.click(screen.getByRole('button', { name: 'Open 1m chart in new window' }))

    expect(onPopOut).toHaveBeenCalledOnce()
  })

  it('emphasizes chart identity while keeping pane actions compact', () => {
    render(<ChartTile pane={pane} active removable maximized={false} onActivate={() => undefined} onToggleMaximize={() => undefined} onRemove={() => undefined} onSymbolChange={() => undefined} onTimeframeChange={() => undefined} onSettingsChange={() => undefined} onPopOut={() => undefined} />)

    const identity = screen.getByRole('button', { name: 'NQ 1m chart symbol and timeframe' })
    expect(identity.querySelectorAll('svg')).toHaveLength(1)
    expect(identity.querySelector('svg')).toHaveAttribute('width', '12')

    const actions = [
      screen.getByRole('button', { name: 'Open 1m chart in new window' }),
      screen.getByRole('button', { name: 'Maximize 1m chart' }),
      screen.getByRole('button', { name: 'Chart settings for 1m' }),
      screen.getByRole('button', { name: 'Remove 1m chart' }),
    ]
    for (const action of actions) {
      expect(action).toHaveClass('chart-action-button')
      expect(action.querySelector('svg')).toHaveAttribute('width', '14')
    }
  })

  it('re-measures its chart container on every render, not just when its own props change', async () => {
    const { rerender } = render(<ChartTile pane={pane} active removable={false} maximized={false} onActivate={() => undefined} onToggleMaximize={() => undefined} onRemove={() => undefined} onSymbolChange={() => undefined} onTimeframeChange={() => undefined} onSettingsChange={() => undefined} />)
    // The adapter loads via a dynamic import and is attached to a ref, which
    // does not itself trigger a render — wait for the registration call that
    // the same import callback makes, then force a render so the ref is
    // picked up before the assertions below.
    await waitFor(() => expect(replayMocks.registerChartView).toHaveBeenCalled())
    rerender(<ChartTile pane={pane} active removable={false} maximized={false} onActivate={() => undefined} onToggleMaximize={() => undefined} onRemove={() => undefined} onSymbolChange={() => undefined} onTimeframeChange={() => undefined} onSettingsChange={() => undefined} />)
    await waitFor(() => expect(lwcAdapterMocks.syncContainerSize).toHaveBeenCalled())
    lwcAdapterMocks.syncContainerSize.mockClear()

    // A sibling pane resizing a split re-renders this tile with none of its
    // own props changed. That render must still re-measure synchronously —
    // waiting for the adapter's own ResizeObserver instead is what let a
    // horizontally dragged split trail the container's width by a frame.
    rerender(<ChartTile pane={pane} active={false} removable={false} maximized={false} onActivate={() => undefined} onToggleMaximize={() => undefined} onRemove={() => undefined} onSymbolChange={() => undefined} onTimeframeChange={() => undefined} onSettingsChange={() => undefined} />)

    expect(lwcAdapterMocks.syncContainerSize).toHaveBeenCalledTimes(1)
  })
})
