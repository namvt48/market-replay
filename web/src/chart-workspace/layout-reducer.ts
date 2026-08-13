import type { ChartPaneSettings } from '../replay/chart-settings-store'
import type { MarketSession } from '../replay/market-session'
import { buildGridLayout, createLayoutPreset, paneIds } from './layout-presets'
import { CHART_SPLIT_SEPARATOR_SIZE_PX, type ChartPaneState, type ChartSyncFlags, type ChartWorkspaceState, type LayoutNode, type LayoutPreset } from './types'

export type LayoutAction =
  | { type: 'replace'; state: ChartWorkspaceState }
  | { type: 'set-preset'; preset: LayoutPreset; inherited?: ChartPaneSettings }
  | { type: 'add-pane'; pane: ChartPaneState }
  | { type: 'activate'; paneId: string }
  | { type: 'resize'; splitId: string; ratio: number; totalSize: number; minSize?: number }
  | { type: 'remove-pane'; paneId: string }
  | { type: 'set-pane-symbol'; paneId: string; symbol: string }
  | { type: 'set-pane-timeframe'; paneId: string; timeframe: ChartWorkspaceState['panes'][string]['timeframe'] }
  | { type: 'set-pane-settings'; paneId: string; settings: ChartPaneSettings }
  | { type: 'set-market-session'; marketSession: MarketSession }
  | { type: 'set-sync-flags'; syncFlags: Partial<ChartSyncFlags> }

export function clampSplitRatio(ratio: number, totalSize: number, minSize = 240): number {
  if (!Number.isFinite(ratio) || totalSize <= 0) return 0.5
  const limit = Math.min(0.5, minSize / totalSize)
  return Math.max(limit, Math.min(1 - limit, ratio))
}

interface AlignedTrack {
  node: LayoutNode
  size: number
}

function collectAlignedTracks(node: LayoutNode, orientation: Extract<LayoutNode, { kind: 'split' }>['orientation'], size: number, tracks: AlignedTrack[]): void {
  if (node.kind === 'split' && node.orientation === orientation) {
    const firstSize = size * node.ratio
    collectAlignedTracks(node.first, orientation, firstSize, tracks)
    collectAlignedTracks(node.second, orientation, Math.max(0, size - firstSize - CHART_SPLIT_SEPARATOR_SIZE_PX), tracks)
    return
  }
  tracks.push({ node, size })
}

function rebuildAlignedSplits(node: LayoutNode, orientation: Extract<LayoutNode, { kind: 'split' }>['orientation'], sizes: ReadonlyMap<LayoutNode, number>): { node: LayoutNode; size: number } {
  if (node.kind !== 'split' || node.orientation !== orientation) {
    return { node, size: sizes.get(node) ?? 0 }
  }
  const first = rebuildAlignedSplits(node.first, orientation, sizes)
  const second = rebuildAlignedSplits(node.second, orientation, sizes)
  const size = first.size + CHART_SPLIT_SEPARATOR_SIZE_PX + second.size
  const ratio = size > 0 ? first.size / size : node.ratio
  return {
    node: first.node === node.first && second.node === node.second && ratio === node.ratio
      ? node
      : { ...node, ratio, first: first.node, second: second.node },
    size,
  }
}

/**
 * A same-axis split tree represents a row/column track list. Moving one
 * separator must resize only the tracks touching it; otherwise changing an
 * ancestor ratio also moves every separator nested on its second side.
 */
function resizeAlignedSplit(node: Extract<LayoutNode, { kind: 'split' }>, requestedRatio: number, totalSize: number, minSize: number): LayoutNode {
  const desiredRatio = clampSplitRatio(requestedRatio, totalSize, minSize)
  if (totalSize <= 0) return { ...node, ratio: desiredRatio }
  const firstTracks: AlignedTrack[] = []
  const secondTracks: AlignedTrack[] = []
  const firstSize = totalSize * node.ratio
  collectAlignedTracks(node.first, node.orientation, firstSize, firstTracks)
  collectAlignedTracks(node.second, node.orientation, Math.max(0, totalSize - firstSize - CHART_SPLIT_SEPARATOR_SIZE_PX), secondTracks)

  const before = firstTracks[firstTracks.length - 1]
  const after = secondTracks[0]
  if (!before || !after) return { ...node, ratio: desiredRatio }

  const requestedDelta = (desiredRatio - node.ratio) * totalSize
  const minimumTrackSize = Math.min(minSize, (before.size + after.size) / 2)
  const minimumDelta = minimumTrackSize - before.size
  const maximumDelta = after.size - minimumTrackSize
  const delta = Math.max(minimumDelta, Math.min(maximumDelta, requestedDelta))
  if (delta === 0) return node

  const sizes = new Map<LayoutNode, number>()
  for (const track of [...firstTracks, ...secondTracks]) sizes.set(track.node, track.size)
  sizes.set(before.node, before.size + delta)
  sizes.set(after.node, after.size - delta)
  return rebuildAlignedSplits(node, node.orientation, sizes).node
}

function resizeNode(node: LayoutNode, splitId: string, ratio: number, totalSize: number, minSize: number): LayoutNode {
  if (node.kind === 'pane') return node
  if (node.id === splitId) return resizeAlignedSplit(node, ratio, totalSize, minSize)
  const first = resizeNode(node.first, splitId, ratio, totalSize, minSize)
  const second = resizeNode(node.second, splitId, ratio, totalSize, minSize)
  return first === node.first && second === node.second ? node : { ...node, first, second }
}

export function layoutReducer(state: ChartWorkspaceState, action: LayoutAction): ChartWorkspaceState {
  if (action.type === 'replace') return action.state
  if (action.type === 'set-preset') {
    const active = state.panes[state.activePaneId]
    const next = createLayoutPreset(action.preset, active?.timeframe ?? '1m', action.inherited ?? active?.settings, active?.symbol ?? null)
    const panes = Object.fromEntries(Object.entries(next.panes).map(([paneId, pane]) => [paneId, state.panes[paneId] ?? pane]))
    return {
      ...next,
      panes,
      activePaneId: panes[state.activePaneId] ? state.activePaneId : next.activePaneId,
      marketSession: state.marketSession,
      syncFlags: state.syncFlags,
    }
  }
  if (action.type === 'add-pane') {
    if (state.panes[action.pane.id]) return state
    const root = buildGridLayout([...paneIds(state.root), action.pane.id])
    return { ...state, preset: 'custom', root, panes: { ...state.panes, [action.pane.id]: action.pane }, activePaneId: action.pane.id }
  }
  if (action.type === 'activate') return state.panes[action.paneId] ? { ...state, activePaneId: action.paneId } : state
  if (action.type === 'resize') return { ...state, root: resizeNode(state.root, action.splitId, action.ratio, action.totalSize, action.minSize ?? 240) }
  if (action.type === 'set-pane-symbol') {
    const current = state.panes[action.paneId]
    return current && current.symbol !== action.symbol
      ? { ...state, panes: { ...state.panes, [action.paneId]: { ...current, symbol: action.symbol } } }
      : state
  }
  if (action.type === 'set-pane-timeframe') {
    const current = state.panes[action.paneId]
    return current ? { ...state, panes: { ...state.panes, [action.paneId]: { ...current, timeframe: action.timeframe } } } : state
  }
  if (action.type === 'set-pane-settings') {
    const current = state.panes[action.paneId]
    return current ? { ...state, panes: { ...state.panes, [action.paneId]: { ...current, settings: action.settings } } } : state
  }
  if (action.type === 'set-market-session') {
    return action.marketSession === state.marketSession ? state : { ...state, marketSession: action.marketSession }
  }
  if (action.type === 'set-sync-flags') {
    return { ...state, syncFlags: { ...state.syncFlags, ...action.syncFlags } }
  }
  const remainingIds = paneIds(state.root).filter((id) => id !== action.paneId)
  if (!state.panes[action.paneId] || remainingIds.length === 0) return state
  const root = buildGridLayout(remainingIds)
  const { [action.paneId]: _removed, ...panes } = state.panes
  const activePaneId = state.activePaneId === action.paneId ? remainingIds[0] : state.activePaneId
  return { ...state, preset: remainingIds.length === 1 ? 'single' : 'custom', root, panes, activePaneId }
}
