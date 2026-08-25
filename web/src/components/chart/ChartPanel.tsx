import { AlertTriangle, LoaderCircle, Settings } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ChartAdapter } from '../../replay/chart-adapter'
import { chartSettingsStore, DEFAULT_CHART_PANE_SETTINGS, type ChartPaneSettings } from '../../replay/chart-settings-store'
import { HoverBarStore } from '../../replay/hover-bar-store'
import { replayEngine } from '../../replay/replay-engine'
import { useReplaySelector } from '../../replay/use-replay'
import { DrawingToolbar } from './DrawingToolbar'
import { ChartSettingsDialog } from './ChartSettingsDialog'
import { OhlcLegend } from './OhlcLegend'

const PRIMARY_PANE_ID = 'primary'

export function ChartPanel() {
  const replay = useReplaySelector((snapshot) => ({
    priceDecimals: (snapshot.activeSymbol ?? snapshot.symbol)?.priceDecimals ?? 2,
    timeframe: snapshot.timeframe,
    status: snapshot.status,
    error: snapshot.error,
  }))
  // DEV-only overlay: kept on its own subscription so the frame
  // metrics ticking never re-renders the chart shell in production.
  const frameMetrics = useReplaySelector((snapshot) => (import.meta.env.DEV ? snapshot.frameMetrics : null))
  const [hoverStore] = useState(() => new HoverBarStore())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsByPane = useSyncExternalStore(chartSettingsStore.subscribe, chartSettingsStore.getSnapshot, chartSettingsStore.getSnapshot)
  const settings = settingsByPane[PRIMARY_PANE_ID] ?? DEFAULT_CHART_PANE_SETTINGS
  const adapterRef = useRef<ChartAdapter | null>(null)
  const initialSettingsRef = useRef(settings)
  const initialTimeframeRef = useRef(replay.timeframe)

  useEffect(() => {
    let active = true
    let registeredAdapter: ChartAdapter | null = null
    void import('../../replay/lwc-adapter').then(({ LwcAdapter }) => {
      if (!active) return
      const adapter = new LwcAdapter(hoverStore)
      registeredAdapter = adapter
      adapterRef.current = adapter
      const element = document.querySelector<HTMLElement>('[data-chart-host="primary"]')
      if (element) void replayEngine.registerChartView(PRIMARY_PANE_ID, element, adapter, initialTimeframeRef.current, initialSettingsRef.current, hoverStore)
    })
    return () => {
      active = false
      if (adapterRef.current === registeredAdapter) adapterRef.current = null
      if (registeredAdapter) replayEngine.unregisterChartView(PRIMARY_PANE_ID, registeredAdapter)
    }
  }, [hoverStore])

  const previewSettings = (next: ChartPaneSettings): void => {
    adapterRef.current?.applyAppearance(next.appearance)
    adapterRef.current?.setDisplayTimezone(next.timezone)
  }

  const cancelSettings = (): void => {
    previewSettings(settings)
    setSettingsOpen(false)
  }

  return (
    <section id="chart-workspace" className="relative min-h-[300px] min-w-0 flex-1 overflow-hidden bg-chart" aria-label="Market chart">
      <div data-chart-host="primary" tabIndex={0} aria-label="Primary interactive market chart" className="absolute inset-0 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-active" />
      <div className="pointer-events-none absolute left-14 right-12 top-2 z-20 flex min-w-0 items-start">
        <OhlcLegend store={hoverStore} precision={replay.priceDecimals} textColor={settings.appearance.textColor} />
      </div>
      <button type="button" onClick={() => setSettingsOpen(true)} className="tool-button absolute right-2 top-2 z-30 border border-line bg-surface-1/95" aria-label="Chart settings" title="Chart settings"><Settings size={16} strokeWidth={1.75} /></button>
      {replay.status === 'loading' || replay.status === 'idle' ? (
        <div className="absolute inset-0 z-30 grid place-items-center bg-chart/90 text-ui-title text-muted">
          <div className="flex items-center gap-2"><LoaderCircle className="animate-spin text-active-bright" size={18} /> Loading local market data…</div>
        </div>
      ) : null}
      {replay.status === 'error' ? (
        <div className="absolute inset-0 z-30 grid place-items-center bg-chart/95 p-6">
          <div className="max-w-md rounded-panel border border-loss/30 bg-loss/10 p-5 text-ui-title text-ink">
            <div className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle className="text-loss-bright" size={18} /> Data could not be loaded</div>
            <p className="text-muted">{replay.error}</p>
            <p className="mt-3 text-ui-body text-muted">Start the Go server with the local data directory configured, then refresh.</p>
          </div>
        </div>
      ) : null}
      <DrawingToolbar disabled={replay.status !== 'ready' && replay.status !== 'buffering'} />
      {frameMetrics && frameMetrics.samples > 0 ? (
        <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-control border border-line bg-surface-0/90 px-2 py-1 font-mono text-ui-meta text-muted">
          frame p50 {frameMetrics.p50.toFixed(1)} · p95 {frameMetrics.p95.toFixed(1)} · max {frameMetrics.max.toFixed(1)} ms
        </div>
      ) : null}
      {settingsOpen ? <ChartSettingsDialog value={settings} onPreview={previewSettings} onCancel={cancelSettings} onApply={(next) => { chartSettingsStore.setPane(PRIMARY_PANE_ID, next); previewSettings(next); setSettingsOpen(false) }} /> : null}
    </section>
  )
}
