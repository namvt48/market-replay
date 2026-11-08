import { describe, expect, it, vi } from 'vitest'
import { IndicatorDrawingsPrimitive } from './indicator-drawings-primitive'

describe('IndicatorDrawingsPrimitive', () => {
  it('renders vertical session boundaries and point markers from backend intents', () => {
    const requestUpdate = vi.fn()
    const priceToCoordinate = vi.fn((price: number) => price)
    const primitive = new IndicatorDrawingsPrimitive()
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: (time: number) => time, getVisibleRange: () => ({ from: 0, to: 100 }) }) },
      series: { priceToCoordinate },
      requestUpdate,
    } as never)
    primitive.setDraws([
      { id: 1, kind: 'vline', t0: 10, y0: Number.NaN, style: { linecolor: '#898c96', linestyle: 1 } },
      { id: 2, kind: 'marker', t0: 20, y0: 40, style: { color: '#ff5563', char: '⮝' } },
    ])
    const context = {
      save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
    }
    const target = {
      useBitmapCoordinateSpace: (draw: (scope: unknown) => void) => draw({
        context,
        horizontalPixelRatio: 1,
        verticalPixelRatio: 1,
        bitmapSize: { width: 200, height: 100 },
      }),
    }

    const renderer = primitive.paneViews()[0]?.renderer()
    expect(renderer).not.toBeNull()
    if (renderer === null || renderer === undefined) throw new Error('Expected indicator pane renderer')
    renderer.draw(target as never)

    expect(primitive.draws).toHaveLength(2)
    expect(context.moveTo).toHaveBeenCalledWith(10.5, 0)
    expect(context.lineTo).toHaveBeenCalledWith(10.5, 100)
    expect(context.fillText).toHaveBeenCalledWith('⮝', 20, 36)
    expect(priceToCoordinate).toHaveBeenCalledOnce()
    expect(requestUpdate).toHaveBeenCalledOnce()
  })
  it('draws finite lines at logical bar offsets and fills chart backgrounds', () => {
    const primitive = new IndicatorDrawingsPrimitive()
    primitive.attached({
      chart: { timeScale: () => ({
        timeToCoordinate: () => null,
        timeToIndex: (time: number) => time,
        logicalToCoordinate: (index: number) => index * 5,
        getVisibleRange: () => ({ from: 0, to: 100 }),
      }) },
      series: { priceToCoordinate: (price: number) => price },
      requestUpdate: vi.fn(),
    } as never)
    primitive.setDraws([
      { id: 1, kind: 'line', t0: 10, y0: 20, t1: 20, y1: 40, xOffset0: 2, xOffset1: -1, style: { lineWidth: 2, lineStyle: 'dashed', text: 'trace' } },
      { id: 2, kind: 'rectangle', t0: 30, y0: 50, t1: 40, y1: 60, style: { display: 'background', fillColor: '#abcdef' } },
    ])
    const context = {
      save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
      fillRect: vi.fn(), strokeRect: vi.fn(),
    }
    primitive.paneViews()[0]!.renderer()!.draw({
      useBitmapCoordinateSpace: (draw: (scope: unknown) => void) => draw({
        context, horizontalPixelRatio: 1, verticalPixelRatio: 1, bitmapSize: { width: 200, height: 100 },
      }),
    } as never)

    expect(context.moveTo).toHaveBeenCalledWith(60, 20)
    expect(context.lineTo).toHaveBeenCalledWith(95, 40)
    expect(context.fillText).toHaveBeenCalledWith('trace', 98, 37)
    expect(context.setLineDash).toHaveBeenCalledWith([5, 4])
    expect(context.fillRect).toHaveBeenCalledWith(150, 0, 50, 100)
  })


  it('culls offscreen point draws while retaining rays and rectangles that intersect the viewport', () => {
    const primitive = new IndicatorDrawingsPrimitive()
    primitive.attached({
      chart: { timeScale: () => ({ getVisibleRange: () => ({ from: 10, to: 20 }) }) },
      series: { priceToCoordinate: (price: number) => price },
      requestUpdate: vi.fn(),
    } as never)
    primitive.setDraws([
      { id: 1, kind: 'marker', t0: 9, y0: 1, style: {} },
      { id: 2, kind: 'marker', t0: 10, y0: 2, style: {} },
      { id: 3, kind: 'ray', t0: 5, y0: 3, style: {} },
      { id: 4, kind: 'ray', t0: 21, y0: 4, style: {} },
      { id: 5, kind: 'rectangle', t0: 8, y0: 5, t1: 12, y1: 6, style: {} },
      { id: 6, kind: 'rectangle', t0: 21, y0: 7, t1: 24, y1: 8, style: {} },
    ])

    expect(primitive.visibleDraws().map((draw) => draw.id)).toEqual([2, 3, 5])
  })

  it('keeps GB69 rays and extended zones visible after their anchors leave loaded replay history', () => {
    const primitive = new IndicatorDrawingsPrimitive()
    primitive.attached({
      chart: { timeScale: () => ({
        getVisibleRange: () => ({ from: 100, to: 200 }),
        timeToCoordinate: (time: number) => time >= 100 && time <= 200 ? time - 100 : null,
        timeToIndex: (_time: number) => 0,
        logicalToCoordinate: (index: number) => index,
      }) },
      series: { priceToCoordinate: (price: number) => price },
      requestUpdate: vi.fn(),
    } as never)
    primitive.setDraws([
      { id: 1, kind: 'ray', t0: 50, y0: 40, label: 'GB1-EQ', style: {} },
      { id: 2, kind: 'rectangle', t0: 50, t1: 50, y0: 20, y1: 30, style: { extendRight: true } },
      { id: 3, kind: 'rectangle', t0: 50, t1: 150, y0: 60, y1: 70, style: {} },
      { id: 4, kind: 'ray', t0: 250, y0: 80, label: 'future', style: {} },
    ])
    const context = {
      save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
      fillRect: vi.fn(), strokeRect: vi.fn(),
    }
    primitive.paneViews()[0]!.renderer()!.draw({
      useBitmapCoordinateSpace: (draw: (scope: unknown) => void) => draw({
        context, horizontalPixelRatio: 1, verticalPixelRatio: 1, bitmapSize: { width: 100, height: 100 },
      }),
    } as never)

    expect(context.moveTo).toHaveBeenCalledWith(0, 40.5)
    expect(context.lineTo).toHaveBeenCalledWith(100, 40.5)
    expect(context.fillText).toHaveBeenCalledWith('GB1-EQ', 3, 37.5)
    expect(context.fillRect).toHaveBeenCalledWith(0, 20, 100, 10)
    expect(context.fillRect).toHaveBeenCalledWith(0, 60, 50, 10)
    expect(context.fillText).not.toHaveBeenCalledWith('future', expect.anything(), expect.anything())
  })
  it('places an Open Time ray label at the pane right edge when requested', () => {
    const primitive = new IndicatorDrawingsPrimitive()
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: (time: number) => time, getVisibleRange: () => ({ from: 0, to: 100 }) }) },
      series: { priceToCoordinate: (price: number) => price },
      requestUpdate: vi.fn(),
    } as never)
    primitive.setDraws([
      { id: 1, kind: 'ray', t0: 10, y0: 40, label: '08:30', style: { labelPosition: 'right', textAlign: 'right' } },
    ])
    const context = {
      save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
      textAlign: 'left',
    }
    const renderer = primitive.paneViews()[0]?.renderer()
    if (!renderer) throw new Error('Expected ray pane renderer')
    renderer.draw({
      useBitmapCoordinateSpace: (draw: (scope: unknown) => void) => draw({
        context, horizontalPixelRatio: 1, verticalPixelRatio: 1, bitmapSize: { width: 100, height: 100 },
      }),
    } as never)

    expect(context.lineTo).toHaveBeenCalledWith(100, 40.5)
    expect(context.fillText).toHaveBeenCalledWith('08:30', 95, 37.5)
    expect(context.textAlign).toBe('right')
  })
  it('keeps screen-anchored text visible and renders it without chart coordinates', () => {
    const priceToCoordinate = vi.fn(() => null)
    const primitive = new IndicatorDrawingsPrimitive()
    primitive.attached({
      chart: { timeScale: () => ({ getVisibleRange: () => ({ from: 0, to: 10 }) }) },
      series: { priceToCoordinate },
      requestUpdate: vi.fn(),
    } as never)
    primitive.setDraws([
      {
        id: 1,
        kind: 'screenText',
        t0: 50,
        y0: 1,
        label: 'WATERMARK',
        style: {
          screenAnchor: 'top-right',
          screenOffsetX: -5,
          screenOffsetY: 3,
          textAlign: 'right',
          fontSize: 12,
          textColor: '#123456',
          backgroundColor: '#ffffff',
        },
      },
    ])
    const context = {
      save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
      fillRect: vi.fn(), measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
    }
    const paneViews = primitive.paneViews()
    expect(paneViews.map((paneView) => paneView.zOrder?.())).toEqual(['bottom', 'top'])
    const screenPane = paneViews[1]
    if (!screenPane) throw new Error('Screen pane is missing')
    const renderer = screenPane.renderer()
    if (!renderer) throw new Error('Screen pane renderer is missing')
    renderer.draw({
      useBitmapCoordinateSpace: (draw: (scope: unknown) => void) => draw({
        context,
        horizontalPixelRatio: 1,
        verticalPixelRatio: 1,
        bitmapSize: { width: 200, height: 100 },
      }),
    } as never)

    expect(primitive.visibleDraws().map((draw) => draw.id)).toEqual([1])
    expect(priceToCoordinate).not.toHaveBeenCalled()
    expect(context.fillText).toHaveBeenCalledWith('WATERMARK', 183, 15)
    expect(context.fillRect).toHaveBeenCalledWith(107, 11, 80, 22.4)
  })
  it('shades a background rectangle across the viewport without price-space borders', () => {
    const priceToCoordinate = vi.fn(() => null)
    const primitive = new IndicatorDrawingsPrimitive()
    primitive.attached({
      chart: { timeScale: () => ({
        getVisibleRange: () => ({ from: 0, to: 100 }),
        timeToCoordinate: (time: number) => time,
      }) },
      series: { priceToCoordinate },
      requestUpdate: vi.fn(),
    } as never)
    primitive.setDraws([{
      id: 1, kind: 'rectangle', label: 'London', t0: 10, t1: 30, y0: 5, y1: 10,
      style: { display: 'background', fillColor: 'rgba(1,2,3,0.2)', borderColor: '#000', borderWidth: 1 },
    }])
    const context = {
      save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
      fillRect: vi.fn(), strokeRect: vi.fn(),
    }
    primitive.paneViews()[0]!.renderer()!.draw({
      useBitmapCoordinateSpace: (draw: (scope: unknown) => void) => draw({
        context, horizontalPixelRatio: 1, verticalPixelRatio: 1, bitmapSize: { width: 100, height: 50 },
      }),
    } as never)

    expect(context.fillRect).toHaveBeenCalledWith(10, 0, 20, 50)
    expect(context.fillText).toHaveBeenCalledWith('London', 20, 4)
    expect(context.strokeRect).not.toHaveBeenCalled()
    expect(priceToCoordinate).not.toHaveBeenCalled()
  })
})
