import { z } from 'zod'
import { timeframeSchema } from '../replay/timeframe'
import { chartPaneSettingsSchema } from '../replay/chart-settings-store'
import { DEFAULT_MARKET_SESSION, marketSessionSchema } from '../replay/market-session'
import { createLayoutPreset, paneIds } from './layout-presets'
import { DEFAULT_CHART_SYNC_FLAGS, LAYOUT_PRESET_IDS, type ChartWorkspaceState, type LayoutNode } from './types'
import { preferenceStorage } from '../store/preference-sync'

const STORAGE_KEY = 'market-replay:chart-layout'
const nodeSchema: z.ZodType<LayoutNode> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pane'), paneId: z.string().min(1) }),
  z.object({ kind: z.literal('split'), id: z.string().min(1), orientation: z.enum(['horizontal', 'vertical']), ratio: z.number().min(0.1).max(0.9), first: nodeSchema, second: nodeSchema }),
]))
const paneStateV4Schema = z.object({ id: z.string(), timeframe: timeframeSchema, settings: chartPaneSettingsSchema })
const paneStateSchema = paneStateV4Schema.extend({ symbol: z.string().min(1).nullable() })

const chartWorkspaceStateV2Schema = z.object({
  preset: z.enum(['single', '2v', '2h', '3', '4']),
  root: nodeSchema,
  panes: z.record(z.string(), paneStateV4Schema),
  activePaneId: z.string(),
  marketSession: marketSessionSchema,
})
const chartSyncFlagsV3Schema = z.object({
  crosshair: z.boolean(),
  dateRange: z.boolean(),
})
export const chartSyncFlagsSchema = chartSyncFlagsV3Schema.extend({ lockZoom: z.boolean() })
const chartWorkspaceStateV3Schema = chartWorkspaceStateV2Schema.extend({ syncFlags: chartSyncFlagsV3Schema })
const chartWorkspaceStateV4Schema = chartWorkspaceStateV2Schema.extend({ syncFlags: chartSyncFlagsSchema })
export const chartWorkspaceStateSchema = chartWorkspaceStateV4Schema.extend({
  panes: z.record(z.string(), paneStateSchema),
  preset: z.union([z.enum(LAYOUT_PRESET_IDS), z.literal('custom')]),
})

const legacyPaneSettingsSchema = chartPaneSettingsSchema.extend({
  marketSession: marketSessionSchema.default(DEFAULT_MARKET_SESSION),
})
const legacyChartWorkspaceStateSchema = z.object({
  preset: z.enum(['single', '2v', '2h', '3', '4']),
  root: nodeSchema,
  panes: z.record(z.string(), z.object({ id: z.string(), timeframe: timeframeSchema, settings: legacyPaneSettingsSchema })),
  activePaneId: z.string(),
})
const persistedV1Schema = legacyChartWorkspaceStateSchema.extend({ version: z.literal(1) })
const persistedV2Schema = chartWorkspaceStateV2Schema.extend({ version: z.literal(2) })
const persistedV3Schema = chartWorkspaceStateV3Schema.extend({ version: z.literal(3) })
const persistedV4Schema = chartWorkspaceStateV4Schema.extend({ version: z.literal(4) })
const persistedV5Schema = chartWorkspaceStateSchema.extend({ version: z.literal(5) })
export const persistedChartWorkspaceStateSchema = z.discriminatedUnion('version', [persistedV1Schema, persistedV2Schema, persistedV3Schema, persistedV4Schema, persistedV5Schema])

type LegacyChartWorkspaceState = z.infer<typeof legacyChartWorkspaceStateSchema>
type ChartWorkspaceStateV2 = z.infer<typeof chartWorkspaceStateV2Schema>
type ChartWorkspaceStateV3 = z.infer<typeof chartWorkspaceStateV3Schema>
type ChartWorkspaceStateV4 = z.infer<typeof chartWorkspaceStateV4Schema>

function withPaneSymbols<T extends ChartWorkspaceStateV4>(state: T): ChartWorkspaceState {
  const panes: ChartWorkspaceState['panes'] = Object.fromEntries(Object.entries(state.panes).map(([id, pane]) => [id, { ...pane, symbol: null }]))
  return { preset: state.preset, root: state.root, panes, activePaneId: state.activePaneId, marketSession: state.marketSession, syncFlags: state.syncFlags }
}

function migrateLegacyChartWorkspaceState(legacy: LegacyChartWorkspaceState): ChartWorkspaceState {
  const marketSession = legacy.panes[legacy.activePaneId]?.settings.marketSession ?? DEFAULT_MARKET_SESSION
  const panes: ChartWorkspaceState['panes'] = Object.fromEntries(Object.entries(legacy.panes).map(([id, pane]) => [id, {
    id: pane.id,
    symbol: null,
    timeframe: pane.timeframe,
    settings: { appearance: pane.settings.appearance, timezone: pane.settings.timezone },
  }]))
  return { preset: legacy.preset, root: legacy.root, panes, activePaneId: legacy.activePaneId, marketSession, syncFlags: { ...DEFAULT_CHART_SYNC_FLAGS } }
}

function migrateChartWorkspaceStateV2(state: ChartWorkspaceStateV2): ChartWorkspaceState {
  return withPaneSymbols({ ...state, syncFlags: { ...DEFAULT_CHART_SYNC_FLAGS } })
}

function migrateChartWorkspaceStateV3(state: ChartWorkspaceStateV3): ChartWorkspaceState {
  return withPaneSymbols({ ...state, syncFlags: { ...state.syncFlags, lockZoom: false } })
}

export function parseChartWorkspaceState(value: unknown): ChartWorkspaceState {
  const current = chartWorkspaceStateSchema.safeParse(value)
  if (current.success) return current.data
  const v4 = chartWorkspaceStateV4Schema.safeParse(value)
  if (v4.success) return withPaneSymbols(v4.data)
  const v3 = chartWorkspaceStateV3Schema.safeParse(value)
  if (v3.success) return migrateChartWorkspaceStateV3(v3.data)
  const v2 = chartWorkspaceStateV2Schema.safeParse(value)
  return v2.success ? migrateChartWorkspaceStateV2(v2.data) : migrateLegacyChartWorkspaceState(legacyChartWorkspaceStateSchema.parse(value))
}

export function loadChartLayout(storage: Pick<Storage, 'getItem'> = preferenceStorage): ChartWorkspaceState {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return createLayoutPreset('single')
    const persisted = persistedChartWorkspaceStateSchema.parse(JSON.parse(raw))
    const parsed = persisted.version === 1
      ? migrateLegacyChartWorkspaceState(persisted)
      : persisted.version === 2
        ? migrateChartWorkspaceStateV2(persisted)
        : persisted.version === 3
          ? migrateChartWorkspaceStateV3(persisted)
          : persisted.version === 4
            ? withPaneSymbols(persisted)
            : persisted
    const ids = paneIds(parsed.root)
    if (!ids.every((id) => parsed.panes[id]) || !parsed.panes[parsed.activePaneId]) return createLayoutPreset('single')
    const panes: ChartWorkspaceState['panes'] = Object.fromEntries(Object.entries(parsed.panes).map(([id, pane]) => [id, { ...pane, timeframe: '1m' as const }]))
    return { preset: parsed.preset, root: parsed.root, panes, activePaneId: parsed.activePaneId, marketSession: parsed.marketSession, syncFlags: parsed.syncFlags }
  } catch {
    return createLayoutPreset('single')
  }
}

export function persistChartLayout(state: ChartWorkspaceState, storage: Pick<Storage, 'setItem'> = preferenceStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 5, ...state }))
}
