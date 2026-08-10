// Zustand holds UI state ONLY (docs §5.6). Replay state (cursor,
// position, unrealized P&L) is a plain module singleton outside React,
// updated at 60Hz internally but only pushed into this store — or read
// via a throttled snapshot — at 10Hz, so a P&L panel re-rendering can
// never eat the 60fps frame budget. That bridge doesn't exist yet; this
// store starts with just the state React screens need directly.
import { create } from 'zustand'
import type { Timeframe } from '../api/types'

interface UiState {
  activeSymbol: string | null
  activeTf: Timeframe
  activePaneId: string
  activeTool: string | null
  sidebarTab: 'trade' | 'sessions' | 'calendar' | 'evaluation'
  sidebarOpen: boolean
  setActiveSymbol: (symbol: string) => void
  setActiveTf: (tf: Timeframe) => void
  setActivePaneId: (paneId: string) => void
  setActiveTool: (tool: string | null) => void
  setSidebarTab: (tab: UiState['sidebarTab']) => void
  setSidebarOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeSymbol: null,
  activeTf: '1m',
  activePaneId: 'pane-1',
  activeTool: null,
  sidebarTab: 'trade',
  sidebarOpen: true,
  setActiveSymbol: (symbol) => set({ activeSymbol: symbol }),
  setActiveTf: (tf) => set({ activeTf: tf }),
  setActivePaneId: (activePaneId) => set({ activePaneId }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}))
