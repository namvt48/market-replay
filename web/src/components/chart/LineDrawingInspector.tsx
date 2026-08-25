import { Bold, Check, ChevronDown, Italic, Pencil, Trash2, X } from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react'
import {
  type DrawingAppearance,
  type DrawingAppearancePatch,
  type DrawingBorderStyle,
  type DrawingHorizontalAlign,
  type DrawingLineEndStyle,
  type DrawingVerticalAlign,
} from '../../replay/drawing-appearance'
import { defaultDrawingTemplateAppearance, type DrawingTemplate } from '../../replay/drawing-templates'
import { DrawingCoordinatesPanel, DrawingVisibilityPanel } from './DrawingPropertySharedPanels'

interface LineDrawingInspectorProps {
  drawing: DrawingAppearance
  drawingName: string
  templates: DrawingTemplate[]
  templateError: string | null
  onChange: (patch: DrawingAppearancePatch) => void
  onDeleteTemplate: (id: string) => void
  onClose: () => void
}

type InspectorTab = 'style' | 'text' | 'coordinates' | 'visibility'
type StyleMenu = 'line' | 'start' | 'end' | 'extend' | 'textColor' | 'template' | null

interface TabOption {
  id: InspectorTab
  label: string
}

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

const TABS: readonly TabOption[] = [
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

const PANEL_INPUT = 'h-9 rounded-control border border-[#4b4d52] bg-[#202020] px-2.5 text-ui-control text-[#d6d6d6] outline-none transition-colors focus:border-active'
const ICON_BUTTON = 'grid size-9 place-items-center rounded-control border border-[#4b4d52] bg-[#202020] text-[#d6d6d6] outline-none transition-colors hover:bg-[#2b2b2b] focus-visible:ring-2 focus-visible:ring-active aria-pressed:border-active aria-pressed:bg-[#2b2b2b]'

function endpointIcon(style: DrawingLineEndStyle, reverse = false): ReactElement {
  return (
    <svg aria-hidden="true" width="21" height="12" viewBox="0 0 21 12" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className={reverse ? '-scale-x-100' : undefined}>
      <path d="M3 6h15" />
      {style === 'normal' ? <circle cx="3" cy="6" r="1.6" fill="#202020" /> : <path d="m7 2-4 4 4 4" />}
    </svg>
  )
}

function lineStylePreview(style: DrawingBorderStyle): ReactElement {
  return <span aria-hidden="true" className={`block w-8 border-t-2 border-current ${style === 'dashed' ? 'border-dashed' : style === 'dotted' ? 'border-dotted' : 'border-solid'}`} />
}

function ColorPalette({ color, opacity, opacityLabel = 'Line opacity', onColor, onOpacity, children }: { color: string; opacity: number; opacityLabel?: string; onColor: (color: string) => void; onOpacity: (opacity: number) => void; children?: ReactNode }): ReactElement {
  return (
    <div className="w-[15.5rem] rounded-panel border border-[#363636] bg-[#1f1f1f] p-3 shadow-overlay">
      <div className="grid grid-cols-10 gap-1.5">
        {COLOR_ROWS.flat().map((value, index) => (
          <button key={`${value}-${index}`} type="button" aria-label={`Set color ${value}`} onClick={() => onColor(value)} className="grid size-4 place-items-center rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-active" style={{ backgroundColor: value }}>
            {color.toLowerCase() === value ? <span aria-hidden="true" className="size-[13px] rounded-[2px] border-2 border-[#1f1f1f] ring-1 ring-white" /> : null}
          </button>
        ))}
      </div>
      <div className="my-3 h-px bg-[#424242]" />
      <div className="mb-1.5 flex items-center justify-between text-ui-meta text-[#858585]"><span>Opacity</span><output className="rounded-control border border-[#4b4d52] px-2 py-0.5 text-ui-control text-[#d6d6d6]">{Math.round(opacity * 100)}%</output></div>
      <input aria-label={opacityLabel} type="range" min="0" max="100" value={Math.round(opacity * 100)} onChange={(event) => onOpacity(Number(event.target.value) / 100)} className="h-5 w-full accent-active" />
      {children}
    </div>
  )
}

export function LineDrawingInspector({ drawing, drawingName, templates, templateError, onChange, onDeleteTemplate, onClose }: LineDrawingInspectorProps): ReactElement {
  const [draft, setDraft] = useState<DrawingAppearance>(() => structuredClone(drawing))
  const [activeTab, setActiveTab] = useState<InspectorTab>('style')
  const [openMenu, setOpenMenu] = useState<StyleMenu>(null)
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState<boolean>(false)
  const tabsId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const dragRef = useRef<InspectorDragState | null>(null)
  const matchingTemplates = templates.filter((template) => template.toolType === drawing.type)

  const updateDraft = (patch: DrawingAppearancePatch): void => {
    setDraft((current) => ({ ...current, ...patch }))
    onChange(patch)
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
    if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId)
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
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (typeof event.currentTarget.hasPointerCapture === 'function' && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
  }

  const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const distance = event.shiftKey ? 10 : 1
    const offsets: Partial<Record<string, { x: number; y: number }>> = {
      ArrowDown: { x: 0, y: distance },
      ArrowLeft: { x: -distance, y: 0 },
      ArrowRight: { x: distance, y: 0 },
      ArrowUp: { x: 0, y: -distance },
    }
    const offset = offsets[event.key]
    const dialog = dialogRef.current
    if (!offset || !dialog) return
    event.preventDefault()
    const rect = dialog.getBoundingClientRect()
    setPosition((current) => ({
      x: current.x + Math.min(Math.max(offset.x, 8 - rect.left), window.innerWidth - 8 - rect.right),
      y: current.y + Math.min(Math.max(offset.y, 8 - rect.top), window.innerHeight - 8 - rect.bottom),
    }))
  }

  const moveTabFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const current = buttons.indexOf(event.target as HTMLButtonElement)
    if (current < 0) return
    event.preventDefault()
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    const next = TABS[nextIndex]
    if (!next) return
    setActiveTab(next.id)
    buttons[nextIndex]?.focus()
  }

  const applyTemplate = (template?: DrawingTemplate): void => {
    const appearance = template?.appearance ?? defaultDrawingTemplateAppearance(drawing)
    setDraft((current) => ({ ...current, ...structuredClone(appearance) }))
    onChange(appearance)
    setOpenMenu(null)
  }

  return (
    <section ref={dialogRef} role="dialog" aria-modal="false" aria-label={`Edit ${drawing.type} drawing`} style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }} onKeyDown={(event) => { if (event.key === 'Escape') onClose() }} className={`flex h-auto w-full max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-[6px] border border-[#373737] bg-[#1f1f1f] text-[#d6d6d6] shadow-overlay transition-[width] duration-100 motion-reduce:transition-none sm:max-h-[min(37.5rem,calc(100dvh-1rem))] ${activeTab === 'visibility' ? 'sm:w-[28.5rem]' : 'sm:w-[23.75rem]'}`}>
      <header className="flex h-[3.5rem] shrink-0 items-center justify-between px-5">
        <button
          type="button"
          aria-label="Move drawing properties"
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onLostPointerCapture={stopDrag}
          onKeyDown={moveWithKeyboard}
          className={`flex h-full min-w-0 flex-1 touch-none items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-active ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          title="Drag to move · arrow keys move by 1px · Shift + arrow moves by 10px"
        >
          <span className="truncate text-[1.25rem] font-semibold leading-6 text-[#dcdcdc]">{drawingName}</span>
          <Pencil aria-hidden="true" size={16} strokeWidth={1.5} />
        </button>
        <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-control text-[#c6c6c6] hover:bg-[#2b2b2b] focus-visible:ring-2 focus-visible:ring-active" aria-label="Close drawing properties"><X size={22} strokeWidth={1.35} /></button>
      </header>

      <div role="tablist" aria-label="Drawing property sections" onKeyDown={moveTabFocus} className="mx-5 flex h-11 shrink-0 border-b-4 border-[#565656]">
        {TABS.map((tab) => (
          <button key={tab.id} id={`${tabsId}-${tab.id}-tab`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`${tabsId}-panel`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => { setActiveTab(tab.id); setOpenMenu(null) }} className="relative h-10 px-3 text-[0.95rem] font-semibold text-[#d2d2d2] outline-none after:absolute after:-bottom-1 after:left-0 after:h-1 after:w-full after:rounded-sm after:bg-transparent hover:text-white focus-visible:ring-2 focus-visible:ring-active aria-selected:after:bg-[#dedede] first:pl-0 last:pr-0">
            {tab.label}
          </button>
        ))}
      </div>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${activeTab}-tab`} className="relative min-h-[22rem] flex-1 overflow-y-auto px-5 py-6">
        {activeTab === 'style' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-[5.75rem_1fr] items-center gap-3">
              <span className="text-ui-control">Line</span>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button type="button" aria-label="Line appearance" aria-expanded={openMenu === 'line'} onClick={() => setOpenMenu((current) => current === 'line' ? null : 'line')} className="flex h-9 w-[4.75rem] items-center gap-2 rounded-control border border-[#4b4d52] bg-[#202020] px-1">
                    <span className="size-6 rounded-[3px]" style={{ backgroundColor: draft.strokeColor }} />
                    <span className="h-0 w-8 border-t-2" style={{ borderColor: draft.strokeColor, borderTopStyle: draft.borderStyle }} />
                  </button>
                  {openMenu === 'line' ? (
                    <div className="absolute left-0 top-[calc(100%+0.4rem)] z-30">
                      <ColorPalette color={draft.strokeColor} opacity={draft.strokeOpacity} onColor={(strokeColor) => updateDraft({ strokeColor })} onOpacity={(strokeOpacity) => updateDraft({ strokeOpacity })}>
                        <div className="mt-3 border-t border-[#424242] pt-3">
                        <span className="mb-1.5 block text-ui-meta text-[#858585]">Thickness</span>
                        <div className="grid grid-cols-4 overflow-hidden rounded-control border border-[#4b4d52]">
                          {[1, 2, 3, 4].map((width) => <button key={width} type="button" aria-label={`${width}px`} aria-pressed={draft.lineWidth === width} onClick={() => updateDraft({ lineWidth: width })} className="grid h-8 place-items-center border-r border-[#4b4d52] bg-[#202020] last:border-r-0 aria-pressed:bg-[#efefef] aria-pressed:text-[#111]"><span className="w-7 rounded-full bg-current" style={{ height: width }} /></button>)}
                        </div>
                        <span className="mb-1.5 mt-3 block text-ui-meta text-[#858585]">Line style</span>
                        <div className="grid grid-cols-3 overflow-hidden rounded-control border border-[#4b4d52]">
                          {(['solid', 'dashed', 'dotted'] as const).map((style) => <button key={style} type="button" aria-label={`${style} line`} aria-pressed={draft.borderStyle === style} onClick={() => updateDraft({ borderStyle: style })} className="grid h-8 place-items-center border-r border-[#4b4d52] bg-[#202020] last:border-r-0 aria-pressed:bg-[#efefef] aria-pressed:text-[#111]">{lineStylePreview(style)}</button>)}
                        </div>
                        </div>
                      </ColorPalette>
                    </div>
                  ) : null}
                </div>

                {(['start', 'end'] as const).map((side) => {
                  const value = side === 'start' ? draft.lineStartStyle : draft.lineEndStyle
                  return <div key={side} className="relative">
                    <button type="button" aria-label={`${side === 'start' ? 'Start' : 'End'} line endpoint`} aria-expanded={openMenu === side} onClick={() => setOpenMenu((current) => current === side ? null : side)} className={`${ICON_BUTTON} ${openMenu === side ? 'border-active' : ''}`}>{endpointIcon(value, side === 'end')}</button>
                    {openMenu === side ? <div role="menu" aria-label={`${side} endpoint menu`} className="absolute left-0 top-[calc(100%+0.35rem)] z-20 w-[6.2rem] overflow-hidden rounded-panel border border-[#343434] bg-[#202020] py-1 shadow-overlay">
                      {(['normal', 'arrow'] as const).map((style) => <button key={style} type="button" role="menuitemradio" aria-checked={value === style} onClick={() => { updateDraft(side === 'start' ? { lineStartStyle: style } : { lineEndStyle: style }); setOpenMenu(null) }} className="flex h-9 w-full items-center gap-2 px-2 text-left text-ui-control capitalize hover:bg-[#333]">{endpointIcon(style)}<span>{style}</span></button>)}
                    </div> : null}
                  </div>
                })}
              </div>
            </div>

            <div className="grid grid-cols-[5.75rem_1fr] items-center gap-3">
              <span className="text-ui-control">Extend</span>
              <div className="relative w-[11.25rem]">
                <button type="button" aria-label="Line extension" aria-expanded={openMenu === 'extend'} onClick={() => setOpenMenu((current) => current === 'extend' ? null : 'extend')} className={`${PANEL_INPUT} flex w-full items-center justify-between text-left`}><span>{draft.extendLeft || draft.extendRight ? `${draft.extendLeft ? 'Left' : ''}${draft.extendLeft && draft.extendRight ? ' & ' : ''}${draft.extendRight ? 'Right' : ''}` : "Don't extend"}</span><ChevronDown size={15} /></button>
                {openMenu === 'extend' ? <div role="menu" aria-label="Line extension menu" className="absolute left-0 top-[calc(100%+0.3rem)] z-20 w-full rounded-panel bg-[#2a2a2a] py-1 shadow-overlay">
                  {([['extendLeft', 'Extend left line'], ['extendRight', 'Extend right line']] as const).map(([key, label]) => <label key={key} className="flex h-9 cursor-pointer items-center gap-2 px-3 text-ui-control hover:bg-[#333]"><input type="checkbox" checked={draft[key]} onChange={(event) => updateDraft({ [key]: event.target.checked })} className="size-[18px] accent-white" />{label}</label>)}
                </div> : null}
              </div>
            </div>

            <label className="flex min-h-9 cursor-pointer items-center gap-3 text-ui-control"><input type="checkbox" checked={draft.showMiddlePoint} onChange={(event) => updateDraft({ showMiddlePoint: event.target.checked })} className="size-[18px] accent-white" />Middle point</label>
            <label className="flex min-h-9 cursor-pointer items-center gap-3 text-ui-control"><input type="checkbox" checked={draft.showPriceLabels} onChange={(event) => updateDraft({ showPriceLabels: event.target.checked })} className="size-[18px] accent-white" />Price labels</label>
          </div>
        ) : null}

        {activeTab === 'text' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative">
                <button type="button" aria-label="Text color" aria-expanded={openMenu === 'textColor'} onClick={() => setOpenMenu((current) => current === 'textColor' ? null : 'textColor')} className={`${ICON_BUTTON} p-1`}><span className="size-6 rounded-[3px]" style={{ backgroundColor: draft.textColor }} /></button>
                {openMenu === 'textColor' ? <div className="absolute left-0 top-[calc(100%+0.35rem)] z-20"><ColorPalette color={draft.textColor} opacity={draft.textOpacity} opacityLabel="Text opacity" onColor={(textColor) => { updateDraft({ textColor }); setOpenMenu(null) }} onOpacity={(textOpacity) => updateDraft({ textOpacity })} /></div> : null}
              </div>
              <select aria-label="Font size" value={draft.fontSize} onChange={(event) => updateDraft({ fontSize: Number(event.target.value) })} className={`${PANEL_INPUT} w-[6.25rem]`}>{Array.from({ length: 24 }, (_, index) => index + 9).map((size) => <option key={size} value={size}>{size}</option>)}</select>
              <button type="button" aria-label="Bold text" aria-pressed={draft.bold} onClick={() => updateDraft({ bold: !draft.bold })} className={ICON_BUTTON}><Bold size={18} /></button>
              <button type="button" aria-label="Italic text" aria-pressed={draft.italic} onClick={() => updateDraft({ italic: !draft.italic })} className={ICON_BUTTON}><Italic size={18} /></button>
            </div>
            <textarea aria-label="Drawing text" rows={4} value={draft.text} onChange={(event) => updateDraft({ text: event.target.value })} placeholder="Add text" className="min-h-[6.25rem] w-full resize-none rounded-[7px] border border-[#555] bg-[#202020] px-2.5 py-2 text-ui-control text-[#d6d6d6] outline-none placeholder:text-[#858585] focus:border-active" />
            <div className="grid grid-cols-[6.5rem_1fr] items-center gap-3">
              <span className="text-ui-control">Text alignment</span>
              <div className="grid grid-cols-2 gap-2">
                <select aria-label="Vertical text alignment" value={draft.verticalAlign} onChange={(event) => updateDraft({ verticalAlign: event.target.value as DrawingVerticalAlign })} className={PANEL_INPUT}><option value="top">Top</option><option value="inside">Middle</option><option value="bottom">Bottom</option></select>
                <select aria-label="Horizontal text alignment" value={draft.horizontalAlign} onChange={(event) => updateDraft({ horizontalAlign: event.target.value as DrawingHorizontalAlign })} className={PANEL_INPUT}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'coordinates' ? (
          <DrawingCoordinatesPanel drawing={draft} onChange={updateDraft} />
        ) : null}

        {activeTab === 'visibility' ? (
          <DrawingVisibilityPanel drawing={draft} onChange={updateDraft} />
        ) : null}
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
        <div className="flex items-center gap-3">
          <button type="button" onClick={onClose} className="h-9 rounded-[6px] border border-[#e0e0e0] px-3 text-ui-control text-[#ededed] hover:bg-[#2b2b2b]">Cancel</button>
          <button type="button" onClick={onClose} className="h-9 rounded-[6px] bg-[#f0f0f0] px-3 text-ui-control text-[#171717] hover:bg-white">Ok</button>
        </div>
      </footer>
    </section>
  )
}
