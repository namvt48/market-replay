import type { Timeframe } from '../api/types'
import type { ChartPaneSettings } from '../replay/chart-settings-store'

export type LayoutPreset = 'single' | '2v' | '2h' | '3' | '4'
export type SplitOrientation = 'horizontal' | 'vertical'

export interface ChartPaneState {
  id: string
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
}
