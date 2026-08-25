import { ArrowUpRight, Brush, ChevronDown, Clock3, Eye, EyeOff, GripVertical, LineChart, ListFilter, Lock, LockOpen, Minus, PencilLine, Repeat2, Spline, Square, Star, Trash2, TrendingDown, TrendingUp, Type, Waves, ZoomIn, ZoomOut, type LucideIcon } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
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
import type { ChartCursorMode } from '../../replay/chart-adapter'
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
import { LINE_TOOL_TYPES } from '../../replay/drawing-appearance'
import { useReplaySelector } from '../../replay/use-replay'
// The inspectors and the selection toolbar are loaded on demand: none of
// them renders until a drawing is selected, and together they are the largest
// block of code in the app bundle. Statically imported, every first paint paid
// for eight property panels a session might never open.
const FibonacciDrawingInspector = lazy(() => import('./FibonacciDrawingInspector').then((module) => ({ default: module.FibonacciDrawingInspector })))
const LineDrawingInspector = lazy(() => import('./LineDrawingInspector').then((module) => ({ default: module.LineDrawingInspector })))
const RectangleDrawingInspector = lazy(() => import('./RectangleDrawingInspector').then((module) => ({ default: module.RectangleDrawingInspector })))
const PositionDrawingInspector = lazy(() => import('./PositionDrawingInspector').then((module) => ({ default: module.PositionDrawingInspector })))
const SelectedDrawingToolbar = lazy(() => import('./SelectedDrawingToolbar').then((module) => ({ default: module.SelectedDrawingToolbar })))
const StandardDrawingInspector = lazy(() => import('./StandardDrawingInspector').then((module) => ({ default: module.StandardDrawingInspector })))
const TextDrawingInspector = lazy(() => import('./TextDrawingInspector').then((module) => ({ default: module.TextDrawingInspector })))
const CurveRangeDrawingInspector = lazy(() => import('./CurveRangeDrawingInspector').then((module) => ({ default: module.CurveRangeDrawingInspector })))

const PROJECTION_TOOL_TYPES = ['long-position', 'short-position'] as const
const BRUSH_TOOL_TYPES = ['brush', 'arrow-marker', 'rectangle', 'rotated-rectangle', 'path'] as const
const FIBONACCI_TOOL_TYPES = ['fib-retracement', 'fib-time-zone'] as const
const TEXT_TOOL_TYPES = ['text-annotation', 'anchored-text', 'note', 'price-note', 'pin', 'table', 'callout', 'comment', 'price-label', 'signpost', 'flag-mark'] as const
const RANGE_TOOL_TYPES = ['price-range', 'date-range', 'date-price-range'] as const
const CURSOR_TOOLS: ReadonlyArray<{ mode: ChartCursorMode; label: string }> = [
  { mode: 'cross', label: 'Cross' },
  { mode: 'dot', label: 'Dot' },
  { mode: 'arrow', label: 'Arrow' },
  { mode: 'demonstration', label: 'Demonstration' },
  { mode: 'eraser', label: 'Eraser' },
]

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
  { type: 'curve', name: 'Curve' },
  { type: 'horizontal-line', name: 'Horizontal Line' },
  { type: 'horizontal-ray', name: 'Horizontal Ray' },
  { type: 'vertical-line', name: 'Vertical Line' },
  { type: 'cross-line', name: 'Cross Line' },
  { type: 'fib-retracement', name: 'Fibonacci Retracement' },
  { type: 'fib-time-zone', name: 'Fibonacci Time Zone' },
  { type: 'long-position', name: 'Long Position' },
  { type: 'short-position', name: 'Short Position' },
  { type: 'brush', name: 'Brush' },
  { type: 'arrow-marker', name: 'Arrow Marker' },
  { type: 'rectangle', name: 'Rectangle' },
  { type: 'rotated-rectangle', name: 'Rotated Rectangle' },
  { type: 'path', name: 'Path' },
  { type: 'text-annotation', name: 'Text' },
  { type: 'anchored-text', name: 'Anchored Text' },
  { type: 'note', name: 'Note' },
  { type: 'price-note', name: 'Price Note' },
  { type: 'pin', name: 'Pin' },
  { type: 'table', name: 'Table' },
  { type: 'callout', name: 'Callout' },
  { type: 'comment', name: 'Comment' },
  { type: 'price-label', name: 'Price Label' },
  { type: 'signpost', name: 'Signpost' },
  { type: 'flag-mark', name: 'Flag Mark' },
  { type: 'price-range', name: 'Price Range' },
  { type: 'date-range', name: 'Date Range' },
  { type: 'date-price-range', name: 'Date and Price Range' },
]

const lineTools = [...LINE_TOOL_TYPES.slice(0, 5), 'curve', ...LINE_TOOL_TYPES.slice(5)].flatMap((type) => DRAWING_TOOLS.find((tool) => tool.type === type) ?? [])
const projectionTools = PROJECTION_TOOL_TYPES.flatMap((type) => DRAWING_TOOLS.find((tool) => tool.type === type) ?? [])
const brushTools = BRUSH_TOOL_TYPES.flatMap((type) => DRAWING_TOOLS.find((tool) => tool.type === type) ?? [])
const fibonacciTools = FIBONACCI_TOOL_TYPES.flatMap((type) => DRAWING_TOOLS.find((tool) => tool.type === type) ?? [])
const textTools = TEXT_TOOL_TYPES.flatMap((type) => DRAWING_TOOLS.find((tool) => tool.type === type) ?? [])
const rangeTools = RANGE_TOOL_TYPES.flatMap((type) => DRAWING_TOOLS.find((tool) => tool.type === type) ?? [])

type OpenMenu = 'brushes' | 'cursor' | 'delete' | 'fibonacci' | 'lines' | 'projection' | 'ranges' | 'text' | 'visibility' | null

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
      {type === 'curve' ? <><path d="M3.5 19C8 4 15 4 20.5 10" /><circle cx="3.5" cy="19" r="1.25" /><circle cx="11.8" cy="6.2" r="1.25" /><circle cx="20.5" cy="10" r="1.25" /></> : null}
      {type === 'horizontal-line' ? <><path d="M3 12h18" /><circle cx="12" cy="12" r="1.25" /></> : null}
      {type === 'horizontal-ray' ? <><path d="M4 12h17" /><circle cx="4" cy="12" r="1.3" /></> : null}
      {type === 'vertical-line' ? <><path d="M12 3v18" /><circle cx="12" cy="12" r="1.3" /></> : null}
      {type === 'cross-line' ? <><path d="M3 12h18M12 3v18" /><circle cx="12" cy="12" r="1.3" /></> : null}
    </svg>
  )
}

function CursorModeIcon({ type, size = 18 }: ToolIconProps): ReactElement {
  const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.35 }
  return (
    <svg data-cursor-icon={type} aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" {...common}>
      {type === 'cross' ? <><path d="M12 2v20M2 12h20" /><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" /></> : null}
      {type === 'dot' ? <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" /> : null}
      {type === 'arrow' ? <path d="M5 3.5 17.5 13l-6 .8 3.6 6.2-2.6 1.5-3.6-6.3L5 20V3.5Z" /> : null}
      {type === 'demonstration' ? <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4V8Z" /></> : null}
      {type === 'eraser' ? <><path d="m4 15 9.5-10a2 2 0 0 1 2.9 0l2.7 2.7a2 2 0 0 1 0 2.9L10 20H6l-2-2a2 2 0 0 1 0-3Z" /><path d="m10.5 8 6 6M10 20h10" /></> : null}
    </svg>
  )
}

function AnnotationToolIcon({ type, size = 18 }: ToolIconProps): ReactElement {
  const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.35 }
  return (
    <svg data-annotation-icon={type} aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" {...common}>
      {type === 'text-annotation' ? <><path d="M5 4h14M12 4v16M8.5 20h7" /></> : null}
      {type === 'anchored-text' ? <><path d="M4 4h12M10 4v12M7 16h6M18 14v7M15.5 18.5 18 21l2.5-2.5" /></> : null}
      {type === 'note' ? <><rect x="3" y="3" width="17" height="12" /><path d="M7 6h9M11.5 6v6M9 12h5M11.5 15v5" /><circle cx="11.5" cy="21" r="1" /></> : null}
      {type === 'price-note' ? <><rect x="3" y="3" width="17" height="12" /><path d="M13.5 6.5c-.6-.6-3.5-.8-3.5.7 0 1.8 4 .8 4 2.8 0 1.7-3.2 1.7-4.2.7M12 5.5v7" /><path d="M11.5 15v5" /><circle cx="11.5" cy="21" r="1" /></> : null}
      {type === 'pin' ? <><path d="M12 22s7-6.3 7-13a7 7 0 1 0-14 0c0 6.7 7 13 7 13Z" /><circle cx="12" cy="9" r="2.5" /></> : null}
      {type === 'table' ? <><rect x="2" y="3" width="20" height="18" /><path d="M2 9h20M2 15h20M8 3v18" /></> : null}
      {type === 'callout' ? <><path d="M3 4h18v13H8l-5 4V4Z" /></> : null}
      {type === 'comment' ? <><path d="M4 4h13a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4H8l-5 4 1-6V4Z" /></> : null}
      {type === 'price-label' ? <><path d="M3 5h18v13H8l-5 4V5Z" /><circle cx="6" cy="18" r="1.2" /></> : null}
      {type === 'signpost' ? <><circle cx="12" cy="9" r="7" /><path d="m12 5 1.2 2.4 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4L12 5ZM12 16v7" /></> : null}
      {type === 'flag-mark' ? <><path d="M5 22V3M5 4h13l-3 4 3 4H5" /></> : null}
    </svg>
  )
}

function ToolIcon({ type, size = 16 }: ToolIconProps): ReactElement {
  if ((LINE_TOOL_TYPES as readonly string[]).includes(type) || type === 'curve') return <LineToolIcon type={type} size={size} />
  if ((TEXT_TOOL_TYPES as readonly string[]).includes(type)) return <AnnotationToolIcon type={type} size={size} />
  if ((RANGE_TOOL_TYPES as readonly string[]).includes(type)) return <RangeToolIcon type={type} size={size} />
  let Icon: LucideIcon = PencilLine
  if (type === 'brush') Icon = Brush
  else if (type === 'arrow-marker') Icon = ArrowUpRight
  else if (type === 'long-position') Icon = TrendingUp
  else if (type === 'short-position') Icon = TrendingDown
  else if (type === 'fib-time-zone') Icon = Clock3
  else if (type === 'path') Icon = Spline
  else if (type.includes('horizontal')) Icon = Minus
  else if (type.includes('rectangle')) Icon = Square
  else if (type.includes('fib')) Icon = Waves
  else if (type.includes('text')) Icon = Type
  else if (type.includes('line') || type.includes('ray') || type.includes('trend')) Icon = LineChart
  return <Icon size={size} strokeWidth={1.75} />
}

function RangeToolIcon({ type, size = 18 }: ToolIconProps): ReactElement {
  return <svg data-range-icon={type} aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
    {type === 'price-range' ? <><path d="M4 3h16M4 21h16M12 4v16m-3-3 3 3 3-3m-6-10 3-3 3 3" /></> : null}
    {type === 'date-range' ? <><path d="M3 4v16M21 4v16M4 12h16m-3-3 3 3-3 3M7 9l-3 3 3 3" /></> : null}
    {type === 'date-price-range' ? <><rect x="4" y="4" width="16" height="16" /><path d="M8 8h8v8H8zM12 5v14M5 12h14" /></> : null}
  </svg>
}

export function DrawingToolbar({ disabled = false }: DrawingToolbarProps): ReactElement {
  const replay = useReplaySelector((snapshot) => ({
    cursorMode: snapshot.cursorMode,
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
  const [selectedFibonacciTool, setSelectedFibonacciTool] = useState<DrawingFavoriteToolType>('fib-retracement')
  const [selectedTextTool, setSelectedTextTool] = useState<DrawingFavoriteToolType>('text-annotation')
  const [selectedRangeTool, setSelectedRangeTool] = useState<DrawingFavoriteToolType>('price-range')
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
  const selectedFibonacci = fibonacciTools.find((tool) => tool.type === selectedFibonacciTool) ?? fibonacciTools[0]
  const selectedText = textTools.find((tool) => tool.type === selectedTextTool) ?? textTools[0]
  const selectedRange = rangeTools.find((tool) => tool.type === selectedRangeTool) ?? rangeTools[0]
  const selectedDrawingName = replay.selectedDrawing
    ? DRAWING_TOOLS.find((tool) => tool.type === replay.selectedDrawing?.type)?.name ?? replay.selectedDrawing.type
    : ''
  const selectedDrawingIsLine = replay.selectedDrawing ? (LINE_TOOL_TYPES as readonly string[]).includes(replay.selectedDrawing.type) : false
  const selectedDrawingIsFibonacci = replay.selectedDrawing?.type === 'fib-retracement'
  const selectedDrawingIsRectangle = replay.selectedDrawing?.type === 'rectangle'
  const selectedDrawingIsPosition = replay.selectedDrawing?.type === 'long-position' || replay.selectedDrawing?.type === 'short-position'
  const selectedDrawingIsText = replay.selectedDrawing?.type === 'text-annotation'
  const selectedDrawingIsCurveOrRange = replay.selectedDrawing?.type === 'curve' || replay.selectedDrawing?.type === 'price-range' || replay.selectedDrawing?.type === 'date-range'

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

  const chooseCursor = (mode: ChartCursorMode, label: string): void => {
    if (disabled) return
    replayEngine.setNextDrawingAppearance(null)
    replayEngine.setCursorMode(mode)
    setOpenMenu(null)
    showToolFeedback(label, lastMenuTriggerRef.current)
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
        <div className="relative">
          <button type="button" disabled={disabled} onClick={(event) => toggleMenu('cursor', event)} aria-label="Cursor tools" aria-expanded={openMenu === 'cursor'} className="drawing-tool-button relative disabled:cursor-not-allowed disabled:opacity-40" title="Cursor tools">
            <CursorModeIcon type={replay.cursorMode} size={20} />
            <ChevronDown aria-hidden="true" className="absolute bottom-1 right-1" size={7} strokeWidth={1.75} />
          </button>
          {openMenu === 'cursor' ? (
            <div role="menu" aria-label="Cursor tools menu" className="absolute left-[calc(100%+0.25rem)] top-0 w-64 overflow-hidden border border-[#303033] bg-[#1b1b1d] py-1 shadow-overlay">
              {CURSOR_TOOLS.map((tool) => (
                <div key={tool.mode} role="none" className={tool.mode === 'eraser' ? 'mt-1 border-t border-[#444] pt-1' : undefined}>
                  <button
                    role="menuitem"
                    type="button"
                    disabled={disabled}
                    aria-current={replay.cursorMode === tool.mode ? 'true' : undefined}
                    onClick={() => chooseCursor(tool.mode, tool.label)}
                    className="flex h-10 w-full items-center gap-3 px-3 text-left text-ui-control text-[#d1d4dc] outline-none hover:bg-[#2d2d30] hover:text-white focus-visible:bg-[#2d2d30] aria-current:bg-[#f4f4f4] aria-current:text-[#111] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span aria-hidden="true" className="flex w-5 justify-center"><CursorModeIcon type={tool.mode} size={20} /></span>
                    <span className="flex-1">{tool.label}</span>
                    {tool.mode === 'dot' ? <Star aria-hidden="true" size={15} strokeWidth={1.35} /> : null}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="relative">
          <button type="button" disabled={disabled} onClick={(event) => toggleMenu('lines', event)} className="drawing-tool-button relative disabled:cursor-not-allowed disabled:opacity-40" aria-label="Line tools" aria-expanded={openMenu === 'lines'} aria-pressed={LINE_TOOL_TYPES.some((type) => replay.activeDrawingTool === type)} title="Lines">
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

        <div className="relative">
          <button type="button" disabled={disabled} onClick={(event) => toggleMenu('fibonacci', event)} className="drawing-tool-button relative disabled:cursor-not-allowed disabled:opacity-40" aria-label="Fibonacci" aria-expanded={openMenu === 'fibonacci'} aria-pressed={FIBONACCI_TOOL_TYPES.some((type) => replay.activeDrawingTool === type)} title="Fibonacci tools">
            {selectedFibonacci.type === 'fib-time-zone' ? <Clock3 size={20} strokeWidth={1.4} /> : <ListFilter size={20} strokeWidth={1.4} />}
            <ChevronDown aria-hidden="true" className="absolute bottom-1 right-1" size={7} strokeWidth={1.75} />
          </button>
          {openMenu === 'fibonacci' ? (
            <div role="menu" aria-label="Fibonacci tools menu" className="absolute left-[calc(100%+0.25rem)] top-0 w-64 rounded-panel border border-line bg-[#191a1d] p-1 shadow-overlay">
              <div aria-hidden="true" className="px-2 pb-1.5 pt-1 text-ui-meta font-medium text-dim">FIBONACCI</div>
              {fibonacciTools.map((tool) => (
                <div key={tool.type} role="none" className="flex items-center">
                  <button role="menuitem" type="button" disabled={disabled} aria-current={replay.activeDrawingTool === tool.type ? 'true' : undefined} onClick={() => { setSelectedFibonacciTool(tool.type); choose(tool.type, false, tool.name) }} className="flex h-9 min-w-0 flex-1 items-center gap-3 rounded-control px-2 text-left text-ui-control text-muted hover:bg-surface-3 hover:text-ink aria-current:bg-surface-3 aria-current:text-ink disabled:cursor-not-allowed disabled:opacity-40">
                    <span aria-hidden="true" className="flex w-5 justify-center text-ink"><ToolIcon type={tool.type} size={18} /></span><span>{tool.name}</span>
                  </button>
                  {favoriteToggle(tool)}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="relative">
          <button type="button" disabled={disabled} onClick={(event) => toggleMenu('projection', event)} className="drawing-tool-button relative disabled:cursor-not-allowed disabled:opacity-40" aria-label="Projection tools" aria-expanded={openMenu === 'projection'} aria-pressed={PROJECTION_TOOL_TYPES.some((type) => replay.activeDrawingTool === type)} title="Projection">
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
          <button type="button" disabled={disabled} onClick={(event) => toggleMenu('brushes', event)} className="drawing-tool-button relative disabled:cursor-not-allowed disabled:opacity-40" aria-label="Brush tools" aria-expanded={openMenu === 'brushes'} aria-pressed={BRUSH_TOOL_TYPES.some((type) => replay.activeDrawingTool === type)} title="Brushes">
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

        <div className="relative">
          <button type="button" disabled={disabled} onClick={(event) => toggleMenu('text', event)} className="drawing-tool-button relative disabled:cursor-not-allowed disabled:opacity-40" aria-label="Text and notes" aria-expanded={openMenu === 'text'} aria-pressed={TEXT_TOOL_TYPES.some((type) => replay.activeDrawingTool === type)} title="Text and notes">
            <ToolIcon type={selectedText.type} size={20} />
            <ChevronDown aria-hidden="true" className="absolute bottom-1 right-1" size={7} strokeWidth={1.75} />
          </button>
          {openMenu === 'text' ? (
            <div role="menu" aria-label="Text and notes menu" className="absolute left-[calc(100%+0.25rem)] top-0 w-52 rounded-panel border border-line bg-[#191a1d] p-1 shadow-overlay">
              <div aria-hidden="true" className="px-2 pb-1.5 pt-1 text-ui-meta font-medium text-dim">TEXT &amp; NOTES</div>
              {textTools.map((tool) => (
                <div key={tool.type} role="none" className="flex items-center">
                  <button role="menuitem" type="button" disabled={disabled} aria-current={replay.activeDrawingTool === tool.type ? 'true' : undefined} onClick={() => { setSelectedTextTool(tool.type); choose(tool.type, false, tool.name) }} className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-control px-2 text-left text-ui-control text-muted hover:bg-surface-3 hover:text-ink aria-current:bg-surface-3 aria-current:text-ink disabled:cursor-not-allowed disabled:opacity-40">
                    <span aria-hidden="true" className="flex w-5 justify-center text-ink"><ToolIcon type={tool.type} size={18} /></span><span>{tool.name}</span>
                  </button>
                  {favoriteToggle(tool)}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <span aria-hidden="true" className="my-2 h-px w-8 shrink-0 bg-line-strong/70" />

        <div className="relative">
          <button type="button" disabled={disabled} onClick={(event) => toggleMenu('ranges', event)} className="drawing-tool-button relative disabled:cursor-not-allowed disabled:opacity-40" aria-label="Range tools" aria-expanded={openMenu === 'ranges'} aria-pressed={RANGE_TOOL_TYPES.some((type) => replay.activeDrawingTool === type)} title="Range tools">
            <RangeToolIcon type={selectedRange.type} size={20} />
            <ChevronDown aria-hidden="true" className="absolute bottom-1 right-1" size={7} strokeWidth={1.75} />
          </button>
          {openMenu === 'ranges' ? <div role="menu" aria-label="Range tools menu" className="absolute left-[calc(100%+0.25rem)] top-0 w-56 rounded-panel border border-line bg-[#191a1d] p-1 shadow-overlay">
            <div aria-hidden="true" className="px-2 pb-1.5 pt-1 text-ui-meta font-medium text-dim">RANGES</div>
            {rangeTools.map((tool) => <div key={tool.type} role="none" className="flex items-center">
              <button role="menuitem" type="button" disabled={disabled} aria-current={replay.activeDrawingTool === tool.type ? 'true' : undefined} onClick={() => { setSelectedRangeTool(tool.type); choose(tool.type, false, tool.name) }} className="flex h-9 min-w-0 flex-1 items-center gap-3 rounded-control px-2 text-left text-ui-control text-muted hover:bg-surface-3 hover:text-ink aria-current:bg-surface-3 aria-current:text-ink disabled:cursor-not-allowed disabled:opacity-40"><span aria-hidden="true" className="flex w-5 justify-center text-ink"><RangeToolIcon type={tool.type} size={18} /></span><span>{tool.name}</span></button>
              {favoriteToggle(tool)}
            </div>)}
          </div> : null}
        </div>

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

      {/* One boundary for the whole selection cluster: each panel below is
          already gated on a selected drawing, and a null fallback keeps the
          chart from shifting during the one-time chunk fetch. */}
      <Suspense fallback={null}>
      {replay.selectedDrawing && !replay.drawingInspectorOpen ? (
        <SelectedDrawingToolbar
          drawing={replay.selectedDrawing}
          drawingName={selectedDrawingName}
          templates={templates}
          templateError={templateError}
          onApplyDefaultTemplate={applyDefaultTemplate}
          onApplyTemplate={applyTemplate}
          onChange={(patch) => replayEngine.updateSelectedDrawing(patch)}
          onDelete={() => replayEngine.deleteSelectedDrawing()}
          onDuplicate={() => { replayEngine.copySelectedDrawing(); replayEngine.pasteDrawing() }}
          onLock={() => replayEngine.lockSelectedDrawing()}
          onOpenProperties={() => replayEngine.openDrawingInspector()}
          onSaveTemplate={saveTemplate}
        />
      ) : null}

      {replay.selectedDrawing && replay.drawingInspectorOpen && selectedDrawingIsLine ? (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center p-2 sm:p-4">
          <div className="pointer-events-auto max-h-[calc(100dvh-1rem)] w-full sm:w-auto">
            <LineDrawingInspector
              key={replay.selectedDrawing.id}
              drawing={replay.selectedDrawing}
              drawingName={selectedDrawingName}
              templates={templates}
              templateError={templateError}
              onChange={(patch) => replayEngine.updateSelectedDrawing(patch)}
              onDeleteTemplate={(id) => commitTemplates(deleteDrawingTemplate(templates, id), { type: 'delete', id })}
              onClose={() => replayEngine.closeDrawingInspector()}
            />
          </div>
        </div>
      ) : null}

      {replay.selectedDrawing && replay.drawingInspectorOpen && selectedDrawingIsFibonacci ? (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center p-2 sm:p-4">
          <div className="pointer-events-auto max-h-[calc(100dvh-1rem)] w-full sm:w-auto">
            <FibonacciDrawingInspector
              key={replay.selectedDrawing.id}
              drawing={replay.selectedDrawing}
              templates={templates}
              templateError={templateError}
              onChange={(patch) => replayEngine.updateSelectedDrawing(patch)}
              onDeleteTemplate={(id) => commitTemplates(deleteDrawingTemplate(templates, id), { type: 'delete', id })}
              onClose={() => replayEngine.closeDrawingInspector()}
            />
          </div>
        </div>
      ) : null}

      {replay.selectedDrawing && replay.drawingInspectorOpen && selectedDrawingIsRectangle ? (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center p-2 sm:p-4">
          <div className="pointer-events-auto max-h-[calc(100dvh-1rem)] w-full sm:w-auto">
            <RectangleDrawingInspector
              key={replay.selectedDrawing.id}
              drawing={replay.selectedDrawing}
              templates={templates}
              templateError={templateError}
              onChange={(patch) => replayEngine.updateSelectedDrawing(patch)}
              onDeleteTemplate={(id) => commitTemplates(deleteDrawingTemplate(templates, id), { type: 'delete', id })}
              onClose={() => replayEngine.closeDrawingInspector()}
            />
          </div>
        </div>
      ) : null}

      {replay.selectedDrawing && replay.drawingInspectorOpen && selectedDrawingIsPosition ? (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center p-2 sm:p-4">
          <div className="pointer-events-auto max-h-[calc(100dvh-1rem)] w-full sm:w-auto">
            <PositionDrawingInspector
              key={replay.selectedDrawing.id}
              drawing={replay.selectedDrawing}
              templates={templates}
              templateError={templateError}
              onChange={(patch) => replayEngine.updateSelectedDrawing(patch)}
              onDeleteTemplate={(id) => commitTemplates(deleteDrawingTemplate(templates, id), { type: 'delete', id })}
              onClose={() => replayEngine.closeDrawingInspector()}
            />
          </div>
        </div>
      ) : null}

      {replay.selectedDrawing && replay.drawingInspectorOpen && selectedDrawingIsText ? (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center p-2 sm:p-4">
          <div className="pointer-events-auto max-h-[calc(100dvh-1rem)] w-full sm:w-auto">
            <TextDrawingInspector
              key={replay.selectedDrawing.id}
              drawing={replay.selectedDrawing}
              templates={templates}
              templateError={templateError}
              onChange={(patch) => replayEngine.updateSelectedDrawing(patch)}
              onDelete={() => replayEngine.deleteSelectedDrawing()}
              onDeleteTemplate={(id) => commitTemplates(deleteDrawingTemplate(templates, id), { type: 'delete', id })}
              onClose={() => replayEngine.closeDrawingInspector()}
            />
          </div>
        </div>
      ) : null}

      {replay.selectedDrawing && replay.drawingInspectorOpen && selectedDrawingIsCurveOrRange ? (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center p-2 sm:p-4">
          <div className="pointer-events-auto max-h-[calc(100dvh-1rem)] w-full sm:w-auto">
            <CurveRangeDrawingInspector
              key={replay.selectedDrawing.id}
              drawing={replay.selectedDrawing}
              drawingName={selectedDrawingName}
              templates={templates}
              templateError={templateError}
              onChange={(patch) => replayEngine.updateSelectedDrawing(patch)}
              onClose={() => replayEngine.closeDrawingInspector()}
            />
          </div>
        </div>
      ) : null}

      {replay.selectedDrawing && replay.drawingInspectorOpen && !selectedDrawingIsLine && !selectedDrawingIsFibonacci && !selectedDrawingIsRectangle && !selectedDrawingIsPosition && !selectedDrawingIsText && !selectedDrawingIsCurveOrRange ? (
        <div ref={inspectorRef} className="fixed inset-2 z-[80] will-change-transform sm:absolute sm:bottom-auto sm:left-0 sm:right-auto sm:top-0 sm:w-auto">
          <StandardDrawingInspector
            drawing={replay.selectedDrawing}
            drawingName={selectedDrawingName}
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
      </Suspense>
    </>
  )
}
