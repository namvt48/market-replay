import { describe, expect, it } from 'vitest'
import type { SerializedDrawing } from 'lightweight-charts-drawing'
import { projectDrawingsToHistory } from './drawing-projection'

describe('projectDrawingsToHistory', () => {
  it('keeps price canonical and maps time into the containing timeframe candle', () => {
    const drawing = {
      id: 'line-1', type: 'trend-line',
      anchors: [{ time: 359, price: 101.25 }, { time: 601, price: 103.5 }], style: {}, options: {},
    } as SerializedDrawing
    const projected = projectDrawingsToHistory([drawing], [
      { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 300, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 600, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ])
    expect(projected[0].anchors).toEqual([{ time: 300, price: 101.25 }, { time: 600, price: 103.5 }])
    expect(drawing.anchors[0].time).toBe(359)
  })

  it('retains an anchor before the loaded window so it can appear after prepend', () => {
    const drawing = { id: 'old', type: 'horizontal-line', anchors: [{ time: 60, price: 100 }], style: {}, options: {} } as SerializedDrawing
    expect(projectDrawingsToHistory([drawing], [{ time: 300, open: 1, high: 1, low: 1, close: 1, volume: 1 }])[0].anchors[0].time).toBe(60)
  })
})
