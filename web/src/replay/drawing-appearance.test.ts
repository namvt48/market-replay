import { describe, expect, it } from 'vitest'
import { FibRetracement } from 'lightweight-charts-drawing'
import type { UTCTimestamp } from 'lightweight-charts'
import {
  DEFAULT_DRAWING_METADATA,
  appearanceOptions,
  clampOpacity,
  colorWithOpacity,
  isHexColor,
  lineDashFor,
  mergeDrawingAppearance,
  normalizeFibonacciLevels,
  normalizeHexColor,
  type DrawingAppearance,
} from './drawing-appearance'

describe('drawing appearance utilities', () => {
  it('validates and expands hex colors', () => {
    expect(isHexColor('#E9A23B')).toBe(true)
    expect(isHexColor('#ea3')).toBe(true)
    expect(isHexColor('orange')).toBe(false)
    expect(normalizeHexColor('#EA3', '#000000')).toBe('#eeaa33')
  })

  it('creates deterministic rgba colors with clamped opacity', () => {
    expect(colorWithOpacity('#e9a23b', 0.4)).toBe('rgba(233, 162, 59, 0.4)')
    expect(colorWithOpacity('#000000', 4)).toBe('rgba(0, 0, 0, 1)')
    expect(clampOpacity(-1)).toBe(0)
  })

  it('maps the three supported border styles', () => {
    expect(lineDashFor('solid')).toEqual([])
    expect(lineDashFor('dashed')).toEqual([8, 6])
    expect(lineDashFor('dotted')).toEqual([2, 5])
  })

  it('normalizes and maps all 24 Fibonacci level slots to drawing options', () => {
    const levels = normalizeFibonacciLevels([{ value: 0.25, visible: true, color: '#ABCDEF' }])
    const drawing: DrawingAppearance = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'fib-1',
      type: 'fib-retracement',
      lineWidth: 2,
      extendLeft: false,
      extendRight: false,
      supportsExtend: true,
      fibonacciLevels: levels,
    }
    const merged = mergeDrawingAppearance(drawing, { fibonacciExtend: true, fibonacciLevelDecimals: 20 })

    expect(merged.fibonacciLevels).toHaveLength(24)
    expect(merged.fibonacciLevels[0]).toEqual({ value: 0.25, visible: true, color: '#abcdef' })
    expect(merged.fibonacciLevelDecimals).toBe(8)
    expect(appearanceOptions(merged)).toMatchObject({
      extendLines: true,
      levelDecimals: 8,
      labelPosition: 'right',
      levelSettings: expect.arrayContaining([expect.objectContaining({ value: 0.25, color: '#abcdef' })]),
    })
  })

  it('keeps custom Fibonacci settings in the renderer and serialized drawing', () => {
    const fibonacci = new FibRetracement('fib-1', [{ time: 1 as UTCTimestamp, price: 100 }, { time: 2 as UTCTimestamp, price: 120 }])
    const levelSettings = normalizeFibonacciLevels([{ value: 0.42, visible: true, color: '#112233' }])

    fibonacci.updateOptions({ levelSettings, extendLines: true, levelDecimals: 4, labelPosition: 'left', labelFontSize: 14 })

    expect(fibonacci.fibOptions).toMatchObject({ extendLines: true, levelDecimals: 4, labelPosition: 'left', labelFontSize: 14 })
    expect(fibonacci.fibOptions.levelSettings?.[0]).toEqual({ value: 0.42, visible: true, color: '#112233' })
    expect(fibonacci.toJSON().options).toMatchObject({ extendLines: true, levelDecimals: 4, labelPosition: 'left' })
  })
})
