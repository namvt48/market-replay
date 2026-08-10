import { describe, expect, it, vi } from 'vitest'
import { HoverBarStore } from './hover-bar-store'

describe('HoverBarStore', () => {
  it('conflates repeated crosshair events to one emit per animation frame', () => {
    let callback: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((next) => { callback = next; return 1 })
    const store = new HoverBarStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.emit({ time: 1, open: 1, high: 2, low: 0, close: 1, hovered: true })
    store.emit({ time: 2, open: 2, high: 3, low: 1, close: 2.5, hovered: true })
    expect(listener).not.toHaveBeenCalled()
    expect(callback).not.toBeNull()
    if (callback) (callback as FrameRequestCallback)(0)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()?.time).toBe(2)
  })
})
