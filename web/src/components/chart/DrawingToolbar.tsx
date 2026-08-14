import { ArrowUpRight, Brush, ChevronDown, Crosshair, Eye, EyeOff, GripVertical, LineChart, ListFilter, Lock, LockOpen, Minus, PencilLine, Repeat2, Ruler, Spline, Square, Star, Trash2, TrendingDown, TrendingUp, Type, Waves, ZoomIn, ZoomOut, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { useDismissableLayer, type DismissReason } from '../../hooks/use-dismissable-layer'
import {
  loadDrawingFavorites,
  persistDrawingFavorites,
  toggleDrawingFavorite,
  type DrawingFavoriteToolType,
} from '../../replay/drawing-favorites'
import {
  loadDrawingToolbarPosition,
  persistDrawingToolbarPosition,
  type DrawingToolbarPosition,
} from '../../replay/drawing-toolbar-position'
import { replayEngine } from '../../replay/replay-engine'
import {
  defaultDrawingTemplateAppearance,
  deleteDrawingTemplate,
  loadDrawingTemplates,
  persistDrawingTemplates,
  saveNamedDrawingTemplate,
  syncDrawingTemplateDelete,
  syncDrawingTemplateUpsert,
  type DrawingTemplate,
} from '../../replay/drawing-templates'
import { useReplaySelector } from '../../replay/use-replay'
import { DrawingInspector } from './DrawingInspector'
import { SelectedDrawingToolbar } from './SelectedDrawingToolbar'

const LINE_TOOL_TYPES = ['trend-line', 'ray', 'info-line', 'extended-line', 'trend-angle', 'horizontal-line', 'horizontal-ray', 'vertical-line', 'cross-line'] as const
const PROJECTION_TOOL_TYPES = ['long-position', 'short-position'] as const
const BRUSH_TOOL_TYPES = ['brush', 'arrow-marker', 'rectangle', 'rotated-rectangle', 'path'] as const

interface DrawingToolItem {
  type: DrawingFavoriteToolType
  name: string
}

interface DrawingToolbarProps {
  disabled?: boolean
}

interface ToolIconProps {
  type: string
  size?: number
}

interface ToolbarDragState {
  pointerId: number
  pointerX: number
  pointerY: number
  toolbarX: number
  toolbarY: number
  moved: boolean
}

interface InspectorDragState {
  pointerId: number
  pointerX: number
  pointerY: number
  inspectorX: number
  inspectorY: number
}

const FLOATING_TOOLBAR_BOUNDARY = 8
const FLOATING_TOOLBAR_DEFAULT_TOP = 44
const DRAWING_INSPECTOR_BOUNDARY = 8
const DRAWING_INSPECTOR_DEFAULT_LEFT = 60

const DRAWING_TOOLS: readonly DrawingToolItem[] = [
  { type: 'trend-line', name: 'Trend Line' },
  { type: 'ray', name: 'Ray' },
  { type: 'info-line', name: 'Info Line' },
  { type: 'extended-line', name: 'Extended Line' },
  { type: 'trend-angle', name: 'Trend Angle' },
  { type: 'horizontal-line', name: 'Horizontal Line' },
  { type: 'horizontal-ray', name: 'Horizontal Ray' },
  { type: 'vertical-line', name: 'Vertical Line' },
  { type: 'cross-line', name: 'Cross Line' },
  { type: 'fib-retracement', name: 'Fibonacci Retracement' },
  { type: 'long-position', name: 'Long Position' },
  { type: 'short-position', name: 'Short Position' },
  { type: 'brush', name: 'Brush' },
  { type: 'arrow-marker', name: 'Arrow Marker' },
  { type: 'rectangle', name: 'Rectangle' },
  { type: 'rotated-rectangle', name: 'Rotated Rectangle' },
  { type: 'path', name: 'Path' },
  { type: 'text-annotation', name: 'Text' },
  { type: 'date-price-range', name: 'Measure' },
]

const lineTools = LINE_TOOL_TYPES.flatMap((type) => DRAWING_TOOLS.find((tool) => tool.type === type) ?? [])
const projectionTools = PROJECTION_TOOL_TYPES.flatMap((type) => DRAWING_TOOLS.find((tool) => tool.type === type) ?? [])
const brushTools = BRUSH_TOOL_TYPES.flatMap((type) => DRAWING_TOOLS.find((tool) => tool.type === type) ?? [])
const fibonacciTool = DRAWING_TOOLS.find((tool) => tool.type === 'fib-retracement')
const textTool = DRAWING_TOOLS.find((tool) => tool.type === 'text-annotation')
const measureTool = DRAWING_TOOLS.find((tool) => tool.type === 'date-price-range')

type OpenMenu = 'brushes' | 'delete' | 'lines' | 'projection' | 'visibility' | null

interface ToolFeedback {
  label: string
  top: number
}

function LineToolIcon({ type, size = 18 }: ToolIconProps): ReactElement {
  const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.35 }
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" {...common}>
      {type === 'trend-line' ? <><path d="M4 18 20 6" /><circle cx="4" cy="18" r="1.35" /><circle cx="20" cy="6" r="1.35" /></> : null}
      {type === 'ray' ? <><path d="m4 18 16-12" /><circle cx="4" cy="18" r="1.35" /><circle cx="11" cy="12.75" r="1.15" /></> : null}
      {type === 'info-line' ? <><path d="M3.5 18.5 19 6" /><circle cx="3.5" cy="18.5" r="1.25" /><circle cx="19" cy="6" r="1.25" /><path d="M14.5 17.5h5v3h-5z" /></> : null}
      {type === 'extended-line' ? <><path d="M2.5 20.5 21.5 3.5" /><circle cx="8.25" cy="15.35" r="1.25" /><circle cx="15.75" cy="8.65" r="1.25" /></> : null}
      {type === 'trend-angle' ? <><path d="M3 18.5h18M4 18.5 16.5 7" /><path d="M8 18.5a4 4 0 0 1 1.2-2.85" /><circle cx="4" cy="18.5" r="1.2" /><circle cx="16.5" cy="7" r="1.2" /></> : null}
      {type === 'horizontal-line' ? <><path d="M3 12h18" /><circle cx="12" cy="12" r="1.25" /></> : null}
      {type === 'horizontal-ray' ? <><path d="M4 12h17" /><circle cx="4" cy="12" r="1.3" /></> : null}
      {type === 'vertical-line' ? <><path d="M12 3v18" /><circle cx="12" cy="12" r="1.3" /></> : null}
      {type === 'cross-line' ? <><path d="M3 12h18M12 3v18" /><circle cx="12" cy="12" r="1.3" /></> : null}
    </svg>
  )
}

function ToolIcon({ type, size = 16 }: ToolIconProps): ReactElement {
  if ((LINE_TOOL_TYPES as readonly string[]).includes(type)) return <LineToolIcon type={type} size={size} />
  let Icon: LucideIcon = PencilLine
  if (type === 'date-price-range') Icon = Ruler
  else if (type === 'brush') Icon = Brush
  else if (type === 'arrow-marker') Icon = ArrowUpRight
  else if (type === 'long-position') Icon = TrendingUp
  else if (type === 'short-position') Icon = TrendingDown
  else if (type === 'path') Icon = Spline
  else if (type.includes('horizontal')) Icon = Minus
  else if (type.includes('rectangle')) Icon = Square
  else if (type.includes('fib')) Icon = Waves
  else if (type.includes('text')) Icon = Type
  else if (type.includes('line') || type.includes('ray') || type.includes('trend')) Icon = LineChart
  return <Icon size={size} strokeWidth={1.75} />
}

export function DrawingToolbar({ disabled = false }: DrawingToolbarProps): ReactElement {
  const replay = useReplaySelector((snapshot) => ({
    activeDrawingTool: snapshot.activeDrawingTool,
    selectedDrawing: snapshot.selectedDrawing,
    drawingInspectorOpen: snapshot.drawingInspectorOpen,
    keepDrawing: snapshot.keepDrawing,
    drawingsLocked: snapshot.drawingsLocked,
    drawingsHidden: snapshot.drawingsHidden,
    indicatorsHidden: snapshot.indicatorsHidden,
    areaZoomSelecting: snapshot.areaZoomSelecting,
    areaZoomed: snapshot.areaZoomed,
    indicators: snapshot.indicators,
  }))
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [favorites, setFavorites] = useState<DrawingFavoriteToolType[]>(loadDrawingFavorites)
  const [floatingDragging, setFloatingDragging] = useState<boolean>(false)
  const [inspectorDragging, setInspectorDragging] = useState<boolean>(false)
  const [templates, setTemplates] = useState<DrawingTemplate[]>(loadDrawingTemplates)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [selectedLineTool, setSelectedLineTool] = useState<DrawingFavoriteToolType>('trend-line')
  const [selectedBrushTool, setSelectedBrushTool] = useState<DrawingFavoriteToolType>('brush')
  const [selectedProjectionTool, setSelectedProjectionTool] = useState<DrawingFavoriteToolType>('long-position')
  const [drawingCount, setDrawingCount] = useState<number>(0)
  const [toolFeedback, setToolFeedback] = useState<ToolFeedback | null>(null)
  const toolbarRef = useRef<HTMLElement>(null)
  const floatingToolbarRef = useRef<HTMLElement>(null)
  const floatingPositionRef = useRef<DrawingToolbarPosition | null>(null)
  const floatingDragRef = useRef<ToolbarDragState | null>(null)
  const floatingPositionCustomizedRef = useRef<boolean>(false)
  const inspectorRef = useRef<HTMLDivElement>(null)
  const inspectorPositionRef = useRef<DrawingToolbarPosition | null>(null)
  const inspectorDragRef = useRef<InspectorDragState | null>(null)
  const lastMenuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const favoriteTools = favorites.flatMap((type) => DRAWING_TOOLS.find((tool) => tool.type === type) ?? [])
  const selectedLine = lineTools.find((tool) => tool.type === selectedLineTool) ?? lineTools[0]
  const selectedBrush = brushTools.find((tool) => tool.type === selectedBrushTool) ?? brushTools[0]
  const selectedProjection = projectionTools.find((tool) => tool.type === selectedProjectionTool) ?? projectionTools[0]
  const selectedDrawingName = replay.selectedDrawing
    ? DRAWING_TOOLS.find((tool) => tool.type === replay.selectedDrawing?.type)?.name ?? replay.selectedDrawing.type
    : ''

  useEffect(() => {
    if (!toolFeedback) return
    const timer = window.setTimeout(() => setToolFeedback(null), 1400)
    return () => window.clearTimeout(timer)
  }, [toolFeedback])

  const showToolFeedback = (label: string, anchor?: HTMLElement | null): void => {
    setToolFeedback({ label, top: (anchor?.offsetTop ?? 8) + 1 })
  }

  const applyFloatingPosition = useCallback((position: DrawingToolbarPosition): DrawingToolbarPosition | null => {
    const toolbar = floatingToolbarRef.current
    const container = toolbar?.parentElement
    if (!toolbar || !container) return null
    const maxX = Math.max(FLOATING_TOOLBAR_BOUNDARY, container.clientWidth - toolbar.offsetWidth - FLOATING_TOOLBAR_BOUNDARY)
    const maxY = Math.max(FLOATING_TOOLBAR_BOUNDARY, container.clientHeight - toolbar.offsetHeight - FLOATING_TOOLBAR_BOUNDARY)
    const next = {
      x: Math.min(Math.max(position.x, FLOATING_TOOLBAR_BOUNDARY), maxX),
      y: Math.min(Math.max(position.y, FLOATING_TOOLBAR_BOUNDARY), maxY),
    }
    floatingPositionRef.current = next
    toolbar.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`
    return next
  }, [])

  const defaultFloatingPosition = useCallback((): DrawingToolbarPosition => {
    const toolbar = floatingToolbarRef.current
    const container = toolbar?.parentElement
    if (!toolbar || !container) return { x: FLOATING_TOOLBAR_BOUNDARY, y: FLOATING_TOOLBAR_DEFAULT_TOP }
    return {
      x: Math.max(FLOATING_TOOLBAR_BOUNDARY, (container.clientWidth - toolbar.offsetWidth) / 2),
      y: FLOATING_TOOLBAR_DEFAULT_TOP,
    }
  }, [])

  useLayoutEffect(() => {
    const toolbar = floatingToolbarRef.current
    const container = toolbar?.parentElement
    if (!toolbar || !container) return

    if (!floatingPositionRef.current) {
      const stored = loadDrawingToolbarPosition()
      floatingPositionCustomizedRef.current = stored !== null
      floatingPositionRef.current = stored
    }

    const syncPosition = (): void => {
      const position = floatingPositionCustomizedRef.current && floatingPositionRef.current
        ? floatingPositionRef.current
        : defaultFloatingPosition()
      applyFloatingPosition(position)
    }

    syncPosition()
    if (typeof ResizeObserver === 'undefined') return
    const resizeObserver = new ResizeObserver(syncPosition)
    resizeObserver.observe(container)
    resizeObserver.observe(toolbar)
    return () => resizeObserver.disconnect()
  }, [applyFloatingPosition, defaultFloatingPosition, favoriteTools.length])

  const applyInspectorPosition = useCallback((position: DrawingToolbarPosition): DrawingToolbarPosition | null => {
    const inspector = inspectorRef.current
    const container = inspector?.parentElement
    if (!inspector || !container || window.innerWidth < 640) return null
    const maxX = Math.max(DRAWING_INSPECTOR_BOUNDARY, container.clientWidth - inspector.offsetWidth - DRAWING_INSPECTOR_BOUNDARY)
    const maxY = Math.max(DRAWING_INSPECTOR_BOUNDARY, container.clientHeight - inspector.offsetHeight - DRAWING_INSPECTOR_BOUNDARY)
    const next = {
      x: Math.min(Math.max(position.x, DRAWING_INSPECTOR_BOUNDARY), maxX),
      y: Math.min(Math.max(position.y, DRAWING_INSPECTOR_BOUNDARY), maxY),
    }
    inspectorPositionRef.current = next
    inspector.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`
    return next
  }, [])

  useLayoutEffect(() => {
    const inspector = inspectorRef.current
    const container = inspector?.parentElement
    if (!replay.drawingInspectorOpen || !inspector || !container) return
    const syncPosition = (): void => {
      if (window.innerWidth < 640) {
        inspector.style.transform = ''
        return
      }
      applyInspectorPosition(inspectorPositionRef.current ?? { x: DRAWING_INSPECTOR_DEFAULT_LEFT, y: DRAWING_INSPECTOR_BOUNDARY })
    }
    syncPosition()
    window.addEventListener('resize', syncPosition)
    if (typeof ResizeObserver === 'undefined') return () => window.removeEventListener('resize', syncPosition)
    const resizeObserver = new ResizeObserver(syncPosition)
    resizeObserver.observe(container)
    resizeObserver.observe(inspector)
    return () => {
      window.removeEventListener('resize', syncPosition)
      resizeObserver.disconnect()
    }
  }, [applyInspectorPosition, replay.drawingInspectorOpen, replay.selectedDrawing?.type])

  const startInspectorDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (window.innerWidth < 640 || event.button !== 0 || event.isPrimary === false) return
    const position = inspectorPositionRef.current ?? applyInspectorPosition({ x: DRAWING_INSPECTOR_DEFAULT_LEFT, y: DRAWING_INSPECTOR_BOUNDARY })
    if (!position) return
    inspectorDragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      inspectorX: position.x,
      inspectorY: position.y,
    }
    if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId)
    setInspectorDragging(true)
    event.preventDefault()
  }

  const moveInspector = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = inspectorDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    applyInspectorPosition({
      x: drag.inspectorX + event.clientX - drag.pointerX,
      y: drag.inspectorY + event.clientY - drag.pointerY,
    })
    event.preventDefault()
  }

  const stopInspectorDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = inspectorDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    inspectorDragRef.current = null
    if (typeof event.currentTarget.hasPointerCapture === 'function' && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setInspectorDragging(false)
  }

  const moveInspectorWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (window.innerWidth < 640) return
    const distance = event.shiftKey ? 10 : 1
    const offsets: Partial<Record<string, DrawingToolbarPosition>> = {
      ArrowDown: { x: 0, y: distance },
      ArrowLeft: { x: -distance, y: 0 },
      ArrowRight: { x: distance, y: 0 },
      ArrowUp: { x: 0, y: -distance },
    }
    const offset = offsets[event.key]
    if (!offset) return
    event.preventDefault()
    const current = inspectorPositionRef.current ?? applyInspectorPosition({ x: DRAWING_INSPECTOR_DEFAULT_LEFT, y: DRAWING_INSPECTOR_BOUNDARY })
    if (!current) return
    applyInspectorPosition({ x: current.x + offset.x, y: current.y + offset.y })
  }

  const dismissMenus = useCallback((reason: DismissReason): void => {
    setOpenMenu(null)
    if (reason === 'escape') queueMicrotask(() => lastMenuTriggerRef.current?.focus())
  }, [])

  useDismissableLayer({ open: openMenu !== null, layerRef: toolbarRef, onDismiss: dismissMenus })

  const toggleMenu = (menu: Exclude<OpenMenu, null>, event: ReactMouseEvent<HTMLButtonElement>): void => {
    lastMenuTriggerRef.current = event.currentTarget
    if (menu === 'delete') setDrawingCount(replayEngine.drawingCount())
    setOpenMenu((current) => current === menu ? null : menu)
  }

  const choose = (tool: string | null, keepNextAppearance: boolean = false, label?: string, anchor?: HTMLElement | null): void => {
    if (disabled) return
    if (!keepNextAppearance) replayEngine.setNextDrawingAppearance(null)
    replayEngine.setDrawingTool(tool)
    setOpenMenu(null)
    if (label) showToolFeedback(label, anchor ?? lastMenuTriggerRef.current)
  }

  const toggleFavorite = (type: DrawingFavoriteToolType): void => {
    const next = toggleDrawingFavorite(favorites, type)
    try {
      persistDrawingFavorites(next)
      setFavorites(next)
    } catch (error) {
      showToolFeedback(error instanceof Error ? error.message : 'Could not save favorite drawing tools', lastMenuTriggerRef.current)
    }
  }

  const commitFloatingPosition = (): void => {
    const position = floatingPositionRef.current
    if (!position) return
    try {
      persistDrawingToolbarPosition(position)
    } catch (error) {
      showToolFeedback(error instanceof Error ? error.message : 'Could not save the favorite toolbar position', floatingToolbarRef.current)
    }
  }

  const startFloatingDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || event.isPrimary === false) return
    const position = floatingPositionRef.current ?? applyFloatingPosition(defaultFloatingPosition())
    if (!position) return
    floatingDragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      toolbarX: position.x,
      toolbarY: position.y,
      moved: false,
    }
    if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId)
    setFloatingDragging(true)
    event.preventDefault()
  }

  const moveFloatingToolbar = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = floatingDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.moved = true
    floatingPositionCustomizedRef.current = true
    applyFloatingPosition({
      x: drag.toolbarX + event.clientX - drag.pointerX,
      y: drag.toolbarY + event.clientY - drag.pointerY,
    })
    event.preventDefault()
  }

  const stopFloatingDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = floatingDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    floatingDragRef.current = null
    if (typeof event.currentTarget.hasPointerCapture === 'function' && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setFloatingDragging(false)
    if (drag.moved) commitFloatingPosition()
  }

  const moveFloatingToolbarWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const distance = event.shiftKey ? 10 : 1
    const offsets: Partial<Record<string, DrawingToolbarPosition>> = {
      ArrowDown: { x: 0, y: distance },
      ArrowLeft: { x: -distance, y: 0 },
      ArrowRight: { x: distance, y: 0 },
      ArrowUp: { x: 0, y: -distance },
    }
    const offset = offsets[event.key]
    if (!offset) return
    event.preventDefault()
    floatingPositionCustomizedRef.current = true
    const current = floatingPositionRef.current ?? applyFloatingPosition(defaultFloatingPosition())
    if (!current) return
    applyFloatingPosition({ x: current.x + offset.x, y: current.y + offset.y })
    commitFloatingPosition()
  }

  const commitTemplates = (next: DrawingTemplate[], sync: { type: 'upsert'; template: DrawingTemplate } | { type: 'delete'; id: string }): void => {
    try {
      persistDrawingTemplates(next)
      setTemplates(next)
      setTemplateError(null)
      if (sync.type === 'upsert') syncDrawingTemplateUpsert(sync.template)
      else syncDrawingTemplateDelete(sync.id)
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Could not save drawing templates')
    }
  }

  const saveTemplate = (name: string): void => {
    if (!replay.selectedDrawing) return
    try {
      const next = saveNamedDrawingTemplate(templates, name, replay.selectedDrawing)
      // saveNamedDrawingTemplate only ever creates a new object reference for
      // the entry it added or updated — every unchanged entry keeps its prior
      // reference, so this finds "the one that changed" without redoing its
      // name/tool-type matching.
      const saved = next.find((template) => !templates.includes(template))
      if (saved) commitTemplates(next, { type: 'upsert', template: saved })
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Could not save drawing template')
    }
  }

  const applyTemplate = (template: DrawingTemplate): void => {
    replayEngine.updateSelectedDrawing(template.appearance)
  }

  const applyDefaultTemplate = (): void => {
    const drawing = replay.selectedDrawing
    if (drawing) replayEngine.updateSelectedDrawing(defaultDrawingTemplateAppearance(drawing))
  }

  const favoriteToggle = (tool: DrawingToolItem): ReactElement => {
    const favorite = favorites.includes(tool.type)
    return (
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={favorite}
        aria-label={`${favorite ? 'Unstar' : 'Star'} ${tool.name}`}
        onClick={() => toggleFavorite(tool.type)}
        className="grid size-8 shrink-0 place-items-center rounded-control text-muted hover:bg-surface-3 hover:text-ink"
        title={`${favorite ? 'Remove' : 'Add'} ${tool.name} ${favorite ? 'from' : 'to'} favorites`}
      >
        <Star size={13} strokeWidth={1.75} fill={favorite ? 'currentColor' : 'none'} />
      </button>
    )
  }

  return (
    <>
      <nav ref={toolbarRef} className="drawing-toolbar relative z-50 flex h-full shrink-0 flex-col items-center border-r border-line bg-[#0d0e10] px-1.5 py-2" aria-label="Drawing tools">
        <button type="button" disabled={disabled} onClick={(event) => choose(null, false, 'Crosshair', event.currentTarget)} aria-label="Crosshair" aria-pressed={replay.activeDrawingTool === null} className="drawing-tool-button disabled:cursor-not-allowed disabled:opacity-40" title="Crosshair (Esc)">
          <Crosshair size={20} strokeWidth={1.4} />
        </button>

        <div className="relative">
          <button type="button" onClick={(event) => toggleMenu('lines', event)} className="drawing-tool-button relative" aria-label="Line tools" aria-expanded={openMenu === 'lines'} aria-pressed={LINE_TOOL_TYPES.some((type) => replay.activeDrawingTool === type)} title="Lines">
            <LineToolIcon type={selectedLine.type} size={20} />
            <ChevronDown aria-hidden="true" className="absolute bottom-1 right-1" size={7} strokeWidth={1.75} />
          </button>
          {openMenu === 'lines' ? (
            <div role="menu" aria-label="Line tools menu" className="absolute left-[calc(100%+0.25rem)] top-0 w-64 rounded-panel border border-line bg-[#191a1d] p-1 shadow-overlay">
              <div aria-hidden="true" className="px-1.5 pb-1 pt-0.5 text-ui-meta font-medium text-dim">LINES</div>
              {lineTools.map((tool) => (
                <div key={tool.type} role="none" className="flex items-center">
                  <button role="menuitem" type="button" disabled={disabled} aria-current={replay.activeDrawingTool === tool.type ? 'true' : undefined} onClick={() => { setSelectedLineTool(tool.type); choose(tool.type, false, tool.name) }} className="flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-control px-1.5 text-left text-ui-control text-muted hover:bg-surface-3 hover:text-ink aria-current:bg-surface-3 aria-current:text-ink disabled:cursor-not-allowed disabled:opacity-40">
                    <span aria-hidden="true" className="flex w-5 justify-center text-ink"><LineToolIcon type={tool.type} size={18} /></span><span>{tool.name}</span>
                  </button>
                  {favoriteToggle(tool)}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {fibonacciTool ? (
          <button type="button" disabled={disabled} onClick={(event) => choose(fibonacciTool.type, false, fibonacciTool.name, event.currentTarget)} aria-label="Fibonacci" aria-pressed={replay.activeDrawingTool === fibonacciTool.type} className="drawing-tool-button disabled:cursor-not-allowed disabled:opacity-40" title="Fibonacci Retracement · one drawing">
            <ListFilter size={20} strokeWidth={1.4} />
          </button>
        ) : null}

        <div className="relative">
          <button type="button" onClick={(event) => toggleMenu('projection', event)} className="drawing-tool-button relative" aria-label="Projection tools" aria-expanded={openMenu === 'projection'} aria-pressed={PROJECTION_TOOL_TYPES.some((type) => replay.activeDrawingTool === type)} title="Projection">
            <ToolIcon type={selectedProjection.type} size={20} />
            <ChevronDown aria-hidden="true" className="absolute bottom-1 right-1" size={7} strokeWidth={1.75} />
          </button>
          {openMenu === 'projection' ? (
            <div role="menu" aria-label="Projection tools menu" className="absolute left-[calc(100%+0.25rem)] top-0 w-52 rounded-panel border border-line bg-[#191a1d] p-1 shadow-overlay">
              <div aria-hidden="true" className="px-1.5 pb-1 pt-0.5 text-ui-meta font-medium text-dim">PROJECTION</div>
              {projectionTools.map((tool) => (
                <div key={tool.type} role="none" className="flex items-center">
                  <button role="menuitem" type="button" disabled={disabled} aria-current={replay.activeDrawingTool === tool.type ? 'true' : undefined} onClick={() => { setSelectedProjectionTool(tool.type); choose(tool.type, false, tool.name) }} className="flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-control px-1.5 text-left text-ui-control text-muted hover:bg-surface-3 hover:text-ink aria-current:bg-surface-3 aria-current:text-ink disabled:cursor-not-allowed disabled:opacity-40">
                    <span aria-hidden="true" className="flex w-5 justify-center text-ink"><ToolIcon type={tool.type} size={17} /></span><span>{tool.name}</span>
                  </button>
                  {favoriteToggle(tool)}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="relative">
          <button type="button" onClick={(event) => toggleMenu('brushes', event)} className="drawing-tool-button relative" aria-label="Brush tools" aria-expanded={openMenu === 'brushes'} aria-pressed={BRUSH_TOOL_TYPES.some((type) => replay.activeDrawingTool === type)} title="Brushes">
            <ToolIcon type={selectedBrush.type} size={20} />
            <ChevronDown aria-hidden="true" className="absolute bottom-1 right-1" size={7} strokeWidth={1.75} />
          </button>
          {openMenu === 'brushes' ? (
            <div role="menu" aria-label="Brush tools menu" className="absolute left-[calc(100%+0.25rem)] top-0 w-52 rounded-panel border border-line bg-[#191a1d] p-1 shadow-overlay">
              <div aria-hidden="true" className="px-1.5 pb-1 pt-0.5 text-ui-meta font-medium text-dim">BRUSHES</div>
              {brushTools.map((tool) => (
                <div key={tool.type} role="none" className="flex items-center">
                  <button role="menuitem" type="button" disabled={disabled} aria-current={replay.activeDrawingTool === tool.type ? 'true' : undefined} onClick={() => { setSelectedBrushTool(tool.type); choose(tool.type, false, tool.name) }} className="flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-control px-1.5 text-left text-ui-control text-muted hover:bg-surface-3 hover:text-ink aria-current:bg-surface-3 aria-current:text-ink disabled:cursor-not-allowed disabled:opacity-40">
                    <span aria-hidden="true" className="flex w-5 justify-center text-ink"><ToolIcon type={tool.type} size={17} /></span><span>{tool.name}</span>
                  </button>
                  {favoriteToggle(tool)}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {textTool ? <button type="button" disabled={disabled} onClick={(event) => choose(textTool.type, false, textTool.name, event.currentTarget)} aria-label="Text" aria-pressed={replay.activeDrawingTool === textTool.type} className="drawing-tool-button disabled:cursor-not-allowed disabled:opacity-40" title="Text · one drawing"><Type size={20} strokeWidth={1.4} /></button> : null}

        <span aria-hidden="true" className="my-2 h-px w-8 shrink-0 bg-line-strong/70" />

        {measureTool ? <button type="button" disabled={disabled} onClick={(event) => choose(measureTool.type, false, measureTool.name, event.currentTarget)} aria-label="Measure" aria-pressed={replay.activeDrawingTool === measureTool.type} className="drawing-tool-button disabled:cursor-not-allowed disabled:opacity-40" title="Measure · hold Shift for mouse-down, then release and drag · clears on next chart action"><Ruler size={20} strokeWidth={1.4} /></button> : null}

        <button type="button" disabled={disabled} onClick={(event) => { replayEngine.beginAreaZoom(); showToolFeedback('Drag a region or press Enter to zoom', event.currentTarget) }} className="drawing-tool-button disabled:cursor-not-allowed disabled:opacity-40" aria-label="Zoom in chart by region" aria-pressed={replay.areaZoomSelecting} title="Zoom in · drag a region or press Enter"><ZoomIn size={20} strokeWidth={1.4} /></button>
        {replay.areaZoomed ? <button type="button" disabled={disabled} onClick={(event) => { replayEngine.resetAreaZoom(); showToolFeedback('Zoom reset', event.currentTarget) }} className="drawing-tool-button disabled:cursor-not-allowed disabled:opacity-40" aria-label="Zoom out to previous view" title="Zoom out to original view"><ZoomOut size={20} strokeWidth={1.4} /></button> : null}

        <span aria-hidden="true" className="my-2 h-px w-8 shrink-0 bg-line-strong/70" />

        <button type="button" disabled={disabled} onClick={(event) => { replayEngine.setKeepDrawing(!replay.keepDrawing); showToolFeedback(replay.keepDrawing ? 'Keep drawing off' : 'Keep drawing on', event.currentTarget) }} className="drawing-tool-button relative disabled:cursor-not-allowed disabled:opacity-40" aria-label="Keep drawing" aria-pressed={replay.keepDrawing} title="Keep drawing">
          <Repeat2 size={19} strokeWidth={1.4} />
          {replay.keepDrawing ? <Lock aria-hidden="true" className="absolute bottom-0.5 right-0.5 rounded-sm bg-[#0d0e10]" size={9} strokeWidth={2} /> : <LockOpen aria-hidden="true" className="absolute bottom-0.5 right-0.5 rounded-sm bg-[#0d0e10]" size={9} strokeWidth={2} />}
        </button>

        <button type="button" disabled={disabled} onClick={(event) => { replayEngine.setAllDrawingsLocked(!replay.drawingsLocked); showToolFeedback(replay.drawingsLocked ? 'Drawings unlocked' : 'All drawings locked', event.currentTarget) }} className="drawing-tool-button disabled:cursor-not-allowed disabled:opacity-40" aria-label={replay.drawingsLocked ? 'Unlock all drawings' : 'Lock all drawings'} aria-pressed={replay.drawingsLocked} title={replay.drawingsLocked ? 'Unlock all drawings' : 'Lock all drawings'}>{replay.drawingsLocked ? <Lock size={20} strokeWidth={1.4} /> : <LockOpen size={20} strokeWidth={1.4} />}</button>

        <div className="relative">
          <button type="button" onClick={(event) => toggleMenu('visibility', event)} className="drawing-tool-button relative" aria-label="Drawing and indicator visibility" aria-expanded={openMenu === 'visibility'} aria-pressed={replay.drawingsHidden || replay.indicatorsHidden} title="Visibility">{replay.drawingsHidden || replay.indicatorsHidden ? <EyeOff size={20} strokeWidth={1.4} /> : <Eye size={20} strokeWidth={1.4} />}<ChevronDown aria-hidden="true" className="absolute bottom-1 right-1" size={7} strokeWidth={1.75} /></button>
          {openMenu === 'visibility' ? (
            <div role="menu" aria-label="Visibility menu" className="absolute bottom-0 left-[calc(100%+0.25rem)] w-44 rounded-panel border border-line bg-[#191a1d] p-1 shadow-overlay">
              <button role="menuitem" type="button" onClick={() => { replayEngine.setDrawingsHidden(!replay.drawingsHidden); setOpenMenu(null) }} className="flex h-9 w-full items-center gap-3 rounded-control px-2 text-left text-ui-control text-muted hover:bg-surface-3 hover:text-ink">{replay.drawingsHidden ? <Eye size={15} /> : <EyeOff size={15} />}{replay.drawingsHidden ? 'Show drawings' : 'Hide drawings'}</button>
              <button role="menuitem" type="button" onClick={() => { replayEngine.setIndicatorsHidden(!replay.indicatorsHidden); setOpenMenu(null) }} className="flex h-9 w-full items-center gap-3 rounded-control px-2 text-left text-ui-control text-muted hover:bg-surface-3 hover:text-ink">{replay.indicatorsHidden ? <Eye size={15} /> : <EyeOff size={15} />}{replay.indicatorsHidden ? 'Show indicators' : 'Hide indicators'}</button>
              <button role="menuitem" type="button" onClick={() => { const hidden = !(replay.drawingsHidden && replay.indicatorsHidden); replayEngine.setDrawingsHidden(hidden); replayEngine.setIndicatorsHidden(hidden); setOpenMenu(null) }} className="flex h-9 w-full items-center gap-3 rounded-control px-2 text-left text-ui-control text-muted hover:bg-surface-3 hover:text-ink">{replay.drawingsHidden && replay.indicatorsHidden ? <Eye size={15} /> : <EyeOff size={15} />}{replay.drawingsHidden && replay.indicatorsHidden ? 'Show all' : 'Hide all'}</button>
            </div>
          ) : null}
        </div>

        <div className="relative mt-auto pt-4 before:absolute before:left-1/2 before:top-2 before:h-px before:w-8 before:-translate-x-1/2 before:bg-line-strong/70">
          <button type="button" onClick={(event) => toggleMenu('delete', event)} className="drawing-tool-button hover:!text-loss-bright" aria-label="Remove drawings and indicators" aria-expanded={openMenu === 'delete'} title="Remove drawings and indicators"><Trash2 size={19} strokeWidth={1.4} /></button>
          {openMenu === 'delete' ? (
            <div role="menu" aria-label="Remove drawings and indicators menu" className="absolute bottom-0 left-[calc(100%+0.25rem)] w-64 rounded-panel border border-line bg-[#191a1d] p-1 shadow-overlay">
              <button role="menuitem" type="button" disabled={disabled || drawingCount === 0} onClick={() => { replayEngine.deleteAllDrawings(); setOpenMenu(null) }} className="flex h-9 w-full items-center gap-3 rounded-control px-2 text-left text-ui-control text-muted hover:bg-loss/10 hover:text-loss-bright disabled:cursor-not-allowed disabled:opacity-35"><Trash2 size={14} />Remove {drawingCount} drawings</button>
              <button role="menuitem" type="button" disabled={disabled || replay.indicators.length === 0} onClick={() => { replayEngine.removeAllIndicators(); setOpenMenu(null) }} className="flex h-9 w-full items-center gap-3 rounded-control px-2 text-left text-ui-control text-muted hover:bg-loss/10 hover:text-loss-bright disabled:cursor-not-allowed disabled:opacity-35"><Trash2 size={14} />Remove {replay.indicators.length} indicators</button>
              <button role="menuitem" type="button" disabled={disabled || (drawingCount === 0 && replay.indicators.length === 0)} onClick={() => { replayEngine.deleteAllDrawings(); replayEngine.removeAllIndicators(); setOpenMenu(null) }} className="flex h-9 w-full items-center gap-3 rounded-control px-2 text-left text-ui-control text-muted hover:bg-loss/10 hover:text-loss-bright disabled:cursor-not-allowed disabled:opacity-35"><Trash2 size={14} />Remove {drawingCount} drawings &amp; {replay.indicators.length} indicators</button>
            </div>
          ) : null}
        </div>
      </nav>

      {toolFeedback ? <div role="status" aria-live="polite" style={{ top: toolFeedback.top }} className="pointer-events-none absolute left-[3.25rem] z-[70] whitespace-nowrap rounded-control border border-line-strong bg-[#191a1d] px-2.5 py-1.5 text-ui-body font-medium text-ink shadow-overlay">{toolFeedback.label}</div> : null}

      {favoriteTools.length > 0 ? (
        <nav ref={floatingToolbarRef} aria-label="Favorite drawing tools" className="absolute left-0 top-0 z-[60] flex max-w-[calc(100%-1rem)] items-center gap-0.5 overflow-x-auto rounded-panel border border-line bg-surface-1/95 p-0.5 shadow-overlay will-change-transform">
          <button
            type="button"
            aria-label="Move favorite toolbar"
            aria-describedby="favorite-toolbar-drag-help"
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
            onPointerDown={startFloatingDrag}
            onPointerMove={moveFloatingToolbar}
            onPointerUp={stopFloatingDrag}
            onPointerCancel={stopFloatingDrag}
            onLostPointerCapture={stopFloatingDrag}
            onKeyDown={moveFloatingToolbarWithKeyboard}
            className={`group sticky left-0 z-10 grid size-7 shrink-0 touch-none place-items-center bg-surface-1 ${floatingDragging ? 'cursor-grabbing text-ink' : 'cursor-grab text-muted hover:text-ink'}`}
            title="Drag to move · arrow keys move by 1px · Shift + arrow moves by 10px"
          >
            <GripVertical className="transition-transform duration-150 ease-out group-hover:scale-110 group-active:scale-90 motion-reduce:transition-none" size={15} strokeWidth={1.75} />
          </button>
          <span id="favorite-toolbar-drag-help" className="sr-only">Drag to move this toolbar within the chart. Use arrow keys for precise movement; hold Shift to move faster.</span>
          {favoriteTools.map((tool) => (
            <button key={tool.type} type="button" disabled={disabled} onClick={(event) => choose(tool.type, false, tool.name, event.currentTarget)} aria-label={`Favorite ${tool.name}`} aria-pressed={replay.activeDrawingTool === tool.type} className="tool-button shrink-0 disabled:cursor-not-allowed disabled:opacity-40" title={tool.name}>
              <ToolIcon type={tool.type} />
            </button>
          ))}
        </nav>
      ) : null}

      {replay.selectedDrawing ? (
        <SelectedDrawingToolbar
          drawing={replay.selectedDrawing}
          drawingName={selectedDrawingName}
          templates={templates}
          templateError={templateError}
          onApplyDefaultTemplate={applyDefaultTemplate}
          onApplyTemplate={applyTemplate}
          onChange={(patch) => replayEngine.updateSelectedDrawing(patch)}
          onDelete={() => replayEngine.deleteSelectedDrawing()}
          onLock={() => replayEngine.lockSelectedDrawing()}
          onOpenProperties={() => replayEngine.openDrawingInspector()}
          onSaveTemplate={saveTemplate}
        />
      ) : null}

      {replay.selectedDrawing && replay.drawingInspectorOpen ? (
        <div ref={inspectorRef} className="absolute bottom-2 left-[3.75rem] right-2 top-2 z-[80] will-change-transform sm:bottom-auto sm:left-0 sm:right-auto sm:top-0 sm:w-[22rem]">
          <DrawingInspector
            drawing={replay.selectedDrawing}
            templates={templates}
            templateError={templateError}
            moving={inspectorDragging}
            onMovePointerDown={startInspectorDrag}
            onMovePointerMove={moveInspector}
            onMovePointerUp={stopInspectorDrag}
            onMoveKeyDown={moveInspectorWithKeyboard}
            onChange={(patch) => replayEngine.updateSelectedDrawing(patch)}
            onClose={() => replayEngine.closeDrawingInspector()}
            onSaveTemplate={saveTemplate}
            onApplyTemplate={applyTemplate}
            onDeleteTemplate={(id) => commitTemplates(deleteDrawingTemplate(templates, id), { type: 'delete', id })}
          />
        </div>
      ) : null}
    </>
  )
}
