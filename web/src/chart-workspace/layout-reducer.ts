import type { ChartPaneSettings } from '../replay/chart-settings-store'
import { createLayoutPreset, paneIds } from './layout-presets'
import type { ChartPaneState, ChartWorkspaceState, LayoutNode, LayoutPreset, SplitOrientation } from './types'

export type LayoutAction =
  | { type: 'replace'; state: ChartWorkspaceState }
  | { type: 'set-preset'; preset: LayoutPreset; inherited?: ChartPaneSettings }
  | { type: 'add-pane'; pane: ChartPaneState; targetPaneId?: string; orientation?: SplitOrientation }
  | { type: 'activate'; paneId: string }
  | { type: 'resize'; splitId: string; ratio: number; totalSize: number; minSize?: number }
  | { type: 'remove-pane'; paneId: string }
  | { type: 'set-pane-timeframe'; paneId: string; timeframe: ChartWorkspaceState['panes'][string]['timeframe'] }
  | { type: 'set-pane-settings'; paneId: string; settings: ChartPaneSettings }

export function clampSplitRatio(ratio: number, totalSize: number, minSize = 240): number {
  if (!Number.isFinite(ratio) || totalSize <= 0) return 0.5
  const limit = Math.min(0.5, minSize / totalSize)
  return Math.max(limit, Math.min(1 - limit, ratio))
}

function resizeNode(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.kind === 'pane') return node
  if (node.id === splitId) return { ...node, ratio }
  return { ...node, first: resizeNode(node.first, splitId, ratio), second: resizeNode(node.second, splitId, ratio) }
}

function removePane(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.kind === 'pane') return node.paneId === paneId ? null : node
  const first = removePane(node.first, paneId)
  const second = removePane(node.second, paneId)
  if (!first) return second
  if (!second) return first
  return { ...node, first, second }
}

function addBeside(node: LayoutNode, targetPaneId: string, paneId: string, orientation: SplitOrientation): LayoutNode {
  if (node.kind === 'pane') {
    return node.paneId === targetPaneId
      ? { kind: 'split', id: `split-${targetPaneId}-${paneId}`, orientation, ratio: 0.5, first: node, second: { kind: 'pane', paneId } }
      : node
  }
  return { ...node, first: addBeside(node.first, targetPaneId, paneId, orientation), second: addBeside(node.second, targetPaneId, paneId, orientation) }
}

export function layoutReducer(state: ChartWorkspaceState, action: LayoutAction): ChartWorkspaceState {
  if (action.type === 'replace') return action.state
  if (action.type === 'set-preset') {
    const active = state.panes[state.activePaneId]
    return createLayoutPreset(action.preset, active?.timeframe ?? '1m', action.inherited ?? active?.settings)
  }
  if (action.type === 'add-pane') {
    if (state.panes[action.pane.id] || Object.keys(state.panes).length >= 4) return state
    const target = action.targetPaneId && state.panes[action.targetPaneId] ? action.targetPaneId : state.activePaneId
    const root = addBeside(state.root, target, action.pane.id, action.orientation ?? 'horizontal')
    const count = Object.keys(state.panes).length + 1
    return { ...state, preset: count === 2 ? '2v' : count === 3 ? '3' : '4', root, panes: { ...state.panes, [action.pane.id]: action.pane }, activePaneId: action.pane.id }
  }
  if (action.type === 'activate') return state.panes[action.paneId] ? { ...state, activePaneId: action.paneId } : state
  if (action.type === 'resize') return { ...state, root: resizeNode(state.root, action.splitId, clampSplitRatio(action.ratio, action.totalSize, action.minSize)) }
  if (action.type === 'set-pane-timeframe') {
    const current = state.panes[action.paneId]
    return current ? { ...state, panes: { ...state.panes, [action.paneId]: { ...current, timeframe: action.timeframe } } } : state
  }
  if (action.type === 'set-pane-settings') {
    const current = state.panes[action.paneId]
    return current ? { ...state, panes: { ...state.panes, [action.paneId]: { ...current, settings: action.settings } } } : state
  }
  const root = removePane(state.root, action.paneId)
  if (!root) return state
  const { [action.paneId]: _removed, ...panes } = state.panes
  const ids = paneIds(root)
  const activePaneId = state.activePaneId === action.paneId ? ids[0] : state.activePaneId
  return { ...state, preset: ids.length === 1 ? 'single' : state.preset, root, panes, activePaneId }
}
