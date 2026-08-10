import { describe, expect, it } from 'vitest'
import {
  IDLE_DRAWING_PLACEMENT,
  cancelDrawingPlacement,
  commitDrawingAnchor,
  drawingPreviewAnchors,
  moveDrawingPlacement,
  startDrawingPlacement,
} from './drawing-placement'

const a = { time: 60, price: 100 }
const b = { time: 120, price: 102 }
const c = { time: 180, price: 99 }

describe('drawing placement state machine', () => {
  it('completes a one-anchor tool on its first valid click', () => {
    expect(commitDrawingAnchor(startDrawingPlacement('horizontal-line', 1), a)).toEqual({
      status: 'complete', tool: 'horizontal-line', anchors: [a],
    })
  })

  it('previews and completes a two-anchor tool', () => {
    const anchored = commitDrawingAnchor(startDrawingPlacement('trend-line', 2), a)
    const previewing = moveDrawingPlacement(anchored, b)
    expect(drawingPreviewAnchors(previewing)).toEqual([a, b])
    expect(commitDrawingAnchor(previewing, b)).toEqual({ status: 'complete', tool: 'trend-line', anchors: [a, b] })
  })

  it('keeps committed anchors and moves only the next point for multi-anchor tools', () => {
    const first = commitDrawingAnchor(startDrawingPlacement('pitchfork', 3), a)
    const second = commitDrawingAnchor(moveDrawingPlacement(first, b), b)
    const previewing = moveDrawingPlacement(second, c)
    expect(drawingPreviewAnchors(previewing)).toEqual([a, b, c])
    expect(commitDrawingAnchor(previewing, c)).toEqual({ status: 'complete', tool: 'pitchfork', anchors: [a, b, c] })
  })

  it('ignores invalid coordinates and invalid tool definitions', () => {
    const state = startDrawingPlacement('trend-line', 2)
    expect(commitDrawingAnchor(state, { time: Number.NaN, price: 1 })).toBe(state)
    expect(moveDrawingPlacement(state, { time: 1, price: Number.POSITIVE_INFINITY })).toBe(state)
    expect(startDrawingPlacement('', 2)).toEqual(IDLE_DRAWING_PLACEMENT)
    expect(startDrawingPlacement('bad', 0)).toEqual(IDLE_DRAWING_PLACEMENT)
  })

  it('cancels the old placement when Escape or a tool change occurs', () => {
    const old = commitDrawingAnchor(startDrawingPlacement('trend-line', 2), a)
    expect(cancelDrawingPlacement(old)).toEqual({ status: 'cancelled', tool: 'trend-line' })
    expect(startDrawingPlacement('rectangle', 2)).toEqual({ status: 'anchored', tool: 'rectangle', requiredAnchors: 2, anchors: [] })
  })
})
