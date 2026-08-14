import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DRAWING_METADATA, type DrawingAppearance } from '../../replay/drawing-appearance'
import { CONTEXTUAL_DRAWING_TOOLBAR_POSITION_STORAGE_KEY } from '../../replay/drawing-toolbar-position'
import { defaultDrawingTemplateAppearance } from '../../replay/drawing-templates'
import { DrawingToolbar } from './DrawingToolbar'

const drawingTemplateMocks = vi.hoisted(() => ({
  persist: vi.fn(),
  syncUpsert: vi.fn(),
  syncDelete: vi.fn(),
  templates: [] as Array<{
    id: string
    name: string
    toolType: string
    appearance: Record<string, unknown>
    createdAt: number
    updatedAt: number
  }>,
}))

const engineMocks = vi.hoisted(() => ({
  setDrawingTool: vi.fn(),
  setDrawingsHidden: vi.fn(),
  setIndicatorsHidden: vi.fn(),
  setAllDrawingsLocked: vi.fn(),
  setKeepDrawing: vi.fn(),
  beginAreaZoom: vi.fn(),
  resetAreaZoom: vi.fn(),
  removeAllIndicators: vi.fn(),
  updateSelectedDrawing: vi.fn(),
  openDrawingInspector: vi.fn(),
  lockSelectedDrawing: vi.fn(),
  deleteSelectedDrawing: vi.fn(),
}))

vi.mock('../../replay/replay-engine', () => ({
  replayEngine: {
    deleteAllDrawings: vi.fn(),
    deleteSelectedDrawing: engineMocks.deleteSelectedDrawing,
    drawingTools: () => [
      { type: 'trend-line', name: 'Trend Line', category: 'line', requiredAnchors: 2 },
      { type: 'ray', name: 'Ray', category: 'line', requiredAnchors: 2 },
      { type: 'info-line', name: 'Info Line', category: 'line', requiredAnchors: 2 },
      { type: 'extended-line', name: 'Extended Line', category: 'line', requiredAnchors: 2 },
      { type: 'trend-angle', name: 'Trend Angle', category: 'line', requiredAnchors: 2 },
      { type: 'horizontal-line', name: 'Horizontal Line', category: 'line', requiredAnchors: 1 },
      { type: 'horizontal-ray', name: 'Horizontal Ray', category: 'line', requiredAnchors: 1 },
      { type: 'vertical-line', name: 'Vertical Line', category: 'line', requiredAnchors: 1 },
      { type: 'cross-line', name: 'Cross Line', category: 'line', requiredAnchors: 1 },
      { type: 'rectangle', name: 'Rectangle', category: 'shape', requiredAnchors: 2 },
      { type: 'rotated-rectangle', name: 'Rotated Rectangle', category: 'shape', requiredAnchors: 3 },
      { type: 'path', name: 'Path', category: 'shape', requiredAnchors: 2 },
      { type: 'brush', name: 'Brush', category: 'annotation', requiredAnchors: 2 },
      { type: 'arrow-marker', name: 'Arrow Marker', category: 'annotation', requiredAnchors: 1 },
      { type: 'long-position', name: 'Long Position', category: 'forecasting', requiredAnchors: 3 },
      { type: 'short-position', name: 'Short Position', category: 'forecasting', requiredAnchors: 3 },
      { type: 'fib-retracement', name: 'Fibonacci Retracement', category: 'fibonacci', requiredAnchors: 2 },
      { type: 'text-annotation', name: 'Text', category: 'annotation', requiredAnchors: 1 },
      { type: 'date-price-range', name: 'Date and Price Range', category: 'measurement', requiredAnchors: 2 },
      { type: 'arrow', name: 'Arrow', category: 'line', requiredAnchors: 2 },
    ],
    setDrawingTool: engineMocks.setDrawingTool,
    setNextDrawingAppearance: vi.fn(),
    setDrawingsHidden: engineMocks.setDrawingsHidden,
    setIndicatorsHidden: engineMocks.setIndicatorsHidden,
    setAllDrawingsLocked: engineMocks.setAllDrawingsLocked,
    setKeepDrawing: engineMocks.setKeepDrawing,
    beginAreaZoom: engineMocks.beginAreaZoom,
    resetAreaZoom: engineMocks.resetAreaZoom,
    removeAllIndicators: engineMocks.removeAllIndicators,
    drawingCount: vi.fn().mockReturnValue(2),
    updateSelectedDrawing: engineMocks.updateSelectedDrawing,
    openDrawingInspector: engineMocks.openDrawingInspector,
    lockSelectedDrawing: engineMocks.lockSelectedDrawing,
  },
}))

const drawingSnapshot = {
  activeDrawingTool: null as string | null,
  drawingInspectorOpen: false,
  selectedDrawing: null as DrawingAppearance | null,
  keepDrawing: false,
  drawingsLocked: false,
  drawingsHidden: false,
  indicatorsHidden: false,
  areaZoomSelecting: false,
  areaZoomed: false,
  indicators: [{ id: 'indicator-1' }, { id: 'indicator-2' }, { id: 'indicator-3' }],
}
vi.mock('../../replay/use-replay', () => ({
  useReplaySnapshot: () => drawingSnapshot,
  useReplaySelector: (select: (value: typeof drawingSnapshot) => unknown) => select(drawingSnapshot),
}))

vi.mock('../../replay/drawing-templates', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../replay/drawing-templates')>()
  return {
    ...original,
    loadDrawingTemplates: () => drawingTemplateMocks.templates,
    persistDrawingTemplates: drawingTemplateMocks.persist,
    syncDrawingTemplateUpsert: drawingTemplateMocks.syncUpsert,
    syncDrawingTemplateDelete: drawingTemplateMocks.syncDelete,
  }
})

beforeEach(() => {
  window.localStorage.clear()
  drawingTemplateMocks.templates = []
})

afterEach(() => {
  cleanup()
  drawingSnapshot.activeDrawingTool = null
  drawingSnapshot.drawingInspectorOpen = false
  drawingSnapshot.selectedDrawing = null
  drawingSnapshot.keepDrawing = false
  drawingSnapshot.drawingsLocked = false
  drawingSnapshot.drawingsHidden = false
  drawingSnapshot.indicatorsHidden = false
  drawingSnapshot.areaZoomSelecting = false
  drawingSnapshot.areaZoomed = false
  vi.clearAllMocks()
})

describe('DrawingToolbar menus', () => {
  it('shows a configurable contextual toolbar as soon as a drawing is selected', () => {
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-1',
      type: 'trend-line',
      lineWidth: 2,
      extendLeft: false,
      extendRight: false,
      supportsExtend: true,
    }

    render(<DrawingToolbar />)

    const toolbar = screen.getByRole('toolbar', { name: 'Selected Trend Line drawing' })
    expect(within(toolbar).getByRole('button', { name: 'Move selected drawing toolbar' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Drawing templates' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Drawing color' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Line thickness' })).toHaveTextContent('2px')
    expect(within(toolbar).getByRole('button', { name: 'Drawing properties' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Lock drawing' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Remove drawing' })).toBeInTheDocument()
    expect(within(toolbar).queryByRole('button', { name: 'More drawing actions' })).not.toBeInTheDocument()
  })

  it('applies color, line width, default template, properties, lock and remove actions', async () => {
    const user = userEvent.setup()
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-1',
      type: 'trend-line',
      strokeColor: '#2962ff',
      lineWidth: 2,
      extendLeft: false,
      extendRight: false,
      supportsExtend: true,
    }

    render(<DrawingToolbar />)

    await user.click(screen.getByRole('button', { name: 'Drawing color' }))
    await user.click(within(screen.getByRole('menu', { name: 'Drawing color palette' })).getByRole('menuitemradio', { name: 'Set drawing color #f23645' }))
    expect(engineMocks.updateSelectedDrawing).toHaveBeenLastCalledWith({ strokeColor: '#f23645' })

    await user.click(screen.getByRole('button', { name: 'Line thickness' }))
    await user.click(within(screen.getByRole('menu', { name: 'Line thickness menu' })).getByRole('menuitemradio', { name: '3px' }))
    expect(engineMocks.updateSelectedDrawing).toHaveBeenLastCalledWith({ lineWidth: 3 })

    await user.click(screen.getByRole('button', { name: 'Drawing templates' }))
    await user.click(within(screen.getByRole('menu', { name: 'Drawing templates menu' })).getByRole('menuitem', { name: 'Apply default drawing template' }))
    expect(engineMocks.updateSelectedDrawing).toHaveBeenLastCalledWith(expect.objectContaining({ lineWidth: 2, strokeColor: DEFAULT_DRAWING_METADATA.strokeColor }))

    await user.click(screen.getByRole('button', { name: 'Drawing properties' }))
    await user.click(screen.getByRole('button', { name: 'Lock drawing' }))
    await user.click(screen.getByRole('button', { name: 'Remove drawing' }))
    expect(engineMocks.openDrawingInspector).toHaveBeenCalledOnce()
    expect(engineMocks.lockSelectedDrawing).toHaveBeenCalledOnce()
    expect(engineMocks.deleteSelectedDrawing).toHaveBeenCalledOnce()
  })

  it('uses the per-drawing toolbar template to omit unsupported line controls', () => {
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-text',
      type: 'text-annotation',
      lineWidth: 1,
      extendLeft: false,
      extendRight: false,
      supportsExtend: false,
    }

    render(<DrawingToolbar />)

    const toolbar = screen.getByRole('toolbar', { name: 'Selected Text drawing' })
    expect(within(toolbar).getByRole('button', { name: 'Drawing color' })).toBeInTheDocument()
    expect(within(toolbar).queryByRole('button', { name: 'Line thickness' })).not.toBeInTheDocument()
  })

  it('saves and applies named templates from the contextual menu', async () => {
    const user = userEvent.setup()
    const drawing: DrawingAppearance = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-1',
      type: 'trend-line',
      lineWidth: 2,
      extendLeft: false,
      extendRight: false,
      supportsExtend: true,
    }
    drawingSnapshot.selectedDrawing = drawing
    drawingTemplateMocks.templates = [{
      id: 'template-1',
      name: 'Breakout',
      toolType: 'trend-line',
      appearance: { ...defaultDrawingTemplateAppearance(drawing), lineWidth: 4 },
      createdAt: 1,
      updatedAt: 1,
    }]

    render(<DrawingToolbar />)

    await user.click(screen.getByRole('button', { name: 'Drawing templates' }))
    await user.click(within(screen.getByRole('menu', { name: 'Drawing templates menu' })).getByRole('menuitem', { name: 'Breakout' }))
    expect(engineMocks.updateSelectedDrawing).toHaveBeenLastCalledWith(expect.objectContaining({ lineWidth: 4 }))

    await user.click(screen.getByRole('button', { name: 'Drawing templates' }))
    await user.click(within(screen.getByRole('menu', { name: 'Drawing templates menu' })).getByRole('menuitem', { name: 'Save Drawing Template As…' }))
    await user.type(screen.getByLabelText('Template name'), 'Pullback')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(drawingTemplateMocks.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: 'Pullback', toolType: 'trend-line' })]))
    // The local write is the source of truth immediately; the backend mirror
    // is a best-effort side effect fired for exactly the saved template.
    expect(drawingTemplateMocks.syncUpsert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Pullback', toolType: 'trend-line' }))
  })

  it('mirrors a template delete to the backend', async () => {
    const user = userEvent.setup()
    const drawing: DrawingAppearance = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-1',
      type: 'trend-line',
      lineWidth: 2,
      extendLeft: false,
      extendRight: false,
      supportsExtend: true,
    }
    drawingSnapshot.selectedDrawing = drawing
    drawingSnapshot.drawingInspectorOpen = true
    drawingTemplateMocks.templates = [{
      id: 'template-1',
      name: 'Breakout',
      toolType: 'trend-line',
      appearance: { ...defaultDrawingTemplateAppearance(drawing), lineWidth: 4 },
      createdAt: 1,
      updatedAt: 1,
    }]

    render(<DrawingToolbar />)

    await user.click(screen.getByRole('tab', { name: 'Templates' }))
    await user.selectOptions(screen.getByLabelText('Drawing template'), 'template-1')
    await user.click(screen.getByRole('button', { name: 'Delete selected template' }))

    expect(drawingTemplateMocks.persist).toHaveBeenCalledWith([])
    expect(drawingTemplateMocks.syncDelete).toHaveBeenCalledWith('template-1')
  })

  it('moves the contextual toolbar within the chart workspace', () => {
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-1',
      type: 'trend-line',
      lineWidth: 2,
      extendLeft: false,
      extendRight: false,
      supportsExtend: true,
    }
    render(<div><DrawingToolbar /></div>)
    const toolbar = screen.getByRole('toolbar', { name: 'Selected Trend Line drawing' })
    const layer = toolbar.parentElement
    expect(layer?.parentElement).not.toBeNull()
    if (!layer?.parentElement) return
    Object.defineProperties(layer.parentElement, {
      clientWidth: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 800 },
    })

    const handle = within(toolbar).getByRole('button', { name: 'Move selected drawing toolbar' })
    const initialTransform = layer.style.transform
    fireEvent.pointerDown(handle, { button: 0, isPrimary: true, pointerId: 8, clientX: 300, clientY: 30 })
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 430, clientY: 100 })
    fireEvent.pointerUp(handle, { pointerId: 8, clientX: 430, clientY: 100 })

    expect(layer.style.transform).not.toBe(initialTransform)
    expect(handle).toHaveClass('cursor-grab')
    expect(JSON.parse(window.localStorage.getItem(CONTEXTUAL_DRAWING_TOOLBAR_POSITION_STORAGE_KEY) ?? 'null')).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }))
  })

  it('restores one contextual toolbar position for every subsequently selected drawing', () => {
    window.localStorage.setItem(CONTEXTUAL_DRAWING_TOOLBAR_POSITION_STORAGE_KEY, JSON.stringify({ x: 240, y: 96 }))
    const firstHost = document.createElement('div')
    Object.defineProperties(firstHost, {
      clientWidth: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 800 },
    })
    document.body.append(firstHost)
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-line',
      type: 'trend-line',
      lineWidth: 2,
      extendLeft: false,
      extendRight: false,
      supportsExtend: true,
    }
    const first = render(<DrawingToolbar />, { container: firstHost })
    expect(screen.getByRole('toolbar', { name: 'Selected Trend Line drawing' }).parentElement).toHaveStyle({ transform: 'translate3d(240px, 96px, 0)' })
    first.unmount()
    firstHost.remove()

    const secondHost = document.createElement('div')
    Object.defineProperties(secondHost, {
      clientWidth: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 800 },
    })
    document.body.append(secondHost)
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-text',
      type: 'text-annotation',
      lineWidth: 1,
      extendLeft: false,
      extendRight: false,
      supportsExtend: false,
    }
    const second = render(<DrawingToolbar />, { container: secondHost })
    expect(screen.getByRole('toolbar', { name: 'Selected Text drawing' }).parentElement).toHaveStyle({ transform: 'translate3d(240px, 96px, 0)' })
    second.unmount()
    secondHost.remove()
  })

  it('persists contextual toolbar movement from the keyboard like the favorites bar', () => {
    const host = document.createElement('div')
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 800 },
    })
    document.body.append(host)
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-line',
      type: 'trend-line',
      lineWidth: 2,
      extendLeft: false,
      extendRight: false,
      supportsExtend: true,
    }
    const view = render(<DrawingToolbar />, { container: host })

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move selected drawing toolbar' }), { key: 'ArrowRight', shiftKey: true })

    expect(JSON.parse(window.localStorage.getItem(CONTEXTUAL_DRAWING_TOOLBAR_POSITION_STORAGE_KEY) ?? 'null')).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }))
    view.unmount()
    host.remove()
  })

  it('keeps the movable drawing inspector above chart splitters', () => {
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-1',
      type: 'trend-line',
      lineWidth: 2,
      extendLeft: false,
      extendRight: false,
      supportsExtend: true,
    }
    drawingSnapshot.drawingInspectorOpen = true
    const view = render(<div><DrawingToolbar /></div>)
    const inspector = screen.getByRole('complementary', { name: 'Edit trend-line drawing' })
    const layer = inspector.parentElement
    expect(layer).not.toBeNull()
    expect(layer).toHaveClass('z-[80]')
    if (!layer?.parentElement) return
    Object.defineProperties(layer.parentElement, {
      clientWidth: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 800 },
    })

    const handle = screen.getByRole('button', { name: 'Move drawing properties' })
    const initialTransform = layer.style.transform
    fireEvent.pointerDown(handle, { button: 0, isPrimary: true, pointerId: 7, clientX: 80, clientY: 30 })
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 180, clientY: 90 })
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 180, clientY: 90 })

    expect(layer.style.transform).not.toBe(initialTransform)
    expect(handle).toHaveClass('cursor-grab')
    view.unmount()
  })

  it('shows only the requested drawing groups on the rail', () => {
    render(<DrawingToolbar />)

    expect(screen.getByRole('button', { name: 'Crosshair' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Line tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fibonacci' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Projection tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Brush tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Measure' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in chart by region' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep drawing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lock all drawings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drawing and indicator visibility' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove drawings and indicators' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arrow' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'All drawing tools' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drawing templates' })).not.toBeInTheDocument()
  })

  it('connects rail utility actions to the active chart', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)

    await user.click(screen.getByRole('button', { name: 'Zoom in chart by region' }))
    await user.click(screen.getByRole('button', { name: 'Keep drawing' }))
    await user.click(screen.getByRole('button', { name: 'Lock all drawings' }))

    expect(engineMocks.beginAreaZoom).toHaveBeenCalledOnce()
    expect(engineMocks.setKeepDrawing).toHaveBeenCalledWith(true)
    expect(engineMocks.setAllDrawingsLocked).toHaveBeenCalledWith(true)
  })

  it('uses the compact graphite rail treatment and keeps destructive actions at the end', () => {
    render(<DrawingToolbar />)

    const rail = screen.getByRole('navigation', { name: 'Drawing tools' })
    const buttons = within(rail).getAllByRole('button')
    expect(rail).toHaveClass('drawing-toolbar', 'bg-[#0d0e10]')
    expect(buttons[0]).toHaveAttribute('aria-label', 'Crosshair')
    expect(buttons[0]).toHaveClass('drawing-tool-button')
    expect(buttons[0].querySelector('svg')).toHaveAttribute('width', '20')
    expect(buttons.at(-1)).toHaveAttribute('aria-label', 'Remove drawings and indicators')
    expect(buttons.at(-1)?.parentElement).toHaveClass('mt-auto')
    expect(buttons.every((button) => button.classList.contains('drawing-tool-button'))).toBe(true)
  })

  it('shows the complete line set with distinct geometric icons', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)

    await user.click(screen.getByRole('button', { name: 'Line tools' }))
    const menu = screen.getByRole('menu', { name: 'Line tools menu' })
    expect(within(menu).getAllByRole('menuitem').map((button) => button.textContent)).toEqual([
      'Trend Line', 'Ray', 'Info Line', 'Extended Line', 'Trend Angle', 'Horizontal Line', 'Horizontal Ray', 'Vertical Line', 'Cross Line',
    ])
    expect(new Set(within(menu).getAllByRole('menuitem').map((button) => button.querySelector('svg')?.innerHTML)).size).toBe(9)
  })

  it('uses the selected line icon on the rail and briefly announces its name', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    const trigger = screen.getByRole('button', { name: 'Line tools' })
    const originalIcon = trigger.querySelector('svg')?.innerHTML

    await user.click(trigger)
    await user.click(within(screen.getByRole('menu', { name: 'Line tools menu' })).getByRole('menuitem', { name: 'Cross Line' }))

    expect(engineMocks.setDrawingTool).toHaveBeenLastCalledWith('cross-line')
    expect(trigger.querySelector('svg')?.innerHTML).not.toBe(originalIcon)
    expect(screen.getByRole('status')).toHaveTextContent('Cross Line')
  })

  it('temporarily labels single-action tools after they are pressed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<DrawingToolbar />)

    await user.click(screen.getByRole('button', { name: 'Text' }))
    expect(screen.getByRole('status')).toHaveTextContent('Text')
    await act(async () => { vi.advanceTimersByTime(1400) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('dismisses an open group menu when the user clicks outside', async () => {
    const user = userEvent.setup()
    render(<div><DrawingToolbar /><button type="button">Chart surface</button></div>)

    await user.click(screen.getByRole('button', { name: 'Line tools' }))
    expect(screen.getByRole('menu', { name: 'Line tools menu' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Chart surface' }))
    expect(screen.queryByRole('menu', { name: 'Line tools menu' })).not.toBeInTheDocument()
    expect(engineMocks.setDrawingTool).not.toHaveBeenCalled()
  })

  it('closes the menu with Escape and restores focus to its trigger', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    const trigger = screen.getByRole('button', { name: 'Brush tools' })

    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Brush tools menu' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('selects grouped and direct tools', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)

    await user.click(screen.getByRole('button', { name: 'Brush tools' }))
    await user.click(within(screen.getByRole('menu', { name: 'Brush tools menu' })).getByRole('menuitem', { name: 'Path' }))
    await user.click(screen.getByRole('button', { name: 'Fibonacci' }))
    await user.click(screen.getByRole('button', { name: 'Text' }))
    await user.click(screen.getByRole('button', { name: 'Measure' }))

    expect(engineMocks.setDrawingTool).toHaveBeenNthCalledWith(1, 'path')
    expect(engineMocks.setDrawingTool).toHaveBeenNthCalledWith(2, 'fib-retracement')
    expect(engineMocks.setDrawingTool).toHaveBeenNthCalledWith(3, 'text-annotation')
    expect(engineMocks.setDrawingTool).toHaveBeenNthCalledWith(4, 'date-price-range')
    expect(screen.queryByRole('menu', { name: 'Brush tools menu' })).not.toBeInTheDocument()
  })

  it('exposes Projection and the complete Brushes tool set', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)

    await user.click(screen.getByRole('button', { name: 'Projection tools' }))
    expect(within(screen.getByRole('menu', { name: 'Projection tools menu' })).getAllByRole('menuitem').map((button) => button.textContent)).toEqual(['Long Position', 'Short Position'])
    await user.click(within(screen.getByRole('menu', { name: 'Projection tools menu' })).getByRole('menuitem', { name: 'Short Position' }))
    expect(engineMocks.setDrawingTool).toHaveBeenLastCalledWith('short-position')

    await user.click(screen.getByRole('button', { name: 'Brush tools' }))
    expect(within(screen.getByRole('menu', { name: 'Brush tools menu' })).getAllByRole('menuitem').map((button) => button.textContent)).toEqual([
      'Brush', 'Arrow Marker', 'Rectangle', 'Rotated Rectangle', 'Path',
    ])
  })

  it('shows Zoom out only after an area zoom and restores the saved view', async () => {
    const user = userEvent.setup()
    const view = render(<DrawingToolbar />)
    expect(screen.queryByRole('button', { name: 'Zoom out to previous view' })).not.toBeInTheDocument()

    drawingSnapshot.areaZoomed = true
    view.rerender(<DrawingToolbar />)
    await user.click(screen.getByRole('button', { name: 'Zoom out to previous view' }))
    expect(engineMocks.resetAreaZoom).toHaveBeenCalledOnce()
  })

  it('offers separate drawing, indicator, and combined visibility actions', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)

    await user.click(screen.getByRole('button', { name: 'Drawing and indicator visibility' }))
    const menu = screen.getByRole('menu', { name: 'Visibility menu' })
    expect(within(menu).getByRole('menuitem', { name: 'Hide drawings' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Hide indicators' })).toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: 'Hide all' }))
    expect(engineMocks.setDrawingsHidden).toHaveBeenCalledWith(true)
    expect(engineMocks.setIndicatorsHidden).toHaveBeenCalledWith(true)
  })

  it('shows drawing and indicator counts in the remove menu', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)

    await user.click(screen.getByRole('button', { name: 'Remove drawings and indicators' }))
    const menu = screen.getByRole('menu', { name: 'Remove drawings and indicators menu' })
    expect(within(menu).getByRole('menuitem', { name: 'Remove 2 drawings' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Remove 3 indicators' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Remove 2 drawings & 3 indicators' })).toBeInTheDocument()
  })

  it('hides only the rail favorite manager while menu stars still populate the floating toolbar', async () => {
    const user = userEvent.setup()
    const view = render(<DrawingToolbar />)

    expect(screen.queryByRole('button', { name: 'Manage favorite tools' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Favorite drawing tools' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Brush tools' }))
    await user.click(within(screen.getByRole('menu', { name: 'Brush tools menu' })).getByRole('menuitemcheckbox', { name: 'Star Path' }))

    const floatingToolbar = screen.getByRole('navigation', { name: 'Favorite drawing tools' })
    expect(within(floatingToolbar).getByRole('button', { name: 'Favorite Path' })).toBeInTheDocument()
    await user.click(within(floatingToolbar).getByRole('button', { name: 'Favorite Path' }))
    expect(engineMocks.setDrawingTool).toHaveBeenLastCalledWith('path')

    view.unmount()
    render(<DrawingToolbar />)
    expect(screen.getByRole('navigation', { name: 'Favorite drawing tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Favorite Path' })).toBeInTheDocument()
  })

  it('uses a hand cursor and motion cue without turning the drag handle into a hover button', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    await user.click(screen.getByRole('button', { name: 'Brush tools' }))
    await user.click(within(screen.getByRole('menu', { name: 'Brush tools menu' })).getByRole('menuitemcheckbox', { name: 'Star Path' }))

    const handle = screen.getByRole('button', { name: 'Move favorite toolbar' })
    expect(handle).toHaveClass('cursor-grab')
    expect(handle).not.toHaveClass('hover:bg-surface-3')
    expect(handle.querySelector('svg')).toHaveClass('transition-transform')
  })

  it('keeps the rail usable while drawing is disabled', () => {
    render(<DrawingToolbar disabled />)

    expect(screen.getByRole('navigation', { name: 'Drawing tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fibonacci' })).toBeDisabled()
    expect(engineMocks.setDrawingTool).not.toHaveBeenCalled()
  })

  it('highlights only the tool that is actually active', async () => {
    const user = userEvent.setup()
    const view = render(<DrawingToolbar />)
    await user.click(screen.getByRole('button', { name: 'Brush tools' }))
    const initialMenu = screen.getByRole('menu', { name: 'Brush tools menu' })
    expect(within(initialMenu).getAllByRole('menuitem').every((item) => !item.hasAttribute('aria-current'))).toBe(true)

    drawingSnapshot.activeDrawingTool = 'path'
    view.rerender(<DrawingToolbar />)
    const activeMenu = screen.getByRole('menu', { name: 'Brush tools menu' })
    expect(within(activeMenu).getByRole('menuitem', { name: 'Path' })).toHaveAttribute('aria-current', 'true')
    expect(within(activeMenu).getByRole('menuitem', { name: 'Brush' })).not.toHaveAttribute('aria-current')
  })
})
