import { AlertTriangle, ChartCandlestick, ChevronDown, LoaderCircle, MousePointer2, RotateCcw, Settings, X } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Timeframe } from '../../api/types'
import type { ChartPaneState } from '../../chart-workspace/types'
import { useDismissableLayer } from '../../hooks/use-dismissable-layer'
import type { ChartAdapter } from '../../replay/chart-adapter'
import type { ChartPaneSettings } from '../../replay/chart-settings-store'
import { HoverBarStore } from '../../replay/hover-bar-store'
import { replayEngine } from '../../replay/replay-engine'
import { BUILT_IN_TIMEFRAMES } from '../../replay/timeframe-preferences'
import { sortTimeframes } from '../../replay/timeframe'
import { useReplaySelector } from '../../replay/use-replay'
import { useEvalStore } from '../../store/eval-store'
import { useTimeframePreferences } from '../timeframe/use-timeframe-preferences'
import { ChartSettingsDialog } from './ChartSettingsDialog'
import { DrawingToolbar } from './DrawingToolbar'
import { OhlcLegend } from './OhlcLegend'

interface ChartTileProps {
  pane: ChartPaneState
  active: boolean
  removable: boolean
  onActivate: () => void
  onRemove: () => void
  onTimeframeChange: (timeframe: Timeframe) => void
  onSettingsChange: (settings: ChartPaneSettings) => void
}

interface ContextMenuPosition { left: number; top: number }

export function ChartTile({ pane, active, removable, onActivate, onRemove, onTimeframeChange, onSettingsChange }: ChartTileProps) {
  // A tile renders two <select>s, the OHLC legend host and the drawing
  // toolbar; none of that depends on the replay cursor, so it must not
  // re-render at emit rate while playing.
  const replay = useReplaySelector((snapshot) => ({
    symbols: snapshot.symbols,
    symbol: snapshot.symbol?.symbol ?? '',
    priceDecimals: snapshot.symbol?.priceDecimals ?? 2,
    status: snapshot.status,
    error: snapshot.error,
    replayMode: snapshot.replayMode,
  }))
  const evalLocked = useEvalStore((state) => state.phase === 'running')
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
    void import('../../replay/lwc-adapter').then(({ LwcAdapter }) => {
      if (!mounted) return
      const initial = latestPaneRef.current
      const adapter = new LwcAdapter(hoverStore)
      adapterRef.current = adapter
      void replayEngine.registerChartView(initial.id, host, adapter, initial.timeframe, initial.settings, hoverStore)
    })
    return () => {
      mounted = false
      adapterRef.current = null
      replayEngine.unregisterChartView(paneId)
    }
  }, [hoverStore])

  useEffect(() => { replayEngine.requestChartViewTimeframe(pane.id, pane.timeframe) }, [pane.id, pane.timeframe])
  useEffect(() => { replayEngine.updateChartViewSettings(pane.id, pane.settings) }, [pane.id, pane.settings])

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
  const timeframes = sortTimeframes([...new Set([...BUILT_IN_TIMEFRAMES, ...timeframePreferences.customTimeframes, pane.timeframe])])
  const marketSession = pane.settings.marketSession
  const toggleMarketSession = (): void => {
    const nextSettings: ChartPaneSettings = { ...pane.settings, marketSession: marketSession === 'eth' ? 'rth' : 'eth' }
    onSettingsChange(nextSettings)
    replayEngine.updateChartViewSettings(pane.id, nextSettings)
  }

  return (
    <section onPointerDownCapture={activate} onContextMenu={openContextMenu} className={`relative h-full min-h-0 min-w-0 overflow-hidden bg-chart ${active ? 'ring-1 ring-inset ring-active' : 'ring-1 ring-inset ring-line'}`} aria-label={`${pane.timeframe} market chart${active ? ', active' : ''}`}>
      <div ref={hostRef} data-chart-host={pane.id} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-14 right-32 top-1.5 z-20 flex min-w-0 flex-col items-start gap-0.5 sm:flex-row sm:gap-2">
        <div ref={identityMenuRef} className="pointer-events-auto relative shrink-0">
          <button type="button" onClick={() => setIdentityOpen((open) => !open)} aria-label={`${replay.symbol || 'No symbol'} ${pane.timeframe} chart symbol and timeframe`} aria-expanded={identityOpen} aria-haspopup="dialog" className="flex h-7 items-center gap-1.5 rounded-control bg-surface-1/90 px-1.5 text-ui-meta font-semibold text-ink transition-colors hover:bg-surface-3 focus-visible:bg-surface-3">
            <ChartCandlestick size={14} strokeWidth={1.75} className="text-active-bright" />
            <span>{replay.symbol || '—'} · {pane.timeframe}</span>
            <ChevronDown size={12} className="text-muted" />
          </button>
          {identityOpen ? (
            <div role="dialog" aria-label="Chart symbol and timeframe" className="absolute left-0 top-8 z-50 w-56 rounded-panel border border-line-strong bg-[#111214] p-3 shadow-overlay">
              <label className="mb-3 block text-ui-meta font-medium text-muted">
                <span className="mb-1 block">Symbol</span>
                <select aria-label="Chart symbol" disabled={evalLocked || replay.symbols.length === 0} value={replay.symbol} onChange={(event) => { void replayEngine.selectSymbol(event.target.value) }} className="field-input h-9 w-full font-semibold">
                  {replay.symbols.map((symbol) => <option key={symbol.symbol} value={symbol.symbol}>{symbol.symbol} — {symbol.name}</option>)}
                </select>
              </label>
              <label className="block text-ui-meta font-medium text-muted">
                <span className="mb-1 block">Interval</span>
                <select aria-label="Chart timeframe" value={pane.timeframe} onChange={(event) => { onTimeframeChange(event.target.value as Timeframe); setIdentityOpen(false) }} className="field-input h-9 w-full font-semibold">
                  {timeframes.map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
                </select>
              </label>
            </div>
          ) : null}
        </div>
        <OhlcLegend store={hoverStore} precision={replay.priceDecimals} timezone={pane.settings.timezone} />
      </div>
      <div className="absolute right-1.5 top-1.5 z-30 flex items-center gap-0.5">
        <button
          type="button"
          onClick={toggleMarketSession}
          aria-pressed={marketSession === 'rth'}
          aria-label={marketSession === 'eth' ? 'Market session ETH: show regular trading hours only' : 'Market session RTH: show extended trading hours'}
          title={marketSession === 'eth' ? 'ETH · Show all electronic-session bars' : 'RTH · 09:30–16:00 in the symbol timezone'}
          className="tool-button !w-auto min-w-10 border border-line bg-surface-1/95 px-2 font-mono text-ui-meta font-semibold"
        >
          {marketSession.toUpperCase()}
        </button>
        <button type="button" onClick={() => setSettingsOpen(true)} className="tool-button border border-line bg-surface-1/95" aria-label={`Chart settings for ${pane.timeframe}`}><Settings size={15} strokeWidth={1.75} /></button>
        {removable ? <button type="button" onClick={onRemove} className="tool-button border border-line bg-surface-1/95 hover:!text-loss-bright" aria-label={`Remove ${pane.timeframe} chart`}><X size={15} /></button> : null}
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
      {active ? <DrawingToolbar disabled={replay.replayMode === 'selecting' || (replay.status !== 'ready' && replay.status !== 'buffering')} /> : null}
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
