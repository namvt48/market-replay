import type { Timeframe } from '../api/types'
import { DEFAULT_CHART_PANE_SETTINGS, type ChartPaneSettings } from '../replay/chart-settings-store'
import { DEFAULT_MARKET_SESSION } from '../replay/market-session'
import { DEFAULT_CHART_SYNC_FLAGS, type BuiltInLayoutPreset, type ChartPaneState, type ChartWorkspaceState, type LayoutNode, type LayoutPreset, type SplitOrientation } from './types'

const paneNode = (paneId: string): LayoutNode => ({ kind: 'pane', paneId })
const split = (id: string, orientation: SplitOrientation, first: LayoutNode, second: LayoutNode, ratio = 0.5): LayoutNode => ({ kind: 'split', id, orientation, ratio, first, second })

export type LayoutTemplateNode = number | { orientation: SplitOrientation; ratio: number; first: LayoutTemplateNode; second: LayoutTemplateNode }

export interface LayoutTemplate {
  id: BuiltInLayoutPreset
  count: number
  label: string
  root: LayoutTemplateNode
}

const h = (first: LayoutTemplateNode, second: LayoutTemplateNode, ratio = 0.5): LayoutTemplateNode => ({ orientation: 'horizontal', ratio, first, second })
const v = (first: LayoutTemplateNode, second: LayoutTemplateNode, ratio = 0.5): LayoutTemplateNode => ({ orientation: 'vertical', ratio, first, second })

function equal(items: LayoutTemplateNode[], orientation: SplitOrientation): LayoutTemplateNode {
  if (items.length === 1) return items[0]
  const [first, ...rest] = items
  return { orientation, ratio: 1 / items.length, first, second: equal(rest, orientation) }
}

const columns = (...items: LayoutTemplateNode[]): LayoutTemplateNode => equal(items, 'horizontal')
const rows = (...items: LayoutTemplateNode[]): LayoutTemplateNode => equal(items, 'vertical')

export const LAYOUT_TEMPLATES: readonly LayoutTemplate[] = [
  { id: 'single', count: 1, label: '1 chart', root: 1 },

  { id: '2v', count: 2, label: '2 charts vertical', root: columns(1, 2) },
  { id: '2h', count: 2, label: '2 charts horizontal', root: rows(1, 2) },

  { id: '3-columns', count: 3, label: '3 charts, columns', root: columns(1, 2, 3) },
  { id: '3-rows', count: 3, label: '3 charts, rows', root: rows(1, 2, 3) },
  { id: '3', count: 3, label: '3 charts', root: h(1, rows(2, 3), 0.6) },
  { id: '3-main-right', count: 3, label: '3 charts, main right', root: h(rows(1, 2), 3, 0.4) },
  { id: '3-main-top', count: 3, label: '3 charts, main top', root: v(1, columns(2, 3), 0.6) },

  { id: '4', count: 4, label: '4 charts', root: v(columns(1, 2), columns(3, 4)) },
  { id: '4-rows', count: 4, label: '4 charts, rows', root: rows(1, 2, 3, 4) },
  { id: '4-columns', count: 4, label: '4 charts, columns', root: columns(1, 2, 3, 4) },
  { id: '4-main-left', count: 4, label: '4 charts, main left', root: h(1, rows(2, 3, 4), 0.62) },
  { id: '4-main-right', count: 4, label: '4 charts, main right', root: h(rows(1, 2, 3), 4, 0.38) },
  { id: '4-main-top', count: 4, label: '4 charts, main top', root: v(1, columns(2, 3, 4), 0.62) },
  { id: '4-main-bottom', count: 4, label: '4 charts, main bottom', root: v(columns(1, 2, 3), 4, 0.38) },
  { id: '4-left-stack', count: 4, label: '4 charts, two left', root: h(rows(1, 2), rows(3, 4), 0.38) },
  { id: '4-right-stack', count: 4, label: '4 charts, two right', root: h(rows(1, 2), rows(3, 4), 0.62) },
  { id: '4-center-main', count: 4, label: '4 charts, center main', root: h(rows(1, 2), h(3, 4, 0.7), 0.3) },

  { id: '5', count: 5, label: '5 charts', root: v(columns(1, 2), columns(3, 4, 5), 0.5) },
  { id: '5-columns', count: 5, label: '5 charts, columns', root: columns(1, 2, 3, 4, 5) },
  { id: '5-rows', count: 5, label: '5 charts, rows', root: rows(1, 2, 3, 4, 5) },
  { id: '5-main-left', count: 5, label: '5 charts, main left', root: h(1, rows(2, 3, 4, 5), 0.62) },
  { id: '5-main-right', count: 5, label: '5 charts, main right', root: h(rows(1, 2, 3, 4), 5, 0.38) },
  { id: '5-main-top', count: 5, label: '5 charts, main top', root: v(1, columns(2, 3, 4, 5), 0.62) },
  { id: '5-main-bottom', count: 5, label: '5 charts, main bottom', root: v(columns(1, 2, 3, 4), 5, 0.38) },
  { id: '5-left-two', count: 5, label: '5 charts, two left', root: h(rows(1, 2), rows(3, 4, 5), 0.42) },
  { id: '5-right-two', count: 5, label: '5 charts, two right', root: h(rows(1, 2, 3), rows(4, 5), 0.58) },
  { id: '5-center-main', count: 5, label: '5 charts, center main', root: h(rows(1, 2), h(3, rows(4, 5), 0.68), 0.25) },

  { id: '6', count: 6, label: '6 charts', root: v(columns(1, 2, 3), columns(4, 5, 6)) },
  { id: '6-columns', count: 6, label: '6 charts, columns', root: columns(1, 2, 3, 4, 5, 6) },
  { id: '6-rows', count: 6, label: '6 charts, rows', root: rows(1, 2, 3, 4, 5, 6) },
  { id: '6-two-columns', count: 6, label: '6 charts, two columns', root: h(rows(1, 2, 3), rows(4, 5, 6)) },
  { id: '6-three-columns', count: 6, label: '6 charts, three columns', root: columns(rows(1, 2), rows(3, 4), rows(5, 6)) },
  { id: '6-main-left', count: 6, label: '6 charts, main left', root: h(1, rows(2, 3, 4, 5, 6), 0.62) },

  { id: '7', count: 7, label: '7 charts', root: v(columns(1, 2, 3), columns(4, 5, 6, 7), 0.5) },
  { id: '7-columns', count: 7, label: '7 charts, columns', root: columns(1, 2, 3, 4, 5, 6, 7) },
  { id: '7-main-left', count: 7, label: '7 charts, main left', root: h(1, rows(2, 3, 4, 5, 6, 7), 0.62) },

  { id: '8', count: 8, label: '8 charts', root: v(columns(1, 2, 3, 4), columns(5, 6, 7, 8)) },
  { id: '8-columns', count: 8, label: '8 charts, columns', root: columns(1, 2, 3, 4, 5, 6, 7, 8) },
  { id: '8-rows', count: 8, label: '8 charts, rows', root: rows(1, 2, 3, 4, 5, 6, 7, 8) },
  { id: '8-two-columns', count: 8, label: '8 charts, two columns', root: h(rows(1, 2, 3, 4), rows(5, 6, 7, 8)) },
] as const

const templateById = new Map(LAYOUT_TEMPLATES.map((template) => [template.id, template]))

function materialize(node: LayoutTemplateNode, path = 'root'): LayoutNode {
  if (typeof node === 'number') return paneNode(`pane-${node}`)
  return split(`split-${path}`, node.orientation, materialize(node.first, `${path}-first`), materialize(node.second, `${path}-second`), node.ratio)
}

export function createPane(id: string, timeframe: Timeframe, settings: ChartPaneSettings, symbol: string | null): ChartPaneState {
  return { id, symbol, timeframe, settings: { appearance: { ...settings.appearance }, timezone: { ...settings.timezone } } }
}

export function createLayoutPreset(preset: LayoutPreset, timeframe: Timeframe = '1m', inherited: ChartPaneSettings = DEFAULT_CHART_PANE_SETTINGS, symbol: string | null = null): ChartWorkspaceState {
  const template = preset === 'custom' ? templateById.get('single') : templateById.get(preset)
  if (!template) throw new Error(`Unknown chart layout preset: ${preset}`)
  const count = template.count
  const panes = Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const id = `pane-${index + 1}`
    return [id, createPane(id, timeframe, inherited, symbol)]
  }))
  const root = materialize(template.root)
  return {
    preset,
    root,
    panes,
    activePaneId: 'pane-1',
    timezone: { ...inherited.timezone },
    marketSession: DEFAULT_MARKET_SESSION,
    syncFlags: { ...DEFAULT_CHART_SYNC_FLAGS },
  }
}

export function paneIds(node: LayoutNode): string[] {
  return node.kind === 'pane' ? [node.paneId] : [...paneIds(node.first), ...paneIds(node.second)]
}

function gridNode(ids: readonly string[], orientation: SplitOrientation): LayoutNode {
  if (ids.length === 1) return paneNode(ids[0])
  const mid = Math.ceil(ids.length / 2)
  const next: SplitOrientation = orientation === 'horizontal' ? 'vertical' : 'horizontal'
  return split(`split-grid-${ids.join('-')}`, orientation, gridNode(ids.slice(0, mid), next), gridNode(ids.slice(mid), next), mid / ids.length)
}

/** Builds a balanced split tree for an arbitrary number of panes by recursively halving the id list, alternating orientation per level so the result reads as a grid instead of a lopsided chain of splits. */
export function buildGridLayout(ids: readonly string[]): LayoutNode {
  if (ids.length === 0) throw new Error('buildGridLayout requires at least one pane id')
  return gridNode(ids, 'horizontal')
}

/** Collapses panes in `detachedIds` out of the tree so their sibling takes the freed space, instead of leaving a placeholder in their slot. */
export function pruneDetachedPanes(node: LayoutNode, detachedIds: ReadonlySet<string>): LayoutNode | null {
  if (node.kind === 'pane') return detachedIds.has(node.paneId) ? null : node
  const first = pruneDetachedPanes(node.first, detachedIds)
  const second = pruneDetachedPanes(node.second, detachedIds)
  if (!first) return second
  if (!second) return first
  return first === node.first && second === node.second ? node : { ...node, first, second }
}
