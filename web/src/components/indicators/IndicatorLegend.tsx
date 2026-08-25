import { Eye, EyeOff, LoaderCircle, MoreHorizontal, RefreshCw, Settings, Trash2 } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { replayEngine } from '../../replay/replay-engine'
import { useReplaySelector } from '../../replay/use-replay'
import { IndicatorSettingsDialog } from './IndicatorSettingsDialog'
import { useIndicatorCatalog } from './use-indicator-catalog'

interface IndicatorLegendProps {
  /** Same value as the chart's "Price & time text" appearance setting
   * (ChartAppearanceSettings.textColor), so an active indicator's name
   * matches the price/time axis labels instead of a fixed Tailwind shade. */
  textColor: string
}

export function IndicatorLegend({ textColor }: IndicatorLegendProps): ReactElement | null {
  const state = useReplaySelector((snapshot) => ({ indicators: snapshot.indicators, loading: snapshot.indicatorLoading }))
  const catalog = useIndicatorCatalog()
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [moreId, setMoreId] = useState<string | null>(null)
  const indicators = state.indicators ?? []
  if (indicators.length === 0) return null
  const settingsIndicator = indicators.find((indicator) => indicator.id === settingsId)
  const settingsDescriptor = catalog.descriptors.find((item) => item.id === settingsIndicator?.scriptId)

  return (
    <div className="pointer-events-auto flex max-w-[min(34rem,calc(100vw-5rem))] flex-col items-start" aria-label="Active indicators">
      {indicators.map((indicator) => {
        const canConfigure = catalog.descriptors.some((item) => item.id === indicator.scriptId)
        return (
          <div key={indicator.id} className="relative flex h-7 max-w-full items-center text-ui-meta text-muted">
            <span className={`max-w-72 truncate pl-1 pr-1.5 ${indicator.visible ? '' : 'text-dim line-through'}`} style={indicator.visible ? { color: textColor } : undefined}>{indicator.name}</span>
            {state.loading && indicator.visible ? <span className="grid size-7 place-items-center" aria-label={`${indicator.name} loading`}><LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" /></span> : null}
            <button type="button" onClick={() => replayEngine.setIndicatorVisibility(indicator.id, !indicator.visible)} className="grid size-7 place-items-center rounded-control hover:bg-surface-2 hover:text-ink" aria-label={`${indicator.visible ? 'Hide' : 'Show'} ${indicator.name}`}>{indicator.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
            <button type="button" disabled={!canConfigure} onClick={() => setSettingsId(indicator.id)} className="grid size-7 place-items-center rounded-control hover:bg-surface-2 hover:text-ink disabled:opacity-35" aria-label={`Settings for ${indicator.name}`}><Settings size={14} /></button>
            <button type="button" onClick={() => replayEngine.removeIndicator(indicator.id)} className="grid size-7 place-items-center rounded-control hover:bg-loss/10 hover:text-loss-bright" aria-label={`Remove ${indicator.name}`}><Trash2 size={14} /></button>
            <button type="button" onClick={() => setMoreId((current) => current === indicator.id ? null : indicator.id)} className="grid size-7 place-items-center rounded-control hover:bg-surface-2 hover:text-ink" aria-label={`More actions for ${indicator.name}`} aria-expanded={moreId === indicator.id}><MoreHorizontal size={15} /></button>
            {moreId === indicator.id ? <div role="menu" className="absolute left-full top-0 z-50 ml-1 w-36 rounded-panel border border-line bg-surface-1 p-1 shadow-overlay"><button type="button" role="menuitem" onClick={() => { replayEngine.refreshIndicator(indicator.id); setMoreId(null) }} className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-ui-meta text-muted hover:bg-surface-2 hover:text-ink"><RefreshCw size={13} />Recalculate</button></div> : null}
          </div>
        )
      })}
      {settingsIndicator && settingsDescriptor ? <IndicatorSettingsDialog indicator={settingsIndicator} descriptor={settingsDescriptor} onApply={(inputs) => replayEngine.updateIndicatorInputs(settingsIndicator.id, inputs)} onClose={() => setSettingsId(null)} /> : null}
    </div>
  )
}
