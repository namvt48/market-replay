import { CalendarRange, Crosshair, Lock, type LucideIcon } from 'lucide-react'
import type { ReactElement } from 'react'
import type { ChartSyncFlags } from '../../chart-workspace/types'
import { useChartWorkspace } from '../../chart-workspace/use-chart-workspace'

interface SyncControl {
  flag: keyof ChartSyncFlags
  label: string
  shortLabel: string
  title: string
  icon: LucideIcon
}

const SYNC_CONTROLS: readonly SyncControl[] = [
  { flag: 'crosshair', label: 'Sync crosshair across charts', shortLabel: 'Crosshair', title: 'Share crosshair time and price across charts', icon: Crosshair },
  { flag: 'dateRange', label: 'Sync date range across charts', shortLabel: 'Range', title: 'Keep charts centered on the same time range', icon: CalendarRange },
  { flag: 'lockZoom', label: 'Lock zoom across charts', shortLabel: 'Zoom', title: 'Use the same horizontal zoom span on every chart', icon: Lock },
]

export function ChartWorkspaceControls(): ReactElement {
  const { state, dispatch } = useChartWorkspace()

  const toggleSyncFlag = (flag: keyof ChartSyncFlags): void => {
    const syncFlags: Partial<ChartSyncFlags> = { [flag]: !state.syncFlags[flag] }
    dispatch({ type: 'set-sync-flags', syncFlags })
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5" aria-label="Shared chart controls">
      <div className="flex items-center rounded-control bg-surface-0 p-0.5" role="group" aria-label="Market session">
        {(['eth', 'rth'] as const).map((marketSession) => (
          <button
            key={marketSession}
            type="button"
            onClick={() => dispatch({ type: 'set-market-session', marketSession })}
            aria-pressed={state.marketSession === marketSession}
            aria-label={marketSession === 'eth' ? 'Electronic trading hours (ETH)' : 'Regular trading hours (RTH)'}
            title={marketSession === 'eth' ? 'ETH · Show the full electronic session' : 'RTH · Show 09:30–16:00 in the symbol timezone'}
            className="h-7 min-w-10 rounded-[3px] px-2 font-mono text-ui-meta font-semibold text-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-active aria-pressed:bg-surface-3 aria-pressed:text-ink"
          >
            {marketSession.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="flex items-center rounded-control border border-line bg-surface-0 p-0.5" role="group" aria-label="Chart synchronization">
        {SYNC_CONTROLS.map(({ flag, label, shortLabel, title, icon: Icon }) => (
          <button
            key={flag}
            type="button"
            onClick={() => toggleSyncFlag(flag)}
            aria-label={label}
            aria-pressed={state.syncFlags[flag]}
            title={title}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-[3px] px-1.5 text-ui-meta font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-active aria-pressed:bg-surface-3 aria-pressed:text-active-bright xl:px-2"
          >
            <Icon size={14} strokeWidth={1.75} />
            <span className="hidden xl:inline">{shortLabel}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
