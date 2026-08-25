import { Bold, ChevronDown, Italic, Pencil, X } from 'lucide-react'
import { useId, useRef, useState, type PointerEvent, type ReactElement } from 'react'
import {
  type DrawingAppearance,
  type DrawingAppearancePatch,
  type RangeStatKey,
} from '../../replay/drawing-appearance'
import { defaultDrawingTemplateAppearance, type DrawingTemplate } from '../../replay/drawing-templates'
import { DrawingColorPalette } from './DrawingPropertyPopover'
import { DrawingCoordinatesPanel, DrawingVisibilityPanel } from './DrawingPropertySharedPanels'

interface CurveRangeDrawingInspectorProps {
  drawing: DrawingAppearance
  drawingName: string
  templates: DrawingTemplate[]
  templateError: string | null
  onChange: (patch: DrawingAppearancePatch) => void
  onClose: () => void
}

type Tab = 'style' | 'text' | 'coordinates' | 'visibility'
type Palette = 'line' | 'fill' | 'label' | 'labelBackground' | null

interface DragState {
  pointerId: number
  clientX: number
  clientY: number
  x: number
  y: number
}

const INPUT = 'h-9 rounded-control border border-[#4b4d52] bg-[#202020] px-2.5 text-ui-control text-[#d6d6d6] outline-none focus:border-active'
const ICON = 'grid size-9 place-items-center rounded-control border border-[#4b4d52] bg-[#202020] text-[#d6d6d6] hover:bg-[#2b2b2b] focus-visible:ring-2 focus-visible:ring-active aria-pressed:border-active'
const PRICE_STATS: readonly { key: RangeStatKey; label: string }[] = [
  { key: 'price-range', label: 'Price range' },
  { key: 'percent-change', label: 'Percent change' },
  { key: 'change-in-pips', label: 'Change in pips' },
]
const DATE_STATS: readonly { key: RangeStatKey; label: string }[] = [
  { key: 'bars-range', label: 'Bars range' },
  { key: 'date-time-range', label: 'Date/time range' },
  { key: 'volume', label: 'Volume' },
]

export function CurveRangeDrawingInspector({ drawing, drawingName, templates, templateError, onChange, onClose }: CurveRangeDrawingInspectorProps): ReactElement {
  const isCurve = drawing.type === 'curve'
  const isDateRange = drawing.type === 'date-range'
  const isRange = drawing.type === 'price-range' || isDateRange
  const tabs: readonly { id: Tab; label: string }[] = isCurve
    ? [{ id: 'style', label: 'Style' }, { id: 'coordinates', label: 'Coordinates' }, { id: 'visibility', label: 'Visibility' }]
    : [{ id: 'style', label: 'Style' }, { id: 'text', label: 'Text' }, { id: 'coordinates', label: 'Coordinates' }, { id: 'visibility', label: 'Visibility' }]
  const [draft, setDraft] = useState<DrawingAppearance>(() => structuredClone(drawing))
  const [activeTab, setActiveTab] = useState<Tab>('style')
  const [palette, setPalette] = useState<Palette>(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const lineRef = useRef<HTMLButtonElement>(null)
  const fillRef = useRef<HTMLButtonElement>(null)
  const labelRef = useRef<HTMLButtonElement>(null)
  const labelBackgroundRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const tabsId = useId()

  const update = (patch: DrawingAppearancePatch): void => {
    setDraft((current) => ({ ...current, ...patch }))
    onChange(patch)
  }
  const startDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || event.isPrimary === false) return
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: position.x, y: position.y }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
    event.preventDefault()
  }
  const moveDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dialog = dialogRef.current
    if (!dialog) return
    const rect = dialog.getBoundingClientRect()
    const nextX = drag.x + event.clientX - drag.clientX
    const nextY = drag.y + event.clientY - drag.clientY
    setPosition({
      x: Math.min(Math.max(nextX, 8 - rect.left + position.x), window.innerWidth - 8 - rect.right + position.x),
      y: Math.min(Math.max(nextY, 8 - rect.top + position.y), window.innerHeight - 8 - rect.bottom + position.y),
    })
  }
  const stopDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
  }
  const extension = draft.extendLeft && draft.extendRight ? 'both' : draft.extendLeft ? 'left' : draft.extendRight ? 'right' : 'none'
  const stats = isDateRange ? DATE_STATS : PRICE_STATS
  const statsLabel = draft.rangeStats.map((key) => stats.find((item) => item.key === key)?.label).filter(Boolean).join(', ')
  const matchingTemplates = templates.filter((template) => template.toolType === drawing.type)

  return <section ref={dialogRef} role="dialog" aria-modal="false" aria-label={`Edit ${drawing.type} drawing`} style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }} className={`flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-[6px] border border-[#373737] bg-[#1f1f1f] text-[#d6d6d6] shadow-overlay sm:w-[23.75rem] ${activeTab === 'visibility' ? 'sm:w-[28.5rem]' : ''}`}>
    <header className="flex h-14 shrink-0 items-center justify-between px-5">
      <button type="button" aria-label="Move drawing properties" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag} className={`flex h-full min-w-0 flex-1 touch-none items-center gap-2.5 text-left ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}><span className="truncate text-[1.25rem] font-semibold">{drawingName}</span><Pencil size={16} strokeWidth={1.5} /></button>
      <button type="button" aria-label="Close drawing properties" onClick={onClose} className="grid size-9 place-items-center rounded-control hover:bg-[#2b2b2b]"><X size={22} strokeWidth={1.35} /></button>
    </header>
    <div role="tablist" aria-label="Drawing property sections" className="mx-5 flex h-11 shrink-0 border-b-4 border-[#565656]">
      {tabs.map((tab) => <button key={tab.id} id={`${tabsId}-${tab.id}-tab`} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => { setActiveTab(tab.id); setPalette(null); setStatsOpen(false) }} className="relative h-10 px-3 text-[0.95rem] font-semibold first:pl-0 last:pr-0 after:absolute after:-bottom-1 after:left-0 after:h-1 after:w-full after:rounded-sm after:bg-transparent aria-selected:after:bg-[#dedede]">{tab.label}</button>)}
    </div>
    <div role="tabpanel" aria-labelledby={`${tabsId}-${activeTab}-tab`} className="min-h-[19rem] flex-1 overflow-y-auto px-5 py-6">
      {activeTab === 'style' ? <div className="space-y-4">
        <div className="grid grid-cols-[6.25rem_1fr] items-center gap-3"><span className="text-ui-control">Line</span><button ref={lineRef} type="button" aria-label="Line appearance" aria-expanded={palette === 'line'} onClick={() => setPalette((value) => value === 'line' ? null : 'line')} className="flex h-9 w-[4.75rem] items-center gap-2 rounded-control border border-[#4b4d52] bg-[#202020] px-1"><span className="size-6 rounded-[3px]" style={{ backgroundColor: draft.strokeColor }} /><span className="w-8 border-t-2" style={{ borderColor: draft.strokeColor, borderTopStyle: draft.borderStyle }} /></button></div>
        <div className="grid grid-cols-[6.25rem_1fr] items-center gap-3"><label htmlFor={`${tabsId}-extend`} className="text-ui-control">Extend</label><select id={`${tabsId}-extend`} aria-label="Line extension" value={extension} onChange={(event) => update({ extendLeft: event.target.value === 'left' || event.target.value === 'both', extendRight: event.target.value === 'right' || event.target.value === 'both' })} className={`${INPUT} w-[11.25rem]`}><option value="none">Don't extend</option><option value="left">Extend left</option><option value="right">Extend right</option><option value="both">Extend both</option></select></div>
        <div className="flex min-h-9 items-center gap-3"><label className="flex cursor-pointer items-center gap-3 text-ui-control"><input type="checkbox" checked={draft.drawingBackgroundVisible} onChange={(event) => update({ drawingBackgroundVisible: event.target.checked })} className="size-[18px] accent-white" />Background</label><button ref={fillRef} type="button" aria-label="Background color" aria-expanded={palette === 'fill'} onClick={() => setPalette((value) => value === 'fill' ? null : 'fill')} className={ICON}><span className="size-6 rounded-[3px]" style={{ backgroundColor: draft.fillColor, opacity: Math.max(.2, draft.fillOpacity) }} /></button></div>
        {isRange ? <>
          <div className="relative grid grid-cols-[6.25rem_1fr] items-center gap-3"><span className="text-ui-control">Stats</span><button type="button" aria-label="Range statistics" aria-expanded={statsOpen} onClick={() => setStatsOpen((value) => !value)} className={`${INPUT} flex min-w-0 items-center justify-between text-left`}><span className="truncate">{statsLabel || 'None'}</span><ChevronDown size={15} /></button>{statsOpen ? <div role="menu" aria-label="Range statistics menu" className="absolute left-[6.95rem] top-[calc(100%+0.3rem)] z-30 w-[13.5rem] rounded-panel border border-[#343434] bg-[#242424] p-1 shadow-overlay">{stats.map((item) => <label key={item.key} className="flex h-9 cursor-pointer items-center gap-2 rounded-control px-2 text-ui-control hover:bg-[#333]"><input type="checkbox" checked={draft.rangeStats.includes(item.key)} onChange={(event) => update({ rangeStats: event.target.checked ? [...draft.rangeStats, item.key] : draft.rangeStats.filter((key) => key !== item.key) })} className="size-[18px] accent-white" />{item.label}</label>)}</div> : null}</div>
          <div className="grid grid-cols-[6.25rem_1fr] items-center gap-3"><span className="text-ui-control">Label</span><div className="flex gap-2"><button ref={labelRef} type="button" aria-label="Label color" aria-expanded={palette === 'label'} onClick={() => setPalette((value) => value === 'label' ? null : 'label')} className={ICON}><span className="size-6 rounded-[3px]" style={{ backgroundColor: draft.textColor }} /></button><select aria-label="Label font size" value={draft.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} className={`${INPUT} w-[6.25rem]`}>{[8,10,11,12,14,16,18,20,24,28,32,40].map((size) => <option key={size}>{size}</option>)}</select></div></div>
          <div className="flex min-h-9 items-center gap-3"><label className="flex cursor-pointer items-center gap-3 text-ui-control"><input type="checkbox" checked={draft.rangeLabelBackgroundVisible} onChange={(event) => update({ rangeLabelBackgroundVisible: event.target.checked })} className="size-[18px] accent-white" />Label background</label><button ref={labelBackgroundRef} type="button" aria-label="Label background color" aria-expanded={palette === 'labelBackground'} onClick={() => setPalette((value) => value === 'labelBackground' ? null : 'labelBackground')} className={ICON}><span className="size-6 rounded-[3px]" style={{ backgroundColor: draft.backgroundColor }} /></button></div>
        </> : null}
      </div> : null}
      {activeTab === 'text' ? <div className="space-y-4"><div className="flex gap-2"><button ref={labelRef} type="button" aria-label="Text color" aria-expanded={palette === 'label'} onClick={() => setPalette((value) => value === 'label' ? null : 'label')} className={ICON}><span className="size-6 rounded-[3px]" style={{ backgroundColor: draft.textColor }} /></button><select aria-label="Font size" value={draft.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} className={`${INPUT} w-[6.25rem]`}>{[8,10,11,12,14,16,18,20,24,28,32,40].map((size) => <option key={size}>{size}</option>)}</select><button type="button" aria-label="Bold text" aria-pressed={draft.bold} onClick={() => update({ bold: !draft.bold })} className={ICON}><Bold size={18} /></button><button type="button" aria-label="Italic text" aria-pressed={draft.italic} onClick={() => update({ italic: !draft.italic })} className={ICON}><Italic size={18} /></button></div><textarea aria-label="Drawing text" value={draft.text} onChange={(event) => update({ text: event.target.value })} placeholder="Add text" className="min-h-[6.25rem] w-full resize-none rounded-[7px] border border-[#555] bg-[#202020] px-2.5 py-2 text-ui-control outline-none placeholder:text-[#858585] focus:border-active" /></div> : null}
      {activeTab === 'coordinates' ? <DrawingCoordinatesPanel drawing={draft} onChange={update} /> : null}
      {activeTab === 'visibility' ? <DrawingVisibilityPanel drawing={draft} onChange={update} /> : null}
    </div>
    <footer className="flex min-h-[4.1rem] shrink-0 items-center justify-between border-t border-[#3d3d3d] px-5 py-3"><select aria-label="Drawing template" defaultValue="" onChange={(event) => { const template = matchingTemplates.find((item) => item.id === event.target.value); const patch = template?.appearance ?? defaultDrawingTemplateAppearance(drawing); setDraft((current) => ({ ...current, ...structuredClone(patch) })); onChange(patch) }} className={`${INPUT} w-[7rem]`}><option value="">Template</option><option value="default">Default</option>{matchingTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select><div className="flex gap-3"><button type="button" onClick={onClose} className="h-9 rounded-[6px] border border-[#e0e0e0] px-3 text-ui-control">Cancel</button><button type="button" onClick={onClose} className="h-9 rounded-[6px] bg-[#f0f0f0] px-3 text-ui-control text-[#171717]">Ok</button></div>{templateError ? <span role="alert" className="sr-only">{templateError}</span> : null}</footer>
    {palette === 'line' ? <DrawingColorPalette anchorRef={lineRef} ariaLabel="Line color palette" color={draft.strokeColor} opacity={draft.strokeOpacity} opacityLabel="Line opacity" positionKey={`${activeTab}-line`} onColor={(strokeColor) => { update({ strokeColor }); setPalette(null) }} onOpacity={(strokeOpacity) => update({ strokeOpacity })} /> : null}
    {palette === 'fill' ? <DrawingColorPalette anchorRef={fillRef} ariaLabel="Background color palette" color={draft.fillColor} opacity={draft.fillOpacity} opacityLabel="Background opacity" positionKey={`${activeTab}-fill`} onColor={(fillColor) => { update({ fillColor }); setPalette(null) }} onOpacity={(fillOpacity) => update({ fillOpacity })} /> : null}
    {palette === 'label' ? <DrawingColorPalette anchorRef={labelRef} ariaLabel="Label color palette" color={draft.textColor} opacity={draft.textOpacity} opacityLabel="Label opacity" positionKey={`${activeTab}-label`} onColor={(textColor) => { update({ textColor }); setPalette(null) }} onOpacity={(textOpacity) => update({ textOpacity })} /> : null}
    {palette === 'labelBackground' ? <DrawingColorPalette anchorRef={labelBackgroundRef} ariaLabel="Label background color palette" color={draft.backgroundColor} opacity={draft.backgroundOpacity} opacityLabel="Label background opacity" positionKey={`${activeTab}-label-background`} onColor={(backgroundColor) => { update({ backgroundColor }); setPalette(null) }} onOpacity={(backgroundOpacity) => update({ backgroundOpacity })} /> : null}
  </section>
}
