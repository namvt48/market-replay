import { z } from 'zod'
import { preferenceStorage } from '../store/preference-sync'

export const DRAWING_FAVORITES_STORAGE_KEY = 'market-replay:drawing-favorites:v1'

export const DRAWING_FAVORITE_TOOL_TYPES = [
  'trend-line',
  'ray',
  'info-line',
  'extended-line',
  'horizontal-line',
  'horizontal-ray',
  'vertical-line',
  'fib-retracement',
  'rectangle',
  'path',
  'text-annotation',
  'date-price-range',
] as const

export type DrawingFavoriteToolType = typeof DRAWING_FAVORITE_TOOL_TYPES[number]

interface DrawingFavoritesStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const favoritesSchema = z.array(z.enum(DRAWING_FAVORITE_TOOL_TYPES)).max(DRAWING_FAVORITE_TOOL_TYPES.length)

function getBrowserStorage(): DrawingFavoritesStorage | null {
  return typeof window === 'undefined' ? null : preferenceStorage
}

export function parseDrawingFavorites(raw: string | null): DrawingFavoriteToolType[] {
  if (!raw) return []
  try {
    const result = favoritesSchema.safeParse(JSON.parse(raw))
    return result.success ? [...new Set(result.data)] : []
  } catch {
    return []
  }
}

export function loadDrawingFavorites(storage: DrawingFavoritesStorage | null = getBrowserStorage()): DrawingFavoriteToolType[] {
  return storage ? parseDrawingFavorites(storage.getItem(DRAWING_FAVORITES_STORAGE_KEY)) : []
}

export function persistDrawingFavorites(favorites: DrawingFavoriteToolType[], storage: DrawingFavoritesStorage | null = getBrowserStorage()): void {
  if (!storage) return
  const validated = favoritesSchema.parse([...new Set(favorites)])
  storage.setItem(DRAWING_FAVORITES_STORAGE_KEY, JSON.stringify(validated))
}

export function toggleDrawingFavorite(favorites: DrawingFavoriteToolType[], type: DrawingFavoriteToolType): DrawingFavoriteToolType[] {
  return favorites.includes(type) ? favorites.filter((favorite) => favorite !== type) : [...favorites, type]
}
