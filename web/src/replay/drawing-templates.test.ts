import { describe, expect, it } from 'vitest'
import { DEFAULT_DRAWING_METADATA, type DrawingAppearance } from './drawing-appearance'
import {
  DRAWING_TEMPLATES_STORAGE_KEY,
  deleteDrawingTemplate,
  loadDrawingTemplates,
  parseDrawingTemplates,
  persistDrawingTemplates,
  saveNamedDrawingTemplate,
} from './drawing-templates'

const drawing: DrawingAppearance = {
  ...DEFAULT_DRAWING_METADATA,
  id: 'drawing-1', type: 'trend-line', lineWidth: 2, extendLeft: false, extendRight: true, supportsExtend: true,
  strokeColor: '#e9a23b', strokeOpacity: 1, borderStyle: 'solid', fillColor: '#e9a23b', fillOpacity: 0.12,
  text: 'Breakout', textColor: '#e8edf0', textOpacity: 1, backgroundColor: '#070d12', backgroundOpacity: 0.82,
  horizontalAlign: 'center', verticalAlign: 'inside', bold: true, italic: false, fontSize: 12,
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
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value) },
    }
    const saved = saveNamedDrawingTemplate([], 'Trend default', drawing, 100, () => 'template-1')
    persistDrawingTemplates(saved, storage)

    expect(values.has(DRAWING_TEMPLATES_STORAGE_KEY)).toBe(true)
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
    })
  })
})
