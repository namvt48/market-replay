import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDrawingToolbarPosition } from '../../replay/drawing-toolbar-position'
import { DrawingToolbar } from './DrawingToolbar'

const { setDrawingTool } = vi.hoisted(() => ({ setDrawingTool: vi.fn() }))

vi.mock('../../replay/replay-engine', () => ({
  replayEngine: {
    deleteAllDrawings: vi.fn(),
    deleteSelectedDrawing: vi.fn(),
    drawingTools: () => [
      { type: 'trend-line', name: 'Trend Line', category: 'line', requiredAnchors: 2 },
      { type: 'ray', name: 'Ray', category: 'line', requiredAnchors: 2 },
      { type: 'info-line', name: 'Info Line', category: 'line', requiredAnchors: 2 },
      { type: 'extended-line', name: 'Extended Line', category: 'line', requiredAnchors: 2 },
      { type: 'horizontal-line', name: 'Horizontal Line', category: 'line', requiredAnchors: 1 },
      { type: 'horizontal-ray', name: 'Horizontal Ray', category: 'line', requiredAnchors: 1 },
      { type: 'vertical-line', name: 'Vertical Line', category: 'line', requiredAnchors: 1 },
      { type: 'rectangle', name: 'Rectangle', category: 'shape', requiredAnchors: 2 },
      { type: 'path', name: 'Path', category: 'shape', requiredAnchors: 2 },
      { type: 'fib-retracement', name: 'Fibonacci Retracement', category: 'fibonacci', requiredAnchors: 2 },
      { type: 'text-annotation', name: 'Text', category: 'annotation', requiredAnchors: 1 },
      { type: 'date-price-range', name: 'Date and Price Range', category: 'measurement', requiredAnchors: 2 },
      { type: 'arrow', name: 'Arrow', category: 'line', requiredAnchors: 2 },
    ],
    setDrawingTool,
    setNextDrawingAppearance: vi.fn(),
  },
}))

const drawingSnapshot = { activeDrawingTool: null, drawingInspectorOpen: false, selectedDrawing: null }
vi.mock('../../replay/use-replay', () => ({
  useReplaySnapshot: () => drawingSnapshot,
  useReplaySelector: (select: (value: typeof drawingSnapshot) => unknown) => select(drawingSnapshot),
}))

vi.mock('../../replay/drawing-templates', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../replay/drawing-templates')>()
  return { ...original, loadDrawingTemplates: () => [], persistDrawingTemplates: vi.fn() }
})

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  setDrawingTool.mockClear()
})

describe('DrawingToolbar menus', () => {
  it('shows only the requested drawing groups on the rail', () => {
    render(<DrawingToolbar />)

    expect(screen.getByRole('button', { name: 'Crosshair' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Line tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fibonacci' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shape tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Measure' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete drawings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arrow' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'All drawing tools' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drawing templates' })).not.toBeInTheDocument()
  })

  it('shows exactly the seven requested line tools', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)

    await user.click(screen.getByRole('button', { name: 'Line tools' }))
    const menu = screen.getByRole('menu', { name: 'Line tools menu' })
    expect(within(menu).getAllByRole('menuitem').map((button) => button.textContent)).toEqual([
      'Trend Line', 'Ray', 'Info Line', 'Extended Line', 'Horizontal Line', 'Horizontal Ray', 'Vertical Line',
    ])
  })

  it('dismisses an open group menu when the user clicks outside', async () => {
    const user = userEvent.setup()
    render(<div><DrawingToolbar /><button type="button">Chart surface</button></div>)

    await user.click(screen.getByRole('button', { name: 'Line tools' }))
    expect(screen.getByRole('menu', { name: 'Line tools menu' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Chart surface' }))
    expect(screen.queryByRole('menu', { name: 'Line tools menu' })).not.toBeInTheDocument()
    expect(setDrawingTool).not.toHaveBeenCalled()
  })

  it('closes the menu with Escape and restores focus to its trigger', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    const trigger = screen.getByRole('button', { name: 'Shape tools' })

    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Shape tools menu' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('selects grouped and direct tools', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)

    await user.click(screen.getByRole('button', { name: 'Shape tools' }))
    await user.click(within(screen.getByRole('menu', { name: 'Shape tools menu' })).getByRole('menuitem', { name: 'Path' }))
    await user.click(screen.getByRole('button', { name: 'Fibonacci' }))
    await user.click(screen.getByRole('button', { name: 'Text' }))
    await user.click(screen.getByRole('button', { name: 'Measure' }))

    expect(setDrawingTool).toHaveBeenNthCalledWith(1, 'path')
    expect(setDrawingTool).toHaveBeenNthCalledWith(2, 'fib-retracement')
    expect(setDrawingTool).toHaveBeenNthCalledWith(3, 'text-annotation')
    expect(setDrawingTool).toHaveBeenNthCalledWith(4, 'date-price-range')
    expect(screen.queryByRole('menu', { name: 'Shape tools menu' })).not.toBeInTheDocument()
  })

  it('stars tools into a persistent floating toolbar', async () => {
    const user = userEvent.setup()
    const view = render(<DrawingToolbar />)

    await user.click(screen.getByRole('button', { name: 'Manage favorite tools' }))
    await user.click(within(screen.getByRole('menu', { name: 'Favorite tools menu' })).getByRole('menuitemcheckbox', { name: 'Star Fibonacci Retracement' }))

    const floatingToolbar = screen.getByRole('navigation', { name: 'Favorite drawing tools' })
    await user.click(within(floatingToolbar).getByRole('button', { name: 'Favorite Fibonacci Retracement' }))
    expect(setDrawingTool).toHaveBeenLastCalledWith('fib-retracement')

    view.unmount()
    render(<DrawingToolbar />)
    expect(screen.getByRole('navigation', { name: 'Favorite drawing tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Favorite Fibonacci Retracement' })).toBeInTheDocument()
  })

  it('keeps the rail and favorite manager usable while drawing is disabled', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar disabled />)

    expect(screen.getByRole('navigation', { name: 'Drawing tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fibonacci' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Manage favorite tools' }))
    await user.click(within(screen.getByRole('menu', { name: 'Favorite tools menu' })).getByRole('menuitemcheckbox', { name: 'Star Measure' }))
    expect(screen.getByRole('button', { name: 'Favorite Measure' })).toBeDisabled()
    expect(setDrawingTool).not.toHaveBeenCalled()
  })

  it('drags the floating toolbar within the chart and persists its position', async () => {
    const user = userEvent.setup()
    render(<section><DrawingToolbar /></section>)
    await user.click(screen.getByRole('button', { name: 'Manage favorite tools' }))
    await user.click(within(screen.getByRole('menu', { name: 'Favorite tools menu' })).getByRole('menuitemcheckbox', { name: 'Star Path' }))

    const floatingToolbar = screen.getByRole('navigation', { name: 'Favorite drawing tools' })
    const chart = floatingToolbar.parentElement
    if (!chart) throw new Error('Expected floating toolbar to have a chart container')
    Object.defineProperties(chart, {
      clientHeight: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 500 },
    })
    Object.defineProperties(floatingToolbar, {
      offsetHeight: { configurable: true, value: 42 },
      offsetWidth: { configurable: true, value: 82 },
    })

    const handle = screen.getByRole('button', { name: 'Move favorite toolbar' })
    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10, isPrimary: true, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 160, clientY: 80, isPrimary: true, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 160, clientY: 80, isPrimary: true, pointerId: 1 })

    expect(floatingToolbar).toHaveStyle({ transform: 'translate3d(158px, 78px, 0)' })
    expect(loadDrawingToolbarPosition()).toEqual({ x: 158, y: 78 })
  })

  it('keeps the floating toolbar above chart split handles', async () => {
    const user = userEvent.setup()
    render(<section><DrawingToolbar /></section>)
    await user.click(screen.getByRole('button', { name: 'Manage favorite tools' }))
    await user.click(within(screen.getByRole('menu', { name: 'Favorite tools menu' })).getByRole('menuitemcheckbox', { name: 'Star Path' }))

    expect(screen.getByRole('navigation', { name: 'Favorite drawing tools' })).toHaveClass('z-[60]')
  })

  it('supports precise keyboard movement for the floating toolbar', async () => {
    const user = userEvent.setup()
    render(<section><DrawingToolbar /></section>)
    await user.click(screen.getByRole('button', { name: 'Manage favorite tools' }))
    await user.click(within(screen.getByRole('menu', { name: 'Favorite tools menu' })).getByRole('menuitemcheckbox', { name: 'Star Text' }))

    const floatingToolbar = screen.getByRole('navigation', { name: 'Favorite drawing tools' })
    const chart = floatingToolbar.parentElement
    if (!chart) throw new Error('Expected floating toolbar to have a chart container')
    Object.defineProperties(chart, {
      clientHeight: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 500 },
    })
    Object.defineProperties(floatingToolbar, {
      offsetHeight: { configurable: true, value: 42 },
      offsetWidth: { configurable: true, value: 82 },
    })
    const handle = screen.getByRole('button', { name: 'Move favorite toolbar' })
    handle.focus()
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}')

    expect(loadDrawingToolbarPosition()).toEqual({ x: 18, y: 8 })
  })
})
