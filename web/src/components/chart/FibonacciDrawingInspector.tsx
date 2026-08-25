import { Check, ChevronDown, Pencil, Trash2, X } from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react'
import {
  type DrawingAppearance,
  type DrawingAppearancePatch,
  type DrawingBorderStyle,
  type DrawingHorizontalAlign,
  type DrawingVerticalAlign,
  type FibonacciLabelPosition,
  type FibonacciLabelVerticalPosition,
  type FibonacciLevelFormat,
} from '../../replay/drawing-appearance'
import { defaultDrawingTemplateAppearance, type DrawingTemplate } from '../../replay/drawing-templates'
import { DrawingCoordinatesPanel, DrawingVisibilityPanel } from './DrawingPropertySharedPanels'

interface FibonacciDrawingInspectorProps {
  drawing: DrawingAppearance
  templates: DrawingTemplate[]
  templateError: string | null
  onChange: (patch: DrawingAppearancePatch) => void
  onDeleteTemplate: (id: string) => void
  onClose: () => void
}

type FibonacciInspectorTab = 'style' | 'text' | 'coordinates' | 'visibility'
type FibonacciMenu = 'levelStyle' | 'levelWidth' | 'template' | null

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

const TABS: readonly { id: FibonacciInspectorTab; label: string }[] = [
  { id: 'style', label: 'Style' },
  { id: 'text', label: 'Text' },
  { id: 'coordinates', label: 'Coordinates' },
  { id: 'visibility', label: 'Visibility' },
]

const PANEL_INPUT = 'h-9 rounded-control border border-[#4b4d52] bg-[#202020] px-2.5 text-ui-control text-[#d6d6d6] outline-none transition-[border-color,background-color] duration-100 hover:border-[#5a5c61] focus:border-active disabled:cursor-not-allowed disabled:border-[#414141] disabled:bg-[#292929] disabled:text-[#686868]'
const CHECKBOX = 'size-[18px] shrink-0 accent-white disabled:cursor-not-allowed'

function parseHorizontalAlign(value: string): DrawingHorizontalAlign {
  if (value === 'left' || value === 'right') return value
  return 'center'
}

function parseVerticalAlign(value: string): DrawingVerticalAlign {
  if (value === 'top' || value === 'bottom') return value
  return 'inside'
}

function parseLabelPosition(value: string): FibonacciLabelPosition {
  if (value === 'left' || value === 'center') return value
  return 'right'
}

function parseLabelVerticalPosition(value: string): FibonacciLabelVerticalPosition {
  if (value === 'top' || value === 'bottom') return value
  return 'middle'
}

function parseLevelFormat(value: string): FibonacciLevelFormat {
  return value === 'percents' ? 'percents' : 'values'
}

function linePreview(style: DrawingBorderStyle, width = 1, compact = false): ReactElement {
  return <span aria-hidden="true" className={`block ${compact ? 'w-6' : 'w-12'} border-current ${style === 'dashed' ? 'border-dashed' : style === 'dotted' ? 'border-dotted' : 'border-solid'}`} style={{ borderTopWidth: width }} />
}

function ColorSwatch({ label, value, disabled = false, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }): ReactElement {
  return (
    <label className={`relative grid size-9 shrink-0 place-items-center rounded-control border border-[#4b4d52] bg-[#202020] transition-[border-color,background-color] duration-100 focus-within:border-active focus-within:ring-1 focus-within:ring-active ${disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer hover:border-[#62646a] hover:bg-[#262626]'}`}>
      <span aria-hidden="true" className="size-6 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" style={{ backgroundColor: value }} />
      <input aria-label={label} type="color" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value.toLowerCase())} className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
    </label>
  )
}

export function FibonacciDrawingInspector({ drawing, templates, templateError, onChange, onDeleteTemplate, onClose }: FibonacciDrawingInspectorProps): ReactElement {
  const [draft, setDraft] = useState<DrawingAppearance>(() => structuredClone(drawing))
  const [activeTab, setActiveTab] = useState<FibonacciInspectorTab>('style')
  const [openMenu, setOpenMenu] = useState<FibonacciMenu>(null)
  const [dragging, setDragging] = useState<boolean>(false)
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const dragRef = useRef<InspectorDragState | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const lastFillOpacity = useRef<number>(drawing.fillOpacity > 0 ? drawing.fillOpacity : 0.12)
  const tabsId = useId()
  const matchingTemplates = templates.filter((template) => template.toolType === drawing.type)

  const updateDraft = (patch: DrawingAppearancePatch): void => {
    setDraft((current) => ({ ...current, ...patch }))
    onChange(patch)
  }

  const updateLevel = (index: number, patch: Partial<DrawingAppearance['fibonacciLevels'][number]>): void => {
    updateDraft({
      fibonacciLevels: draft.fibonacciLevels.map((level, levelIndex) => levelIndex === index ? { ...level, ...patch } : level),
    })
  }

  const applyTemplate = (template?: DrawingTemplate): void => {
    const appearance = template?.appearance ?? defaultDrawingTemplateAppearance(drawing)
    setDraft((current) => ({ ...current, ...structuredClone(appearance) }))
    onChange(appearance)
    setOpenMenu(null)
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

  const startDrag = (event: PointerEvent<HTMLButtonElement>): void => {
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
      minX: boundary - rect.left + position.x,
      maxX: window.innerWidth - boundary - rect.right + position.x,
      minY: boundary - rect.top + position.y,
      maxY: window.innerHeight - boundary - rect.bottom + position.y,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
  }

  const moveDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPosition({
      x: Math.min(Math.max(drag.originX + event.clientX - drag.pointerX, drag.minX), drag.maxX),
      y: Math.min(Math.max(drag.originY + event.clientY - drag.pointerY, drag.minY), drag.maxY),
    })
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

  return (
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="false"
      aria-label="Edit fib-retracement drawing"
      style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}
      className="flex h-auto w-full max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-[6px] border border-[#3a3a3a] bg-[#1f1f1f] text-[#d6d6d6] shadow-[0_14px_36px_rgba(0,0,0,0.38)] sm:w-[28.5rem] sm:max-h-[min(47rem,calc(100dvh-1rem))]"
    >
      <header className="flex h-[3.5rem] shrink-0 items-center justify-between px-4">
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
        >
          <span className="truncate text-[1.25rem] font-semibold leading-6 text-[#dcdcdc]">Fib Retracement</span>
          <Pencil aria-hidden="true" size={16} strokeWidth={1.5} />
        </button>
        <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-control text-[#c6c6c6] hover:bg-[#2b2b2b] focus-visible:ring-2 focus-visible:ring-active" aria-label="Close drawing properties"><X size={22} strokeWidth={1.35} /></button>
      </header>

      <div role="tablist" aria-label="Drawing property sections" onKeyDown={moveTabFocus} className="mx-4 flex h-11 shrink-0 border-b-4 border-[#555]">
        {TABS.map((tab) => <button key={tab.id} id={`${tabsId}-${tab.id}-tab`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`${tabsId}-panel`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => { setActiveTab(tab.id); setOpenMenu(null) }} className="relative h-10 px-3 text-[0.95rem] font-semibold text-[#d2d2d2] outline-none after:absolute after:-bottom-1 after:left-0 after:h-1 after:w-full after:rounded-sm after:bg-transparent hover:text-white focus-visible:ring-2 focus-visible:ring-active aria-selected:after:bg-[#dedede] first:pl-0">
          {tab.label}
        </button>)}
      </div>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${activeTab}-tab`} className="relative min-h-[22rem] flex-1 overflow-y-auto px-4 py-6 [scrollbar-color:#454545_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#454545] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
        {activeTab === 'style' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-ui-control"><input type="checkbox" checked={draft.fibonacciDiagonalLine} onChange={(event) => updateDraft({ fibonacciDiagonalLine: event.target.checked })} className={CHECKBOX} />Trend line</label>
              <label className={`relative flex h-9 w-[4.7rem] items-center gap-2 rounded-control border border-[#4b4d52] bg-[#202020] px-1 transition-[border-color,background-color] duration-100 focus-within:border-active focus-within:ring-1 focus-within:ring-active ${draft.fibonacciDiagonalLine ? 'cursor-pointer hover:border-[#62646a] hover:bg-[#262626]' : 'cursor-not-allowed opacity-45'}`}>
                <input aria-label="Trend line color" type="color" value={draft.fibonacciTrendLineColor} disabled={!draft.fibonacciDiagonalLine} onChange={(event) => updateDraft({ fibonacciTrendLineColor: event.target.value.toLowerCase() })} className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
                <span aria-hidden="true" className="size-6 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" style={{ backgroundColor: draft.fibonacciTrendLineColor }} />
                <span className="text-[#7f9a80]">{linePreview(draft.fibonacciTrendLineStyle, draft.fibonacciTrendLineWidth, true)}</span>
              </label>
            </div>

            <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
              <span className="text-ui-control">Levels line</span>
              <div className="flex gap-2">
                <div className="relative">
                  <button type="button" aria-label="Levels line style" aria-expanded={openMenu === 'levelStyle'} onClick={() => setOpenMenu((current) => current === 'levelStyle' ? null : 'levelStyle')} className="grid h-9 w-[4.7rem] place-items-center rounded-control border border-[#4b4d52] bg-[#202020] text-[#d6d6d6] outline-none transition-[border-color,background-color] duration-100 hover:border-[#62646a] hover:bg-[#292929] focus-visible:ring-2 focus-visible:ring-active">{linePreview(draft.borderStyle, 1)}</button>
                  {openMenu === 'levelStyle' ? <div role="menu" aria-label="Levels line style menu" className="absolute left-0 top-[calc(100%+0.3rem)] z-30 w-[7rem] rounded-control border border-[#3f3f3f] bg-[#242424] p-1 shadow-overlay">{(['solid', 'dashed', 'dotted'] as const).map((style) => <button key={style} type="button" role="menuitemradio" aria-checked={draft.borderStyle === style} onClick={() => { updateDraft({ borderStyle: style }); setOpenMenu(null) }} className="grid h-8 w-full place-items-center rounded-control hover:bg-[#333]">{linePreview(style)}</button>)}</div> : null}
                </div>
                <div className="relative">
                  <button type="button" aria-label="Levels line thickness" aria-expanded={openMenu === 'levelWidth'} onClick={() => setOpenMenu((current) => current === 'levelWidth' ? null : 'levelWidth')} className="grid size-9 place-items-center rounded-control border border-[#4b4d52] bg-[#202020] text-[#d6d6d6] outline-none transition-[border-color,background-color] duration-100 hover:border-[#62646a] hover:bg-[#292929] focus-visible:ring-2 focus-visible:ring-active">{linePreview('solid', draft.lineWidth, true)}</button>
                  {openMenu === 'levelWidth' ? <div role="menu" aria-label="Levels line thickness menu" className="absolute left-0 top-[calc(100%+0.3rem)] z-30 w-16 rounded-control border border-[#3f3f3f] bg-[#242424] p-1 shadow-overlay">{[1, 2, 3, 4].map((width) => <button key={width} type="button" role="menuitemradio" aria-checked={draft.lineWidth === width} onClick={() => { updateDraft({ lineWidth: width }); setOpenMenu(null) }} className="grid h-8 w-full place-items-center rounded-control hover:bg-[#333]">{linePreview('solid', width)}</button>)}</div> : null}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
              <label htmlFor={`${tabsId}-extend`} className="text-ui-control">Extend</label>
              <select id={`${tabsId}-extend`} aria-label="Fibonacci line extension" value={draft.fibonacciExtend ? 'extend' : 'none'} onChange={(event) => updateDraft({ fibonacciExtend: event.target.value === 'extend' })} className={`${PANEL_INPUT} w-[11.25rem]`}><option value="none">Don't extend</option><option value="extend">Extend lines</option></select>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1 min-[430px]:grid-cols-[10.5rem_10.5rem] min-[430px]:gap-x-12">
              {draft.fibonacciLevels.map((level, index) => <div key={index} className="grid grid-cols-[18px_minmax(0,1fr)_36px] items-center gap-2">
                <input aria-label={`Show level ${index + 1}`} type="checkbox" checked={level.visible} onChange={(event) => updateLevel(index, { visible: event.target.checked })} className={CHECKBOX} />
                <input aria-label={`Level ${index + 1} value`} type="number" step="any" value={level.value} disabled={!level.visible} onChange={(event) => updateLevel(index, { value: Number(event.target.value) })} className={`${PANEL_INPUT} min-w-0 px-2 font-mono`} />
                <ColorSwatch label={`Level ${index + 1} color`} value={level.color} disabled={!level.visible} onChange={(color) => updateLevel(index, { color })} />
              </div>)}
            </div>

            <div className="grid grid-cols-[7rem_1fr] items-center gap-2 pt-3">
              <span className="text-ui-control">Use one color</span>
              <ColorSwatch label="Use one Fibonacci color" value={draft.fibonacciLevels.find((level) => level.visible)?.color ?? draft.fibonacciLevels[0]?.color ?? '#787b86'} onChange={(color) => updateDraft({ fibonacciLevels: draft.fibonacciLevels.map((level) => ({ ...level, color })) })} />
            </div>

            <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-ui-control"><input aria-label="Background" type="checkbox" checked={draft.fillOpacity > 0} onChange={(event) => updateDraft({ fillOpacity: event.target.checked ? lastFillOpacity.current : 0 })} className={CHECKBOX} />Background</label>
              <input aria-label="Fibonacci background opacity" type="range" min="0" max="100" disabled={draft.fillOpacity === 0} value={Math.round(draft.fillOpacity * 100)} onChange={(event) => { const fillOpacity = Number(event.target.value) / 100; lastFillOpacity.current = fillOpacity; updateDraft({ fillOpacity }) }} className="fib-opacity-range w-36" />
            </div>

            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-ui-control"><input type="checkbox" checked={draft.fibonacciReverse} onChange={(event) => updateDraft({ fibonacciReverse: event.target.checked })} className={CHECKBOX} />Reverse</label>
            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-ui-control"><input type="checkbox" checked={draft.fibonacciPrices} onChange={(event) => updateDraft({ fibonacciPrices: event.target.checked })} className={CHECKBOX} />Prices</label>

            <label className="flex min-h-9 cursor-not-allowed items-center gap-2 text-ui-control text-[#686868]"><input type="checkbox" disabled className={CHECKBOX} />Fib levels based on log scale</label>
          </div>
        ) : null}

        {activeTab === 'text' ? <div className="space-y-4">
          <div className="grid grid-cols-[7rem_1fr] items-center gap-2"><label className="flex cursor-pointer items-center gap-2 text-ui-control"><input type="checkbox" checked={draft.fibonacciLevelLabels} onChange={(event) => updateDraft({ fibonacciLevelLabels: event.target.checked })} className={CHECKBOX} />Levels</label><select aria-label="Level label format" value={draft.fibonacciLevelFormat} disabled={!draft.fibonacciLevelLabels} onChange={(event) => updateDraft({ fibonacciLevelFormat: parseLevelFormat(event.target.value) })} className={`${PANEL_INPUT} w-[6.25rem]`}><option value="values">Values</option><option value="percents">Percents</option></select></div>
          <div className="grid grid-cols-[7rem_1fr] items-center gap-2"><span className="text-ui-control">Labels</span><div className="grid grid-cols-[6.25rem_6.25rem] gap-2"><select aria-label="Label horizontal position" value={draft.fibonacciLabelPosition} disabled={!draft.fibonacciLevelLabels} onChange={(event) => updateDraft({ fibonacciLabelPosition: parseLabelPosition(event.target.value) })} className={PANEL_INPUT}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select><select aria-label="Label vertical position" value={draft.fibonacciLabelVerticalPosition} disabled={!draft.fibonacciLevelLabels} onChange={(event) => updateDraft({ fibonacciLabelVerticalPosition: parseLabelVerticalPosition(event.target.value) })} className={PANEL_INPUT}><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></div></div>
          <div className="grid grid-cols-[7rem_1fr] items-center gap-2"><label className="flex cursor-pointer items-center gap-2 text-ui-control"><input type="checkbox" checked={draft.fibonacciTextVisible} onChange={(event) => updateDraft({ fibonacciTextVisible: event.target.checked })} className={CHECKBOX} />Text</label><div className="grid grid-cols-[6.25rem_6.25rem] gap-2"><select aria-label="Text horizontal position" value={draft.horizontalAlign} disabled={!draft.fibonacciTextVisible} onChange={(event) => updateDraft({ horizontalAlign: parseHorizontalAlign(event.target.value) })} className={PANEL_INPUT}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select><select aria-label="Text vertical position" value={draft.verticalAlign} disabled={!draft.fibonacciTextVisible} onChange={(event) => updateDraft({ verticalAlign: parseVerticalAlign(event.target.value) })} className={PANEL_INPUT}><option value="top">Top</option><option value="inside">Middle</option><option value="bottom">Bottom</option></select></div></div>
          {draft.fibonacciTextVisible ? <textarea aria-label="Fibonacci text" rows={3} value={draft.text} onChange={(event) => updateDraft({ text: event.target.value })} placeholder="Add text" className={`${PANEL_INPUT} min-h-20 w-full resize-y py-2`} /> : null}
          <div className="grid grid-cols-[7rem_1fr] items-center gap-2"><label htmlFor={`${tabsId}-font-size`} className="text-ui-control">Font size</label><select id={`${tabsId}-font-size`} aria-label="Fibonacci font size" value={draft.fontSize} onChange={(event) => updateDraft({ fontSize: Number(event.target.value) })} className={`${PANEL_INPUT} w-[6.25rem]`}>{Array.from({ length: 24 }, (_, index) => index + 9).map((size) => <option key={size} value={size}>{size}</option>)}</select></div>
        </div> : null}

        {activeTab === 'coordinates' ? <DrawingCoordinatesPanel drawing={draft} onChange={updateDraft} /> : null}
        {activeTab === 'visibility' ? <DrawingVisibilityPanel drawing={draft} onChange={updateDraft} /> : null}
      </div>

      <footer className="flex min-h-[4.1rem] shrink-0 items-center justify-between border-t border-[#3d3d3d] px-4 py-3">
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
