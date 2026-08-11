import { Check, ChevronDown, Crosshair, GripVertical, LineChart, Minus, PencilLine, Ruler, Spline, Square, Star, Trash2, Type, Waves, type LucideIcon } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
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
  deleteDrawingTemplate,
  loadDrawingTemplates,
  persistDrawingTemplates,
  saveNamedDrawingTemplate,
  type DrawingTemplate,
} from '../../replay/drawing-templates'
import { useReplaySelector } from '../../replay/use-replay'
import { DrawingInspector } from './DrawingInspector'

const LINE_TOOL_TYPES = ['trend-line', 'ray', 'info-line', 'extended-line', 'horizontal-line', 'horizontal-ray', 'vertical-line'] as const
const SHAPE_TOOL_TYPES = ['rectangle', 'path'] as const

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

const FLOATING_TOOLBAR_BOUNDARY = 8
const FLOATING_TOOLBAR_DEFAULT_TOP = 44

const DRAWING_TOOLS: readonly DrawingToolItem[] = [
  { type: 'trend-line', name: 'Trend Line' },
  { type: 'ray', name: 'Ray' },
  { type: 'info-line', name: 'Info Line' },
  { type: 'extended-line', name: 'Extended Line' },
  { type: 'horizontal-line', name: 'Horizontal Line' },
  { type: 'horizontal-ray', name: 'Horizontal Ray' },
  { type: 'vertical-line', name: 'Vertical Line' },
  { type: 'fib-retracement', name: 'Fibonacci Retracement' },
  { type: 'rectangle', name: 'Rectangle' },
  { type: 'path', name: 'Path' },
  { type: 'text-annotation', name: 'Text' },
  { type: 'date-price-range', name: 'Measure' },
]

const lineTools = LINE_TOOL_TYPES.flatMap((type) => DRAWING_TOOLS.find((tool) => tool.type === type) ?? [])
const shapeTools = SHAPE_TOOL_TYPES.flatMap((type) => DRAWING_TOOLS.find((tool) => tool.type === type) ?? [])
const fibonacciTool = DRAWING_TOOLS.find((tool) => tool.type === 'fib-retracement')
const textTool = DRAWING_TOOLS.find((tool) => tool.type === 'text-annotation')
const measureTool = DRAWING_TOOLS.find((tool) => tool.type === 'date-price-range')

type OpenMenu = 'delete' | 'favorites' | 'lines' | 'shapes' | null

function ToolIcon({ type, size = 16 }: ToolIconProps): ReactElement {
  let Icon: LucideIcon = PencilLine
  if (type === 'date-price-range') Icon = Ruler
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
  }))
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [favorites, setFavorites] = useState<DrawingFavoriteToolType[]>(loadDrawingFavorites)
  const [favoritesError, setFavoritesError] = useState<string | null>(null)
  const [floatingDragging, setFloatingDragging] = useState<boolean>(false)
  const [templates, setTemplates] = useState<DrawingTemplate[]>(loadDrawingTemplates)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState<boolean>(false)
  const toolbarRef = useRef<HTMLElement>(null)
  const floatingToolbarRef = useRef<HTMLElement>(null)
  const floatingPositionRef = useRef<DrawingToolbarPosition | null>(null)
  const floatingDragRef = useRef<ToolbarDragState | null>(null)
  const floatingPositionCustomizedRef = useRef<boolean>(false)
  const lastMenuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const favoriteTools = favorites.flatMap((type) => DRAWING_TOOLS.find((tool) => tool.type === type) ?? [])

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

  const dismissMenus = useCallback((reason: DismissReason): void => {
    setOpenMenu(null)
    setConfirmAll(false)
    if (reason === 'escape') queueMicrotask(() => lastMenuTriggerRef.current?.focus())
  }, [])

  useDismissableLayer({ open: openMenu !== null, layerRef: toolbarRef, onDismiss: dismissMenus })

  const toggleMenu = (menu: Exclude<OpenMenu, null>, event: ReactMouseEvent<HTMLButtonElement>): void => {
    lastMenuTriggerRef.current = event.currentTarget
    setConfirmAll(false)
    setOpenMenu((current) => current === menu ? null : menu)
  }

  const choose = (tool: string | null, keepNextAppearance: boolean = false): void => {
    if (disabled) return
    if (!keepNextAppearance) replayEngine.setNextDrawingAppearance(null)
    replayEngine.setDrawingTool(tool)
    setOpenMenu(null)
  }

  const toggleFavorite = (type: DrawingFavoriteToolType): void => {
    const next = toggleDrawingFavorite(favorites, type)
    try {
      persistDrawingFavorites(next)
      setFavorites(next)
      setFavoritesError(null)
    } catch (error) {
      setFavoritesError(error instanceof Error ? error.message : 'Could not save favorite drawing tools')
    }
  }

  const commitFloatingPosition = (): void => {
    const position = floatingPositionRef.current
    if (!position) return
    try {
      persistDrawingToolbarPosition(position)
      setFavoritesError(null)
    } catch (error) {
      setFavoritesError(error instanceof Error ? error.message : 'Could not save the favorite toolbar position')
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

  const commitTemplates = (next: DrawingTemplate[]): void => {
    try {
      persistDrawingTemplates(next)
      setTemplates(next)
      setTemplateError(null)
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Could not save drawing templates')
    }
  }

  const saveTemplate = (name: string): void => {
    if (!replay.selectedDrawing) return
    try {
      commitTemplates(saveNamedDrawingTemplate(templates, name, replay.selectedDrawing))
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Could not save drawing template')
    }
  }

  const applyTemplate = (template: DrawingTemplate): void => {
    replayEngine.updateSelectedDrawing(template.appearance)
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
        className="grid size-9 shrink-0 place-items-center rounded-control text-muted hover:bg-surface-3 hover:text-ink"
        title={`${favorite ? 'Remove' : 'Add'} ${tool.name} ${favorite ? 'from' : 'to'} favorites`}
      >
        <Star size={14} strokeWidth={1.75} fill={favorite ? 'currentColor' : 'none'} />
      </button>
    )
  }

  return (
    <>
      <nav ref={toolbarRef} className="drawing-toolbar absolute left-2 top-2 z-50 flex flex-col rounded-panel border border-line bg-surface-1/95 p-1 shadow-overlay" aria-label="Drawing tools">
        <button type="button" disabled={disabled} onClick={() => choose(null)} aria-label="Crosshair" aria-pressed={replay.activeDrawingTool === null} className="tool-button disabled:cursor-not-allowed disabled:opacity-40" title="Crosshair (Esc)">
          <Crosshair size={16} strokeWidth={1.75} />
        </button>

        <span aria-hidden="true" className="mx-1 my-1 h-px bg-line" />

        <div className="relative">
          <button type="button" onClick={(event) => toggleMenu('lines', event)} className="tool-button relative" aria-label="Line tools" aria-expanded={openMenu === 'lines'} aria-pressed={LINE_TOOL_TYPES.some((type) => replay.activeDrawingTool === type)} title="Lines">
            <LineChart size={16} strokeWidth={1.75} />
            <ChevronDown aria-hidden="true" className="absolute bottom-0.5 right-0.5" size={8} strokeWidth={2} />
          </button>
          {openMenu === 'lines' ? (
            <div role="menu" aria-label="Line tools menu" className="absolute left-[calc(100%+0.25rem)] top-0 w-64 rounded-panel border border-line bg-surface-2 p-1.5 shadow-overlay">
              {lineTools.map((tool) => (
                <div key={tool.type} role="none" className="flex items-center">
                  <button role="menuitem" type="button" disabled={disabled} onClick={() => choose(tool.type)} className="flex h-9 min-w-0 flex-1 items-center gap-3 rounded-control px-2 text-left text-ui-control text-muted hover:bg-surface-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40">
                    <span aria-hidden="true" className="flex w-5 justify-center text-active-bright"><ToolIcon type={tool.type} size={15} /></span><span>{tool.name}</span>
                  </button>
                  {favoriteToggle(tool)}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {fibonacciTool ? (
          <button type="button" disabled={disabled} onClick={() => choose(fibonacciTool.type)} aria-label="Fibonacci" aria-pressed={replay.activeDrawingTool === fibonacciTool.type} className="tool-button disabled:cursor-not-allowed disabled:opacity-40" title="Fibonacci Retracement · one drawing">
            <Waves size={16} strokeWidth={1.75} />
          </button>
        ) : null}

        <div className="relative">
          <button type="button" onClick={(event) => toggleMenu('shapes', event)} className="tool-button relative" aria-label="Shape tools" aria-expanded={openMenu === 'shapes'} aria-pressed={SHAPE_TOOL_TYPES.some((type) => replay.activeDrawingTool === type)} title="Shapes">
            <Square size={15} strokeWidth={1.75} />
            <ChevronDown aria-hidden="true" className="absolute bottom-0.5 right-0.5" size={8} strokeWidth={2} />
          </button>
          {openMenu === 'shapes' ? (
            <div role="menu" aria-label="Shape tools menu" className="absolute left-[calc(100%+0.25rem)] top-0 w-56 rounded-panel border border-line bg-surface-2 p-1.5 shadow-overlay">
              {shapeTools.map((tool) => (
                <div key={tool.type} role="none" className="flex items-center">
                  <button role="menuitem" type="button" disabled={disabled} onClick={() => choose(tool.type)} className="flex h-9 min-w-0 flex-1 items-center gap-3 rounded-control px-2 text-left text-ui-control text-muted hover:bg-surface-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40">
                    <span aria-hidden="true" className="flex w-5 justify-center text-active-bright"><ToolIcon type={tool.type} size={15} /></span><span>{tool.name}</span>
                  </button>
                  {favoriteToggle(tool)}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {textTool ? <button type="button" disabled={disabled} onClick={() => choose(textTool.type)} aria-label="Text" aria-pressed={replay.activeDrawingTool === textTool.type} className="tool-button disabled:cursor-not-allowed disabled:opacity-40" title="Text · one drawing"><Type size={16} strokeWidth={1.75} /></button> : null}
        {measureTool ? <button type="button" disabled={disabled} onClick={() => choose(measureTool.type)} aria-label="Measure" aria-pressed={replay.activeDrawingTool === measureTool.type} className="tool-button disabled:cursor-not-allowed disabled:opacity-40" title="Measure · hold Shift for mouse-down, then release and drag · clears on next chart action"><Ruler size={16} strokeWidth={1.75} /></button> : null}

        <span aria-hidden="true" className="mx-1 my-1 h-px bg-line" />

        <div className="relative">
          <button type="button" onClick={(event) => toggleMenu('favorites', event)} className="tool-button" aria-label="Manage favorite tools" aria-expanded={openMenu === 'favorites'} aria-pressed={favorites.length > 0} title="Favorite drawing tools">
            <Star size={15} strokeWidth={1.75} fill={favorites.length > 0 ? 'currentColor' : 'none'} />
          </button>
        </div>

        {openMenu === 'favorites' ? (
          <div role="menu" aria-label="Favorite tools menu" className="absolute left-[calc(100%+0.25rem)] top-0 max-h-[17.75rem] w-64 overflow-y-auto rounded-panel border border-line bg-surface-2 p-1.5 shadow-overlay">
            <div aria-hidden="true" className="px-2 pb-1.5 pt-1 text-ui-meta font-semibold uppercase tracking-[0.12em] text-faint">Show in floating bar</div>
            {DRAWING_TOOLS.map((tool) => {
              const favorite = favorites.includes(tool.type)
              return (
                <button key={tool.type} type="button" role="menuitemcheckbox" aria-checked={favorite} aria-label={`${favorite ? 'Unstar' : 'Star'} ${tool.name}`} onClick={() => toggleFavorite(tool.type)} className="flex h-9 w-full items-center gap-3 rounded-control px-2 text-left text-ui-control text-muted hover:bg-surface-3 hover:text-ink">
                  <span aria-hidden="true" className="flex w-5 justify-center text-active-bright"><ToolIcon type={tool.type} size={15} /></span>
                  <span className="min-w-0 flex-1 truncate">{tool.name}</span>
                  <Star aria-hidden="true" size={14} strokeWidth={1.75} fill={favorite ? 'currentColor' : 'none'} />
                </button>
              )
            })}
            {favoritesError ? <div role="alert" className="px-2 py-1.5 text-ui-body text-loss-bright">{favoritesError}</div> : null}
          </div>
        ) : null}

        <div className="relative">
          <button type="button" onClick={(event) => toggleMenu('delete', event)} className="tool-button hover:!text-loss-bright" aria-label="Delete drawings" aria-expanded={openMenu === 'delete'} title="Delete drawings"><Trash2 size={15} /></button>
          {openMenu === 'delete' ? (
            <div role="menu" aria-label="Delete drawings menu" className="absolute bottom-0 left-[calc(100%+0.25rem)] w-48 rounded-panel border border-line bg-surface-2 p-1.5 shadow-overlay">
              <button role="menuitem" type="button" disabled={disabled || !replay.selectedDrawing} onClick={() => { replayEngine.deleteSelectedDrawing(); setOpenMenu(null) }} className="flex h-9 w-full items-center gap-2 rounded-control px-2 text-left text-ui-control text-muted hover:bg-surface-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"><Trash2 size={14} />Delete selected</button>
              <button role="menuitem" type="button" disabled={disabled} onClick={() => { if (confirmAll) { replayEngine.deleteAllDrawings(); setOpenMenu(null); setConfirmAll(false) } else setConfirmAll(true) }} className={`flex h-9 w-full items-center gap-2 rounded-control px-2 text-left text-ui-control disabled:cursor-not-allowed disabled:opacity-35 ${confirmAll ? 'bg-loss/12 text-loss-bright' : 'text-muted hover:bg-loss/10 hover:text-loss-bright'}`}>{confirmAll ? <Check size={14} /> : <Trash2 size={14} />}{confirmAll ? 'Confirm delete all' : 'Delete all drawings'}</button>
            </div>
          ) : null}
        </div>
      </nav>

      {favoriteTools.length > 0 ? (
        <nav ref={floatingToolbarRef} aria-label="Favorite drawing tools" className="absolute left-0 top-0 z-[60] flex max-w-[calc(100%-1rem)] items-center gap-0.5 overflow-x-auto rounded-panel border border-line bg-surface-1/95 p-1 shadow-overlay will-change-transform">
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
            className={`sticky left-0 z-10 grid size-8 shrink-0 touch-none place-items-center rounded-control bg-surface-1 ${floatingDragging ? 'cursor-grabbing text-ink' : 'cursor-grab text-muted hover:bg-surface-3 hover:text-ink'}`}
            title="Drag to move · arrow keys move by 1px · Shift + arrow moves by 10px"
          >
            <GripVertical size={15} strokeWidth={1.75} />
          </button>
          <span id="favorite-toolbar-drag-help" className="sr-only">Drag to move this toolbar within the chart. Use arrow keys for precise movement; hold Shift to move faster.</span>
          {favoriteTools.map((tool) => (
            <button key={tool.type} type="button" disabled={disabled} onClick={() => choose(tool.type)} aria-label={`Favorite ${tool.name}`} aria-pressed={replay.activeDrawingTool === tool.type} className="tool-button shrink-0 disabled:cursor-not-allowed disabled:opacity-40" title={tool.name}>
              <ToolIcon type={tool.type} />
            </button>
          ))}
        </nav>
      ) : null}

      {replay.selectedDrawing && replay.drawingInspectorOpen ? (
        <div className="absolute bottom-2 left-[3.75rem] right-2 top-2 z-30 sm:right-auto sm:w-[22rem]">
          <DrawingInspector
            drawing={replay.selectedDrawing}
            templates={templates}
            templateError={templateError}
            onChange={(patch) => replayEngine.updateSelectedDrawing(patch)}
            onClose={() => replayEngine.closeDrawingInspector()}
            onSaveTemplate={saveTemplate}
            onApplyTemplate={applyTemplate}
            onDeleteTemplate={(id) => commitTemplates(deleteDrawingTemplate(templates, id))}
          />
        </div>
      ) : null}
    </>
  )
}
