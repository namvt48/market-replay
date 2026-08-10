import { describe, expect, it, vi } from 'vitest'
import type { SeriesAttachedParameter, Time } from 'lightweight-charts'
import type { IDrawing } from 'lightweight-charts-drawing'
import { DEFAULT_FIBONACCI_LEVELS } from './drawing-appearance'
import { DrawingLabelsPrimitive, drawingPriceLevels, priceAxisTextColor } from './drawing-labels-primitive'

function drawing(overrides: Partial<IDrawing> & Pick<IDrawing, 'id' | 'type' | 'anchors'>): IDrawing {
  return {
    style: { lineColor: '#f6a53a', lineWidth: 2 },
    options: { visible: true },
    ...overrides,
  } as IDrawing
}

describe('drawingPriceLevels', () => {
  it('mirrors unique anchor prices with the drawing stroke color', () => {
    const levels = drawingPriceLevels(drawing({
      id: 'box',
      type: 'rectangle',
      anchors: [
        { time: 1 as Time, price: 20_125.25 },
        { time: 2 as Time, price: 20_100 },
        { time: 3 as Time, price: 20_125.25 },
      ],
    }))

    expect(levels).toEqual([
      { price: 20_125.25, color: '#f6a53a' },
      { price: 20_100, color: '#f6a53a' },
    ])
  })

  it('does not add price-scale noise for time-only, freehand, or hidden drawings', () => {
    const anchor = [{ time: 1 as Time, price: 100 }]
    expect(drawingPriceLevels(drawing({ id: 'vertical', type: 'vertical-line', anchors: anchor }))).toEqual([])
    expect(drawingPriceLevels(drawing({ id: 'brush', type: 'brush', anchors: anchor }))).toEqual([])
    expect(drawingPriceLevels(drawing({ id: 'hidden', type: 'horizontal-line', anchors: anchor, options: { visible: false } }))).toEqual([])
  })

  it('projects every visible Fibonacci retracement level with its own line color', () => {
    const levels = DEFAULT_FIBONACCI_LEVELS.map((level) => ({ ...level, visible: level.value === 0 || level.value === 0.5 || level.value === 1 }))
    const projected = drawingPriceLevels(drawing({
      id: 'fib',
      type: 'fib-retracement',
      anchors: [{ time: 1 as Time, price: 100 }, { time: 2 as Time, price: 120 }],
      options: { visible: true, levelSettings: levels },
    } as Partial<IDrawing> & Pick<IDrawing, 'id' | 'type' | 'anchors'>))

    expect(projected).toEqual([
      { price: 100, color: '#787b86' },
      { price: 110, color: '#089981' },
      { price: 120, color: '#787b86' },
    ])
  })
})

describe('DrawingLabelsPrimitive price-axis views', () => {
  it('formats the right-axis price and keeps the cached array until a level changes', () => {
    const line = drawing({ id: 'line', type: 'horizontal-line', anchors: [{ time: 1 as Time, price: 20_125.25 }] })
    const requestUpdate = vi.fn()
    const primitive = new DrawingLabelsPrimitive(() => [line], (price) => price.toFixed(2))
    primitive.attached({
      chart: {},
      series: { priceToCoordinate: (price: number) => price - 20_000 },
      requestUpdate,
    } as unknown as SeriesAttachedParameter<Time>)

    const initial = primitive.priceAxisViews()
    expect(initial).toHaveLength(1)
    expect(initial[0].text()).toBe('20125.25')
    expect(initial[0].coordinate()).toBe(125.25)
    expect(initial[0].backColor()).toBe('#f6a53a')
    expect(initial[0].textColor()).toBe('#000000')

    primitive.requestUpdate()
    expect(primitive.priceAxisViews()).toBe(initial)
    expect(requestUpdate).toHaveBeenCalledOnce()

    line.anchors[0].price = 20_130
    primitive.requestUpdate()
    expect(primitive.priceAxisViews()).not.toBe(initial)
    expect(primitive.priceAxisViews()[0].text()).toBe('20130.00')
  })

  it('uses the foreground with the stronger contrast', () => {
    expect(priceAxisTextColor('#f6a53a')).toBe('#000000')
    expect(priceAxisTextColor('#2962ff')).toBe('#ffffff')
  })
})
