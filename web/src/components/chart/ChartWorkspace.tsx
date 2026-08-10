import { useEffect, useState } from 'react'
import { useChartWorkspace } from '../../chart-workspace/use-chart-workspace'
import { paneIds } from '../../chart-workspace/layout-presets'
import { ChartTile } from './ChartTile'
import { ResizableChartLayout } from './ResizableChartLayout'

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

export function ChartWorkspace() {
  const { state, dispatch, activate } = useChartWorkspace()
  const ids = paneIds(state.root)
  const tabbed = useTabbedLayout(ids.length)

  const renderPane = (paneId: string) => {
    const pane = state.panes[paneId]
    return <ChartTile key={paneId} pane={pane} active={state.activePaneId === paneId} removable={ids.length > 1} onActivate={() => activate(paneId)} onRemove={() => dispatch({ type: 'remove-pane', paneId })} onTimeframeChange={(timeframe) => dispatch({ type: 'set-pane-timeframe', paneId, timeframe })} onSettingsChange={(settings) => dispatch({ type: 'set-pane-settings', paneId, settings })} />
  }

  return (
    <section id="chart-workspace" className="relative flex min-h-[300px] min-w-0 flex-1 flex-col overflow-hidden bg-chart" aria-label="Chart workspace">
      {tabbed ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 overflow-x-auto border-b border-line bg-surface-1">{ids.map((id) => <button key={id} type="button" onClick={() => activate(id)} aria-pressed={state.activePaneId === id} className="min-w-20 border-b-2 border-transparent px-3 text-ui-control font-medium text-muted aria-pressed:border-active aria-pressed:text-ink">{state.panes[id].timeframe}</button>)}</div>
          <div className="min-h-0 flex-1">{renderPane(state.activePaneId)}</div>
        </div>
      ) : <div className="min-h-0 flex-1"><ResizableChartLayout node={state.root} renderPane={renderPane} onResize={(splitId, ratio, totalSize) => dispatch({ type: 'resize', splitId, ratio, totalSize })} /></div>}
    </section>
  )
}
