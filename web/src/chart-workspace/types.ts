import type { Timeframe } from '../api/types'
import type { ChartPaneSettings } from '../replay/chart-settings-store'
import type { MarketSession } from '../replay/market-session'

export type LayoutPreset = 'single' | '2v' | '2h' | '3' | '4'
export type SplitOrientation = 'horizontal' | 'vertical'

export interface ChartSyncFlags {
  crosshair: boolean
  dateRange: boolean
  lockZoom: boolean
}

export const DEFAULT_CHART_SYNC_FLAGS: ChartSyncFlags = {
  crosshair: true,
  dateRange: true,
  lockZoom: false,
}

export interface ChartPaneState {
  id: string
  /** Null follows the replay symbol; a code pins this pane independently. */
  symbol: string | null
  timeframe: Timeframe
  settings: ChartPaneSettings
}

export type LayoutNode =
  | { kind: 'pane'; paneId: string }
  | { kind: 'split'; id: string; orientation: SplitOrientation; ratio: number; first: LayoutNode; second: LayoutNode }

export interface ChartWorkspaceState {
  preset: LayoutPreset
  root: LayoutNode
  panes: Record<string, ChartPaneState>
  activePaneId: string
  marketSession: MarketSession
  syncFlags: ChartSyncFlags
}
