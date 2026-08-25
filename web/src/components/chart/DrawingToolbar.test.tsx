import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DRAWING_METADATA, type DrawingAppearance } from '../../replay/drawing-appearance'
import { CONTEXTUAL_DRAWING_TOOLBAR_POSITION_STORAGE_KEY } from '../../replay/drawing-toolbar-position'
import { defaultDrawingTemplateAppearance } from '../../replay/drawing-templates'
import { DrawingToolbar } from './DrawingToolbar'

// The contextual toolbar and the property panels are React.lazy (see
// DrawingToolbar): their first render suspends for a microtask while the
// chunk resolves. These tests are about what those panels contain, not about
// the loading boundary, so they flush that microtask right after rendering
// and keep querying synchronously.
async function flushLazyPanels(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

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
  setCursorMode: vi.fn(),
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
      { type: 'curve', name: 'Curve', category: 'shape', requiredAnchors: 3 },
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
      { type: 'fib-time-zone', name: 'Fibonacci Time Zone', category: 'fibonacci', requiredAnchors: 2 },
      { type: 'text-annotation', name: 'Text', category: 'annotation', requiredAnchors: 1 },
      { type: 'anchored-text', name: 'Anchored Text', category: 'annotation', requiredAnchors: 2 },
      { type: 'note', name: 'Note', category: 'annotation', requiredAnchors: 2 },
      { type: 'price-note', name: 'Price Note', category: 'annotation', requiredAnchors: 2 },
      { type: 'pin', name: 'Pin', category: 'annotation', requiredAnchors: 1 },
      { type: 'table', name: 'Table', category: 'annotation', requiredAnchors: 1 },
      { type: 'comment', name: 'Comment', category: 'annotation', requiredAnchors: 1 },
      { type: 'callout', name: 'Callout', category: 'annotation', requiredAnchors: 2 },
      { type: 'price-label', name: 'Price Label', category: 'annotation', requiredAnchors: 1 },
      { type: 'signpost', name: 'Signpost', category: 'annotation', requiredAnchors: 1 },
      { type: 'flag-mark', name: 'Flag Mark', category: 'annotation', requiredAnchors: 1 },
      { type: 'date-price-range', name: 'Date and Price Range', category: 'measurement', requiredAnchors: 2 },
      { type: 'price-range', name: 'Price Range', category: 'measurement', requiredAnchors: 2 },
      { type: 'date-range', name: 'Date Range', category: 'measurement', requiredAnchors: 2 },
      { type: 'arrow', name: 'Arrow', category: 'line', requiredAnchors: 2 },
    ],
    setDrawingTool: engineMocks.setDrawingTool,
    setCursorMode: engineMocks.setCursorMode,
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
  cursorMode: 'cross' as const,
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
  drawingSnapshot.cursorMode = 'cross'
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

  it('shows a configurable contextual toolbar as soon as a drawing is selected', async () => {
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
    await flushLazyPanels()

    const toolbar = await screen.findByRole('toolbar', { name: 'Selected Trend Line drawing' })
    expect(within(toolbar).getByRole('button', { name: 'Move selected drawing toolbar' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Drawing templates' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Drawing color' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Drawing text' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Drawing text' }).querySelector('[data-color-indicator="text"]')).toHaveStyle({ backgroundColor: DEFAULT_DRAWING_METADATA.textColor })
    expect(within(toolbar).getByRole('button', { name: 'Line thickness' })).toHaveTextContent('2px')
    expect(within(toolbar).getByRole('button', { name: 'Line style' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Drawing properties' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Drawing properties' }).querySelector('[data-icon="line-properties"]')).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Lock drawing' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Remove drawing' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'More drawing actions' })).toBeInTheDocument()
  })

  it('shows the complete Rectangle contextual toolbar', async () => {
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-2',
      type: 'rectangle',
      lineWidth: 2,
      extendLeft: false,
      extendRight: false,
      supportsExtend: false,
    }

    render(<DrawingToolbar />)
    await flushLazyPanels()

    const toolbar = await screen.findByRole('toolbar', { name: 'Selected Rectangle drawing' })
    expect(within(toolbar).getByRole('button', { name: 'Drawing color' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Drawing fill' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Drawing text' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Line thickness' })).toHaveTextContent('2px')
    expect(within(toolbar).getByRole('button', { name: 'Line style' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Drawing properties' }).querySelector('[data-icon="line-properties"]')).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'More drawing actions' })).toBeInTheDocument()
  })

  it('live-syncs Rectangle fill from the contextual toolbar', async () => {
    const user = userEvent.setup()
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-2', type: 'rectangle', lineWidth: 2,
      extendLeft: false, extendRight: false, supportsExtend: true,
    }

    render(<DrawingToolbar />)
    await flushLazyPanels()

    await user.click(screen.getByRole('button', { name: 'Drawing fill' }))
    await user.click(within(screen.getByRole('menu', { name: 'Drawing fill color palette' })).getByRole('menuitemradio', { name: 'Set drawing fill color #f23645' }))
    expect(engineMocks.updateSelectedDrawing).toHaveBeenLastCalledWith({ fillColor: '#f23645', fillOpacity: DEFAULT_DRAWING_METADATA.fillOpacity })
  })

  it('shows the Long Position toolbar without Create limit order and live-syncs target/stop colors', async () => {
    const user = userEvent.setup()
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'long-1', type: 'long-position', lineWidth: 1,
      extendLeft: false, extendRight: false, supportsExtend: false,
      coordinates: [{ price: 100, bar: 10 }, { price: 90, bar: 10 }, { price: 120, bar: 30 }],
    }

    render(<DrawingToolbar />)
    await flushLazyPanels()

    const toolbar = await screen.findByRole('toolbar', { name: 'Selected Long Position drawing' })
    expect(within(toolbar).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Move selected drawing toolbar',
      'Drawing templates',
      'Drawing text',
      'Position target color',
      'Position stop color',
      'Drawing properties',
      'Lock drawing',
      'Remove drawing',
      'More drawing actions',
    ])
    expect(within(toolbar).queryByRole('button', { name: /Create limit order/i })).not.toBeInTheDocument()

    await user.click(within(toolbar).getByRole('button', { name: 'Position target color' }))
    await user.click(within(screen.getByRole('menu', { name: 'Position target color palette' })).getByRole('menuitemradio', { name: 'Set position target color #ff9800' }))
    expect(engineMocks.updateSelectedDrawing).toHaveBeenLastCalledWith({ positionTargetColor: '#ff9800', positionTargetOpacity: DEFAULT_DRAWING_METADATA.positionTargetOpacity })

    await user.click(within(toolbar).getByRole('button', { name: 'Position stop color' }))
    await user.click(within(screen.getByRole('menu', { name: 'Position stop color palette' })).getByRole('menuitemradio', { name: 'Set position stop color #f23645' }))
    expect(engineMocks.updateSelectedDrawing).toHaveBeenLastCalledWith({ positionStopColor: '#f23645', positionStopOpacity: DEFAULT_DRAWING_METADATA.positionStopOpacity })
  })

  it('uses the same properties icon for every drawing type', async () => {
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'note-1', type: 'note', lineWidth: 1,
      extendLeft: false, extendRight: false, supportsExtend: false,
    }

    render(<DrawingToolbar />)
    await flushLazyPanels()

    expect(screen.getByRole('button', { name: 'Drawing properties' }).querySelector('[data-icon="line-properties"]')).toBeInTheDocument()
  })

  it('uses the line properties icon for Fibonacci Retracement', async () => {
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'fib-1', type: 'fib-retracement', lineWidth: 2,
      extendLeft: false, extendRight: false, supportsExtend: true,
    }

    render(<DrawingToolbar />)
    await flushLazyPanels()

    const toolbar = await screen.findByRole('toolbar', { name: 'Selected Fibonacci Retracement drawing' })
    expect(within(toolbar).getByRole('button', { name: 'Drawing properties' }).querySelector('[data-icon="line-properties"]')).toBeInTheDocument()
  })

  it('uses lock icons to show the current state while labels describe the action', async () => {
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-unlocked', type: 'trend-line', locked: false, lineWidth: 2,
      extendLeft: false, extendRight: false, supportsExtend: true,
    }
    const unlocked = render(<DrawingToolbar />)
    await flushLazyPanels()
    expect(screen.getByRole('button', { name: 'Lock drawing' }).querySelector('.lucide-lock-open')).toBeInTheDocument()
    unlocked.unmount()

    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-locked', type: 'trend-line', locked: true, lineWidth: 2,
      extendLeft: false, extendRight: false, supportsExtend: true,
    }
    render(<DrawingToolbar />)
    await flushLazyPanels()
    expect(screen.getByRole('button', { name: 'Unlock drawing' }).querySelector('.lucide-lock')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlock drawing' }).querySelector('.lucide-lock-open')).not.toBeInTheDocument()
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
    await flushLazyPanels()

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

  it('opens a text color palette below the drawing text trigger', async () => {
    const user = userEvent.setup()
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
    await flushLazyPanels()
    const textTrigger = screen.getByRole('button', { name: 'Drawing text' })
    Object.defineProperty(textTrigger, 'offsetLeft', { configurable: true, value: 96 })
    await user.click(textTrigger)

    const palette = screen.getByRole('menu', { name: 'Drawing text color palette' })
    expect(palette).toHaveStyle({ left: '96px' })
    await user.click(within(palette).getByRole('menuitemradio', { name: 'Set drawing text color #f23645' }))
    expect(engineMocks.updateSelectedDrawing).toHaveBeenLastCalledWith({ textColor: '#f23645' })
  })

  it('hides the selected drawing toolbar while properties are open', async () => {
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

    render(<DrawingToolbar />)
    await flushLazyPanels()

    expect(await screen.findByRole('dialog', { name: 'Edit trend-line drawing' })).toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: 'Selected Trend Line drawing' })).not.toBeInTheDocument()
  })

  it('syncs line property changes to the replay engine before Ok', async () => {
    const user = userEvent.setup()
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-1', type: 'trend-line', lineWidth: 2,
      extendLeft: false, extendRight: false, supportsExtend: true,
    }
    drawingSnapshot.drawingInspectorOpen = true
    render(<DrawingToolbar />)
    await flushLazyPanels()

    await user.click(screen.getByRole('checkbox', { name: 'Middle point' }))

    expect(engineMocks.updateSelectedDrawing).toHaveBeenCalledWith({ showMiddlePoint: true })
  })

  it('centers Fibonacci properties, hides its toolbar, and live-syncs changes', async () => {
    const user = userEvent.setup()
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'fib-1', type: 'fib-retracement', lineWidth: 2,
      extendLeft: false, extendRight: false, supportsExtend: true,
      coordinates: [{ price: 100, bar: 10 }, { price: 120, bar: 30 }],
    }
    drawingSnapshot.drawingInspectorOpen = true

    render(<DrawingToolbar />)
    await flushLazyPanels()

    const inspector = await screen.findByRole('dialog', { name: 'Edit fib-retracement drawing' })
    expect(screen.queryByRole('toolbar', { name: 'Selected Fibonacci Retracement drawing' })).not.toBeInTheDocument()
    expect(inspector.parentElement?.parentElement).toHaveClass('fixed', 'inset-0', 'items-center', 'justify-center')
    await user.click(screen.getByRole('checkbox', { name: 'Reverse' }))
    expect(engineMocks.updateSelectedDrawing).toHaveBeenCalledWith({ fibonacciReverse: true })
  })

  it('centers Rectangle properties, hides its toolbar, and live-syncs changes', async () => {
    const user = userEvent.setup()
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'rectangle-1', type: 'rectangle', lineWidth: 2,
      extendLeft: false, extendRight: false, supportsExtend: true,
      coordinates: [{ price: 100, bar: 10 }, { price: 120, bar: 30 }],
    }
    drawingSnapshot.drawingInspectorOpen = true

    render(<DrawingToolbar />)
    await flushLazyPanels()

    const inspector = await screen.findByRole('dialog', { name: 'Edit rectangle drawing' })
    expect(screen.queryByRole('toolbar', { name: 'Selected Rectangle drawing' })).not.toBeInTheDocument()
    expect(inspector.parentElement?.parentElement).toHaveClass('fixed', 'inset-0', 'items-center', 'justify-center')
    await user.click(screen.getByRole('checkbox', { name: 'Middle line' }))
    expect(engineMocks.updateSelectedDrawing).toHaveBeenCalledWith({ rectangleMiddleLine: true })
  })

  it('centers Long Position properties, hides its toolbar, and live-syncs inputs', async () => {
    const user = userEvent.setup()
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'long-1', type: 'long-position', lineWidth: 1,
      extendLeft: false, extendRight: false, supportsExtend: false,
      positionTickSize: 0.25,
      positionPricePrecision: 2,
      coordinates: [{ price: 100, bar: 10 }, { price: 90, bar: 10 }, { price: 120, bar: 30 }],
    }
    drawingSnapshot.drawingInspectorOpen = true

    render(<DrawingToolbar />)
    await flushLazyPanels()

    const inspector = await screen.findByRole('dialog', { name: 'Edit long-position drawing' })
    expect(screen.queryByRole('toolbar', { name: 'Selected Long Position drawing' })).not.toBeInTheDocument()
    expect(inspector.parentElement?.parentElement).toHaveClass('fixed', 'inset-0', 'items-center', 'justify-center')
    await user.clear(screen.getByRole('spinbutton', { name: 'Position account size' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Position account size' }), '2500')
    expect(engineMocks.updateSelectedDrawing).toHaveBeenLastCalledWith({ positionAccountSize: 2500 })
  })

  it('uses the dedicated Text toolbar with color, font size and anchor controls', async () => {
    const user = userEvent.setup()
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
    await flushLazyPanels()

    const toolbar = await screen.findByRole('toolbar', { name: 'Selected Text drawing' })
    expect(within(toolbar).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Move selected drawing toolbar',
      'Drawing templates',
      'Drawing text',
      'Font size',
      'Drawing properties',
      'Lock drawing',
      'Anchor drawing',
      'Remove drawing',
      'More drawing actions',
    ])
    await user.click(within(toolbar).getByRole('button', { name: 'Font size' }))
    await user.click(within(screen.getByRole('menu', { name: 'Font size menu' })).getByRole('menuitemradio', { name: '24' }))
    expect(engineMocks.updateSelectedDrawing).toHaveBeenLastCalledWith({ fontSize: 24 })
    const anchor = within(toolbar).getByRole('button', { name: 'Anchor drawing' })
    expect(anchor).toHaveAttribute('aria-pressed', 'false')
    await user.click(anchor)
    expect(engineMocks.updateSelectedDrawing).toHaveBeenLastCalledWith({ textAnchored: true })
  })

  it('opens the dedicated Text inspector', async () => {
    drawingSnapshot.selectedDrawing = {
      ...DEFAULT_DRAWING_METADATA,
      id: 'drawing-text', type: 'text-annotation', textColor: '#2962ff', fontSize: 14,
      extendLeft: false, extendRight: false, supportsExtend: false, lineWidth: 1,
    }
    drawingSnapshot.drawingInspectorOpen = true

    render(<DrawingToolbar />)
    await flushLazyPanels()

    await screen.findByRole('tab', { name: 'Text' })
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Text', 'Visibility'])
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveAttribute('placeholder', 'Add text')
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
    await flushLazyPanels()

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
    await flushLazyPanels()

    await user.click(screen.getByRole('button', { name: 'Drawing template' }))
    await user.click(screen.getByRole('button', { name: 'Delete Breakout template' }))

    expect(drawingTemplateMocks.persist).toHaveBeenCalledWith([])
    expect(drawingTemplateMocks.syncDelete).toHaveBeenCalledWith('template-1')
  })

  it('moves the contextual toolbar within the chart workspace', async () => {
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
    await flushLazyPanels()
    const toolbar = await screen.findByRole('toolbar', { name: 'Selected Trend Line drawing' })
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

  it('restores one contextual toolbar position for every subsequently selected drawing', async () => {
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
    await flushLazyPanels()
    expect((await screen.findByRole('toolbar', { name: 'Selected Trend Line drawing' })).parentElement).toHaveStyle({ transform: 'translate3d(240px, 96px, 0)' })
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
    await flushLazyPanels()
    expect((await screen.findByRole('toolbar', { name: 'Selected Text drawing' })).parentElement).toHaveStyle({ transform: 'translate3d(240px, 96px, 0)' })
    second.unmount()
    secondHost.remove()
  })

  it('persists contextual toolbar movement from the keyboard like the favorites bar', async () => {
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
    await flushLazyPanels()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move selected drawing toolbar' }), { key: 'ArrowRight', shiftKey: true })

    expect(JSON.parse(window.localStorage.getItem(CONTEXTUAL_DRAWING_TOOLBAR_POSITION_STORAGE_KEY) ?? 'null')).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }))
    view.unmount()
    host.remove()
  })

  it('centers the line drawing inspector above chart splitters', async () => {
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
    await flushLazyPanels()
    const inspector = await screen.findByRole('dialog', { name: 'Edit trend-line drawing' })
    const panel = inspector.parentElement
    const layer = panel?.parentElement
    expect(panel).toHaveClass('sm:w-auto')
    expect(layer).toHaveClass('fixed', 'inset-0', 'z-[80]', 'items-center', 'justify-center')
    expect(screen.getByRole('button', { name: 'Move drawing properties' })).toHaveClass('cursor-grab')
    view.unmount()
  })

  it('shows only the requested drawing groups on the rail', async () => {
    render(<DrawingToolbar />)
    await flushLazyPanels()

    expect(screen.getByRole('button', { name: 'Cursor tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Line tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fibonacci' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Projection tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Brush tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Text and notes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Range tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in chart by region' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep drawing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lock all drawings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drawing and indicator visibility' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove drawings and indicators' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arrow' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'All drawing tools' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drawing templates' })).not.toBeInTheDocument()
  })

  it('shows the complete cursor menu and activates each chart interaction mode', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    await flushLazyPanels()

    const trigger = screen.getByRole('button', { name: 'Cursor tools' })
    await user.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Cursor tools menu' })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Cross', 'Dot', 'Arrow', 'Demonstration', 'Eraser',
    ])
    expect(within(menu).getByRole('menuitem', { name: 'Cross' })).toHaveAttribute('aria-current', 'true')

    for (const [label, mode] of [
      ['Dot', 'dot'], ['Arrow', 'arrow'], ['Demonstration', 'demonstration'], ['Eraser', 'eraser'],
    ] as const) {
      if (!screen.queryByRole('menu', { name: 'Cursor tools menu' })) await user.click(trigger)
      await user.click(within(screen.getByRole('menu', { name: 'Cursor tools menu' })).getByRole('menuitem', { name: label }))
      expect(engineMocks.setCursorMode).toHaveBeenLastCalledWith(mode)
    }
  })

  it('connects rail utility actions to the active chart', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    await flushLazyPanels()

    await user.click(screen.getByRole('button', { name: 'Zoom in chart by region' }))
    await user.click(screen.getByRole('button', { name: 'Keep drawing' }))
    await user.click(screen.getByRole('button', { name: 'Lock all drawings' }))

    expect(engineMocks.beginAreaZoom).toHaveBeenCalledOnce()
    expect(engineMocks.setKeepDrawing).toHaveBeenCalledWith(true)
    expect(engineMocks.setAllDrawingsLocked).toHaveBeenCalledWith(true)
  })

  it('uses the compact graphite rail treatment and keeps destructive actions at the end', async () => {
    render(<DrawingToolbar />)
    await flushLazyPanels()

    const rail = screen.getByRole('navigation', { name: 'Drawing tools' })
    const buttons = within(rail).getAllByRole('button')
    expect(rail).toHaveClass('drawing-toolbar', 'bg-[#0d0e10]')
    expect(buttons[0]).toHaveAttribute('aria-label', 'Cursor tools')
    expect(buttons[0]).toHaveClass('drawing-tool-button')
    expect(buttons[0].querySelector('svg')).toHaveAttribute('width', '20')
    expect(buttons.at(-1)).toHaveAttribute('aria-label', 'Remove drawings and indicators')
    expect(buttons.at(-1)?.parentElement).toHaveClass('mt-auto')
    expect(buttons.every((button) => button.classList.contains('drawing-tool-button'))).toBe(true)
  })

  it('shows the complete line set with distinct geometric icons', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    await flushLazyPanels()

    await user.click(screen.getByRole('button', { name: 'Line tools' }))
    const menu = screen.getByRole('menu', { name: 'Line tools menu' })
    expect(within(menu).getAllByRole('menuitem').map((button) => button.textContent)).toEqual([
      'Trend Line', 'Ray', 'Info Line', 'Extended Line', 'Trend Angle', 'Curve', 'Horizontal Line', 'Horizontal Ray', 'Vertical Line', 'Cross Line',
    ])
    expect(new Set(within(menu).getAllByRole('menuitem').map((button) => button.querySelector('svg')?.innerHTML)).size).toBe(10)
  })

  it('shows Price Range, Date Range, and Date and Price Range in one measurement menu', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    await flushLazyPanels()

    await user.click(screen.getByRole('button', { name: 'Range tools' }))
    const menu = screen.getByRole('menu', { name: 'Range tools menu' })
    expect(within(menu).getAllByRole('menuitem').map((button) => button.textContent)).toEqual([
      'Price Range', 'Date Range', 'Date and Price Range',
    ])

    await user.click(within(menu).getByRole('menuitem', { name: 'Date Range' }))
    expect(engineMocks.setDrawingTool).toHaveBeenLastCalledWith('date-range')
  })

  it('uses the selected line icon on the rail and briefly announces its name', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    await flushLazyPanels()
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
    await flushLazyPanels()

    await user.click(screen.getByRole('button', { name: 'Text and notes' }))
    await user.click(within(screen.getByRole('menu', { name: 'Text and notes menu' })).getByRole('menuitem', { name: 'Text' }))
    expect(screen.getByRole('status')).toHaveTextContent('Text')
    await act(async () => { vi.advanceTimersByTime(1400) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('dismisses an open group menu when the user clicks outside', async () => {
    const user = userEvent.setup()
    render(<div><DrawingToolbar /><button type="button">Chart surface</button></div>)
    await flushLazyPanels()

    await user.click(screen.getByRole('button', { name: 'Line tools' }))
    expect(screen.getByRole('menu', { name: 'Line tools menu' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Chart surface' }))
    expect(screen.queryByRole('menu', { name: 'Line tools menu' })).not.toBeInTheDocument()
    expect(engineMocks.setDrawingTool).not.toHaveBeenCalled()
  })

  it('closes the menu with Escape and restores focus to its trigger', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    await flushLazyPanels()
    const trigger = screen.getByRole('button', { name: 'Brush tools' })

    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Brush tools menu' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('selects grouped and direct tools', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    await flushLazyPanels()

    await user.click(screen.getByRole('button', { name: 'Brush tools' }))
    await user.click(within(screen.getByRole('menu', { name: 'Brush tools menu' })).getByRole('menuitem', { name: 'Path' }))
    await user.click(screen.getByRole('button', { name: 'Fibonacci' }))
    await user.click(within(screen.getByRole('menu', { name: 'Fibonacci tools menu' })).getByRole('menuitem', { name: 'Fibonacci Retracement' }))
    await user.click(screen.getByRole('button', { name: 'Text and notes' }))
    await user.click(within(screen.getByRole('menu', { name: 'Text and notes menu' })).getByRole('menuitem', { name: 'Text' }))
    await user.click(screen.getByRole('button', { name: 'Range tools' }))
    await user.click(within(screen.getByRole('menu', { name: 'Range tools menu' })).getByRole('menuitem', { name: 'Date and Price Range' }))

    expect(engineMocks.setDrawingTool).toHaveBeenNthCalledWith(1, 'path')
    expect(engineMocks.setDrawingTool).toHaveBeenNthCalledWith(2, 'fib-retracement')
    expect(engineMocks.setDrawingTool).toHaveBeenNthCalledWith(3, 'text-annotation')
    expect(engineMocks.setDrawingTool).toHaveBeenNthCalledWith(4, 'date-price-range')
    expect(screen.queryByRole('menu', { name: 'Brush tools menu' })).not.toBeInTheDocument()
  })

  it('exposes Projection and the complete Brushes tool set', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    await flushLazyPanels()

    await user.click(screen.getByRole('button', { name: 'Projection tools' }))
    expect(within(screen.getByRole('menu', { name: 'Projection tools menu' })).getAllByRole('menuitem').map((button) => button.textContent)).toEqual(['Long Position', 'Short Position'])
    await user.click(within(screen.getByRole('menu', { name: 'Projection tools menu' })).getByRole('menuitem', { name: 'Short Position' }))
    expect(engineMocks.setDrawingTool).toHaveBeenLastCalledWith('short-position')

    await user.click(screen.getByRole('button', { name: 'Brush tools' }))
    expect(within(screen.getByRole('menu', { name: 'Brush tools menu' })).getAllByRole('menuitem').map((button) => button.textContent)).toEqual([
      'Brush', 'Arrow Marker', 'Rectangle', 'Rotated Rectangle', 'Path',
    ])
  })

  it('exposes Fibonacci Time Zone and the requested Text & Notes tools', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    await flushLazyPanels()

    await user.click(screen.getByRole('button', { name: 'Fibonacci' }))
    expect(within(screen.getByRole('menu', { name: 'Fibonacci tools menu' })).getAllByRole('menuitem').map((button) => button.textContent)).toEqual([
      'Fibonacci Retracement', 'Fibonacci Time Zone',
    ])
    await user.click(within(screen.getByRole('menu', { name: 'Fibonacci tools menu' })).getByRole('menuitem', { name: 'Fibonacci Time Zone' }))
    expect(engineMocks.setDrawingTool).toHaveBeenLastCalledWith('fib-time-zone')

    await user.click(screen.getByRole('button', { name: 'Text and notes' }))
    const textMenu = screen.getByRole('menu', { name: 'Text and notes menu' })
    expect(within(textMenu).getAllByRole('menuitem').map((button) => button.textContent)).toEqual([
      'Text', 'Anchored Text', 'Note', 'Price Note', 'Pin', 'Table', 'Callout', 'Comment', 'Price Label', 'Signpost', 'Flag Mark',
    ])
    expect(Array.from(textMenu.querySelectorAll('[data-annotation-icon]')).map((icon) => icon.getAttribute('data-annotation-icon'))).toEqual([
      'text-annotation', 'anchored-text', 'note', 'price-note', 'pin', 'table', 'callout', 'comment', 'price-label', 'signpost', 'flag-mark',
    ])
  })

  it('shows Zoom out only after an area zoom and restores the saved view', async () => {
    const user = userEvent.setup()
    const view = render(<DrawingToolbar />)
    await flushLazyPanels()
    expect(screen.queryByRole('button', { name: 'Zoom out to previous view' })).not.toBeInTheDocument()

    drawingSnapshot.areaZoomed = true
    view.rerender(<DrawingToolbar />)
    await flushLazyPanels()
    await user.click(screen.getByRole('button', { name: 'Zoom out to previous view' }))
    expect(engineMocks.resetAreaZoom).toHaveBeenCalledOnce()
  })

  it('offers separate drawing, indicator, and combined visibility actions', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    await flushLazyPanels()

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
    await flushLazyPanels()

    await user.click(screen.getByRole('button', { name: 'Remove drawings and indicators' }))
    const menu = screen.getByRole('menu', { name: 'Remove drawings and indicators menu' })
    expect(within(menu).getByRole('menuitem', { name: 'Remove 2 drawings' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Remove 3 indicators' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Remove 2 drawings & 3 indicators' })).toBeInTheDocument()
  })

  it('hides only the rail favorite manager while menu stars still populate the floating toolbar', async () => {
    const user = userEvent.setup()
    const view = render(<DrawingToolbar />)
    await flushLazyPanels()

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
    await flushLazyPanels()
    expect(screen.getByRole('navigation', { name: 'Favorite drawing tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Favorite Path' })).toBeInTheDocument()
  })

  it('uses a hand cursor and motion cue without turning the drag handle into a hover button', async () => {
    const user = userEvent.setup()
    render(<DrawingToolbar />)
    await flushLazyPanels()
    await user.click(screen.getByRole('button', { name: 'Brush tools' }))
    await user.click(within(screen.getByRole('menu', { name: 'Brush tools menu' })).getByRole('menuitemcheckbox', { name: 'Star Path' }))

    const handle = screen.getByRole('button', { name: 'Move favorite toolbar' })
    expect(handle).toHaveClass('cursor-grab')
    expect(handle).not.toHaveClass('hover:bg-surface-3')
    expect(handle.querySelector('svg')).toHaveClass('transition-transform')
  })

  it('keeps the rail usable while drawing is disabled', async () => {
    render(<DrawingToolbar disabled />)
    await flushLazyPanels()

    expect(screen.getByRole('navigation', { name: 'Drawing tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fibonacci' })).toBeDisabled()
    expect(engineMocks.setDrawingTool).not.toHaveBeenCalled()
  })

  it('highlights only the tool that is actually active', async () => {
    const user = userEvent.setup()
    const view = render(<DrawingToolbar />)
    await flushLazyPanels()
    await user.click(screen.getByRole('button', { name: 'Brush tools' }))
    const initialMenu = screen.getByRole('menu', { name: 'Brush tools menu' })
    expect(within(initialMenu).getAllByRole('menuitem').every((item) => !item.hasAttribute('aria-current'))).toBe(true)

    drawingSnapshot.activeDrawingTool = 'path'
    view.rerender(<DrawingToolbar />)
    await flushLazyPanels()
    const activeMenu = screen.getByRole('menu', { name: 'Brush tools menu' })
    expect(within(activeMenu).getByRole('menuitem', { name: 'Path' })).toHaveAttribute('aria-current', 'true')
    expect(within(activeMenu).getByRole('menuitem', { name: 'Brush' })).not.toHaveAttribute('aria-current')
  })
})
