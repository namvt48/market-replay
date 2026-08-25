import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_DRAWING_METADATA, type DrawingAppearance } from './drawing-appearance'

const api = vi.hoisted(() => ({
  fetchDrawingTemplates: vi.fn(),
  putDrawingTemplate: vi.fn().mockResolvedValue(undefined),
  deleteDrawingTemplateRemote: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../api/client', () => api)

const {
  DRAWING_TEMPLATES_STORAGE_KEY,
  defaultDrawingTemplateAppearance,
  deleteDrawingTemplate,
  hydrateDrawingTemplates,
  loadDrawingTemplates,
  parseDrawingTemplates,
  persistDrawingTemplates,
  saveNamedDrawingTemplate,
  syncDrawingTemplateDelete,
  syncDrawingTemplateUpsert,
} = await import('./drawing-templates')

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => { values.set(key, value) },
  }
}

const drawing: DrawingAppearance = {
  ...DEFAULT_DRAWING_METADATA,
  id: 'drawing-1', type: 'trend-line', lineWidth: 2, extendLeft: false, extendRight: true, supportsExtend: true,
  strokeColor: '#e9a23b', strokeOpacity: 1, borderStyle: 'solid', fillColor: '#e9a23b', fillOpacity: 0.12,
  text: 'Breakout', textColor: '#e8edf0', textOpacity: 1, backgroundColor: '#070d12', backgroundOpacity: 0.82,
  horizontalAlign: 'center', verticalAlign: 'inside', bold: true, italic: false, fontSize: 13,
}

describe('drawing templates', () => {
  it('saves a named template and replaces a same-name template for the same tool', () => {
    const first = saveNamedDrawingTemplate([], 'My breakout', drawing, 100, () => 'template-1')
    const updated = saveNamedDrawingTemplate(first, ' my BREAKOUT ', { ...drawing, lineWidth: 4 }, 200, () => 'unused')

    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({ id: 'template-1', name: 'my BREAKOUT', toolType: 'trend-line', createdAt: 100, updatedAt: 200 })
    expect(updated[0].appearance.lineWidth).toBe(4)
  })

  it('persists, validates and deletes templates without geometry', () => {
    const storage = memoryStorage()
    const saved = saveNamedDrawingTemplate([], 'Trend default', drawing, 100, () => 'template-1')
    persistDrawingTemplates(saved, storage)

    expect(storage.getItem(DRAWING_TEMPLATES_STORAGE_KEY)).not.toBeNull()
    expect(loadDrawingTemplates(storage)).toEqual(saved)
    expect(deleteDrawingTemplate(saved, 'template-1')).toEqual([])
    expect(saved[0].appearance).not.toHaveProperty('id')
    expect(saved[0].appearance).not.toHaveProperty('type')
  })

  it('returns an empty list for corrupt or schema-invalid storage', () => {
    expect(parseDrawingTemplates('{oops')).toEqual([])
    expect(parseDrawingTemplates(JSON.stringify([{ id: 'bad' }]))).toEqual([])
  })

  it('adds display defaults when loading templates saved before the new drawing options', () => {
    const [saved] = saveNamedDrawingTemplate([], 'Legacy rectangle', drawing, 100, () => 'template-1')
    const {
      rectangleMiddleLine: _rectangleMiddleLine,
      rectangleMiddleLineColor: _rectangleMiddleLineColor,
      rectangleMiddleLineOpacity: _rectangleMiddleLineOpacity,
      rectangleMiddleLineWidth: _rectangleMiddleLineWidth,
      rectangleMiddleLineStyle: _rectangleMiddleLineStyle,
      fibonacciDiagonalLine: _fibonacciDiagonalLine,
      fibonacciLabelVerticalPosition: _fibonacciLabelVerticalPosition,
      fibonacciReverse: _fibonacciReverse,
      fibonacciPrices: _fibonacciPrices,
      fibonacciLevelLabels: _fibonacciLevelLabels,
      fibonacciLevelFormat: _fibonacciLevelFormat,
      fibonacciTextVisible: _fibonacciTextVisible,
      fibonacciTrendLineColor: _fibonacciTrendLineColor,
      fibonacciTrendLineOpacity: _fibonacciTrendLineOpacity,
      fibonacciTrendLineWidth: _fibonacciTrendLineWidth,
      fibonacciTrendLineStyle: _fibonacciTrendLineStyle,
      ...legacyAppearance
    } = saved.appearance
    const parsed = parseDrawingTemplates(JSON.stringify([{ ...saved, appearance: legacyAppearance }]))

    expect(parsed[0].appearance).toMatchObject({
      rectangleMiddleLine: false,
      rectangleMiddleLineColor: '#2962ff',
      rectangleMiddleLineOpacity: 1,
      rectangleMiddleLineWidth: 1,
      rectangleMiddleLineStyle: 'solid',
      fibonacciDiagonalLine: true,
      fibonacciLabelVerticalPosition: 'middle',
      fibonacciReverse: false,
      fibonacciPrices: true,
      fibonacciLevelLabels: true,
      fibonacciLevelFormat: 'values',
      fibonacciTextVisible: false,
      fibonacciTrendLineColor: '#787b86',
      fibonacciTrendLineOpacity: 1,
      fibonacciTrendLineWidth: 1,
      fibonacciTrendLineStyle: 'dashed',
    })
  })
})

describe('hydrateDrawingTemplates', () => {
  it('seeds the local cache from the backend', async () => {
    const storage = memoryStorage()
    api.fetchDrawingTemplates.mockResolvedValue([
      { id: 't1', toolType: 'trend-line', name: 'Remote', appearance: defaultDrawingTemplateAppearance(drawing), createdAt: 100, updatedAt: 100 },
    ])

    await hydrateDrawingTemplates(storage)

    const loaded = loadDrawingTemplates(storage)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({ id: 't1', name: 'Remote', toolType: 'trend-line' })
  })

  it('leaves the local cache untouched when the backend is unreachable', async () => {
    const storage = memoryStorage()
    const seeded = saveNamedDrawingTemplate([], 'Local only', drawing, 100, () => 'template-1')
    persistDrawingTemplates(seeded, storage)
    api.fetchDrawingTemplates.mockRejectedValue(new Error('offline'))

    // Must resolve, not reject: boot is gated on it (see main.tsx).
    await expect(hydrateDrawingTemplates(storage)).resolves.toBeUndefined()
    expect(loadDrawingTemplates(storage)).toEqual(seeded)
  })

  it('leaves the local cache untouched when the backend response fails validation', async () => {
    const storage = memoryStorage()
    const seeded = saveNamedDrawingTemplate([], 'Local only', drawing, 100, () => 'template-1')
    persistDrawingTemplates(seeded, storage)
    api.fetchDrawingTemplates.mockResolvedValue([{ id: 'bad' }])

    await hydrateDrawingTemplates(storage)

    expect(loadDrawingTemplates(storage)).toEqual(seeded)
  })
})

describe('syncDrawingTemplateUpsert / syncDrawingTemplateDelete', () => {
  it('fires a PUT with the saved template', async () => {
    const [saved] = saveNamedDrawingTemplate([], 'My breakout', drawing, 100, () => 'template-1')

    syncDrawingTemplateUpsert(saved)
    await vi.waitFor(() => expect(api.putDrawingTemplate).toHaveBeenCalledWith(saved))
  })

  it('fires a DELETE with the id', async () => {
    syncDrawingTemplateDelete('template-1')
    await vi.waitFor(() => expect(api.deleteDrawingTemplateRemote).toHaveBeenCalledWith('template-1'))
  })

  it('does not throw when the backend rejects the upsert', () => {
    api.putDrawingTemplate.mockRejectedValueOnce(new Error('offline'))
    const [saved] = saveNamedDrawingTemplate([], 'My breakout', drawing, 100, () => 'template-1')
    expect(() => syncDrawingTemplateUpsert(saved)).not.toThrow()
  })

  it('does not throw when the backend rejects the delete', () => {
    api.deleteDrawingTemplateRemote.mockRejectedValueOnce(new Error('offline'))
    expect(() => syncDrawingTemplateDelete('template-1')).not.toThrow()
  })
})
