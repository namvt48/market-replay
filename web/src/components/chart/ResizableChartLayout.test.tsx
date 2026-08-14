import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutNode } from '../../chart-workspace/types'
import { ResizableChartLayout } from './ResizableChartLayout'

afterEach(cleanup)

const node: LayoutNode = { kind: 'split', id: 'root', orientation: 'horizontal', ratio: 0.5, first: { kind: 'pane', paneId: 'a' }, second: { kind: 'pane', paneId: 'b' } }
const verticalNode: LayoutNode = { ...node, orientation: 'vertical' }

// Deterministic rAF: a queue of callbacks the test controls manually.
let rafCallbacks: Array<() => void>
let rafId: number
beforeEach(() => {
  rafCallbacks = []
  rafId = 0
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    rafCallbacks.push(cb)
    return ++rafId
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  // jsdom has no setPointerCapture on the element; stub it.
  Object.defineProperty(globalThis.HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  vi.unstubAllGlobals()
  rafCallbacks = []
})

const flushOneFrame = (): void => {
  const cb = rafCallbacks.shift()
  if (cb) cb()
}

describe('ResizableChartLayout', () => {
  it('shows the platform column or row resize cursor while hovering a splitter', () => {
    const { rerender } = render(<ResizableChartLayout node={node} renderPane={(id) => <div>{id}</div>} onResize={vi.fn()} />)
    expect(screen.getByRole('separator', { name: 'Resize horizontal chart split' })).toHaveStyle({ cursor: 'col-resize' })

    rerender(<ResizableChartLayout node={verticalNode} renderPane={(id) => <div>{id}</div>} onResize={vi.fn()} />)
    expect(screen.getByRole('separator', { name: 'Resize vertical chart split' })).toHaveStyle({ cursor: 'row-resize' })
  })

  it('exposes separator semantics and keyboard resizing', async () => {
    const user = userEvent.setup()
    const onResize = vi.fn()
    render(<ResizableChartLayout node={node} renderPane={(id) => <div>{id}</div>} onResize={onResize} />)
    const separator = screen.getByRole('separator', { name: 'Resize horizontal chart split' })
    expect(separator).toHaveAttribute('aria-orientation', 'vertical')
    expect(separator).toHaveAttribute('aria-valuenow', '50')
    separator.focus()
    await user.keyboard('{ArrowRight}')
    expect(onResize).toHaveBeenCalledWith('root', 0.52, 0)
    await user.keyboard('{Home}')
    expect(onResize).toHaveBeenLastCalledWith('root', 0, 0)
  })
  it('coalesces many pointermove events into a single onResize per animation frame', () => {
    // Regression: separator drag fired onResize on EVERY pointermove, causing
    // a full ChartWorkspace re-render (including popout tiles) at pointer-input
    // rate (60–125Hz+) — far above the 60fps display, so frames dropped.
    const onResize = vi.fn()
    render(<ResizableChartLayout node={node} renderPane={(id) => <div>{id}</div>} onResize={onResize} />)
    const separator = screen.getByRole('separator', { name: 'Resize horizontal chart split' })

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    // Mouse polling can emit many moves before the next paint.
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 110 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 120 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 130 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 140 })
    // No re-render should be triggered until the next animation frame.
    expect(onResize).not.toHaveBeenCalled()

    // One frame → exactly one dispatch, using the LATEST pointer position.
    flushOneFrame()
    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenCalledWith('root', expect.any(Number), expect.any(Number))

    // A second burst in the same frame still yields one dispatch.
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 150 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 160 })
    flushOneFrame()
    expect(onResize).toHaveBeenCalledTimes(2)

    fireEvent.pointerUp(separator, { pointerId: 1 })
  })

  it('keeps the bidirectional resize cursor active for the whole drag gesture', () => {
    render(<ResizableChartLayout node={node} renderPane={(id) => <div>{id}</div>} onResize={vi.fn()} />)
    const separator = screen.getByRole('separator', { name: 'Resize horizontal chart split' })

    fireEvent.pointerDown(separator, { pointerId: 7, clientX: 100 })
    expect(document.documentElement.style.cursor).toBe('col-resize')
    fireEvent.pointerUp(separator, { pointerId: 7, clientX: 120 })
    expect(document.documentElement.style.cursor).toBe('')
  })

  it.each([
    { layout: node, name: 'Resize horizontal chart split', sizeStyle: { width: '2px' }, cursor: 'col-resize' },
    { layout: verticalNode, name: 'Resize vertical chart split', sizeStyle: { height: '2px' }, cursor: 'row-resize' },
  ])('keeps every pointer hit target on the visible splitter line', ({ layout, name, sizeStyle, cursor }) => {
    render(<ResizableChartLayout node={layout} renderPane={(id) => <div>{id}</div>} onResize={vi.fn()} />)

    const separator = screen.getByRole('separator', { name })
    expect(separator).toHaveStyle({ ...sizeStyle, cursor })
    expect(separator).toHaveClass('z-10')
    expect(separator.className).not.toContain('before:')
  })
})
