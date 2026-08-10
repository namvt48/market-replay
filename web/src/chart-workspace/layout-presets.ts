import type { Timeframe } from '../api/types'
import { DEFAULT_CHART_PANE_SETTINGS, type ChartPaneSettings } from '../replay/chart-settings-store'
import type { ChartPaneState, ChartWorkspaceState, LayoutNode, LayoutPreset, SplitOrientation } from './types'

const paneNode = (paneId: string): LayoutNode => ({ kind: 'pane', paneId })
const split = (id: string, orientation: SplitOrientation, first: LayoutNode, second: LayoutNode, ratio = 0.5): LayoutNode => ({ kind: 'split', id, orientation, ratio, first, second })

function pane(id: string, timeframe: Timeframe, settings: ChartPaneSettings): ChartPaneState {
  return { id, timeframe, settings: { appearance: { ...settings.appearance }, timezone: { ...settings.timezone }, marketSession: settings.marketSession } }
}

export function createLayoutPreset(preset: LayoutPreset, timeframe: Timeframe = '1m', inherited: ChartPaneSettings = DEFAULT_CHART_PANE_SETTINGS): ChartWorkspaceState {
  const count = preset === 'single' ? 1 : preset === '2v' || preset === '2h' ? 2 : preset === '3' ? 3 : 4
  const panes = Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const id = `pane-${index + 1}`
    return [id, pane(id, timeframe, inherited)]
  }))
  let root: LayoutNode = paneNode('pane-1')
  if (preset === '2v') root = split('split-root', 'horizontal', paneNode('pane-1'), paneNode('pane-2'))
  if (preset === '2h') root = split('split-root', 'vertical', paneNode('pane-1'), paneNode('pane-2'))
  if (preset === '3') root = split('split-root', 'horizontal', paneNode('pane-1'), split('split-right', 'vertical', paneNode('pane-2'), paneNode('pane-3')), 0.6)
  if (preset === '4') root = split('split-root', 'vertical', split('split-top', 'horizontal', paneNode('pane-1'), paneNode('pane-2')), split('split-bottom', 'horizontal', paneNode('pane-3'), paneNode('pane-4')))
  return { preset, root, panes, activePaneId: 'pane-1' }
}

export function paneIds(node: LayoutNode): string[] {
  return node.kind === 'pane' ? [node.paneId] : [...paneIds(node.first), ...paneIds(node.second)]
}
