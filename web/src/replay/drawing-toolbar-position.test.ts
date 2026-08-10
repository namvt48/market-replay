import { describe, expect, it } from 'vitest'
import {
  DRAWING_TOOLBAR_POSITION_STORAGE_KEY,
  loadDrawingToolbarPosition,
  parseDrawingToolbarPosition,
  persistDrawingToolbarPosition,
} from './drawing-toolbar-position'

describe('drawing toolbar position', () => {
  it('validates persisted chart-relative coordinates', () => {
    expect(parseDrawingToolbarPosition(JSON.stringify({ x: 180.5, y: 72 }))).toEqual({ x: 180.5, y: 72 })
    expect(parseDrawingToolbarPosition(JSON.stringify({ x: -1, y: 72 }))).toBeNull()
    expect(parseDrawingToolbarPosition(JSON.stringify({ x: 10, y: Number.POSITIVE_INFINITY }))).toBeNull()
    expect(parseDrawingToolbarPosition('{bad')).toBeNull()
  })

  it('persists and loads the position', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value) },
    }

    persistDrawingToolbarPosition({ x: 240, y: 96 }, storage)

    expect(values.has(DRAWING_TOOLBAR_POSITION_STORAGE_KEY)).toBe(true)
    expect(loadDrawingToolbarPosition(storage)).toEqual({ x: 240, y: 96 })
  })
})
