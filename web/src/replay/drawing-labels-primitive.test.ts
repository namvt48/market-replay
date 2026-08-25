import { describe, expect, it, vi } from 'vitest'
import type { IPrimitivePaneRenderer, SeriesAttachedParameter, Time } from 'lightweight-charts'
import type { IDrawing } from 'lightweight-charts-drawing'
import { drawLineWithLabelGap, inlineLabelPosition } from '../../vendor/lightweight-charts-drawing/src/rendering/canvas-utils'
import { extendLineToViewport } from '../../vendor/lightweight-charts-drawing/src/core/geometry'
import { DEFAULT_DRAWING_METADATA, DEFAULT_FIBONACCI_LEVELS, LINE_TOOL_TYPES } from './drawing-appearance'
import { DrawingLabelsPrimitive, drawingPriceLevels, priceAxisTextColor } from './drawing-labels-primitive'

function drawing(overrides: Partial<IDrawing> & Pick<IDrawing, 'id' | 'type' | 'anchors'>): IDrawing {
  return {
    style: { lineColor: '#f6a53a', lineWidth: 2 },
    options: { visible: true },
    state: 'normal',
    ...overrides,
  } as IDrawing
}

describe('drawingPriceLevels', () => {
  it('mirrors unique anchor prices with the drawing stroke color', () => {
    const levels = drawingPriceLevels(drawing({
      id: 'box',
      type: 'ellipse',
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
    const line = drawing({ id: 'line', type: 'horizontal-line', state: 'selected', anchors: [{ time: 1 as Time, price: 20_125.25 }] })
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

  it('only exposes drawing-colored price labels while the drawing is targeted', () => {
    const line = drawing({ id: 'line', type: 'horizontal-line', anchors: [{ time: 1 as Time, price: 20_125.25 }] })
    const primitive = new DrawingLabelsPrimitive(() => [line], (price) => price.toFixed(2))
    primitive.attached({
      chart: {},
      series: { priceToCoordinate: (price: number) => price - 20_000 },
      requestUpdate: vi.fn(),
    } as unknown as SeriesAttachedParameter<Time>)

    expect(primitive.priceAxisViews()).toHaveLength(0)

    line.state = 'selected'
    primitive.requestUpdate()
    expect(primitive.priceAxisViews()).toHaveLength(1)

    line.state = 'normal'
    primitive.requestUpdate()
    expect(primitive.priceAxisViews()).toHaveLength(0)
  })

  it('uses the foreground with the stronger contrast', () => {
    expect(priceAxisTextColor('#f6a53a')).toBe('#000000')
    expect(priceAxisTextColor('#2962ff')).toBe('#ffffff')
  })
})

describe('DrawingLabelsPrimitive pane renderer', () => {
  function render(target: Parameters<IPrimitivePaneRenderer['draw']>[0]) {
    const line = {
      id: 'box',
      type: 'ellipse',
      state: 'normal',
      style: { lineColor: '#2962ff', lineWidth: 2 },
      options: { visible: true, workbench: { text: 'Hello' } },
      anchors: [
        { time: 1 as Time, price: 100 },
        { time: 2 as Time, price: 200 },
      ],
    } as unknown as IDrawing
    const primitive = new DrawingLabelsPrimitive(() => [line])
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: () => 50 }) },
      series: { priceToCoordinate: () => 800 },
      requestUpdate: vi.fn(),
    } as never)
    const renderer = primitive.paneViews()[0]?.renderer()
    if (!renderer) throw new Error('missing pane renderer')
    renderer.draw(target as never)
    return renderer
  }

  function makeTarget(roundRect: ReturnType<typeof vi.fn>) {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), fill: vi.fn(), fillText: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), setLineDash: vi.fn(),
      measureText: vi.fn(() => ({ width: 40 })),
      roundRect,
    }
    return {
      context,
      target: {
        useBitmapCoordinateSpace: (draw: (scope: unknown) => void) => draw({
          context,
          horizontalPixelRatio: 1,
          verticalPixelRatio: 1,
          bitmapSize: { width: 200, height: 100 },
        }),
      },
    }
  }

  it('lets the label follow the drawing off-pane instead of pinning it to the chart edge', () => {
    const roundRect = vi.fn()
    const { target } = makeTarget(roundRect)
    render(target as never)

    expect(roundRect).toHaveBeenCalledOnce()
    const { 0: boxX, 1: boxY, 2: boxWidth, 3: boxHeight } = roundRect.mock.calls[0]
    expect(boxX).toBeCloseTo(24, 5)
    expect(boxY).toBeGreaterThan(100)
    expect(boxWidth).toBeCloseTo(52, 5)
    expect(boxHeight).toBeCloseTo(28.64, 5)
  })

  it('keeps the label fully visible while the drawing still intersects the pane', () => {
    const roundRect = vi.fn()
    const { target } = makeTarget(roundRect)
    const line = {
      id: 'near-bottom',
      type: 'ellipse',
      state: 'normal',
      style: { lineColor: '#2962ff', lineWidth: 2 },
      options: { visible: true, workbench: { text: 'Hello' } },
      anchors: [{ time: 1 as Time, price: 90 }],
    } as unknown as IDrawing
    const primitive = new DrawingLabelsPrimitive(() => [line])
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: () => 50 }) },
      series: { priceToCoordinate: () => 90 },
      requestUpdate: vi.fn(),
    } as never)
    primitive.paneViews()[0]?.renderer()?.draw(target as never)

    const { 1: boxY } = roundRect.mock.calls[0]
    expect(boxY).toBeGreaterThanOrEqual(0)
    expect(boxY).toBeLessThan(100)
  })

  it('lets a partially-dragged line take its label off-pane once the label position itself leaves the pane', () => {
    const roundRect = vi.fn()
    const { target } = makeTarget(roundRect)
    const line = {
      id: 'dragged-down',
      type: 'ellipse',
      state: 'editing',
      style: { lineColor: '#2962ff', lineWidth: 2 },
      options: { visible: true, workbench: { text: 'Hello' } },
      anchors: [
        { time: 1 as Time, price: 100 },
        { time: 2 as Time, price: 200 },
      ],
    } as unknown as IDrawing
    const primitive = new DrawingLabelsPrimitive(() => [line])
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: (time: Time) => (time === 1 ? 50 : 60) }) },
      series: { priceToCoordinate: (price: number) => (price - 100) * 25 + 90 },
      requestUpdate: vi.fn(),
    } as never)
    primitive.paneViews()[0]?.renderer()?.draw(target as never)

    const { 1: boxY } = roundRect.mock.calls[0]
    expect(boxY).toBeGreaterThan(100)
  })

  it('does not hold a floating label at the pane edge while it crosses out of view', () => {
    const roundRect = vi.fn()
    const { target } = makeTarget(roundRect)
    const line = {
      id: 'crossing-bottom-edge',
      type: 'ellipse',
      state: 'normal',
      style: { lineColor: '#2962ff', lineWidth: 2 },
      options: { visible: true, workbench: { text: 'Hello' } },
      anchors: [{ time: 1 as Time, price: 105 }],
    } as unknown as IDrawing
    const primitive = new DrawingLabelsPrimitive(() => [line])
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: () => 50 }) },
      series: { priceToCoordinate: () => 105 },
      requestUpdate: vi.fn(),
    } as never)
    primitive.paneViews()[0]?.renderer()?.draw(target as never)

    const { 1: boxY, 3: boxHeight } = roundRect.mock.calls[0]
    expect(boxY).toBeCloseTo(105 - boxHeight / 2, 5)
  })

  it.each(['trend-line', 'rectangle'] as const)('skips the floating box for %s, which renders its text inline instead', (type) => {
    const roundRect = vi.fn()
    const { target } = makeTarget(roundRect)
    const line = {
      id: 'trend',
      type,
      state: 'normal',
      style: { lineColor: '#2962ff', lineWidth: 2 },
      options: { visible: true, workbench: { text: 'Hello' } },
      anchors: [
        { time: 1 as Time, price: 100 },
        { time: 2 as Time, price: 200 },
      ],
    } as unknown as IDrawing
    const primitive = new DrawingLabelsPrimitive(() => [line])
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: () => 50 }) },
      series: { priceToCoordinate: () => 800 },
      requestUpdate: vi.fn(),
    } as never)
    primitive.paneViews()[0]?.renderer()?.draw(target as never)

    expect(roundRect).not.toHaveBeenCalled()
  })

  it('does not render line arrows or midpoint when timeframe visibility hides the drawing', () => {
    const roundRect = vi.fn()
    const { context, target } = makeTarget(roundRect)
    const line = {
      id: 'hidden-trend',
      type: 'trend-line',
      state: 'selected',
      style: { lineColor: '#2962ff', lineWidth: 2 },
      options: {
        visible: false,
        workbench: { ...DEFAULT_DRAWING_METADATA, lineStartStyle: 'arrow', lineEndStyle: 'arrow', showMiddlePoint: true },
      },
      anchors: [{ time: 1 as Time, price: 100 }, { time: 2 as Time, price: 200 }],
    } as unknown as IDrawing
    const primitive = new DrawingLabelsPrimitive(() => [line])
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: (time: Time) => Number(time) * 50 }) },
      series: { priceToCoordinate: (price: number) => price },
      requestUpdate: vi.fn(),
    } as never)

    primitive.paneViews()[0]?.renderer()?.draw(target as never)

    expect(context.moveTo).not.toHaveBeenCalled()
    expect(context.arc).not.toHaveBeenCalled()
    expect(context.fillText).not.toHaveBeenCalled()
  })

  it.each([
    ['trend-line', 'start', 'lineStartStyle', 100],
    ['trend-line', 'end', 'lineEndStyle', 200],
    ['ray', 'start', 'lineStartStyle', 100],
    ['ray', 'end', 'lineEndStyle', 200],
    ['info-line', 'start', 'lineStartStyle', 100],
    ['info-line', 'end', 'lineEndStyle', 200],
    ['extended-line', 'start', 'lineStartStyle', 100],
    ['extended-line', 'end', 'lineEndStyle', 200],
    ['trend-angle', 'start', 'lineStartStyle', 100],
    ['trend-angle', 'end', 'lineEndStyle', 200],
  ] as const)('places the %s %s arrow on the visual endpoint even when anchors were created right-to-left', (lineType, _side, property, expectedTipX) => {
    const roundRect = vi.fn()
    const { context, target } = makeTarget(roundRect)
    const line = {
      id: 'reverse-trend',
      type: lineType,
      state: 'selected',
      style: { lineColor: '#2962ff', lineWidth: 2 },
      options: {
        visible: true,
        workbench: { ...DEFAULT_DRAWING_METADATA, [property]: 'arrow' },
      },
      anchors: [{ time: 2 as Time, price: 20 }, { time: 1 as Time, price: 80 }],
    } as unknown as IDrawing
    const primitive = new DrawingLabelsPrimitive(() => [line])
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: (time: Time) => Number(time) * 100 }) },
      series: { priceToCoordinate: (price: number) => price },
      requestUpdate: vi.fn(),
    } as never)

    primitive.paneViews()[0]?.renderer()?.draw(target as never)

    expect(context.moveTo).toHaveBeenNthCalledWith(1, expectedTipX, property === 'lineStartStyle' ? 80 : 20)
  })

  it.each([
    ['horizontal-line', 'lineStartStyle', 0, 50],
    ['horizontal-line', 'lineEndStyle', 200, 50],
    ['horizontal-ray', 'lineStartStyle', 100, 50],
    ['horizontal-ray', 'lineEndStyle', 200, 50],
    ['vertical-line', 'lineStartStyle', 100, 0],
    ['vertical-line', 'lineEndStyle', 100, 100],
    ['cross-line', 'lineStartStyle', 0, 50],
    ['cross-line', 'lineEndStyle', 200, 50],
  ] as const)('places the %s endpoint arrow on its displayed primary segment', (lineType, property, expectedX, expectedY) => {
    const roundRect = vi.fn()
    const { context, target } = makeTarget(roundRect)
    const line = {
      id: lineType,
      type: lineType,
      state: 'selected',
      style: { lineColor: '#2962ff', lineWidth: 2 },
      options: {
        visible: true,
        workbench: { ...DEFAULT_DRAWING_METADATA, [property]: 'arrow' },
      },
      anchors: [{ time: 1 as Time, price: 50 }],
    } as unknown as IDrawing
    const primitive = new DrawingLabelsPrimitive(() => [line])
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: () => 100 }) },
      series: { priceToCoordinate: () => 50 },
      requestUpdate: vi.fn(),
    } as never)

    primitive.paneViews()[0]?.renderer()?.draw(target as never)

    expect(context.moveTo).toHaveBeenNthCalledWith(1, expectedX, expectedY)
  })

  it.each([
    ['horizontal-line', 100, 50],
    ['horizontal-ray', 150, 50],
    ['vertical-line', 100, 50],
    ['cross-line', 100, 50],
  ] as const)('renders the %s midpoint control on its displayed primary segment', (lineType, expectedX, expectedY) => {
    const roundRect = vi.fn()
    const { context, target } = makeTarget(roundRect)
    const line = {
      id: lineType,
      type: lineType,
      state: 'selected',
      style: { lineColor: '#2962ff', lineWidth: 2 },
      options: {
        visible: true,
        workbench: { ...DEFAULT_DRAWING_METADATA, showMiddlePoint: true },
      },
      anchors: [{ time: 1 as Time, price: 50 }],
    } as unknown as IDrawing
    const primitive = new DrawingLabelsPrimitive(() => [line])
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: () => 100 }) },
      series: { priceToCoordinate: () => 50 },
      requestUpdate: vi.fn(),
    } as never)

    primitive.paneViews()[0]?.renderer()?.draw(target as never)

    expect(context.arc).toHaveBeenCalledWith(expectedX, expectedY, 4, 0, Math.PI * 2)
  })

  it('skips the floating box for every line tool, which renders text inline on the line', () => {
    for (const lineType of LINE_TOOL_TYPES) {
      const roundRect = vi.fn()
      const { target } = makeTarget(roundRect)
      const drawing = {
        id: lineType,
        type: lineType,
        state: 'normal',
        style: { lineColor: '#2962ff', lineWidth: 2 },
        options: { visible: true, workbench: { text: 'Hello' } },
        anchors: [
          { time: 1 as Time, price: 100 },
          { time: 2 as Time, price: 200 },
        ],
      } as unknown as IDrawing
      const primitive = new DrawingLabelsPrimitive(() => [drawing])
      primitive.attached({
        chart: { timeScale: () => ({ timeToCoordinate: () => 50 }) },
        series: { priceToCoordinate: () => 800 },
        requestUpdate: vi.fn(),
      } as never)
      primitive.paneViews()[0]?.renderer()?.draw(target as never)

      expect(roundRect, `${lineType} renders inline text and must not draw a floating box`).not.toHaveBeenCalled()
    }
  })
})

describe('drawLineWithLabelGap positioning', () => {
  it('places left and right aligned inline text at the corresponding line endpoint', () => {
    const start = { x: 20, y: 80 }
    const end = { x: 180, y: 20 }

    expect(inlineLabelPosition(start, end, 'left')).toEqual(start)
    expect(inlineLabelPosition(start, end, 'center')).toEqual({ x: 100, y: 50 })
    expect(inlineLabelPosition(start, end, 'right')).toEqual(end)
  })

  it('uses visual left and right endpoints when the line was drawn in reverse order', () => {
    const rightAnchor = { x: 180, y: 20 }
    const leftAnchor = { x: 20, y: 80 }

    expect(inlineLabelPosition(rightAnchor, leftAnchor, 'left')).toEqual(leftAnchor)
    expect(inlineLabelPosition(rightAnchor, leftAnchor, 'center')).toEqual({ x: 100, y: 50 })
    expect(inlineLabelPosition(rightAnchor, leftAnchor, 'right')).toEqual(rightAnchor)
  })

  it('rotates inline text parallel to the line while keeping it upright', () => {
    const rotate = vi.fn()
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      translate: vi.fn(), rotate,
      measureText: vi.fn(() => ({ width: 40 })), fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D

    drawLineWithLabelGap(
      context,
      { x: 20, y: 80 },
      { x: 180, y: 20 },
      { text: 'test', center: { x: 100, y: 50 } },
    )

    expect(rotate).toHaveBeenCalledWith(Math.atan2(-60, 160))
  })

  it('extends a reverse-drawn line without dropping its original segment', () => {
    const rightAnchor = { x: 180, y: 20 }
    const leftAnchor = { x: 20, y: 80 }

    expect(extendLineToViewport(rightAnchor, leftAnchor, 200, 100, true, false)).toEqual({
      start: { x: 0, y: 87.5 },
      end: rightAnchor,
    })
    expect(extendLineToViewport(rightAnchor, leftAnchor, 200, 100, false, true)).toEqual({
      start: leftAnchor,
      end: { x: 200, y: 12.5 },
    })
  })

  it('still draws endpoint-aligned text when there is no room to split the line around it', () => {
    const fillText = vi.fn()
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      translate: vi.fn(), rotate: vi.fn(),
      measureText: vi.fn(() => ({ width: 70 })), fillText,
    } as unknown as CanvasRenderingContext2D
    const start = { x: 20, y: 80 }
    const end = { x: 180, y: 20 }

    drawLineWithLabelGap(context, start, end, { text: 'ALIGNMENT', center: start })

    expect(fillText).toHaveBeenCalledWith('ALIGNMENT', 20, 80)
  })

  it('keeps inline line text attached to an off-pane line instead of pinning it to the edge', () => {
    const fillText = vi.fn()
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      translate: vi.fn(), rotate: vi.fn(),
      measureText: vi.fn(() => ({ width: 40 })), fillText,
    } as unknown as CanvasRenderingContext2D

    drawLineWithLabelGap(
      context,
      { x: -300, y: 50 },
      { x: -100, y: 50 },
      { text: 'Hello', center: { x: -200, y: 50 }, bounds: { width: 200, height: 100 } },
    )

    expect(fillText).toHaveBeenCalledWith('Hello', -200, 50)
  })

  it('offsets the label above the line and keeps the stroke continuous for verticalPosition top', () => {
    const fillText = vi.fn()
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      translate: vi.fn(), rotate: vi.fn(),
      measureText: vi.fn(() => ({ width: 40 })), fillText,
    } as unknown as CanvasRenderingContext2D

    drawLineWithLabelGap(
      context,
      { x: -100, y: 100 },
      { x: 100, y: 100 },
      { text: 'Hello', center: { x: 0, y: 100 }, verticalPosition: 'top' },
    )

    // dx=200, length=200 → ux=1, uy=0. Perp of (1,0) pointing up is (uy,-ux)·dir
    // = (0,-1)·(+1) → text at (0, 100-10).
    expect(fillText).toHaveBeenCalledWith('Hello', 0, 90)
    // Continuous stroke: one segment start→end, no gap splitting.
    expect(context.moveTo).toHaveBeenNthCalledWith(1, -100, 100)
    expect(context.lineTo).toHaveBeenNthCalledWith(1, 100, 100)
    expect(context.lineTo).toHaveBeenCalledTimes(1)
  })

  it('offsets the label below the line and keeps the stroke continuous for verticalPosition bottom', () => {
    const fillText = vi.fn()
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      translate: vi.fn(), rotate: vi.fn(),
      measureText: vi.fn(() => ({ width: 40 })), fillText,
    } as unknown as CanvasRenderingContext2D

    drawLineWithLabelGap(
      context,
      { x: -100, y: 100 },
      { x: 100, y: 100 },
      { text: 'Hello', center: { x: 0, y: 100 }, verticalPosition: 'bottom' },
    )

    // Perp direction -1 → text at (0, 100+10).
    expect(fillText).toHaveBeenCalledWith('Hello', 0, 110)
    expect(context.lineTo).toHaveBeenCalledTimes(1)
  })

  it('splits the stroke around the label while centered on the line (inside, default)', () => {
    const fillText = vi.fn()
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      translate: vi.fn(), rotate: vi.fn(),
      measureText: vi.fn(() => ({ width: 40 })), fillText,
    } as unknown as CanvasRenderingContext2D

    drawLineWithLabelGap(
      context,
      { x: -100, y: 100 },
      { x: 100, y: 100 },
      { text: 'Hello', center: { x: 0, y: 100 } },
    )

    expect(fillText).toHaveBeenCalledWith('Hello', 0, 100)
    // Two segments: start→gapStart and gapEnd→end.
    expect(context.lineTo).toHaveBeenCalledTimes(2)
  })
})
