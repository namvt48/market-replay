import {
  Anchor,
  Copy,
  GripVertical,
  LayoutGrid,
  Lock,
  LockOpen,
  Minus,
  MoreHorizontal,
  PaintBucket,
  PencilLine,
  Plus,
  Trash2,
  Type,
  type LucideIcon,
} from 'lucide-react'
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from 'react'
import { useDismissableLayer, type DismissReason } from '../../hooks/use-dismissable-layer'
import { LINE_TOOL_TYPES } from '../../replay/drawing-appearance'
import type { DrawingAppearance, DrawingAppearancePatch, DrawingBorderStyle } from '../../replay/drawing-appearance'
import {
  loadContextualDrawingToolbarPosition,
  persistContextualDrawingToolbarPosition,
  type DrawingToolbarPosition,
} from '../../replay/drawing-toolbar-position'
import type { DrawingTemplate } from '../../replay/drawing-templates'

type ContextMenu = 'color' | 'fill' | 'fontSize' | 'positionTarget' | 'positionStop' | 'templates' | 'width' | 'text' | 'lineStyle' | 'overflow' | null
type DrawingColorTarget = 'stroke' | 'fill' | 'text' | 'positionTarget' | 'positionStop'

interface SelectedDrawingToolbarConfig {
  colorTarget: DrawingColorTarget
  lineWidth: boolean
}

interface SelectedDrawingToolbarProps {
  drawing: DrawingAppearance
  drawingName: string
  templates: DrawingTemplate[]
  templateError: string | null
  onApplyDefaultTemplate: () => void
  onApplyTemplate: (template: DrawingTemplate) => void
  onChange: (patch: DrawingAppearancePatch) => void
  onDelete: () => void
  onDuplicate: () => void
  onLock: () => void
  onOpenProperties: () => void
  onSaveTemplate: (name: string) => void
}

interface DragState {
  pointerId: number
  pointerX: number
  pointerY: number
  toolbarX: number
  toolbarY: number
  moved: boolean
}

const TOOLBAR_BOUNDARY = 8
const TOOLBAR_DEFAULT_TOP = 8
const LINE_WIDTHS = [1, 2, 3, 4] as const
const TEXT_FONT_SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 40] as const
const BORDER_STYLE_OPTIONS: readonly { value: DrawingBorderStyle; label: string; css: 'solid' | 'dashed' | 'dotted' }[] = [
  { value: 'solid', label: '— Line', css: 'solid' },
  { value: 'dashed', label: '- - Dashed line', css: 'dashed' },
  { value: 'dotted', label: '··· Dotted line', css: 'dotted' },
]
const COLOR_ROWS = [
  ['#f2f3f5', '#dedfe3', '#c5c7cc', '#a9abb1', '#85878d', '#6b6d73', '#515359', '#393b40', '#232529', '#090a0c'],
  ['#f23645', '#ff9800', '#ffca28', '#4caf50', '#26a69a', '#26c6da', '#2962ff', '#7e57c2', '#ab47bc', '#ec407a'],
  ['#ff8a80', '#ffcc80', '#fff59d', '#a5d6a7', '#80cbc4', '#80deea', '#82b1ff', '#b39ddb', '#ce93d8', '#f48fb1'],
  ['#ef9a9a', '#ffab91', '#ffe082', '#c5e1a5', '#b2dfdb', '#b2ebf2', '#90caf9', '#c5cae9', '#d1c4e9', '#f8bbd0'],
  ['#e57373', '#ff8a65', '#ffd54f', '#81c784', '#4db6ac', '#4dd0e1', '#64b5f6', '#7986cb', '#9575cd', '#f06292'],
  ['#ef5350', '#ff7043', '#ffca28', '#66bb6a', '#26a69a', '#26c6da', '#42a5f5', '#5c6bc0', '#7e57c2', '#ec407a'],
  ['#d84343', '#f4511e', '#ffb300', '#43a047', '#00897b', '#00acc1', '#1e88e5', '#3949ab', '#5e35b1', '#d81b60'],
  ['#aa2e25', '#e64a19', '#f57c00', '#2e7d32', '#00695c', '#00838f', '#1565c0', '#283593', '#4527a0', '#ad1457'],
] as const

const BUTTON_CLASS = 'relative grid size-10 shrink-0 place-items-center rounded-control text-muted outline-none transition-colors duration-100 hover:bg-surface-3 hover:text-ink focus-visible:ring-2 focus-visible:ring-active motion-reduce:transition-none sm:size-9'

const DRAWING_TOOLBAR_CONFIG: Readonly<Record<string, SelectedDrawingToolbarConfig>> = {
  'text-annotation': { colorTarget: 'text', lineWidth: false },
  'arrow-marker': { colorTarget: 'stroke', lineWidth: false },
  'long-position': { colorTarget: 'stroke', lineWidth: false },
  'short-position': { colorTarget: 'stroke', lineWidth: false },
}

function toolbarConfigFor(type: string): SelectedDrawingToolbarConfig {
  return DRAWING_TOOLBAR_CONFIG[type] ?? { colorTarget: 'stroke', lineWidth: true }
}

function MenuButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }): ReactElement {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex min-h-10 w-full items-center gap-3 rounded-control px-3 text-left text-ui-control text-muted outline-none hover:bg-surface-3 hover:text-ink focus-visible:bg-surface-3 focus-visible:text-ink">
      <Icon aria-hidden="true" size={15} strokeWidth={1.6} />
      <span>{label}</span>
    </button>
  )
}

function LinePropertiesIcon(): ReactElement {
  return (
    <svg data-icon="line-properties" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3.5h8l5 8.5-5 8.5H8L3 12z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  )
}

export function SelectedDrawingToolbar({
  drawing,
  drawingName,
  templates,
  templateError,
  onApplyDefaultTemplate,
  onApplyTemplate,
  onChange,
  onDelete,
  onDuplicate,
  onLock,
  onOpenProperties,
  onSaveTemplate,
}: SelectedDrawingToolbarProps): ReactElement {
  const config = toolbarConfigFor(drawing.type)
  const isLineTool = (LINE_TOOL_TYPES as readonly string[]).includes(drawing.type)
  const isRectangle = drawing.type === 'rectangle'
  const isCurve = drawing.type === 'curve'
  const isRange = drawing.type === 'price-range' || drawing.type === 'date-range'
  const isPosition = drawing.type === 'long-position' || drawing.type === 'short-position'
  const isTextAnnotation = drawing.type === 'text-annotation'
  const matchingTemplates = templates.filter((template) => template.toolType === drawing.type)
  const currentColor = config.colorTarget === 'text' ? drawing.textColor : drawing.strokeColor
  const currentOpacity = config.colorTarget === 'text' ? drawing.textOpacity : drawing.strokeOpacity
  const [dragging, setDragging] = useState<boolean>(false)
  const [openMenu, setOpenMenu] = useState<ContextMenu>(null)
  const [savingTemplate, setSavingTemplate] = useState<boolean>(false)
  const [templateName, setTemplateName] = useState<string>('')
  const [menuAnchorLeft, setMenuAnchorLeft] = useState<number>(0)
  const layerRef = useRef<HTMLDivElement>(null)
  const positionRef = useRef<DrawingToolbarPosition | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null)

  const applyPosition = useCallback((position: DrawingToolbarPosition): DrawingToolbarPosition | null => {
    const layer = layerRef.current
    const container = layer?.parentElement
    if (!layer || !container) return null
    const maxX = Math.max(TOOLBAR_BOUNDARY, container.clientWidth - layer.offsetWidth - TOOLBAR_BOUNDARY)
    const maxY = Math.max(TOOLBAR_BOUNDARY, container.clientHeight - layer.offsetHeight - TOOLBAR_BOUNDARY)
    const next = {
      x: Math.min(Math.max(position.x, TOOLBAR_BOUNDARY), maxX),
      y: Math.min(Math.max(position.y, TOOLBAR_BOUNDARY), maxY),
    }
    positionRef.current = next
    layer.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`
    return next
  }, [])

  const defaultPosition = useCallback((): DrawingToolbarPosition => {
    const layer = layerRef.current
    const container = layer?.parentElement
    if (!layer || !container) return { x: TOOLBAR_BOUNDARY, y: TOOLBAR_DEFAULT_TOP }
    return { x: Math.max(TOOLBAR_BOUNDARY, (container.clientWidth - layer.offsetWidth) / 2), y: TOOLBAR_DEFAULT_TOP }
  }, [])

  useLayoutEffect(() => {
    const layer = layerRef.current
    const container = layer?.parentElement
    if (!layer || !container) return
    if (!positionRef.current) positionRef.current = loadContextualDrawingToolbarPosition()
    const syncPosition = (): void => { applyPosition(positionRef.current ?? defaultPosition()) }
    syncPosition()
    window.addEventListener('resize', syncPosition)
    if (typeof ResizeObserver === 'undefined') return () => window.removeEventListener('resize', syncPosition)
    const observer = new ResizeObserver(syncPosition)
    observer.observe(container)
    observer.observe(layer)
    return () => {
      window.removeEventListener('resize', syncPosition)
      observer.disconnect()
    }
  }, [applyPosition, config.lineWidth, defaultPosition, drawing.id])

  const commitPosition = (): void => {
    const position = positionRef.current
    if (position) persistContextualDrawingToolbarPosition(position)
  }

  const dismissMenu = useCallback((reason: DismissReason): void => {
    setOpenMenu(null)
    setSavingTemplate(false)
    setTemplateName('')
    if (reason === 'escape') queueMicrotask(() => lastTriggerRef.current?.focus())
  }, [])

  useDismissableLayer({ open: openMenu !== null, layerRef, onDismiss: dismissMenu })

  const toggleMenu = (menu: Exclude<ContextMenu, null>, trigger: HTMLButtonElement): void => {
    lastTriggerRef.current = trigger
    setMenuAnchorLeft(trigger.offsetLeft)
    setOpenMenu((current) => current === menu ? null : menu)
    setSavingTemplate(false)
    setTemplateName('')
  }

  const startDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || event.isPrimary === false) return
    const position = positionRef.current ?? applyPosition(defaultPosition())
    if (!position) return
    dragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      toolbarX: position.x,
      toolbarY: position.y,
      moved: false,
    }
    if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    event.preventDefault()
  }

  const moveDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.moved = true
    applyPosition({
      x: drag.toolbarX + event.clientX - drag.pointerX,
      y: drag.toolbarY + event.clientY - drag.pointerY,
    })
    event.preventDefault()
  }

  const stopDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (typeof event.currentTarget.hasPointerCapture === 'function' && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDragging(false)
    if (drag.moved) commitPosition()
  }

  const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>): void => {
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
    const current = positionRef.current ?? applyPosition(defaultPosition())
    if (!current) return
    applyPosition({ x: current.x + offset.x, y: current.y + offset.y })
    commitPosition()
  }

  const changeColor = (target: DrawingColorTarget, color: string): void => {
    if (target === 'text') onChange({ textColor: color })
    else if (target === 'fill') onChange({ fillColor: color, fillOpacity: drawing.fillOpacity > 0 ? drawing.fillOpacity : 0.12 })
    else if (target === 'positionTarget') onChange({ positionTargetColor: color, positionTargetOpacity: drawing.positionTargetOpacity > 0 ? drawing.positionTargetOpacity : 0.3 })
    else if (target === 'positionStop') onChange({ positionStopColor: color, positionStopOpacity: drawing.positionStopOpacity > 0 ? drawing.positionStopOpacity : 0.3 })
    else onChange({ strokeColor: color })
    setOpenMenu(null)
  }

  const changeOpacity = (target: DrawingColorTarget, opacity: number): void => {
    if (target === 'text') onChange({ textOpacity: opacity })
    else if (target === 'fill') onChange({ fillOpacity: opacity })
    else if (target === 'positionTarget') onChange({ positionTargetOpacity: opacity })
    else if (target === 'positionStop') onChange({ positionStopOpacity: opacity })
    else onChange({ strokeOpacity: opacity })
  }

  const changeBorderStyle = (borderStyle: DrawingBorderStyle): void => {
    onChange({ borderStyle })
    setOpenMenu(null)
  }

  const submitTemplate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const name = templateName.trim()
    if (!name) return
    onSaveTemplate(name)
    setTemplateName('')
    setSavingTemplate(false)
    setOpenMenu(null)
  }

  return (
    <div ref={layerRef} className="absolute left-0 top-0 z-[75] max-w-[calc(100%-1rem)] will-change-transform">
      <div role="toolbar" aria-label={`Selected ${drawingName} drawing`} className="flex max-w-full items-center overflow-x-auto rounded-panel border border-line bg-[#191a1d] p-0.5 shadow-overlay">
        <button
          type="button"
          aria-label="Move selected drawing toolbar"
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onLostPointerCapture={stopDrag}
          onKeyDown={moveWithKeyboard}
          className={`${BUTTON_CLASS} touch-none ${dragging ? 'cursor-grabbing text-ink' : 'cursor-grab'}`}
          title="Drag to move · arrow keys move by 1px · Shift + arrow moves by 10px"
        >
          <GripVertical size={15} strokeWidth={1.6} />
        </button>

        <button type="button" aria-label="Drawing templates" aria-expanded={openMenu === 'templates'} onClick={(event) => toggleMenu('templates', event.currentTarget)} className={BUTTON_CLASS} title="Drawing templates">
          <LayoutGrid size={17} strokeWidth={1.5} />
          <Plus aria-hidden="true" className="absolute bottom-1 right-1 rounded-sm bg-[#191a1d]" size={9} strokeWidth={2} />
        </button>

        {!isPosition && !isTextAnnotation ? <button type="button" aria-label="Drawing color" aria-expanded={openMenu === 'color'} onClick={(event) => toggleMenu('color', event.currentTarget)} className={BUTTON_CLASS} title="Drawing color">
          <PencilLine size={18} strokeWidth={1.5} />
          <span aria-hidden="true" className="absolute bottom-1 h-0.5 w-5 rounded-sm" style={{ backgroundColor: currentColor }} />
        </button> : null}

        {isRectangle || isCurve || isRange ? (
          <button type="button" aria-label="Drawing fill" aria-expanded={openMenu === 'fill'} onClick={(event) => toggleMenu('fill', event.currentTarget)} className={BUTTON_CLASS} title="Drawing fill">
            <PaintBucket size={18} strokeWidth={1.5} />
            <span aria-hidden="true" className="absolute bottom-1 h-0.5 w-5 rounded-sm" style={{ backgroundColor: drawing.fillColor, opacity: Math.max(0.25, drawing.fillOpacity) }} />
          </button>
        ) : null}

        {isLineTool || isRectangle || isRange || isPosition || isTextAnnotation ? (
          <button type="button" aria-label="Drawing text" aria-expanded={openMenu === 'text'} onClick={(event) => toggleMenu('text', event.currentTarget)} className={BUTTON_CLASS} title="Drawing text">
            <Type size={18} strokeWidth={1.5} />
            <span data-color-indicator="text" aria-hidden="true" className="absolute bottom-1 h-0.5 w-5 rounded-sm" style={{ backgroundColor: drawing.textColor }} />
          </button>
        ) : null}

        {isTextAnnotation ? <button type="button" aria-label="Font size" aria-expanded={openMenu === 'fontSize'} onClick={(event) => toggleMenu('fontSize', event.currentTarget)} className={`${BUTTON_CLASS} w-12 font-mono text-ui-control text-ink`} title="Font size">{drawing.fontSize}</button> : null}

        {isPosition ? (
          <>
            <button type="button" aria-label="Position target color" aria-expanded={openMenu === 'positionTarget'} onClick={(event) => toggleMenu('positionTarget', event.currentTarget)} className={BUTTON_CLASS} title="Target color">
              <PaintBucket size={18} strokeWidth={1.5} />
              <span aria-hidden="true" className="absolute bottom-1 h-0.5 w-5 rounded-sm" style={{ backgroundColor: drawing.positionTargetColor, opacity: Math.max(0.3, drawing.positionTargetOpacity) }} />
            </button>
            <button type="button" aria-label="Position stop color" aria-expanded={openMenu === 'positionStop'} onClick={(event) => toggleMenu('positionStop', event.currentTarget)} className={BUTTON_CLASS} title="Stop color">
              <PaintBucket size={18} strokeWidth={1.5} />
              <span aria-hidden="true" className="absolute bottom-1 h-0.5 w-5 rounded-sm" style={{ backgroundColor: drawing.positionStopColor, opacity: Math.max(0.3, drawing.positionStopOpacity) }} />
            </button>
          </>
        ) : null}

        {config.lineWidth ? (
          <button type="button" aria-label="Line thickness" aria-expanded={openMenu === 'width'} onClick={(event) => toggleMenu('width', event.currentTarget)} className={`${BUTTON_CLASS} w-[4.4rem] grid-cols-[1.4rem_1fr] gap-1 px-1.5 font-mono text-ui-control text-ink sm:w-[4.1rem]`} title="Line thickness">
            <span aria-hidden="true" className="block w-5 rounded-full bg-current" style={{ height: `${Math.min(drawing.lineWidth, 4)}px` }} />
            <span>{drawing.lineWidth}px</span>
          </button>
        ) : null}

        {isLineTool || isRectangle || isCurve || isRange ? (
          <button type="button" aria-label="Line style" aria-expanded={openMenu === 'lineStyle'} onClick={(event) => toggleMenu('lineStyle', event.currentTarget)} className={BUTTON_CLASS} title="Line style">
            <Minus size={18} strokeWidth={1.5} />
          </button>
        ) : null}

        <button type="button" aria-label="Drawing properties" onClick={onOpenProperties} className={BUTTON_CLASS} title="Drawing properties">
          <LinePropertiesIcon />
        </button>
        <button type="button" aria-label={drawing.locked ? 'Unlock drawing' : 'Lock drawing'} aria-pressed={drawing.locked} onClick={onLock} className={`${BUTTON_CLASS} group`} title={drawing.locked ? 'Unlock drawing' : 'Lock drawing'}>
          {drawing.locked
            ? <Lock key="locked-state" className="animate-drawing-lock-swap transition-transform duration-100 group-active:scale-90 motion-reduce:transition-none" size={18} strokeWidth={1.5} />
            : <LockOpen key="unlocked-state" className="animate-drawing-lock-swap transition-transform duration-100 group-active:scale-90 motion-reduce:transition-none" size={18} strokeWidth={1.5} />}
        </button>
        {isTextAnnotation ? <button type="button" aria-label={drawing.textAnchored ? 'Unanchor drawing' : 'Anchor drawing'} aria-pressed={drawing.textAnchored} onClick={() => onChange({ textAnchored: !drawing.textAnchored })} className={`${BUTTON_CLASS} aria-pressed:bg-surface-3 aria-pressed:text-active-bright`} title={drawing.textAnchored ? 'Unanchor from pane' : 'Anchor to pane'}><Anchor size={18} strokeWidth={1.5} /></button> : null}
        <button type="button" aria-label="Remove drawing" onClick={onDelete} className={`${BUTTON_CLASS} hover:bg-loss/10 hover:text-loss-bright`} title="Remove drawing"><Trash2 size={18} strokeWidth={1.5} /></button>

        {isLineTool || isRectangle || isPosition || isTextAnnotation ? (
          <button type="button" aria-label="More drawing actions" aria-expanded={openMenu === 'overflow'} onClick={(event) => toggleMenu('overflow', event.currentTarget)} className={BUTTON_CLASS} title="More actions">
            <MoreHorizontal size={18} strokeWidth={1.5} />
          </button>
        ) : null}
      </div>

      {openMenu === 'templates' ? (
        <div role="menu" aria-label="Drawing templates menu" style={{ left: menuAnchorLeft }} className="absolute top-[calc(100%+0.25rem)] w-[17rem] rounded-panel border border-line bg-[#191a1d] p-1 shadow-overlay">
          {savingTemplate ? (
            <form onSubmit={submitTemplate} className="p-2">
              <label className="field-label">Template name<input autoFocus value={templateName} maxLength={80} onChange={(event) => setTemplateName(event.target.value)} className="field-input mt-1 h-9" placeholder="e.g. Breakout" /></label>
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setSavingTemplate(false)} className="secondary-button px-3">Cancel</button>
                <button type="submit" disabled={!templateName.trim()} className="secondary-button px-3 disabled:opacity-35">Save</button>
              </div>
            </form>
          ) : (
            <>
              <MenuButton icon={Plus} label="Save Drawing Template As…" onClick={() => setSavingTemplate(true)} />
              <MenuButton icon={LayoutGrid} label="Apply default drawing template" onClick={() => { onApplyDefaultTemplate(); setOpenMenu(null) }} />
              {matchingTemplates.length > 0 ? <div role="separator" className="my-1 h-px bg-line" /> : null}
              {matchingTemplates.map((template) => <MenuButton key={template.id} icon={PencilLine} label={template.name} onClick={() => { onApplyTemplate(template); setOpenMenu(null) }} />)}
            </>
          )}
          {templateError ? <p role="alert" className="px-3 py-2 text-ui-meta text-loss-bright">{templateError}</p> : null}
        </div>
      ) : null}

      {openMenu === 'fontSize' ? (
        <div role="menu" aria-label="Font size menu" style={{ left: menuAnchorLeft }} className="absolute top-[calc(100%+0.25rem)] w-12 overflow-hidden rounded-panel border border-line bg-[#191a1d] py-1 shadow-overlay">
          {TEXT_FONT_SIZES.map((fontSize) => <button key={fontSize} type="button" role="menuitemradio" aria-checked={drawing.fontSize === fontSize} onClick={() => { onChange({ fontSize }); setOpenMenu(null) }} className="grid h-8 w-full place-items-center font-mono text-ui-control text-muted hover:bg-surface-3 hover:text-ink aria-checked:bg-[#ededed] aria-checked:text-[#171717]">{fontSize}</button>)}
        </div>
      ) : null}

      {openMenu === 'color' ? (
        <div role="menu" aria-label="Drawing color palette" style={{ left: menuAnchorLeft }} className="absolute top-[calc(100%+0.25rem)] w-[18.5rem] rounded-panel border border-line bg-[#191a1d] p-3 shadow-overlay">
          <div className="grid grid-cols-10 gap-1.5">
            {COLOR_ROWS.flat().map((color, index) => (
              <button key={`${color}-${index}`} type="button" role="menuitemradio" aria-checked={currentColor.toLocaleLowerCase() === color} aria-label={`Set drawing color ${color}`} onClick={() => changeColor(config.colorTarget, color)} className="grid size-5 place-items-center rounded-[2px] outline-none ring-offset-2 ring-offset-[#191a1d] focus-visible:ring-2 focus-visible:ring-active" style={{ backgroundColor: color }}>
                {currentColor.toLocaleLowerCase() === color ? <span aria-hidden="true" className="size-4 rounded-[2px] border-2 border-[#191a1d] ring-1 ring-ink" /> : null}
              </button>
            ))}
          </div>
          <div className="my-3 h-px bg-line" />
          <label className="flex items-center justify-between text-ui-meta text-muted"><span>Opacity</span><output className="rounded-control border border-line px-2 py-1 font-mono text-ink">{Math.round(currentOpacity * 100)}%</output></label>
          <input aria-label="Drawing opacity" type="range" min="0" max="100" value={Math.round(currentOpacity * 100)} onChange={(event) => changeOpacity(config.colorTarget, Number(event.target.value) / 100)} className="mt-2 h-5 w-full accent-active" />
        </div>
      ) : null}

      {openMenu === 'fill' ? (
        <div role="menu" aria-label="Drawing fill color palette" style={{ left: menuAnchorLeft }} className="absolute top-[calc(100%+0.25rem)] w-[18.5rem] rounded-panel border border-line bg-[#191a1d] p-3 shadow-overlay">
          <div className="grid grid-cols-10 gap-1.5">
            {COLOR_ROWS.flat().map((color, index) => (
              <button key={`${color}-${index}`} type="button" role="menuitemradio" aria-checked={drawing.fillColor.toLocaleLowerCase() === color} aria-label={`Set drawing fill color ${color}`} onClick={() => changeColor('fill', color)} className="grid size-5 place-items-center rounded-[2px] outline-none ring-offset-2 ring-offset-[#191a1d] focus-visible:ring-2 focus-visible:ring-active" style={{ backgroundColor: color }}>
                {drawing.fillColor.toLocaleLowerCase() === color ? <span aria-hidden="true" className="size-4 rounded-[2px] border-2 border-[#191a1d] ring-1 ring-ink" /> : null}
              </button>
            ))}
          </div>
          <div className="my-3 h-px bg-line" />
          <label className="flex items-center justify-between text-ui-meta text-muted"><span>Opacity</span><output className="rounded-control border border-line px-2 py-1 font-mono text-ink">{Math.round(drawing.fillOpacity * 100)}%</output></label>
          <input aria-label="Drawing fill opacity" type="range" min="0" max="100" value={Math.round(drawing.fillOpacity * 100)} onChange={(event) => changeOpacity('fill', Number(event.target.value) / 100)} className="mt-2 h-5 w-full accent-active" />
        </div>
      ) : null}

      {openMenu === 'positionTarget' ? (
        <div role="menu" aria-label="Position target color palette" style={{ left: menuAnchorLeft }} className="absolute top-[calc(100%+0.25rem)] w-[18.5rem] rounded-panel border border-line bg-[#191a1d] p-3 shadow-overlay">
          <div className="grid grid-cols-10 gap-1.5">{COLOR_ROWS.flat().map((color, index) => <button key={`${color}-${index}`} type="button" role="menuitemradio" aria-checked={drawing.positionTargetColor.toLowerCase() === color} aria-label={`Set position target color ${color}`} onClick={() => changeColor('positionTarget', color)} className="grid size-5 place-items-center rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-active" style={{ backgroundColor: color }}>{drawing.positionTargetColor.toLowerCase() === color ? <span aria-hidden="true" className="size-4 rounded-[2px] border-2 border-[#191a1d] ring-1 ring-ink" /> : null}</button>)}</div>
          <div className="my-3 h-px bg-line" /><label className="flex items-center justify-between text-ui-meta text-muted"><span>Opacity</span><output className="rounded-control border border-line px-2 py-1 font-mono text-ink">{Math.round(drawing.positionTargetOpacity * 100)}%</output></label><input aria-label="Position target opacity" type="range" min="0" max="100" value={Math.round(drawing.positionTargetOpacity * 100)} onChange={(event) => changeOpacity('positionTarget', Number(event.target.value) / 100)} className="mt-2 h-5 w-full accent-active" />
        </div>
      ) : null}

      {openMenu === 'positionStop' ? (
        <div role="menu" aria-label="Position stop color palette" style={{ left: menuAnchorLeft }} className="absolute top-[calc(100%+0.25rem)] w-[18.5rem] rounded-panel border border-line bg-[#191a1d] p-3 shadow-overlay">
          <div className="grid grid-cols-10 gap-1.5">{COLOR_ROWS.flat().map((color, index) => <button key={`${color}-${index}`} type="button" role="menuitemradio" aria-checked={drawing.positionStopColor.toLowerCase() === color} aria-label={`Set position stop color ${color}`} onClick={() => changeColor('positionStop', color)} className="grid size-5 place-items-center rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-active" style={{ backgroundColor: color }}>{drawing.positionStopColor.toLowerCase() === color ? <span aria-hidden="true" className="size-4 rounded-[2px] border-2 border-[#191a1d] ring-1 ring-ink" /> : null}</button>)}</div>
          <div className="my-3 h-px bg-line" /><label className="flex items-center justify-between text-ui-meta text-muted"><span>Opacity</span><output className="rounded-control border border-line px-2 py-1 font-mono text-ink">{Math.round(drawing.positionStopOpacity * 100)}%</output></label><input aria-label="Position stop opacity" type="range" min="0" max="100" value={Math.round(drawing.positionStopOpacity * 100)} onChange={(event) => changeOpacity('positionStop', Number(event.target.value) / 100)} className="mt-2 h-5 w-full accent-active" />
        </div>
      ) : null}

      {openMenu === 'width' ? (
        <div role="menu" aria-label="Line thickness menu" style={{ left: menuAnchorLeft }} className="absolute top-[calc(100%+0.25rem)] w-28 rounded-panel border border-line bg-[#191a1d] p-1 shadow-overlay">
          {LINE_WIDTHS.map((width) => (
            <button key={width} type="button" role="menuitemradio" aria-checked={drawing.lineWidth === width} aria-label={`${width}px`} onClick={() => { onChange({ lineWidth: width }); setOpenMenu(null) }} className="grid min-h-10 w-full grid-cols-[1.5rem_1fr] items-center gap-2 rounded-control px-2 text-left font-mono text-ui-control text-muted outline-none hover:bg-surface-3 hover:text-ink focus-visible:bg-surface-3 focus-visible:text-ink">
              <span aria-hidden="true" className="block w-5 rounded-full bg-current" style={{ height: `${width}px` }} />
              <span>{width}px</span>
            </button>
          ))}
        </div>
      ) : null}

      {openMenu === 'text' ? (
        <div role="menu" aria-label="Drawing text color palette" style={{ left: menuAnchorLeft }} className="absolute top-[calc(100%+0.25rem)] w-[18.5rem] rounded-panel border border-line bg-[#191a1d] p-3 shadow-overlay">
          <div className="grid grid-cols-10 gap-1.5">
            {COLOR_ROWS.flat().map((color, index) => (
              <button key={`${color}-${index}`} type="button" role="menuitemradio" aria-checked={drawing.textColor.toLocaleLowerCase() === color} aria-label={`Set drawing text color ${color}`} onClick={() => changeColor('text', color)} className="grid size-5 place-items-center rounded-[2px] outline-none ring-offset-2 ring-offset-[#191a1d] focus-visible:ring-2 focus-visible:ring-active" style={{ backgroundColor: color }}>
                {drawing.textColor.toLocaleLowerCase() === color ? <span aria-hidden="true" className="size-4 rounded-[2px] border-2 border-[#191a1d] ring-1 ring-ink" /> : null}
              </button>
            ))}
          </div>
          <div className="my-3 h-px bg-line" />
          <label className="flex items-center justify-between text-ui-meta text-muted"><span>Opacity</span><output className="rounded-control border border-line px-2 py-1 font-mono text-ink">{Math.round(drawing.textOpacity * 100)}%</output></label>
          <input aria-label="Drawing text opacity" type="range" min="0" max="100" value={Math.round(drawing.textOpacity * 100)} onChange={(event) => changeOpacity('text', Number(event.target.value) / 100)} className="mt-2 h-5 w-full accent-active" />
        </div>
      ) : null}

      {openMenu === 'lineStyle' ? (
        <div role="menu" aria-label="Line style menu" style={{ left: menuAnchorLeft }} className="absolute top-[calc(100%+0.25rem)] w-48 rounded-panel border border-line bg-[#191a1d] p-1 shadow-overlay">
          {BORDER_STYLE_OPTIONS.map((option) => (
            <button key={option.value} type="button" role="menuitemradio" aria-checked={drawing.borderStyle === option.value} onClick={() => changeBorderStyle(option.value)} className="grid min-h-10 w-full grid-cols-[1.75rem_1fr] items-center gap-2 rounded-control px-2 text-left text-ui-control text-muted outline-none hover:bg-surface-3 hover:text-ink focus-visible:bg-surface-3 focus-visible:text-ink">
              <span aria-hidden="true" className="block w-6 border-t-2 border-current" style={{ borderTopStyle: option.css }} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {openMenu === 'overflow' ? (
        <div role="menu" aria-label="More drawing actions" style={{ left: menuAnchorLeft }} className="absolute top-[calc(100%+0.25rem)] w-44 rounded-panel border border-line bg-[#191a1d] p-1 shadow-overlay">
          <MenuButton icon={Copy} label="Duplicate" onClick={() => { onDuplicate(); setOpenMenu(null) }} />
        </div>
      ) : null}
    </div>
  )
}
