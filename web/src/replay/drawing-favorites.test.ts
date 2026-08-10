import { describe, expect, it } from 'vitest'
import {
  DRAWING_FAVORITES_STORAGE_KEY,
  loadDrawingFavorites,
  parseDrawingFavorites,
  persistDrawingFavorites,
  toggleDrawingFavorite,
} from './drawing-favorites'

describe('drawing favorites', () => {
  it('validates, de-duplicates and rejects unsupported tool types', () => {
    expect(parseDrawingFavorites(JSON.stringify(['trend-line', 'trend-line', 'path']))).toEqual(['trend-line', 'path'])
    expect(parseDrawingFavorites(JSON.stringify(['trend-line', 'arrow']))).toEqual([])
    expect(parseDrawingFavorites('{bad')).toEqual([])
  })

  it('persists and toggles favorite tools', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value) },
    }
    const favorites = toggleDrawingFavorite(toggleDrawingFavorite([], 'fib-retracement'), 'path')
    persistDrawingFavorites(favorites, storage)

    expect(values.has(DRAWING_FAVORITES_STORAGE_KEY)).toBe(true)
    expect(loadDrawingFavorites(storage)).toEqual(['fib-retracement', 'path'])
    expect(toggleDrawingFavorite(favorites, 'fib-retracement')).toEqual(['path'])
  })
})
