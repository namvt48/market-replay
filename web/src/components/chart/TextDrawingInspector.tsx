import { Bold, Check, ChevronDown, Italic, Pencil, Trash2, X } from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type RefObject } from 'react'
import type { DrawingAppearance, DrawingAppearancePatch } from '../../replay/drawing-appearance'
import { defaultDrawingTemplateAppearance, type DrawingTemplate } from '../../replay/drawing-templates'
import { DrawingColorPalette } from './DrawingPropertyPopover'
import { DrawingVisibilityPanel } from './DrawingPropertySharedPanels'

interface TextDrawingInspectorProps {
  drawing: DrawingAppearance
  templates: DrawingTemplate[]
  templateError: string | null
  onChange: (patch: DrawingAppearancePatch) => void
  onDelete: () => void
  onDeleteTemplate: (id: string) => void
  onClose: () => void
}

type TextTab = 'text' | 'visibility'
type TextMenu = 'color' | 'background' | 'border' | 'template' | null

interface DragState {
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

const TABS: readonly { id: TextTab; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'visibility', label: 'Visibility' },
]
const TEXT_FONT_SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 40] as const
const INPUT = 'h-9 rounded-control border border-[#4b4d52] bg-[#202020] px-2.5 text-ui-control text-[#d6d6d6] outline-none transition-colors hover:border-[#5a5c61] focus:border-active disabled:cursor-not-allowed disabled:text-[#686868]'
const ICON_BUTTON = 'grid size-9 place-items-center rounded-control border border-[#4b4d52] bg-[#202020] text-[#d6d6d6] outline-none transition-colors hover:bg-[#292929] focus-visible:ring-2 focus-visible:ring-active aria-pressed:bg-[#ededed] aria-pressed:text-[#171717]'
const CHECKBOX = 'size-[18px] shrink-0 accent-white'

function ColorButton({ buttonRef, label, color, expanded, disabled = false, onClick }: { buttonRef: RefObject<HTMLButtonElement | null>; label: string; color: string; expanded: boolean; disabled?: boolean; onClick: () => void }): ReactElement {
  return <button ref={buttonRef} type="button" aria-label={label} aria-expanded={expanded} disabled={disabled} onClick={onClick} className="relative grid size-9 place-items-center overflow-hidden rounded-control border border-[#4b4d52] bg-[#202020] outline-none hover:border-[#62646a] focus-visible:ring-2 focus-visible:ring-active disabled:cursor-not-allowed disabled:opacity-45"><span aria-hidden="true" className="size-6 rounded-[3px]" style={{ backgroundColor: color }} /></button>
}

export function TextDrawingInspector({ drawing, templates, templateError, onChange, onDelete, onDeleteTemplate, onClose }: TextDrawingInspectorProps): ReactElement {
  const [draft, setDraft] = useState(() => structuredClone(drawing))
  const [activeTab, setActiveTab] = useState<TextTab>('text')
  const [openMenu, setOpenMenu] = useState<TextMenu>(null)
  const [dragging, setDragging] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const dialogRef = useRef<HTMLElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const colorRef = useRef<HTMLButtonElement>(null)
  const backgroundRef = useRef<HTMLButtonElement>(null)
  const borderRef = useRef<HTMLButtonElement>(null)
  const tabsId = useId()
  const matchingTemplates = templates.filter((template) => template.toolType === drawing.type)
  const positionKey = `${position.x}:${position.y}`

  const update = (patch: DrawingAppearancePatch): void => {
    setDraft((current) => ({ ...current, ...patch }))
    onChange(patch)
  }

  const close = (): void => {
    if (draft.text.trim().length === 0) onDelete()
    else onClose()
  }

  const applyTemplate = (template?: DrawingTemplate): void => {
    const appearance = template?.appearance ?? defaultDrawingTemplateAppearance(drawing)
    setDraft((current) => ({ ...current, ...structuredClone(appearance) }))
    onChange(appearance)
    setOpenMenu(null)
  }

  const startDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || event.isPrimary === false || !dialogRef.current) return
    const rect = dialogRef.current.getBoundingClientRect()
    const boundary = 8
    dragRef.current = { pointerId: event.pointerId, pointerX: event.clientX, pointerY: event.clientY, originX: position.x, originY: position.y, minX: position.x + boundary - rect.left, maxX: position.x + window.innerWidth - boundary - rect.right, minY: position.y + boundary - rect.top, maxY: position.y + window.innerHeight - boundary - rect.bottom }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
    event.preventDefault()
  }

  const moveDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPosition({ x: Math.min(Math.max(drag.originX + event.clientX - drag.pointerX, drag.minX), drag.maxX), y: Math.min(Math.max(drag.originY + event.clientY - drag.pointerY, drag.minY), drag.maxY) })
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
    const current = buttons.indexOf(event.target as HTMLButtonElement)
    if (current < 0) return
    event.preventDefault()
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    const next = TABS[nextIndex]
    if (!next) return
    setActiveTab(next.id)
    setOpenMenu(null)
    buttons[nextIndex]?.focus()
  }

  return (
    <section ref={dialogRef} role="dialog" aria-modal="false" aria-label="Edit text-annotation drawing" style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }} onKeyDown={(event) => { if (event.key !== 'Escape') return; if (openMenu) setOpenMenu(null); else close() }} className={`flex h-auto w-full max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-[6px] border border-[#3a3a3a] bg-[#1f1f1f] text-[#d6d6d6] shadow-overlay transition-[width] duration-100 motion-reduce:transition-none ${activeTab === 'visibility' ? 'sm:w-[28.5rem]' : 'sm:w-[23.75rem]'}`}>
      <header className="flex h-[3.5rem] shrink-0 items-center justify-between px-5"><button type="button" aria-label="Move drawing properties" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag} onKeyDown={moveWithKeyboard} className={`flex h-full min-w-0 flex-1 touch-none items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-active ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}><span className="truncate text-[1.25rem] font-semibold leading-6">Text</span><Pencil size={16} strokeWidth={1.5} /></button><button type="button" onClick={close} className="grid size-9 place-items-center rounded-control text-[#c6c6c6] hover:bg-[#2b2b2b] focus-visible:ring-2 focus-visible:ring-active" aria-label="Close drawing properties"><X size={22} strokeWidth={1.35} /></button></header>
      <div role="tablist" aria-label="Drawing property sections" onKeyDown={moveTabFocus} className="mx-5 flex h-11 shrink-0 border-b border-[#555]">{TABS.map((tab) => <button key={tab.id} id={`${tabsId}-${tab.id}-tab`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`${tabsId}-panel`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => { setActiveTab(tab.id); setOpenMenu(null) }} className="relative h-10 px-3 text-[0.95rem] font-semibold outline-none after:absolute after:-bottom-[3px] after:left-0 after:h-[3px] after:w-full after:rounded-sm after:bg-transparent focus-visible:ring-2 focus-visible:ring-active aria-selected:after:bg-[#dedede] first:pl-0">{tab.label}</button>)}</div>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${activeTab}-tab`} className="relative min-h-[25.5rem] flex-1 overflow-y-auto px-5 py-6 [scrollbar-color:#454545_transparent] [scrollbar-width:thin]">
        {activeTab === 'text' ? <div className="space-y-4">
          <div className="flex items-center gap-2"><ColorButton buttonRef={colorRef} label="Text color" color={draft.textColor} expanded={openMenu === 'color'} onClick={() => setOpenMenu((current) => current === 'color' ? null : 'color')} /><select aria-label="Font size" value={draft.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} className={`${INPUT} w-[6.25rem] font-mono`}>{TEXT_FONT_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select><button type="button" aria-label="Bold text" aria-pressed={draft.bold} onClick={() => update({ bold: !draft.bold })} className={ICON_BUTTON}><Bold size={18} /></button><button type="button" aria-label="Italic text" aria-pressed={draft.italic} onClick={() => update({ italic: !draft.italic })} className={ICON_BUTTON}><Italic size={18} /></button>{openMenu === 'color' ? <DrawingColorPalette anchorRef={colorRef} ariaLabel="Text color palette" color={draft.textColor} opacity={draft.textOpacity} opacityLabel="Text opacity" positionKey={positionKey} onColor={(textColor) => { update({ textColor }); setOpenMenu(null) }} onOpacity={(textOpacity) => update({ textOpacity })} /> : null}</div>
          <textarea autoFocus aria-label="Text" rows={7} value={draft.text} onChange={(event) => update({ text: event.target.value })} placeholder="Add text" className="min-h-[10.75rem] w-full resize-none rounded-[7px] border border-[#555] bg-[#202020] px-2.5 py-2 text-ui-control leading-relaxed outline-none placeholder:text-[#858585] focus:border-active" />
          <div className="space-y-3 pt-1">
            <div className="flex min-h-9 items-center gap-4"><label className="flex min-w-[6.5rem] cursor-pointer items-center gap-2 text-ui-control"><input type="checkbox" checked={draft.textBackgroundVisible} onChange={(event) => update({ textBackgroundVisible: event.target.checked })} className={CHECKBOX} />Background</label><ColorButton buttonRef={backgroundRef} label="Text background color" color={draft.backgroundColor} expanded={openMenu === 'background'} disabled={!draft.textBackgroundVisible} onClick={() => setOpenMenu((current) => current === 'background' ? null : 'background')} />{openMenu === 'background' ? <DrawingColorPalette anchorRef={backgroundRef} ariaLabel="Text background color palette" color={draft.backgroundColor} opacity={draft.backgroundOpacity} opacityLabel="Text background opacity" positionKey={positionKey} onColor={(backgroundColor) => { update({ backgroundColor }); setOpenMenu(null) }} onOpacity={(backgroundOpacity) => update({ backgroundOpacity })} /> : null}</div>
            <div className="flex min-h-9 items-center gap-4"><label className="flex min-w-[6.5rem] cursor-pointer items-center gap-2 text-ui-control"><input type="checkbox" checked={draft.textBorderVisible} onChange={(event) => update({ textBorderVisible: event.target.checked })} className={CHECKBOX} />Border</label><ColorButton buttonRef={borderRef} label="Text border color" color={draft.strokeColor} expanded={openMenu === 'border'} disabled={!draft.textBorderVisible} onClick={() => setOpenMenu((current) => current === 'border' ? null : 'border')} />{openMenu === 'border' ? <DrawingColorPalette anchorRef={borderRef} ariaLabel="Text border color palette" color={draft.strokeColor} opacity={draft.strokeOpacity} opacityLabel="Text border opacity" positionKey={positionKey} onColor={(strokeColor) => { update({ strokeColor }); setOpenMenu(null) }} onOpacity={(strokeOpacity) => update({ strokeOpacity })} /> : null}</div>
            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-ui-control"><input type="checkbox" checked={draft.textWrap} onChange={(event) => update({ textWrap: event.target.checked })} className={CHECKBOX} />Text wrap</label>
          </div>
        </div> : null}
        {activeTab === 'visibility' ? <DrawingVisibilityPanel drawing={draft} onChange={update} /> : null}
      </div>

      <footer className="flex min-h-[4.1rem] shrink-0 items-center justify-between border-t border-[#3d3d3d] px-5 py-3"><div className="relative"><button type="button" aria-label="Drawing template" aria-expanded={openMenu === 'template'} onClick={() => setOpenMenu((current) => current === 'template' ? null : 'template')} className={`${INPUT} flex min-w-[6.25rem] items-center justify-between gap-3`}>Template<ChevronDown size={14} /></button>{openMenu === 'template' ? <div role="menu" aria-label="Drawing template menu" className="absolute bottom-[calc(100%+0.35rem)] left-0 z-30 w-56 rounded-panel border border-[#3f3f3f] bg-[#242424] p-1 shadow-overlay"><button type="button" role="menuitem" onClick={() => applyTemplate()} className="flex h-9 w-full items-center gap-2 rounded-control px-2 text-left text-ui-control hover:bg-[#333]"><Check size={14} />Default</button>{matchingTemplates.map((template) => <div key={template.id} className="flex"><button type="button" role="menuitem" onClick={() => applyTemplate(template)} className="h-9 min-w-0 flex-1 truncate rounded-control px-2 text-left text-ui-control hover:bg-[#333]">{template.name}</button><button type="button" aria-label={`Delete ${template.name} template`} onClick={() => onDeleteTemplate(template.id)} className="grid size-9 place-items-center rounded-control hover:bg-loss/10 hover:text-loss-bright"><Trash2 size={14} /></button></div>)}{templateError ? <p role="alert" className="px-2 py-1.5 text-ui-meta text-loss-bright">{templateError}</p> : null}</div> : null}</div><div className="flex gap-3"><button type="button" onClick={close} className="h-9 rounded-[6px] border border-[#e0e0e0] px-3 text-ui-control">Cancel</button><button type="button" onClick={close} className="h-9 rounded-[6px] bg-[#f0f0f0] px-3 text-ui-control text-[#171717]">Ok</button></div></footer>
    </section>
  )
}
