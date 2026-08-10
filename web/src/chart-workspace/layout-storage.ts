import { z } from 'zod'
import { timeframeSchema } from '../replay/timeframe'
import { chartPaneSettingsSchema } from '../replay/chart-settings-store'
import { createLayoutPreset, paneIds } from './layout-presets'
import type { ChartWorkspaceState, LayoutNode } from './types'
import { preferenceStorage } from '../store/preference-sync'

const STORAGE_KEY = 'market-replay:chart-layout'
const nodeSchema: z.ZodType<LayoutNode> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pane'), paneId: z.string().min(1) }),
  z.object({ kind: z.literal('split'), id: z.string().min(1), orientation: z.enum(['horizontal', 'vertical']), ratio: z.number().min(0.1).max(0.9), first: nodeSchema, second: nodeSchema }),
]))
export const chartWorkspaceStateSchema = z.object({
  preset: z.enum(['single', '2v', '2h', '3', '4']),
  root: nodeSchema,
  panes: z.record(z.string(), z.object({ id: z.string(), timeframe: timeframeSchema, settings: chartPaneSettingsSchema })),
  activePaneId: z.string(),
})
const persistedChartWorkspaceStateSchema = chartWorkspaceStateSchema.extend({ version: z.literal(1) })

export function loadChartLayout(storage: Pick<Storage, 'getItem'> = preferenceStorage): ChartWorkspaceState {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return createLayoutPreset('single')
    const parsed = persistedChartWorkspaceStateSchema.parse(JSON.parse(raw))
    const ids = paneIds(parsed.root)
    if (!ids.every((id) => parsed.panes[id]) || !parsed.panes[parsed.activePaneId]) return createLayoutPreset('single')
    const panes = Object.fromEntries(Object.entries(parsed.panes).map(([id, pane]) => [id, { ...pane, timeframe: '1m' as const }]))
    return { preset: parsed.preset, root: parsed.root, panes, activePaneId: parsed.activePaneId }
  } catch {
    return createLayoutPreset('single')
  }
}

export function persistChartLayout(state: ChartWorkspaceState, storage: Pick<Storage, 'setItem'> = preferenceStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...state }))
}
