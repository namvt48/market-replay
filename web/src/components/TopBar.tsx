import { ChevronDown, Keyboard, PanelRightClose, PanelRightOpen, Rewind, Search } from 'lucide-react'
import type { Timeframe } from '../api/types'
import { replayEngine } from '../replay/replay-engine'
import { sortTimeframes } from '../replay/timeframe'
import { useReplaySelector } from '../replay/use-replay'
import { useUiStore } from '../store/ui-store'
import { useEvalStore } from '../store/eval-store'
import { TimeframeMenu } from './timeframe/TimeframeMenu'
import { useTimeframePreferences } from './timeframe/use-timeframe-preferences'
import { LayoutMenu } from './chart/LayoutMenu'
import { ChartWorkspaceControls } from './chart/ChartWorkspaceControls'
import { useChartWorkspace } from '../chart-workspace/use-chart-workspace'
import { IndicatorMenu } from './indicators/IndicatorMenu'
import { paneIds } from '../chart-workspace/layout-presets'
import { ReplayBrandMark } from './ReplayBrandMark'

interface TopBarProps {
  layoutMenuRequest?: number
  onOpenShortcuts?: () => void
}

export function TopBar({ layoutMenuRequest = 0, onOpenShortcuts = () => undefined }: TopBarProps) {
  // Scoped so the header ignores cursor/fill/stats churn while replay plays.
  const replay = useReplaySelector((snapshot) => ({
    symbol: (snapshot.activeSymbol ?? snapshot.symbol)?.symbol ?? '',
    symbols: snapshot.symbols,
    status: snapshot.status,
    replayMode: snapshot.replayMode,
  }))
  const evalLocked = useEvalStore((state) => state.phase === 'running')
  const { state: chartWorkspace, dispatch: dispatchChartWorkspace } = useChartWorkspace()
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const activeTf = useUiStore((state) => state.activeTf)
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen)
  const setActiveTf = useUiStore((state) => state.setActiveTf)
  const preferences = useTimeframePreferences()
  const visibleTimeframes = sortTimeframes([...new Set([...preferences.starredTimeframes, activeTf])])
  const targetPaneId = chartWorkspace.panes[chartWorkspace.activePaneId]
    ? chartWorkspace.activePaneId
    : paneIds(chartWorkspace.root)[0]

  return (
    <header className="flex h-11 shrink-0 items-stretch border-b border-line bg-[#101114]" aria-label="Workspace controls">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 [scrollbar-width:none] md:gap-2 md:px-3">
        <a href="#chart-workspace" aria-label="Market Replay chart workspace" className="mr-1 flex shrink-0 items-center gap-2 text-ui-title font-semibold tracking-[-0.015em] text-ink sm:mr-2">
          <ReplayBrandMark className="size-8 shrink-0" />
          <span className="hidden sm:inline">MARKET REPLAY</span>
        </a>

        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" size={14} />
          <select
            aria-label="Symbol"
            value={replay.symbol}
            onChange={(event) => {
              const symbol = event.target.value
              if (!targetPaneId) return
              dispatchChartWorkspace({ type: 'set-pane-symbol', paneId: targetPaneId, symbol })
              if (evalLocked) replayEngine.requestChartViewSymbol(targetPaneId, symbol)
              else void replayEngine.selectSymbol(symbol).then(() => replayEngine.requestChartViewSymbol(targetPaneId, symbol))
            }}
            className="h-8 appearance-none rounded-control border border-line bg-surface-2 pl-8 pr-8 text-ui-title font-semibold text-ink outline-none transition-colors hover:border-line-strong focus-visible:border-active"
          >
            {replay.symbols.map((symbol) => <option key={symbol.symbol} value={symbol.symbol}>{symbol.symbol}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted" size={13} />
        </div>

        <ChartWorkspaceControls />

        <nav className="flex shrink-0 items-center rounded-control bg-surface-0 p-0.5" aria-label="Chart timeframe">
          {visibleTimeframes.map((timeframe) => (
            <button
              key={timeframe}
              type="button"
              onClick={() => setActiveTf(timeframe)}
              aria-pressed={activeTf === timeframe}
              className="h-7 min-w-9 rounded-[3px] px-2 text-ui-control font-medium text-muted transition-colors hover:text-ink aria-pressed:bg-surface-3 aria-pressed:text-ink"
            >
              {timeframe}
            </button>
          ))}
        </nav>
        <TimeframeMenu active={activeTf} onSelect={(timeframe: Timeframe) => setActiveTf(timeframe)} />

        {evalLocked ? null : (
          <>
            <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line" />
            <button
              type="button"
              disabled={replay.status !== 'ready' && replay.status !== 'buffering'}
              onClick={() => replayEngine.beginReplaySelection()}
              aria-label={replay.replayMode === 'inactive' ? 'Start bar replay' : 'Replay mode: select start bar'}
              aria-pressed={replay.replayMode !== 'inactive'}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-control border border-line px-2.5 text-ui-control font-medium text-muted transition-colors hover:bg-surface-3 hover:text-ink disabled:cursor-wait disabled:opacity-40 aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface-0"
            >
              <Rewind size={14} strokeWidth={1.9} />Replay
            </button>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-l border-line bg-[#101114] px-2 text-ui-body text-muted md:gap-2 md:px-3">
        <IndicatorMenu />
        <LayoutMenu openRequest={layoutMenuRequest} />
        <button type="button" onClick={onOpenShortcuts} className="tool-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts · ?"><Keyboard size={16} strokeWidth={1.7} /></button>
        <button
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="grid size-8 place-items-center rounded-control text-muted transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-active"
          aria-label={sidebarOpen ? 'Hide operations panel' : 'Show operations panel'}
        >
          {sidebarOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
    </header>
  )
}
