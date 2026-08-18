import { AlertTriangle, ChevronDown, ExternalLink, LoaderCircle, Maximize2, Minimize2, MousePointer2, RotateCcw, Settings, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Timeframe } from '../../api/types'
import type { ChartPaneState } from '../../chart-workspace/types'
import { useDismissableLayer } from '../../hooks/use-dismissable-layer'
import type { ChartAdapter } from '../../replay/chart-adapter'
import type { ChartPaneSettings } from '../../replay/chart-settings-store'
import { HoverBarStore } from '../../replay/hover-bar-store'
import { replayEngine } from '../../replay/replay-engine'
import { parseTimeframe, sortTimeframes } from '../../replay/timeframe'
import { useReplaySelector } from '../../replay/use-replay'
import { useTimeframePreferences } from '../timeframe/use-timeframe-preferences'
import { ChartSettingsDialog } from './ChartSettingsDialog'
import { OhlcLegend } from './OhlcLegend'
import { IndicatorLegend } from '../indicators/IndicatorLegend'

interface ChartTileProps {
  pane: ChartPaneState
  active: boolean
  removable: boolean
  maximized: boolean
  onActivate: () => void
  onToggleMaximize: () => void
  onRemove: () => void
  onSymbolChange: (symbol: string) => void
  onTimeframeChange: (timeframe: Timeframe) => void
  onSettingsChange: (settings: ChartPaneSettings) => void
  onPopOut?: () => void
  detached?: boolean
}

interface ContextMenuPosition { left: number; top: number }

export function ChartTile({ pane, active, removable, maximized, onActivate, onToggleMaximize, onRemove, onSymbolChange, onTimeframeChange, onSettingsChange, onPopOut, detached = false }: ChartTileProps) {
  // A tile renders two <select>s and the OHLC legend host; none of that
  // depends on the replay cursor, so it must not
  // re-render at emit rate while playing.
  const replay = useReplaySelector((snapshot) => ({
    symbols: snapshot.symbols,
    symbol: snapshot.symbol?.symbol ?? '',
    priceDecimals: snapshot.symbol?.priceDecimals ?? 2,
    status: snapshot.status,
    error: snapshot.error,
    replayMode: snapshot.replayMode,
  }))
  const paneSymbol = pane.symbol ?? replay.symbol
  const paneSymbolMeta = replay.symbols.find((symbol) => symbol.symbol === paneSymbol)
  const timeframePreferences = useTimeframePreferences()
  const hostRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<ChartAdapter | null>(null)
  const latestPaneRef = useRef(pane)
  latestPaneRef.current = pane
  const [hoverStore] = useState(() => new HoverBarStore())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [identityOpen, setIdentityOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const identityMenuRef = useRef<HTMLDivElement>(null)
  useDismissableLayer({ open: contextMenu !== null, layerRef: contextMenuRef, onDismiss: () => setContextMenu(null) })
  useDismissableLayer({ open: identityOpen, layerRef: identityMenuRef, onDismiss: () => setIdentityOpen(false) })
  useEffect(() => { contextMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus() }, [contextMenu])

  useEffect(() => {
    const host = hostRef.current
    const paneId = latestPaneRef.current.id
    if (!host) return
    let mounted = true
    let registeredAdapter: ChartAdapter | null = null
    void import('../../replay/lwc-adapter').then(({ LwcAdapter }) => {
      if (!mounted) return
      const initial = latestPaneRef.current
      const adapter = new LwcAdapter(hoverStore)
      registeredAdapter = adapter
      adapterRef.current = adapter
      void replayEngine.registerChartView(initial.id, host, adapter, initial.timeframe, initial.settings, hoverStore, initial.symbol ?? undefined)
    })
    return () => {
      mounted = false
      if (adapterRef.current === registeredAdapter) adapterRef.current = null
      if (registeredAdapter) replayEngine.unregisterChartView(paneId, registeredAdapter)
    }
  }, [hoverStore])

  useEffect(() => { replayEngine.requestChartViewTimeframe(pane.id, pane.timeframe) }, [pane.id, pane.timeframe])
  useEffect(() => {
    if (pane.symbol) replayEngine.requestChartViewSymbol(pane.id, pane.symbol)
  }, [pane.id, pane.symbol])
  useEffect(() => { replayEngine.updateChartViewSettings(pane.id, pane.settings) }, [pane.id, pane.settings])

  // Runs after every commit (no deps), synchronously right after the DOM
  // has resized — e.g. the same render that moves a split's ratio while
  // dragging. syncContainerSize() no-ops when the size is unchanged, so
  // this stays cheap on renders that have nothing to do with layout.
  useLayoutEffect(() => { adapterRef.current?.syncContainerSize() })

  const activate = (): void => {
    if (active) return
    replayEngine.activateChartView(pane.id)
    onActivate()
  }

  const previewAllSettings = (settings: ChartPaneSettings): void => {
    adapterRef.current?.applyAppearance(settings.appearance)
    adapterRef.current?.setDisplayTimezone(settings.timezone)
  }

  const openContextMenu = (event: MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    activate()
    setContextMenu({
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - 192)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - 52)),
    })
  }
  const hasSecondsData = Boolean(paneSymbolMeta?.ranges?.['5s'])
  const timeframes = sortTimeframes([...new Set([...timeframePreferences.starredTimeframes, pane.timeframe])])
    .filter((timeframe) => hasSecondsData || parseTimeframe(timeframe)?.unit !== 's')
  return (
    <section
      onPointerDownCapture={activate}
      onClickCapture={(event) => {
        if (event.altKey && !(event.target instanceof Element && event.target.closest('button, input, select, textarea, [role="dialog"], [role="menu"]'))) {
          event.preventDefault()
          onToggleMaximize()
        }
      }}
      onDoubleClick={(event) => {
        if (!event.defaultPrevented && !(event.target instanceof Element && event.target.closest('button, input, select, textarea, [role="dialog"], [role="menu"]'))) onToggleMaximize()
      }}
      onContextMenu={openContextMenu}
      className="relative h-full min-h-0 min-w-0 overflow-hidden bg-chart ring-1 ring-inset ring-line"
      data-active-chart={active}
      data-chart-capture-root
      aria-label={`${pane.timeframe} market chart${active ? ', active' : ''}`}
    >
      <div
        ref={hostRef}
        data-chart-host={pane.id}
        tabIndex={0}
        aria-label={`${paneSymbol || 'Market'} ${pane.timeframe} interactive chart`}
        className="absolute inset-0 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-active"
      />
      {active ? (
        <div data-active-chart-outline aria-hidden="true" className="pointer-events-none absolute inset-0 z-40 border border-active/80">
          <span className="absolute left-0 top-0 size-4 border-l-2 border-t-2 border-active" />
          <span className="absolute bottom-0 right-0 size-4 border-b-2 border-r-2 border-active" />
        </div>
      ) : null}
      <div className="pointer-events-none absolute left-1.5 right-32 top-1.5 z-20 flex min-w-0 flex-col items-start gap-0.5">
        <div className="flex w-full min-w-0 items-start gap-2">
          <div ref={identityMenuRef} className="pointer-events-auto relative shrink-0">
            <button type="button" onClick={() => setIdentityOpen((open) => !open)} aria-label={`${paneSymbol || 'No symbol'} ${pane.timeframe} chart symbol and timeframe`} aria-expanded={identityOpen} aria-haspopup="dialog" className="flex h-7 items-center gap-1.5 rounded-control bg-surface-1/90 px-2 text-ui-meta text-ink transition-colors hover:bg-surface-3 focus-visible:bg-surface-3">
              <strong className="font-semibold">{paneSymbol || '—'}</strong>
              <span aria-hidden="true" className="h-3 w-px bg-line-strong" />
              <span className="font-medium text-muted">{pane.timeframe}</span>
              <ChevronDown size={12} className="text-muted" />
            </button>
            {identityOpen ? (
              <div role="dialog" aria-label="Chart symbol and timeframe" className="absolute left-0 top-8 z-50 w-60 rounded-control border border-line-strong bg-[#111214] p-2 shadow-overlay">
                <label className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-2 text-ui-meta font-medium text-muted">
                  <span>Symbol</span>
                  <select aria-label="Chart symbol" disabled={replay.symbols.length === 0} value={paneSymbol} onChange={(event) => { const symbol = event.target.value; onSymbolChange(symbol); replayEngine.requestChartViewSymbol(pane.id, symbol) }} className="field-input h-9 w-full font-semibold">
                    {replay.symbols.map((symbol) => <option key={symbol.symbol} value={symbol.symbol}>{symbol.symbol} — {symbol.name}</option>)}
                  </select>
                </label>
                <label className="mt-1.5 grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-2 text-ui-meta font-medium text-muted">
                  <span>Interval</span>
                  <select aria-label="Chart timeframe" value={pane.timeframe} onChange={(event) => { onTimeframeChange(event.target.value as Timeframe); setIdentityOpen(false) }} className="field-input h-9 w-full font-semibold">
                    {timeframes.map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
                  </select>
                </label>
              </div>
            ) : null}
          </div>
          <OhlcLegend store={hoverStore} precision={paneSymbolMeta?.priceDecimals ?? replay.priceDecimals} />
        </div>
        <IndicatorLegend />
      </div>
      <div className="absolute right-1.5 top-1.5 z-30 flex items-center gap-0.5">
        {onPopOut ? <button type="button" onClick={onPopOut} className="tool-button chart-action-button border border-line bg-surface-1/95" aria-label={`Open ${pane.timeframe} chart in new window`} title="Open chart on another screen"><ExternalLink size={14} strokeWidth={1.75} /></button> : null}
        {detached ? null : <button type="button" onClick={onToggleMaximize} className="tool-button chart-action-button border border-line bg-surface-1/95" aria-label={maximized ? `Restore ${pane.timeframe} chart layout` : `Maximize ${pane.timeframe} chart`}>{maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>}
        <button type="button" onClick={() => setSettingsOpen(true)} className="tool-button chart-action-button border border-line bg-surface-1/95" aria-label={`Chart settings for ${pane.timeframe}`}><Settings size={14} strokeWidth={1.75} /></button>
        {removable ? <button type="button" onClick={onRemove} className="tool-button chart-action-button border border-line bg-surface-1/95 hover:!text-loss-bright" aria-label={`Remove ${pane.timeframe} chart`}><X size={14} /></button> : null}
      </div>
      {active && replay.replayMode === 'selecting' ? (
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-11 z-30 flex -translate-x-1/2 items-center gap-2 rounded-control border border-active/50 bg-[#15171c]/95 px-3 py-2 text-ui-body font-medium text-ink shadow-overlay">
          <MousePointer2 size={14} className="text-active-bright" />
          <span>Click a candle to start replay</span>
          <kbd className="hidden rounded-[3px] border border-line-strong bg-surface-3 px-1.5 py-0.5 font-mono text-ui-meta text-muted sm:inline">←/→ + Enter</kbd>
        </div>
      ) : null}
      {replay.status === 'loading' || replay.status === 'idle' ? <div className="absolute inset-0 z-20 grid place-items-center bg-chart/90 text-ui-body text-muted"><span className="flex items-center gap-2"><LoaderCircle className="animate-spin text-active-bright" size={16} />Loading market data…</span></div> : null}
      {replay.status === 'error' ? <div className="absolute inset-0 z-20 grid place-items-center bg-chart/95 p-4"><div className="max-w-sm text-ui-body text-muted"><strong className="mb-2 flex items-center gap-2 text-ink"><AlertTriangle size={16} className="text-loss-bright" />Data could not be loaded</strong>{replay.error}</div></div> : null}
      {settingsOpen ? <ChartSettingsDialog value={pane.settings} onPreview={previewAllSettings} onCancel={() => { previewAllSettings(pane.settings); setSettingsOpen(false) }} onApply={(settings) => { onSettingsChange(settings); replayEngine.updateChartViewSettings(pane.id, settings); setSettingsOpen(false) }} /> : null}
      {contextMenu ? createPortal(
        <div ref={contextMenuRef} role="menu" aria-label="Chart actions" style={contextMenu} className="fixed z-[90] w-44 rounded-control border border-line-strong bg-[#111214] p-1 shadow-overlay">
          <button type="button" role="menuitem" onClick={() => { replayEngine.resetChartView(pane.id); setContextMenu(null) }} className="flex h-9 w-full items-center gap-2 rounded-control px-2.5 text-left text-ui-control text-muted hover:bg-surface-2 hover:text-ink focus-visible:bg-surface-2 focus-visible:text-ink">
            <RotateCcw size={14} strokeWidth={1.75} />Reset chart view
          </button>
        </div>,
        document.body,
      ) : null}
    </section>
  )
}
