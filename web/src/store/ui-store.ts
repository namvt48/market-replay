// Zustand holds UI state ONLY (docs §5.6). Replay state (cursor,
// position, unrealized P&L) is a plain module singleton outside React,
// updated at 60Hz internally but only pushed into this store — or read
// via a throttled snapshot — at 10Hz, so a P&L panel re-rendering can
// never eat the 60fps frame budget. That bridge doesn't exist yet; this
// store starts with just the state React screens need directly.
import { create } from 'zustand'
import type { Timeframe } from '../api/types'

export type CalendarImportanceFilter = '' | 'medium' | 'high'

export interface ReviewSource {
  id: string
  type: 'session' | 'evaluation' | 'live'
  title: string
}

interface UiState {
  activeSymbol: string | null
  activeTf: Timeframe
  activePaneId: string
  activeTool: string | null
  maximizedPaneId: string | null
  sidebarTab: 'sessions' | 'calendar' | 'evaluation' | 'review' | 'analytics' | 'live'
  sidebarOpen: boolean
  reviewSource: ReviewSource | null
  reviewOpen: boolean
  reviewTradeId: string | null
  calendarImportance: CalendarImportanceFilter
  calendarCountry: string
  setActiveSymbol: (symbol: string) => void
  setActiveTf: (tf: Timeframe) => void
  setActivePaneId: (paneId: string) => void
  setActiveTool: (tool: string | null) => void
  toggleMaximizedPane: (paneId: string) => void
  clearMaximizedPane: () => void
  setSidebarTab: (tab: UiState['sidebarTab']) => void
  setSidebarOpen: (open: boolean) => void
  openReview: (source: ReviewSource, tradeId?: string) => void
  closeReview: () => void
  setCalendarImportance: (importance: CalendarImportanceFilter) => void
  setCalendarCountry: (country: string) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeSymbol: null,
  activeTf: '1m',
  activePaneId: 'pane-1',
  activeTool: null,
  maximizedPaneId: null,
  sidebarTab: 'sessions',
  sidebarOpen: true,
  reviewSource: null,
  reviewOpen: false,
  reviewTradeId: null,
  calendarImportance: 'high',
  calendarCountry: 'US',
  setActiveSymbol: (symbol) => set({ activeSymbol: symbol }),
  setActiveTf: (tf) => set({ activeTf: tf }),
  setActivePaneId: (activePaneId) => set({ activePaneId }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  toggleMaximizedPane: (paneId) => set((state) => ({ maximizedPaneId: state.maximizedPaneId === paneId ? null : paneId })),
  clearMaximizedPane: () => set({ maximizedPaneId: null }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  openReview: (reviewSource, reviewTradeId: string | null = null) => set({ reviewSource, reviewTradeId, reviewOpen: true, sidebarOpen: false }),
  closeReview: () => set({ reviewOpen: false, reviewTradeId: null }),
  setCalendarImportance: (calendarImportance) => set({ calendarImportance }),
  setCalendarCountry: (calendarCountry) => set({ calendarCountry }),
}))
