import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChartPaneState } from '../../chart-workspace/types'
import { DEFAULT_CHART_PANE_SETTINGS } from '../../replay/chart-settings-store'
import { ChartTile } from './ChartTile'

const replayMocks = vi.hoisted(() => ({
  snapshot: {
    status: 'loading',
    symbol: { symbol: 'NQ', name: 'Nasdaq', priceDecimals: 2 },
    symbols: [
      { symbol: 'NQ', name: 'Nasdaq', priceDecimals: 2 },
      { symbol: 'ES', name: 'E-mini S&P', priceDecimals: 2 },
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
vi.mock('../../replay/lwc-adapter', () => ({ LwcAdapter: class {} }))
vi.mock('./OhlcLegend', () => ({ OhlcLegend: () => null }))

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
    await user.selectOptions(screen.getByRole('combobox', { name: 'Chart symbol' }), 'ES')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Chart timeframe' }), '5m')

    expect(onSymbolChange).toHaveBeenCalledWith('ES')
    expect(replayMocks.requestChartViewSymbol).toHaveBeenCalledWith('pane-1', 'ES')
    expect(onTimeframeChange).toHaveBeenCalledWith('5m')
    expect(screen.queryByRole('dialog', { name: 'Chart symbol and timeframe' })).not.toBeInTheDocument()
  })
})
