import { describe, expect, it, vi } from 'vitest'
import { IndicatorDrawingsPrimitive } from './indicator-drawings-primitive'

describe('IndicatorDrawingsPrimitive', () => {
  it('renders vertical session boundaries and point markers from backend intents', () => {
    const requestUpdate = vi.fn()
    const priceToCoordinate = vi.fn((price: number) => price)
    const primitive = new IndicatorDrawingsPrimitive()
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: (time: number) => time }) },
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
})
