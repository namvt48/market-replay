import type { Timeframe } from '../api/types'
import type { ChartPaneSettings } from '../replay/chart-settings-store'
import type { MarketSession } from '../replay/market-session'

export const LAYOUT_PRESET_IDS = [
  'single',
  '2v', '2h',
  '3', '3-columns', '3-rows', '3-main-right', '3-main-top',
  '4', '4-columns', '4-rows', '4-main-left', '4-main-right', '4-main-top', '4-main-bottom', '4-left-stack', '4-right-stack', '4-center-main',
  '5', '5-columns', '5-rows', '5-main-left', '5-main-right', '5-main-top', '5-main-bottom', '5-left-two', '5-right-two', '5-center-main',
  '6', '6-columns', '6-rows', '6-two-columns', '6-three-columns', '6-main-left',
  '7', '7-columns', '7-main-left',
  '8', '8-columns', '8-rows', '8-two-columns',
] as const

export type BuiltInLayoutPreset = (typeof LAYOUT_PRESET_IDS)[number]
export type LayoutPreset = BuiltInLayoutPreset | 'custom'
export type SplitOrientation = 'horizontal' | 'vertical'
export const CHART_SPLIT_SEPARATOR_SIZE_PX = 4

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
