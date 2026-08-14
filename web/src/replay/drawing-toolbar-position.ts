import { z } from 'zod'

export const DRAWING_TOOLBAR_POSITION_STORAGE_KEY = 'market-replay:drawing-toolbar-position:v1'
export const CONTEXTUAL_DRAWING_TOOLBAR_POSITION_STORAGE_KEY = 'market-replay:contextual-drawing-toolbar-position:v1'

export interface DrawingToolbarPosition {
  x: number
  y: number
}

interface DrawingToolbarPositionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const positionSchema = z.object({
  x: z.number().finite().min(0).max(100_000),
  y: z.number().finite().min(0).max(100_000),
})

function getBrowserStorage(): DrawingToolbarPositionStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

export function parseDrawingToolbarPosition(raw: string | null): DrawingToolbarPosition | null {
  if (!raw) return null
  try {
    const result = positionSchema.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function loadDrawingToolbarPosition(storage: DrawingToolbarPositionStorage | null = getBrowserStorage()): DrawingToolbarPosition | null {
  return storage ? parseDrawingToolbarPosition(storage.getItem(DRAWING_TOOLBAR_POSITION_STORAGE_KEY)) : null
}

export function persistDrawingToolbarPosition(position: DrawingToolbarPosition, storage: DrawingToolbarPositionStorage | null = getBrowserStorage()): void {
  if (!storage) return
  storage.setItem(DRAWING_TOOLBAR_POSITION_STORAGE_KEY, JSON.stringify(positionSchema.parse(position)))
}

export function loadContextualDrawingToolbarPosition(storage: DrawingToolbarPositionStorage | null = getBrowserStorage()): DrawingToolbarPosition | null {
  return storage ? parseDrawingToolbarPosition(storage.getItem(CONTEXTUAL_DRAWING_TOOLBAR_POSITION_STORAGE_KEY)) : null
}

export function persistContextualDrawingToolbarPosition(position: DrawingToolbarPosition, storage: DrawingToolbarPositionStorage | null = getBrowserStorage()): void {
  if (!storage) return
  storage.setItem(CONTEXTUAL_DRAWING_TOOLBAR_POSITION_STORAGE_KEY, JSON.stringify(positionSchema.parse(position)))
}
