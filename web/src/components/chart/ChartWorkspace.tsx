import { ExternalLink, Link2, MonitorUp, PanelTopClose, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useChartWorkspace } from '../../chart-workspace/use-chart-workspace'
import type { ChartPaneState } from '../../chart-workspace/types'
import { paneIds, pruneDetachedPanes } from '../../chart-workspace/layout-presets'
import { useReplaySelector } from '../../replay/use-replay'
import { useUiStore } from '../../store/ui-store'
import { ChartPopoutWindow } from './ChartPopoutWindow'
import { openChartPopout, type ChartPopoutTarget } from './chart-popout'
import { ChartTile } from './ChartTile'
import { DrawingToolbar } from './DrawingToolbar'
import { ResizableChartLayout } from './ResizableChartLayout'
import { ReplayBar } from '../replay-bar/ReplayBar'

function useTabbedLayout(paneCount: number): boolean {
  const query = (): boolean => window.innerWidth < 768 || (window.innerWidth < 1024 && paneCount > 2)
  const [tabbed, setTabbed] = useState(query)
  useEffect(() => {
    const update = (): void => setTabbed(window.innerWidth < 768 || (window.innerWidth < 1024 && paneCount > 2))
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [paneCount])
  return tabbed
}

interface DetachedPanePlaceholderProps {
  pane: ChartPaneState
  symbol: string
  onFocus: () => void
  onReturn: () => void
}

function DetachedPanePlaceholder({ pane, symbol, onFocus, onReturn }: DetachedPanePlaceholderProps): ReactElement {
  return (
    <section className="grid h-full min-h-0 place-items-center border border-line bg-chart p-5" aria-label={`${pane.timeframe} chart open in another window`}>
      <div className="max-w-sm text-center">
        <span className="mx-auto grid size-10 place-items-center rounded-control border border-line-strong bg-surface-1 text-active-bright"><MonitorUp size={18} strokeWidth={1.6} /></span>
        <strong className="mt-3 block text-ui-title font-semibold text-ink">{symbol || 'Chart'} · {pane.timeframe} is on another screen</strong>
        <span className="mt-1 block text-ui-body text-muted">Crosshair, replay time, indicators and orders stay linked to this workspace.</span>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={onFocus} className="secondary-button"><ExternalLink size={14} />Focus window</button>
          <button type="button" onClick={onReturn} className="secondary-button"><PanelTopClose size={14} />Bring back</button>
        </div>
      </div>
    </section>
  )
}

export function ChartWorkspace(): ReactElement {
  const { state, dispatch, activate } = useChartWorkspace()
  const replay = useReplaySelector((snapshot) => ({ status: snapshot.status, replayMode: snapshot.replayMode, symbol: snapshot.symbol?.symbol ?? '' }))
  const ids = paneIds(state.root)
  const idsKey = ids.join('|')
  const maximizedPaneId = useUiStore((store) => store.maximizedPaneId)
  const toggleMaximizedPane = useUiStore((store) => store.toggleMaximizedPane)
  const clearMaximizedPane = useUiStore((store) => store.clearMaximizedPane)
  const [popouts, setPopouts] = useState<Record<string, ChartPopoutTarget>>({})
  const popoutsRef = useRef(popouts)
  const [popoutError, setPopoutError] = useState<string | null>(null)
  popoutsRef.current = popouts

  const detachedIds = useMemo(() => new Set(Object.keys(popouts)), [popouts])
  const visibleRoot = useMemo(() => pruneDetachedPanes(state.root, detachedIds), [detachedIds, state.root])
  const visibleIds = useMemo(() => visibleRoot ? paneIds(visibleRoot) : [], [visibleRoot])
  const tabbed = useTabbedLayout(visibleIds.length)
  const activeMainPaneId = visibleIds.includes(state.activePaneId) ? state.activePaneId : visibleIds[0] ?? state.activePaneId
  const visibleMaximizedPaneId = maximizedPaneId && visibleIds.includes(maximizedPaneId) ? maximizedPaneId : null

  const returnPane = useCallback((paneId: string): void => {
    const current = popoutsRef.current
    if (!current[paneId]) return
    const { [paneId]: _returned, ...next } = current
    popoutsRef.current = next
    setPopouts(next)
  }, [])

  const popOutPane = useCallback((pane: ChartPaneState): void => {
    const existing = popoutsRef.current[pane.id]
    if (existing && !existing.window.closed) {
      existing.window.focus()
      return
    }
    const symbol = pane.symbol ?? replay.symbol
    const target = openChartPopout(pane.id, `${symbol || 'Chart'} · ${pane.timeframe}`)
    if (!target) {
      setPopoutError('The chart window was blocked. Allow pop-ups for this site, then try again.')
      return
    }
    setPopoutError(null)
    const next = { ...popoutsRef.current, [pane.id]: target }
    popoutsRef.current = next
    setPopouts(next)
    if (maximizedPaneId === pane.id) clearMaximizedPane()
    const nextVisiblePaneId = visibleIds.find((paneId) => paneId !== pane.id)
    if (state.activePaneId === pane.id && nextVisiblePaneId) activate(nextVisiblePaneId)
  }, [activate, clearMaximizedPane, maximizedPaneId, replay.symbol, state.activePaneId, visibleIds])

  useEffect(() => {
    if (maximizedPaneId && !visibleIds.includes(maximizedPaneId)) clearMaximizedPane()
  }, [clearMaximizedPane, maximizedPaneId, visibleIds])

  useEffect(() => {
    const liveIds = new Set(idsKey.split('|'))
    Object.keys(popoutsRef.current).forEach((paneId) => {
      if (!liveIds.has(paneId)) returnPane(paneId)
    })
  }, [idsKey, returnPane])

  useEffect(() => () => {
    const targets = Object.values(popoutsRef.current)
    window.setTimeout(() => targets.forEach((target) => {
      if (!target.window.closed) target.window.close()
    }), 0)
  }, [])

  const removePane = (paneId: string): void => {
    returnPane(paneId)
    dispatch({ type: 'remove-pane', paneId })
  }

  const renderChartTile = (paneId: string, detached: boolean): ReactElement => {
    const pane = state.panes[paneId]
    return <ChartTile key={paneId} pane={pane} active={state.activePaneId === paneId} removable={ids.length > 1} maximized={maximizedPaneId === paneId} detached={detached} onPopOut={detached ? undefined : () => popOutPane(pane)} onActivate={() => activate(paneId)} onToggleMaximize={() => toggleMaximizedPane(paneId)} onRemove={() => removePane(paneId)} onSymbolChange={(symbol) => dispatch({ type: 'set-pane-symbol', paneId, symbol })} onTimeframeChange={(timeframe) => dispatch({ type: 'set-pane-timeframe', paneId, timeframe })} onSettingsChange={(settings) => dispatch({ type: 'set-pane-settings', paneId, settings })} />
  }

  const renderPane = (paneId: string): ReactElement => {
    const pane = state.panes[paneId]
    const target = popouts[paneId]
    if (target) return <DetachedPanePlaceholder key={paneId} pane={pane} symbol={pane.symbol ?? replay.symbol} onFocus={() => target.window.focus()} onReturn={() => returnPane(paneId)} />
    return renderChartTile(paneId, false)
  }

  return (
    <section id="chart-workspace" className="relative flex min-h-[300px] min-w-0 flex-1 overflow-hidden bg-chart" aria-label="Chart workspace">
      <DrawingToolbar disabled={replay.replayMode === 'selecting' || (replay.status !== 'ready' && replay.status !== 'buffering')} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {visibleMaximizedPaneId ? <div className="min-h-0 flex-1">{renderPane(visibleMaximizedPaneId)}</div> : tabbed ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex h-9 shrink-0 overflow-x-auto border-b border-line bg-surface-1">{visibleIds.map((id) => <button key={id} type="button" onClick={() => activate(id)} aria-pressed={state.activePaneId === id} className="min-w-20 border-b-2 border-transparent px-3 text-ui-control font-medium text-muted aria-pressed:border-active aria-pressed:text-ink">{state.panes[id].timeframe}</button>)}</div>
              <div className="min-h-0 flex-1">{renderPane(activeMainPaneId)}</div>
            </div>
          ) : <div className="min-h-0 flex-1">{visibleRoot ? <ResizableChartLayout node={visibleRoot} renderPane={renderPane} onResize={(splitId, ratio, totalSize) => dispatch({ type: 'resize', splitId, ratio, totalSize })} /> : renderPane(state.activePaneId)}</div>}
        </div>
        <ReplayBar />
      </div>
      {Object.entries(popouts).map(([paneId, target]) => {
        const pane = state.panes[paneId]
        if (!pane) return null
        return (
          <ChartPopoutWindow key={paneId} target={target} onClose={() => returnPane(paneId)}>
            <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-0 text-ink">
              <header className="flex h-9 shrink-0 items-center justify-between border-b border-line bg-[#101114] px-2.5" aria-label="Linked chart window">
                <span className="flex min-w-0 items-center gap-2 text-ui-control font-semibold text-ink"><Link2 size={14} className="shrink-0 text-active-bright" /><span className="truncate">{pane.symbol ?? replay.symbol} · {pane.timeframe}</span><span className="hidden font-mono text-ui-meta font-normal text-muted sm:inline">SHARED SESSION</span></span>
                <button type="button" onClick={() => returnPane(paneId)} className="flex h-7 shrink-0 items-center gap-1.5 rounded-control px-2 text-ui-meta font-medium text-muted hover:bg-surface-3 hover:text-ink" aria-label={`Return ${pane.timeframe} chart to workspace`}><PanelTopClose size={14} />Bring back</button>
              </header>
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <DrawingToolbar disabled={replay.replayMode === 'selecting' || (replay.status !== 'ready' && replay.status !== 'buffering')} />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1">{renderChartTile(paneId, true)}</div>
                  <ReplayBar />
                </div>
              </div>
            </div>
          </ChartPopoutWindow>
        )
      })}
      {popoutError ? <div role="alert" className="absolute bottom-14 left-14 z-[100] flex max-w-sm items-start gap-2 rounded-panel border border-line-strong bg-surface-1 p-3 text-ui-body text-ink shadow-overlay"><span className="min-w-0 flex-1">{popoutError}</span><button type="button" onClick={() => setPopoutError(null)} className="tool-button shrink-0" aria-label="Dismiss pop-up warning"><X size={14} /></button></div> : null}
    </section>
  )
}
