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
      { id: 2, kind: 'marker', label: '⮝', t0: 20, y0: 40, style: { color: '#ff5563' } },
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
})
