import { createContext, useContext, type Dispatch } from 'react'
import type { LayoutAction } from './layout-reducer'
import type { ChartWorkspaceState, LayoutPreset } from './types'

export interface ChartWorkspaceContextValue {
  state: ChartWorkspaceState
  dispatch: Dispatch<LayoutAction>
  activate: (paneId: string) => void
  setPreset: (preset: LayoutPreset) => void
  loadLayout: (state: ChartWorkspaceState) => void
}

export const ChartWorkspaceContext = createContext<ChartWorkspaceContextValue | null>(null)

export function useChartWorkspace(): ChartWorkspaceContextValue {
  const context = useContext(ChartWorkspaceContext)
  if (!context) throw new Error('useChartWorkspace must be used inside ChartWorkspaceProvider')
  return context
}
