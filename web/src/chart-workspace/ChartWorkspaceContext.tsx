import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { replayEngine } from '../replay/replay-engine'
import { useUiStore } from '../store/ui-store'
import { layoutReducer } from './layout-reducer'
import { loadChartLayout, persistChartLayout } from './layout-storage'
import type { ChartWorkspaceState, LayoutPreset } from './types'
import { ChartWorkspaceContext } from './use-chart-workspace'

interface ChartWorkspaceProviderProps { children: ReactNode }

export function ChartWorkspaceProvider({ children }: ChartWorkspaceProviderProps) {
  const [state, dispatch] = useReducer(layoutReducer, undefined, () => loadChartLayout())
  const setActivePaneId = useUiStore((store) => store.setActivePaneId)
  const setActiveTf = useUiStore((store) => store.setActiveTf)
  const activeTf = useUiStore((store) => store.activeTf)
  const syncingTimeframeFromLayout = useRef(false)

  useEffect(() => { persistChartLayout(state) }, [state])
  useEffect(() => { replayEngine.setMarketSession(state.marketSession) }, [state.marketSession])
  useEffect(() => { replayEngine.setSyncFlags(state.syncFlags) }, [state.syncFlags])
  useEffect(() => {
    const pane = state.panes[state.activePaneId]
    if (!pane) return
    setActivePaneId(pane.id)
    if (useUiStore.getState().activeTf !== pane.timeframe) {
      syncingTimeframeFromLayout.current = true
      setActiveTf(pane.timeframe)
    }
    replayEngine.activateChartView(pane.id)
  }, [setActivePaneId, setActiveTf, state.activePaneId, state.panes])
  useEffect(() => {
    if (syncingTimeframeFromLayout.current) {
      syncingTimeframeFromLayout.current = false
      return
    }
    const pane = state.panes[state.activePaneId]
    if (pane && pane.timeframe !== activeTf) dispatch({ type: 'set-pane-timeframe', paneId: pane.id, timeframe: activeTf })
  }, [activeTf, state.activePaneId, state.panes])

  const activate = useCallback((paneId: string): void => {
    const pane = state.panes[paneId]
    if (!pane) return
    dispatch({ type: 'activate', paneId })
    setActivePaneId(paneId)
    setActiveTf(pane.timeframe)
    replayEngine.activateChartView(paneId)
  }, [state.panes, setActivePaneId, setActiveTf])

  const setPreset = useCallback((preset: LayoutPreset): void => {
    const active = state.panes[state.activePaneId]
    dispatch({ type: 'set-preset', preset, inherited: active?.settings })
  }, [state.panes, state.activePaneId])

  const loadLayout = useCallback((next: ChartWorkspaceState): void => {
    dispatch({ type: 'replace', state: structuredClone(next) })
  }, [])

  // Every consumer re-renders whenever this context value changes identity
  // — without memoizing it, ChartWorkspaceProvider re-rendering for any
  // reason (even one unrelated to layout/state) handed out a brand new
  // object every time and fanned that re-render out to every consumer.
  const value = useMemo(
    () => ({ state, dispatch, activate, setPreset, loadLayout }),
    [state, activate, setPreset, loadLayout],
  )

  return <ChartWorkspaceContext value={value}>{children}</ChartWorkspaceContext>
}
