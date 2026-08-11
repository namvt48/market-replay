import { z } from 'zod'
import { parseChartWorkspaceState } from './layout-storage'
import type { ChartWorkspaceState } from './types'
import { preferenceStorage } from '../store/preference-sync'

const STORAGE_KEY = 'market-replay:saved-chart-layouts'
const savedLayoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  updatedAt: z.number().int().nonnegative(),
  state: z.unknown(),
})
const savedLayoutsSchema = z.array(savedLayoutSchema)

export interface SavedChartLayout {
  id: string
  name: string
  updatedAt: number
  state: ChartWorkspaceState
}

interface LayoutStorage extends Pick<Storage, 'getItem' | 'setItem'> {}

export function loadSavedLayouts(storage: Pick<Storage, 'getItem'> = preferenceStorage): SavedChartLayout[] {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    return savedLayoutsSchema.parse(JSON.parse(raw)).map((layout) => ({ ...layout, state: parseChartWorkspaceState(layout.state) }))
  } catch {
    return []
  }
}

export function saveNamedLayout(name: string, state: ChartWorkspaceState, storage: LayoutStorage = preferenceStorage): SavedChartLayout[] {
  const normalizedName = name.trim()
  if (!normalizedName) throw new Error('Enter a layout name')
  if (normalizedName.length > 40) throw new Error('Layout name must be 40 characters or fewer')
  const current = loadSavedLayouts(storage)
  const existing = current.find((layout) => layout.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())
  const saved: SavedChartLayout = {
    id: existing?.id ?? crypto.randomUUID(),
    name: normalizedName,
    updatedAt: Date.now(),
    state: structuredClone(state),
  }
  const next = [saved, ...current.filter((layout) => layout.id !== saved.id)]
  storage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function deleteSavedLayout(id: string, storage: LayoutStorage = preferenceStorage): SavedChartLayout[] {
  const next = loadSavedLayouts(storage).filter((layout) => layout.id !== id)
  storage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}
