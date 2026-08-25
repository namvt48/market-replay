import { Bold, Check, ChevronDown, Italic, Pencil, Trash2, X } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  type DrawingAppearance,
  type DrawingAppearancePatch,
  type DrawingBorderStyle,
  type DrawingHorizontalAlign,
  type DrawingVerticalAlign,
} from '../../replay/drawing-appearance'
import { defaultDrawingTemplateAppearance, type DrawingTemplate } from '../../replay/drawing-templates'
import { DrawingCoordinatesPanel, DrawingVisibilityPanel } from './DrawingPropertySharedPanels'

interface RectangleDrawingInspectorProps {
  drawing: DrawingAppearance
  templates: DrawingTemplate[]
  templateError: string | null
  onChange: (patch: DrawingAppearancePatch) => void
  onDeleteTemplate: (id: string) => void
  onClose: () => void
}

type RectangleInspectorTab = 'style' | 'text' | 'coordinates' | 'visibility'
type RectangleMenu = 'border' | 'middle' | 'background' | 'textColor' | 'template' | null
type RectangleExtension = 'none' | 'left' | 'right' | 'both'

interface InspectorDragState {
  pointerId: number
  pointerX: number
  pointerY: number
  originX: number
  originY: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface ColorPaletteProps {
  anchorRef: RefObject<HTMLButtonElement | null>
  color: string
  label: string
  opacity: number
  opacityLabel: string
  positionKey: string
  onColor: (color: string) => void
  onOpacity: (opacity: number) => void
  children?: ReactNode
}

interface LineAppearanceButtonProps {
  buttonRef: RefObject<HTMLButtonElement | null>
  label: string
  color: string
  lineStyle: DrawingBorderStyle
  lineWidth: number
  disabled?: boolean
  expanded: boolean
  onClick: () => void
}

interface LineControlsProps {
  width: number
  style: DrawingBorderStyle
  onWidth: (width: number) => void
  onStyle: (style: DrawingBorderStyle) => void
}

interface PopoverPosition {
  left: number
  top: number
  maxHeight: number
}

const TABS: readonly { id: RectangleInspectorTab; label: string }[] = [
  { id: 'style', label: 'Style' },
  { id: 'text', label: 'Text' },
  { id: 'coordinates', label: 'Coordinates' },
  { id: 'visibility', label: 'Visibility' },
]

const COLOR_ROWS = [
  ['#f2f3f5', '#dedfe3', '#c5c7cc', '#a9abb1', '#85878d', '#6b6d73', '#515359', '#393b40', '#232529', '#090a0c'],
  ['#f23645', '#ff9800', '#ffca28', '#4caf50', '#26a69a', '#26c6da', '#2962ff', '#7e57c2', '#ab47bc', '#ec407a'],
  ['#ffb3b8', '#ffe0b2', '#fff9c4', '#c8e6c9', '#b2dfdb', '#b2ebf2', '#bbdefb', '#c5cae9', '#e1bee7', '#f8bbd0'],
  ['#ef9a9a', '#ffcc80', '#fff59d', '#a5d6a7', '#80cbc4', '#80deea', '#90caf9', '#9fa8da', '#ce93d8', '#f48fb1'],
  ['#e57373', '#ffb74d', '#ffee58', '#81c784', '#4db6ac', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8', '#f06292'],
  ['#ef5350', '#ffa726', '#ffeb3b', '#66bb6a', '#26a69a', '#26c6da', '#42a5f5', '#5c6bc0', '#ab47bc', '#ec407a'],
  ['#c62828', '#ef6c00', '#ffb300', '#2e7d32', '#00796b', '#00838f', '#1565c0', '#303f9f', '#7b1fa2', '#c2185b'],
  ['#9f1d20', '#e65100', '#f57c00', '#00695c', '#00695c', '#006064', '#0d47a1', '#1a237e', '#4a148c', '#880e4f'],
] as const

const PANEL_INPUT = 'h-9 rounded-control border border-[#4b4d52] bg-[#202020] px-2.5 text-ui-control text-[#d6d6d6] outline-none transition-[border-color,background-color] duration-100 hover:border-[#5a5c61] focus:border-active disabled:cursor-not-allowed disabled:border-[#414141] disabled:bg-[#292929] disabled:text-[#686868]'
const ICON_BUTTON = 'grid size-9 place-items-center rounded-control border border-[#4b4d52] bg-[#202020] text-[#d6d6d6] outline-none transition-[border-color,background-color] duration-100 hover:border-[#62646a] hover:bg-[#292929] focus-visible:ring-2 focus-visible:ring-active aria-pressed:bg-[#ededed] aria-pressed:text-[#171717]'
const CHECKBOX = 'size-[18px] shrink-0 accent-white disabled:cursor-not-allowed'

function parseHorizontalAlign(value: string): DrawingHorizontalAlign {
  if (value === 'left' || value === 'right') return value
  return 'center'
}

function parseVerticalAlign(value: string): DrawingVerticalAlign {
  if (value === 'top' || value === 'bottom') return value
  return 'inside'
}

function linePreview(style: DrawingBorderStyle, width = 1): ReactElement {
  return <span aria-hidden="true" className={`block w-8 border-current ${style === 'dashed' ? 'border-dashed' : style === 'dotted' ? 'border-dotted' : 'border-solid'}`} style={{ borderTopWidth: width }} />
}

function ColorPalette({ anchorRef, color, label, opacity, opacityLabel, positionKey, onColor, onOpacity, children }: ColorPaletteProps): ReactElement | null {
  const paletteRef = useRef<HTMLDivElement>(null)
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null)

  useLayoutEffect(() => {
    const updatePosition = (): void => {
      const anchor = anchorRef.current
      const palette = paletteRef.current
      if (!anchor || !palette) return
      const viewportPadding = 8
      const gap = 6
      const anchorRect = anchor.getBoundingClientRect()
      const paletteRect = palette.getBoundingClientRect()
      const boundedHeight = Math.min(paletteRect.height, window.innerHeight - viewportPadding * 2)
      const roomBelow = window.innerHeight - viewportPadding - anchorRect.bottom - gap
      const roomAbove = anchorRect.top - viewportPadding - gap
      const openAbove = paletteRect.height > roomBelow && roomAbove > roomBelow
      const idealTop = openAbove ? anchorRect.top - gap - boundedHeight : anchorRect.bottom + gap
      setPopoverPosition({
        left: Math.max(viewportPadding, Math.min(anchorRect.left, window.innerWidth - paletteRect.width - viewportPadding)),
        top: Math.max(viewportPadding, Math.min(idealTop, window.innerHeight - boundedHeight - viewportPadding)),
        maxHeight: Math.max(0, window.innerHeight - viewportPadding * 2),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition)
    if (paletteRef.current) observer?.observe(paletteRef.current)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      observer?.disconnect()
    }
  }, [anchorRef, positionKey])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={paletteRef}
      role="dialog"
      aria-label={label}
      aria-modal="false"
      style={{ left: popoverPosition?.left ?? 0, top: popoverPosition?.top ?? 0, maxHeight: popoverPosition?.maxHeight, visibility: popoverPosition ? 'visible' : 'hidden' }}
      className="fixed z-[110] w-[15.5rem] overflow-y-auto rounded-panel border border-[#363636] bg-[#1f1f1f] p-3 shadow-overlay [scrollbar-color:#454545_transparent] [scrollbar-width:thin]"
    >
      <div className="grid grid-cols-10 gap-1.5">
        {COLOR_ROWS.flat().map((value, index) => (
          <button key={`${value}-${index}`} type="button" aria-label={`Set color ${value}`} onClick={() => onColor(value)} className="grid size-4 place-items-center rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-active" style={{ backgroundColor: value }}>
            {color.toLowerCase() === value ? <span aria-hidden="true" className="size-[13px] rounded-[2px] border-2 border-[#1f1f1f] ring-1 ring-white" /> : null}
          </button>
        ))}
      </div>
      <div className="my-3 h-px bg-[#424242]" />
      <div className="mb-1.5 flex items-center justify-between text-ui-meta text-[#858585]"><span>Opacity</span><output className="rounded-control border border-[#4b4d52] px-2 py-0.5 font-mono text-ui-control text-[#d6d6d6]">{Math.round(opacity * 100)}%</output></div>
      <input aria-label={opacityLabel} type="range" min="0" max="100" value={Math.round(opacity * 100)} onChange={(event) => onOpacity(Number(event.target.value) / 100)} className="h-5 w-full accent-active" />
      {children}
    </div>,
    document.body,
  )
}

function LineControls({ width, style, onWidth, onStyle }: LineControlsProps): ReactElement {
  return (
    <div className="mt-3 border-t border-[#424242] pt-3">
      <span className="mb-1.5 block text-ui-meta text-[#858585]">Thickness</span>
      <div className="grid grid-cols-4 overflow-hidden rounded-control border border-[#4b4d52]">
        {[1, 2, 3, 4].map((value) => <button key={value} type="button" aria-label={`${value}px`} aria-pressed={width === value} onClick={() => onWidth(value)} className="grid h-8 place-items-center border-r border-[#4b4d52] bg-[#202020] last:border-r-0 aria-pressed:bg-[#efefef] aria-pressed:text-[#111]"><span className="w-7 rounded-full bg-current" style={{ height: value }} /></button>)}
      </div>
      <span className="mb-1.5 mt-3 block text-ui-meta text-[#858585]">Line style</span>
      <div className="grid grid-cols-3 overflow-hidden rounded-control border border-[#4b4d52]">
        {(['solid', 'dashed', 'dotted'] as const).map((value) => <button key={value} type="button" aria-label={`${value} line`} aria-pressed={style === value} onClick={() => onStyle(value)} className="grid h-8 place-items-center border-r border-[#4b4d52] bg-[#202020] last:border-r-0 aria-pressed:bg-[#efefef] aria-pressed:text-[#111]">{linePreview(value)}</button>)}
      </div>
    </div>
  )
}

function LineAppearanceButton({ buttonRef, label, color, lineStyle, lineWidth, disabled = false, expanded, onClick }: LineAppearanceButtonProps): ReactElement {
  return (
    <button ref={buttonRef} type="button" aria-label={label} aria-expanded={expanded} disabled={disabled} onClick={onClick} className="flex h-9 w-[4.75rem] items-center gap-2 rounded-control border border-[#4b4d52] bg-[#202020] px-1 outline-none transition-[border-color,background-color] duration-100 hover:border-[#62646a] hover:bg-[#292929] focus-visible:ring-2 focus-visible:ring-active disabled:cursor-not-allowed disabled:opacity-45">
      <span aria-hidden="true" className="size-6 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" style={{ backgroundColor: color }} />
      <span className="min-w-0" style={{ color }}>{linePreview(lineStyle, lineWidth)}</span>
    </button>
  )
}

function extensionValue(drawing: DrawingAppearance): RectangleExtension {
  if (drawing.extendLeft && drawing.extendRight) return 'both'
  if (drawing.extendLeft) return 'left'
  if (drawing.extendRight) return 'right'
  return 'none'
}

function extensionPatch(value: RectangleExtension): DrawingAppearancePatch {
  return {
    extendLeft: value === 'left' || value === 'both',
    extendRight: value === 'right' || value === 'both',
  }
}

export function RectangleDrawingInspector({ drawing, templates, templateError, onChange, onDeleteTemplate, onClose }: RectangleDrawingInspectorProps): ReactElement {
  const [draft, setDraft] = useState<DrawingAppearance>(() => structuredClone(drawing))
  const [activeTab, setActiveTab] = useState<RectangleInspectorTab>('style')
  const [openMenu, setOpenMenu] = useState<RectangleMenu>(null)
  const [dragging, setDragging] = useState<boolean>(false)
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const dragRef = useRef<InspectorDragState | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const borderAnchorRef = useRef<HTMLButtonElement>(null)
  const middleAnchorRef = useRef<HTMLButtonElement>(null)
  const backgroundAnchorRef = useRef<HTMLButtonElement>(null)
  const textColorAnchorRef = useRef<HTMLButtonElement>(null)
  const lastFillOpacity = useRef<number>(drawing.fillOpacity > 0 ? drawing.fillOpacity : 0.12)
  const tabsId = useId()
  const matchingTemplates = templates.filter((template) => template.toolType === drawing.type)

  const updateDraft = (patch: DrawingAppearancePatch): void => {
    setDraft((current) => ({ ...current, ...patch }))
    onChange(patch)
  }

  const applyTemplate = (template?: DrawingTemplate): void => {
    const appearance = template?.appearance ?? defaultDrawingTemplateAppearance(drawing)
    setDraft((current) => ({ ...current, ...structuredClone(appearance) }))
    onChange(appearance)
    setOpenMenu(null)
  }

  const startDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || event.isPrimary === false) return
    const dialog = dialogRef.current
    if (!dialog) return
    const rect = dialog.getBoundingClientRect()
    const boundary = 8
    dragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: position.x,
      originY: position.y,
      minX: position.x + boundary - rect.left,
      maxX: position.x + window.innerWidth - boundary - rect.right,
      minY: position.y + boundary - rect.top,
      maxY: position.y + window.innerHeight - boundary - rect.bottom,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
    event.preventDefault()
  }

  const moveDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPosition({
      x: Math.min(Math.max(drag.originX + event.clientX - drag.pointerX, drag.minX), drag.maxX),
      y: Math.min(Math.max(drag.originY + event.clientY - drag.pointerY, drag.minY), drag.maxY),
    })
    event.preventDefault()
  }

  const stopDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDragging(false)
  }

  const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const distance = event.shiftKey ? 10 : 1
    const delta = event.key === 'ArrowLeft' ? [-distance, 0] : event.key === 'ArrowRight' ? [distance, 0] : event.key === 'ArrowUp' ? [0, -distance] : event.key === 'ArrowDown' ? [0, distance] : null
    if (!delta) return
    event.preventDefault()
    setPosition((current) => ({ x: current.x + delta[0], y: current.y + delta[1] }))
  }

  const moveTabFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const currentIndex = buttons.indexOf(event.target as HTMLButtonElement)
    if (currentIndex < 0) return
    event.preventDefault()
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    const next = TABS[nextIndex]
    if (!next) return
    setActiveTab(next.id)
    buttons[nextIndex]?.focus()
  }

  const closeOrDismiss = (): void => {
    if (openMenu) setOpenMenu(null)
    else onClose()
  }

  return (
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="false"
      aria-label="Edit rectangle drawing"
      style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
      onKeyDown={(event) => { if (event.key === 'Escape') closeOrDismiss() }}
      className={`flex h-auto w-full max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-[6px] border border-[#3a3a3a] bg-[#1f1f1f] text-[#d6d6d6] shadow-[0_14px_36px_rgba(0,0,0,0.38)] transition-[width] duration-100 motion-reduce:transition-none ${activeTab === 'visibility' ? 'sm:w-[28.5rem]' : 'sm:w-[23.75rem]'}`}
    >
      <header className="flex h-[3.5rem] shrink-0 items-center justify-between px-5">
        <button type="button" aria-label="Move drawing properties" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag} onKeyDown={moveWithKeyboard} className={`flex h-full min-w-0 flex-1 touch-none items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-active ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}>
          <span className="truncate text-[1.25rem] font-semibold leading-6 text-[#dcdcdc]">Rectangle</span>
          <Pencil aria-hidden="true" size={16} strokeWidth={1.5} />
        </button>
        <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-control text-[#c6c6c6] hover:bg-[#2b2b2b] focus-visible:ring-2 focus-visible:ring-active" aria-label="Close drawing properties"><X size={22} strokeWidth={1.35} /></button>
      </header>

      <div role="tablist" aria-label="Drawing property sections" onKeyDown={moveTabFocus} className="mx-5 flex h-11 shrink-0 border-b-4 border-[#555]">
        {TABS.map((tab) => <button key={tab.id} id={`${tabsId}-${tab.id}-tab`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`${tabsId}-panel`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => { setActiveTab(tab.id); setOpenMenu(null) }} className="relative h-10 px-3 text-[0.95rem] font-semibold text-[#d2d2d2] outline-none after:absolute after:-bottom-1 after:left-0 after:h-1 after:w-full after:rounded-sm after:bg-transparent hover:text-white focus-visible:ring-2 focus-visible:ring-active aria-selected:after:bg-[#dedede] first:pl-0 last:pr-0">
          {tab.label}
        </button>)}
      </div>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${activeTab}-tab`} className="relative min-h-[14.5rem] flex-1 overflow-y-auto px-5 py-6 [scrollbar-color:#454545_transparent] [scrollbar-width:thin]">
        {activeTab === 'style' ? (
          <div className="space-y-3.5">
            <div className="grid grid-cols-[6.5rem_1fr] items-center gap-4">
              <label htmlFor={`${tabsId}-extend`} className="text-ui-control">Extend</label>
              <select id={`${tabsId}-extend`} aria-label="Rectangle extension" value={extensionValue(draft)} onChange={(event) => updateDraft(extensionPatch(event.target.value as RectangleExtension))} className={`${PANEL_INPUT} w-[11.25rem]`}><option value="none">Don't extend</option><option value="left">Extend left</option><option value="right">Extend right</option><option value="both">Extend both</option></select>
            </div>

            <div className="grid grid-cols-[6.5rem_1fr] items-center gap-4">
              <span className="text-ui-control">Border</span>
              <div className="relative">
                <LineAppearanceButton buttonRef={borderAnchorRef} label="Border appearance" color={draft.strokeColor} lineStyle={draft.borderStyle} lineWidth={draft.lineWidth} expanded={openMenu === 'border'} onClick={() => setOpenMenu((current) => current === 'border' ? null : 'border')} />
                {openMenu === 'border' ? <ColorPalette anchorRef={borderAnchorRef} color={draft.strokeColor} label="Border color palette" opacity={draft.strokeOpacity} opacityLabel="Border opacity" positionKey={`${position.x}:${position.y}`} onColor={(strokeColor) => updateDraft({ strokeColor })} onOpacity={(strokeOpacity) => updateDraft({ strokeOpacity })}><LineControls width={draft.lineWidth} style={draft.borderStyle} onWidth={(lineWidth) => updateDraft({ lineWidth })} onStyle={(borderStyle) => updateDraft({ borderStyle })} /></ColorPalette> : null}
              </div>
            </div>

            <div className="grid grid-cols-[6.5rem_1fr] items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-ui-control"><input type="checkbox" checked={draft.rectangleMiddleLine} onChange={(event) => updateDraft({ rectangleMiddleLine: event.target.checked })} className={CHECKBOX} />Middle line</label>
              <div className="relative">
                <LineAppearanceButton buttonRef={middleAnchorRef} label="Middle line appearance" color={draft.rectangleMiddleLineColor} lineStyle={draft.rectangleMiddleLineStyle} lineWidth={draft.rectangleMiddleLineWidth} disabled={!draft.rectangleMiddleLine} expanded={openMenu === 'middle'} onClick={() => setOpenMenu((current) => current === 'middle' ? null : 'middle')} />
                {openMenu === 'middle' ? <ColorPalette anchorRef={middleAnchorRef} color={draft.rectangleMiddleLineColor} label="Middle line color palette" opacity={draft.rectangleMiddleLineOpacity} opacityLabel="Middle line opacity" positionKey={`${position.x}:${position.y}`} onColor={(rectangleMiddleLineColor) => updateDraft({ rectangleMiddleLineColor })} onOpacity={(rectangleMiddleLineOpacity) => updateDraft({ rectangleMiddleLineOpacity })}><LineControls width={draft.rectangleMiddleLineWidth} style={draft.rectangleMiddleLineStyle} onWidth={(rectangleMiddleLineWidth) => updateDraft({ rectangleMiddleLineWidth })} onStyle={(rectangleMiddleLineStyle) => updateDraft({ rectangleMiddleLineStyle })} /></ColorPalette> : null}
              </div>
            </div>

            <div className="grid grid-cols-[6.5rem_1fr] items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-ui-control"><input type="checkbox" checked={draft.fillOpacity > 0} onChange={(event) => updateDraft({ fillOpacity: event.target.checked ? lastFillOpacity.current : 0 })} className={CHECKBOX} />Background</label>
              <div className="relative">
                <button ref={backgroundAnchorRef} type="button" aria-label="Rectangle background appearance" aria-expanded={openMenu === 'background'} disabled={draft.fillOpacity === 0} onClick={() => setOpenMenu((current) => current === 'background' ? null : 'background')} className="relative grid size-9 place-items-center overflow-hidden rounded-control border border-[#4b4d52] outline-none focus-visible:ring-2 focus-visible:ring-active disabled:cursor-not-allowed disabled:opacity-45" style={{ backgroundImage: 'conic-gradient(#303030 25%, #202020 0 50%, #303030 0 75%, #202020 0)', backgroundSize: '8px 8px' }}><span aria-hidden="true" className="absolute inset-1 rounded-[2px]" style={{ backgroundColor: draft.fillColor, opacity: draft.fillOpacity }} /></button>
                {openMenu === 'background' ? <ColorPalette anchorRef={backgroundAnchorRef} color={draft.fillColor} label="Background color palette" opacity={draft.fillOpacity} opacityLabel="Background opacity" positionKey={`${position.x}:${position.y}`} onColor={(fillColor) => updateDraft({ fillColor })} onOpacity={(fillOpacity) => { lastFillOpacity.current = fillOpacity; updateDraft({ fillOpacity }) }} /> : null}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'text' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative">
                <button ref={textColorAnchorRef} type="button" aria-label="Rectangle text color" aria-expanded={openMenu === 'textColor'} onClick={() => setOpenMenu((current) => current === 'textColor' ? null : 'textColor')} className={`${ICON_BUTTON} p-1`}><span className="size-6 rounded-[3px]" style={{ backgroundColor: draft.textColor }} /></button>
                {openMenu === 'textColor' ? <ColorPalette anchorRef={textColorAnchorRef} color={draft.textColor} label="Text color palette" opacity={draft.textOpacity} opacityLabel="Text opacity" positionKey={`${position.x}:${position.y}`} onColor={(textColor) => { updateDraft({ textColor }); setOpenMenu(null) }} onOpacity={(textOpacity) => updateDraft({ textOpacity })} /> : null}
              </div>
              <select aria-label="Rectangle font size" value={draft.fontSize} onChange={(event) => updateDraft({ fontSize: Number(event.target.value) })} className={`${PANEL_INPUT} w-[6.25rem]`}>{Array.from({ length: 24 }, (_, index) => index + 9).map((size) => <option key={size} value={size}>{size}</option>)}</select>
              <button type="button" aria-label="Bold rectangle text" aria-pressed={draft.bold} onClick={() => updateDraft({ bold: !draft.bold })} className={ICON_BUTTON}><Bold size={18} /></button>
              <button type="button" aria-label="Italic rectangle text" aria-pressed={draft.italic} onClick={() => updateDraft({ italic: !draft.italic })} className={ICON_BUTTON}><Italic size={18} /></button>
            </div>
            <textarea aria-label="Rectangle text" rows={4} value={draft.text} onChange={(event) => updateDraft({ text: event.target.value })} className="min-h-[6.25rem] w-full resize-none rounded-[7px] border border-[#555] bg-[#202020] px-2.5 py-2 text-ui-control text-[#d6d6d6] outline-none placeholder:text-[#858585] focus:border-active" placeholder="Add text" />
            <div className="grid grid-cols-[6.25rem_1fr] items-center gap-3.5">
              <span className="text-ui-control">Text alignment</span>
              <div className="grid grid-cols-[6.25rem_6.25rem] gap-2">
                <select aria-label="Rectangle vertical text alignment" value={draft.verticalAlign} onChange={(event) => updateDraft({ verticalAlign: parseVerticalAlign(event.target.value) })} className={PANEL_INPUT}><option value="top">Top</option><option value="inside">Inside</option><option value="bottom">Bottom</option></select>
                <select aria-label="Rectangle horizontal text alignment" value={draft.horizontalAlign} onChange={(event) => updateDraft({ horizontalAlign: parseHorizontalAlign(event.target.value) })} className={PANEL_INPUT}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'coordinates' ? <DrawingCoordinatesPanel drawing={draft} onChange={updateDraft} /> : null}
        {activeTab === 'visibility' ? <DrawingVisibilityPanel drawing={draft} onChange={updateDraft} /> : null}
      </div>

      <footer className="flex min-h-[4.1rem] shrink-0 items-center justify-between border-t border-[#3d3d3d] px-5 py-3">
        <div className="relative">
          <button type="button" aria-label="Drawing template" aria-expanded={openMenu === 'template'} onClick={() => setOpenMenu((current) => current === 'template' ? null : 'template')} className={`${PANEL_INPUT} flex min-w-[6.25rem] items-center justify-between gap-3`}>Template<ChevronDown size={14} /></button>
          {openMenu === 'template' ? <div role="menu" aria-label="Drawing template menu" className="absolute bottom-[calc(100%+0.35rem)] left-0 z-30 w-56 rounded-panel border border-[#3f3f3f] bg-[#242424] p-1 shadow-overlay">
            <button type="button" role="menuitem" onClick={() => applyTemplate()} className="flex h-9 w-full items-center gap-2 rounded-control px-2 text-left text-ui-control hover:bg-[#333]"><Check size={14} />Default</button>
            {matchingTemplates.map((template) => <div key={template.id} role="none" className="flex items-center"><button type="button" role="menuitem" onClick={() => applyTemplate(template)} className="flex h-9 min-w-0 flex-1 items-center rounded-control px-2 text-left text-ui-control hover:bg-[#333]">{template.name}</button><button type="button" aria-label={`Delete ${template.name} template`} onClick={() => onDeleteTemplate(template.id)} className="grid size-9 place-items-center rounded-control text-[#aaa] hover:bg-loss/10 hover:text-loss-bright"><Trash2 size={14} /></button></div>)}
            {templateError ? <p role="alert" className="px-2 py-1.5 text-ui-meta text-loss-bright">{templateError}</p> : null}
          </div> : null}
        </div>
        <div className="flex items-center gap-3"><button type="button" onClick={onClose} className="h-9 rounded-[6px] border border-[#e0e0e0] px-3 text-ui-control text-[#ededed] hover:bg-[#2b2b2b]">Cancel</button><button type="button" onClick={onClose} className="h-9 rounded-[6px] bg-[#f0f0f0] px-3 text-ui-control text-[#171717] hover:bg-white">Ok</button></div>
      </footer>
    </section>
  )
}
