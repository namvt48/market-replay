import { Activity, BarChart3, Keyboard, NotebookPen, PanelRightClose, PanelRightOpen, Rewind, Settings } from 'lucide-react'
import { lazy, Suspense, useState, type ReactElement } from 'react'
import { replayEngine } from '../replay/replay-engine'
import { parseTimeframe, sortTimeframes } from '../replay/timeframe'
import { useReplaySelector } from '../replay/use-replay'
import { useUiStore } from '../store/ui-store'
import { useEvalStore } from '../store/eval-store'
import { evalAccountName } from '../eval/rules'
import { replaySessionDisplayName } from '../sources/source-name'
import { useTimeframePreferences } from './timeframe/use-timeframe-preferences'
import { TimeframeMenu } from './timeframe/TimeframeMenu'
import { LayoutMenu } from './chart/LayoutMenu'
import { ChartWorkspaceControls } from './chart/ChartWorkspaceControls'
import { useChartWorkspace } from '../chart-workspace/use-chart-workspace'
import { IndicatorMenu } from './indicators/IndicatorMenu'
import { paneIds } from '../chart-workspace/layout-presets'
import { ReplayBrandMark } from './ReplayBrandMark'
import { ReplaySessionDialog } from './sessions/ReplaySessionDialog'
// Opened by a keystroke or a click, never on first paint — so its symbol
// table, filters and search index stay out of the initial download.
const SymbolBrowserDialog = lazy(() => import('./symbols/SymbolBrowserDialog').then((module) => ({ default: module.SymbolBrowserDialog })))
const SettingsDialog = lazy(() => import('./settings/SettingsDialog').then((module) => ({ default: module.SettingsDialog })))

interface TopBarProps {
  layoutMenuRequest?: number
  onOpenShortcuts?: () => void
}

export function TopBar({ layoutMenuRequest = 0, onOpenShortcuts = () => undefined }: TopBarProps): ReactElement {
  // Scoped so the header ignores cursor/fill/stats churn while replay plays.
  const replay = useReplaySelector((snapshot) => ({
    symbol: (snapshot.activeSymbol ?? snapshot.symbol)?.symbol ?? '',
    symbols: snapshot.symbols,
    status: snapshot.status,
    replayMode: snapshot.replayMode,
    sessionId: snapshot.sessionId,
    sessionName: snapshot.sessionName,
    sessionStatus: snapshot.sessionStatus,
    cursorTs: snapshot.cursorTs,
  }))
  const evaluationRunning = useEvalStore((state) => state.phase === 'running')
  const evaluationName = useEvalStore((state) => state.phase === 'running' && state.config
    ? evalAccountName(state.config)
    : null)
  const evalLocked = evaluationRunning
  const activeSourceName = evaluationName ?? (evaluationRunning ? 'Active evaluation' : replay.sessionId && replay.sessionStatus === 'active'
    ? replaySessionDisplayName({ id: replay.sessionId, name: replay.sessionName })
    : null)
  const { state: chartWorkspace, dispatch: dispatchChartWorkspace } = useChartWorkspace()
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const activeTf = useUiStore((state) => state.activeTf)
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen)
  const setActiveTf = useUiStore((state) => state.setActiveTf)
  const preferences = useTimeframePreferences()
  const [symbolBrowserOpen, setSymbolBrowserOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [saveSessionOpen, setSaveSessionOpen] = useState(false)
  const hasSecondsData = !!replay.symbols.find((symbol) => symbol.symbol === replay.symbol)?.ranges?.['5s']
  const pinnedTimeframes = hasSecondsData
    ? [...preferences.starredTimeframes, activeTf]
    : [...preferences.starredTimeframes, activeTf].filter((timeframe) => parseTimeframe(timeframe)?.unit !== 's')
  const visibleTimeframes = sortTimeframes([...new Set(pinnedTimeframes)])
  const targetPaneId = chartWorkspace.panes[chartWorkspace.activePaneId]
    ? chartWorkspace.activePaneId
    : paneIds(chartWorkspace.root)[0]

  return (
    <header className="workspace-topbar relative flex h-11 shrink-0 items-stretch border-b border-line bg-[#101114]" aria-label="Workspace controls">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 [scrollbar-width:none] md:gap-2 md:px-3">
        <a href="#chart-workspace" aria-label="Market Replay chart workspace" className="mr-1 flex shrink-0 items-center gap-2 text-ui-title font-semibold tracking-[-0.015em] text-ink sm:mr-2">
          <ReplayBrandMark className="size-8 shrink-0" />
          <span className="hidden sm:inline">MARKET REPLAY</span>
        </a>

        <button type="button" onClick={() => setSymbolBrowserOpen(true)} aria-label={`Change symbol, current ${replay.symbol}`} aria-haspopup="dialog" className="topbar-control flex h-8 min-w-28 shrink-0 items-center gap-2 rounded-control bg-surface-2 px-2.5 text-left text-ink transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-active sm:min-w-36">
          <Activity size={15} strokeWidth={1.8} className="shrink-0 text-ink" aria-hidden="true" />
          <strong className="min-w-0 flex-1 truncate text-ui-title font-semibold">{replay.symbol || '—'}</strong>
          <kbd className="rounded-[3px] bg-surface-3 px-1.5 py-0.5 font-mono text-ui-meta font-normal text-dim">/</kbd>
        </button>

        <ChartWorkspaceControls />

        <nav className="flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-surface-0/80 p-0.5" aria-label="Chart timeframe">
          {visibleTimeframes.map((timeframe) => (
            <button
              key={timeframe}
              type="button"
              onClick={() => setActiveTf(timeframe)}
              aria-pressed={activeTf === timeframe}
              className="topbar-control h-9 min-w-11 rounded-[4px] px-2.5 font-mono text-[14px] font-semibold tracking-[-0.01em] text-ui-control text-muted transition-colors hover:bg-surface-2 hover:text-ink aria-pressed:bg-[#303541] aria-pressed:text-[#f4f6fa]"
            >
              {timeframe}
            </button>
          ))}
          <TimeframeMenu active={activeTf} onSelect={setActiveTf} hasSecondsData={hasSecondsData} />
        </nav>
        {evalLocked ? null : (
          <>
            <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line" />
            <button
              type="button"
              disabled={replay.status !== 'ready' && replay.status !== 'buffering'}
              onClick={() => replayEngine.beginReplaySelection()}
              aria-label={replay.replayMode === 'inactive' ? 'Start bar replay' : 'Replay mode: select start bar'}
              aria-pressed={replay.replayMode !== 'inactive'}
              className="topbar-control flex h-8 shrink-0 items-center gap-1.5 rounded-control border border-line px-2.5 text-ui-control font-medium text-muted transition-colors hover:bg-surface-3 hover:text-ink disabled:cursor-wait disabled:opacity-40 aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface-0"
            >
              <Rewind size={14} strokeWidth={1.9} />Replay
            </button>
          </>
        )}
        {!evalLocked && replay.replayMode === 'active' && replay.sessionId === null ? <button type="button" onClick={() => setSaveSessionOpen(true)} className="topbar-control flex h-8 shrink-0 items-center gap-1.5 rounded-control border border-active/50 px-2.5 text-ui-control font-medium text-active-bright transition-colors hover:bg-active/10" aria-label="Save temporary replay as session">Save session</button> : null}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-l border-line bg-[#101114] px-2 text-ui-body text-muted md:gap-2 md:px-3">
        <LayoutMenu openRequest={layoutMenuRequest} />
        <IndicatorMenu />
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-line" />
        <a href="/live" className="topbar-control flex h-8 items-center gap-1.5 rounded-control px-2 text-ui-control font-medium text-muted transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-active" aria-label="Open live accounts" title="Live accounts">
          <NotebookPen size={15} strokeWidth={1.75} />
          <span className="hidden lg:inline">Live</span>
        </a>
        <a href="/analytics" className="topbar-control flex h-8 items-center gap-1.5 rounded-control px-2 text-ui-control font-medium text-muted transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-active" aria-label="Open analytics" title="Analytics">
          <BarChart3 size={15} strokeWidth={1.75} />
          <span className="hidden lg:inline">Analytics</span>
        </a>
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-line" />
        <button type="button" onClick={() => setSettingsOpen(true)} className="tool-button" aria-label="Workspace settings" title="Workspace settings"><Settings size={16} strokeWidth={1.7} /></button>
        <button type="button" onClick={onOpenShortcuts} className="tool-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts · ?"><Keyboard size={16} strokeWidth={1.7} /></button>
        <button
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="topbar-control grid size-8 place-items-center rounded-control text-muted transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-active"
          aria-label={sidebarOpen ? 'Hide operations panel' : 'Show operations panel'}
        >
          {sidebarOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
      {activeSourceName ? <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden min-w-0 -translate-x-1/2 -translate-y-1/2 items-center gap-2 lg:flex" aria-label={`Active ${evaluationRunning ? 'evaluation' : 'replay session'}`}>
        <span className="max-w-72 truncate font-mono text-[15px] font-semibold tracking-[-0.025em] text-[#dbe4ff]">{activeSourceName}</span>
        <span className="shrink-0 border-l border-line pl-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-active-bright">{evaluationRunning ? 'Eval' : 'Session'}</span>
      </div> : null}
      {symbolBrowserOpen ? <Suspense fallback={null}><SymbolBrowserDialog symbols={replay.symbols} activeSymbol={replay.symbol} onClose={() => setSymbolBrowserOpen(false)} onSelect={(meta) => {
        if (!targetPaneId) return
        dispatchChartWorkspace({ type: 'set-pane-symbol', paneId: targetPaneId, symbol: meta.symbol })
        setSymbolBrowserOpen(false)
        if (evalLocked) replayEngine.requestChartViewSymbol(targetPaneId, meta.symbol)
        else void replayEngine.selectSymbol(meta.symbol).then(() => replayEngine.requestChartViewSymbol(targetPaneId, meta.symbol))
      }} /></Suspense> : null}
      {settingsOpen ? <Suspense fallback={null}><SettingsDialog symbols={replay.symbols} timezone={chartWorkspace.timezone} onTimezoneChange={(timezone) => dispatchChartWorkspace({ type: 'set-timezone', timezone })} syncFlags={chartWorkspace.syncFlags} onSyncFlagsChange={(syncFlags) => dispatchChartWorkspace({ type: 'set-sync-flags', syncFlags })} onClose={() => setSettingsOpen(false)} /></Suspense> : null}
      {saveSessionOpen ? <ReplaySessionDialog mode="save" initialTimestamp={replay.cursorTs} timezone={chartWorkspace.timezone} onClose={() => setSaveSessionOpen(false)} onSubmit={(name) => replayEngine.saveTemporaryReplayAsSession(name)} /> : null}
    </header>
  )
}
