import { Check, ChevronDown, Pencil, Trash2, X } from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type RefObject } from 'react'
import {
  type DrawingAppearance,
  type DrawingAppearancePatch,
  type DrawingBorderStyle,
  type DrawingCoordinate,
  type PositionRiskMode,
  type PositionStatKey,
} from '../../replay/drawing-appearance'
import { defaultDrawingTemplateAppearance, type DrawingTemplate } from '../../replay/drawing-templates'
import { DrawingCoordinatesPanel, DrawingVisibilityPanel } from './DrawingPropertySharedPanels'
import { DrawingColorPalette, DrawingPropertyPopover } from './DrawingPropertyPopover'

interface PositionDrawingInspectorProps {
  drawing: DrawingAppearance
  templates: DrawingTemplate[]
  templateError: string | null
  onChange: (patch: DrawingAppearancePatch) => void
  onDeleteTemplate: (id: string) => void
  onClose: () => void
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

interface LineAppearanceButtonProps {
  buttonRef: RefObject<HTMLButtonElement | null>
  color: string
  style: DrawingBorderStyle
  width: number
  expanded: boolean
  onClick: () => void
}

interface ColorSwatchProps {
  buttonRef: RefObject<HTMLButtonElement | null>
  label: string
  color: string
  opacity: number
  expanded: boolean
  onClick: () => void
}

type PositionTab = 'style' | 'text' | 'coordinates' | 'visibility'
type PositionMenu = 'line' | 'stop' | 'target' | 'text' | 'stats' | 'template' | null

const TABS: readonly { id: PositionTab; label: string }[] = [
  { id: 'style', label: 'Style' },
  { id: 'text', label: 'Text' },
  { id: 'coordinates', label: 'Coordinates' },
  { id: 'visibility', label: 'Visibility' },
]

const POSITION_STAT_OPTIONS: readonly { key: PositionStatKey; label: string }[] = [
  { key: 'tp-price-offset', label: 'TP price offset' },
  { key: 'tp-percent-offset', label: 'TP percent offset' },
  { key: 'tp-tick-offset', label: 'TP tick offset' },
  { key: 'tp-amount', label: 'TP amount' },
  { key: 'tp-pl', label: 'TP PL' },
  { key: 'open-closed-pl', label: 'Open/closed PL' },
  { key: 'qty', label: 'Qty' },
  { key: 'risk-reward-ratio', label: 'Risk/reward ratio' },
  { key: 'sl-price-offset', label: 'SL price offset' },
  { key: 'sl-percent-offset', label: 'SL percent offset' },
  { key: 'sl-tick-offset', label: 'SL tick offset' },
  { key: 'sl-amount', label: 'SL amount' },
  { key: 'sl-pl', label: 'SL PL' },
]

const PANEL_INPUT = 'h-9 rounded-control border border-[#4b4d52] bg-[#202020] px-2.5 font-mono text-ui-control text-[#d6d6d6] outline-none transition-[border-color,background-color] duration-100 hover:border-[#5a5c61] focus:border-active disabled:cursor-not-allowed disabled:border-[#414141] disabled:bg-[#292929] disabled:text-[#686868]'
const CHECKBOX = 'size-[18px] shrink-0 accent-white'

function parseRiskMode(value: string): PositionRiskMode {
  return value === 'cash' ? 'cash' : 'percent'
}

function linePreview(style: DrawingBorderStyle, width = 1): ReactElement {
  return <span aria-hidden="true" className={`block w-8 border-current ${style === 'dashed' ? 'border-dashed' : style === 'dotted' ? 'border-dotted' : 'border-solid'}`} style={{ borderTopWidth: width }} />
}

function LineAppearanceButton({ buttonRef, color, style, width, expanded, onClick }: LineAppearanceButtonProps): ReactElement {
  return (
    <button ref={buttonRef} type="button" aria-label="Position lines appearance" aria-expanded={expanded} onClick={onClick} className="flex h-9 w-[4.75rem] items-center gap-2 rounded-control border border-[#4b4d52] bg-[#202020] px-1 outline-none hover:border-[#62646a] hover:bg-[#292929] focus-visible:ring-2 focus-visible:ring-active">
      <span aria-hidden="true" className="size-6 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />
      <span className="min-w-0" style={{ color }}>{linePreview(style, width)}</span>
    </button>
  )
}

function ColorSwatch({ buttonRef, label, color, opacity, expanded, onClick }: ColorSwatchProps): ReactElement {
  return (
    <button ref={buttonRef} type="button" aria-label={label} aria-expanded={expanded} onClick={onClick} className="relative grid size-9 place-items-center overflow-hidden rounded-control border border-[#4b4d52] outline-none focus-visible:ring-2 focus-visible:ring-active" style={{ backgroundImage: 'conic-gradient(#303030 25%, #202020 0 50%, #303030 0 75%, #202020 0)', backgroundSize: '8px 8px' }}>
      <span aria-hidden="true" className="absolute inset-1 rounded-[2px]" style={{ backgroundColor: color, opacity }} />
    </button>
  )
}

function fieldCoordinates(drawing: DrawingAppearance): [DrawingCoordinate, DrawingCoordinate, DrawingCoordinate] {
  const coordinates = drawing.coordinates ?? []
  const fallback = { price: 0, bar: 0 }
  return [coordinates[0] ?? fallback, coordinates[1] ?? fallback, coordinates[2] ?? fallback]
}

export function PositionDrawingInspector({ drawing, templates, templateError, onChange, onDeleteTemplate, onClose }: PositionDrawingInspectorProps): ReactElement {
  const [draft, setDraft] = useState<DrawingAppearance>(() => structuredClone(drawing))
  const [activeTab, setActiveTab] = useState<PositionTab>('style')
  const [openMenu, setOpenMenu] = useState<PositionMenu>(null)
  const [dragging, setDragging] = useState<boolean>(false)
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const dragRef = useRef<InspectorDragState | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const lineAnchorRef = useRef<HTMLButtonElement>(null)
  const stopAnchorRef = useRef<HTMLButtonElement>(null)
  const targetAnchorRef = useRef<HTMLButtonElement>(null)
  const textAnchorRef = useRef<HTMLButtonElement>(null)
  const statsAnchorRef = useRef<HTMLButtonElement>(null)
  const tabsId = useId()
  const matchingTemplates = templates.filter((template) => template.toolType === drawing.type)
  const title = drawing.type === 'short-position' ? 'Short Position' : 'Long Position'
  const isLong = drawing.type !== 'short-position'
  const [entryCoordinate, stopCoordinate, targetCoordinate] = fieldCoordinates(draft)
  const tickSize = Math.max(0.00000001, draft.positionTickSize ?? 0.25)
  const profitTicks = Math.round(Math.abs(targetCoordinate.price - entryCoordinate.price) / tickSize)
  const stopTicks = Math.round(Math.abs(stopCoordinate.price - entryCoordinate.price) / tickSize)
  const positionKey = `${position.x}:${position.y}`
  const selectedStatLabels = POSITION_STAT_OPTIONS.filter((option) => draft.positionStats.includes(option.key)).map((option) => option.label)
  const statsSummary = selectedStatLabels.length === 0 ? 'None' : `${selectedStatLabels[0]}${selectedStatLabels.length > 1 ? ', …' : ''}`

  const updateDraft = (patch: DrawingAppearancePatch): void => {
    setDraft((current) => ({ ...current, ...patch }))
    onChange(patch)
  }

  const updateCoordinate = (index: number, price: number): void => {
    const coordinates = fieldCoordinates(draft).map((coordinate) => ({ ...coordinate }))
    const target = coordinates[index]
    if (!target) return
    target.price = Number.isFinite(price) ? price : 0
    updateDraft({ coordinates })
  }

  const updateTicks = (kind: 'profit' | 'stop', ticks: number): void => {
    const distance = Math.max(0, Math.round(ticks)) * tickSize
    if (kind === 'profit') updateCoordinate(2, entryCoordinate.price + (isLong ? distance : -distance))
    else updateCoordinate(1, entryCoordinate.price + (isLong ? -distance : distance))
  }

  const toggleStat = (key: PositionStatKey): void => {
    const selected = new Set(draft.positionStats)
    if (selected.has(key)) selected.delete(key)
    else selected.add(key)
    updateDraft({ positionStats: POSITION_STAT_OPTIONS.map((option) => option.key).filter((option) => selected.has(option)) })
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
    setOpenMenu(null)
    buttons[nextIndex]?.focus()
  }

  return (
    <section ref={dialogRef} role="dialog" aria-modal="false" aria-label={`Edit ${drawing.type} drawing`} style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }} onKeyDown={(event) => { if (event.key !== 'Escape') return; if (openMenu) setOpenMenu(null); else onClose() }} className={`flex h-auto w-full max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-[6px] border border-[#3a3a3a] bg-[#1f1f1f] text-[#d6d6d6] shadow-[0_14px_36px_rgba(0,0,0,0.38)] transition-[width] duration-100 motion-reduce:transition-none sm:max-h-[min(47rem,calc(100dvh-1rem))] ${activeTab === 'coordinates' || activeTab === 'visibility' ? 'sm:w-[28.5rem]' : 'sm:w-[23.75rem]'}`}>
      <header className="flex h-[3.5rem] shrink-0 items-center justify-between px-4">
        <button type="button" aria-label="Move drawing properties" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag} onKeyDown={moveWithKeyboard} className={`flex h-full min-w-0 flex-1 touch-none items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-active ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}><span className="truncate text-[1.25rem] font-semibold leading-6">{title}</span><Pencil size={16} strokeWidth={1.5} /></button>
        <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-control text-[#c6c6c6] hover:bg-[#2b2b2b] focus-visible:ring-2 focus-visible:ring-active" aria-label="Close drawing properties"><X size={22} strokeWidth={1.35} /></button>
      </header>

      <div role="tablist" aria-label="Drawing property sections" onKeyDown={moveTabFocus} className="mx-4 flex h-11 shrink-0 border-b-4 border-[#555]">
        {TABS.map((tab) => <button key={tab.id} id={`${tabsId}-${tab.id}-tab`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`${tabsId}-panel`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => { setActiveTab(tab.id); setOpenMenu(null) }} className="relative h-10 px-3 text-[0.95rem] font-semibold outline-none after:absolute after:-bottom-1 after:left-0 after:h-1 after:w-full after:rounded-sm after:bg-transparent focus-visible:ring-2 focus-visible:ring-active aria-selected:after:bg-[#dedede] first:pl-0">{tab.label}</button>)}
      </div>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${activeTab}-tab`} className="min-h-[22rem] flex-1 overflow-y-auto px-4 py-6 [scrollbar-color:#454545_transparent] [scrollbar-width:thin]">
        {activeTab === 'style' ? <div className="space-y-4">
          {[
            ['Account size', 'Position account size', draft.positionAccountSize, (value: number) => updateDraft({ positionAccountSize: value })],
            ['Lot size', 'Position lot size', draft.positionLotSize, (value: number) => updateDraft({ positionLotSize: value })],
          ].map(([label, ariaLabel, value, onValue]) => <label key={String(label)} className="grid grid-cols-[5.75rem_6.25rem] items-center gap-4 text-ui-control"><span>{String(label)}</span><input aria-label={String(ariaLabel)} type="number" min="0" step="any" value={Number(value)} onChange={(event) => (onValue as (value: number) => void)(Number(event.target.value))} className={PANEL_INPUT} /></label>)}
          <div className="grid grid-cols-[5.75rem_1fr] items-center gap-4 text-ui-control"><label htmlFor={`${tabsId}-risk`}>Risk</label><div className="flex gap-2"><input id={`${tabsId}-risk`} aria-label="Position risk" type="number" min="0" step="any" value={draft.positionRisk} onChange={(event) => updateDraft({ positionRisk: Number(event.target.value) })} className={`${PANEL_INPUT} w-[6.25rem]`} /><select aria-label="Position risk mode" value={draft.positionRiskMode} onChange={(event) => updateDraft({ positionRiskMode: parseRiskMode(event.target.value) })} className={`${PANEL_INPUT} w-[6.25rem]`}><option value="percent">%</option><option value="cash">Cash</option></select></div></div>
          <label className="grid grid-cols-[5.75rem_6.25rem] items-center gap-4 text-ui-control"><span>Entry price</span><input aria-label="Position entry price" type="number" step="any" value={entryCoordinate.price} onChange={(event) => updateCoordinate(0, Number(event.target.value))} className={PANEL_INPUT} /></label>
          <label className="grid grid-cols-[5.75rem_6.25rem] items-center gap-4 text-ui-control"><span>Leverage</span><input aria-label="Position leverage" type="number" min="0" step="any" value={draft.positionLeverage} onChange={(event) => updateDraft({ positionLeverage: Number(event.target.value) })} className={PANEL_INPUT} /></label>

          <p className="pt-2 text-ui-meta text-[#858585]">PROFIT LEVEL</p>
          <label className="grid grid-cols-[5.75rem_6.25rem] items-center gap-4 text-ui-control"><span>Ticks</span><input aria-label="Position profit ticks" type="number" min="0" step="1" value={profitTicks} onChange={(event) => updateTicks('profit', Number(event.target.value))} className={PANEL_INPUT} /></label>
          <label className="grid grid-cols-[5.75rem_6.25rem] items-center gap-4 text-ui-control"><span>Price</span><input aria-label="Position profit price" type="number" step="any" value={targetCoordinate.price} onChange={(event) => updateCoordinate(2, Number(event.target.value))} className={PANEL_INPUT} /></label>

          <p className="pt-2 text-ui-meta text-[#858585]">STOP LEVEL</p>
          <label className="grid grid-cols-[5.75rem_6.25rem] items-center gap-4 text-ui-control"><span>Ticks</span><input aria-label="Position stop ticks" type="number" min="0" step="1" value={stopTicks} onChange={(event) => updateTicks('stop', Number(event.target.value))} className={PANEL_INPUT} /></label>
          <label className="grid grid-cols-[5.75rem_6.25rem] items-center gap-4 text-ui-control"><span>Price</span><input aria-label="Position stop price" type="number" step="any" value={stopCoordinate.price} onChange={(event) => updateCoordinate(1, Number(event.target.value))} className={PANEL_INPUT} /></label>

          <label className="grid grid-cols-[5.75rem_6.25rem] items-center gap-4 pt-3 text-ui-control"><span>QTY precision</span><select aria-label="Position quantity precision" value={draft.positionQtyPrecision} onChange={(event) => updateDraft({ positionQtyPrecision: event.target.value === 'default' ? 'default' : Number(event.target.value) })} className={PANEL_INPUT}><option value="default">Default</option>{Array.from({ length: 9 }, (_, index) => <option key={index} value={index}>{index}</option>)}</select></label>
          <p className="pt-2 text-ui-meta text-[#858585]">APPEARANCE</p>
          <div className="grid grid-cols-[5rem_1fr] items-center gap-4"><span className="text-ui-control">Lines</span><LineAppearanceButton buttonRef={lineAnchorRef} color={draft.strokeColor} style={draft.borderStyle} width={draft.lineWidth} expanded={openMenu === 'line'} onClick={() => setOpenMenu((current) => current === 'line' ? null : 'line')} />{openMenu === 'line' ? <DrawingColorPalette anchorRef={lineAnchorRef} ariaLabel="Position lines color palette" color={draft.strokeColor} opacity={draft.strokeOpacity} opacityLabel="Position lines opacity" positionKey={positionKey} onColor={(strokeColor) => updateDraft({ strokeColor })} onOpacity={(strokeOpacity) => updateDraft({ strokeOpacity })}><div className="mt-3 border-t border-[#424242] pt-3"><span className="mb-1.5 block text-ui-meta text-[#858585]">Thickness</span><div className="grid grid-cols-4 overflow-hidden rounded-control border border-[#4b4d52]">{[1, 2, 3, 4].map((width) => <button key={width} type="button" aria-label={`${width}px`} aria-pressed={draft.lineWidth === width} onClick={() => updateDraft({ lineWidth: width })} className="grid h-8 place-items-center border-r border-[#4b4d52] last:border-r-0 aria-pressed:bg-white aria-pressed:text-black"><span className="w-7 bg-current" style={{ height: width }} /></button>)}</div><span className="mb-1.5 mt-3 block text-ui-meta text-[#858585]">Line style</span><div className="grid grid-cols-3 overflow-hidden rounded-control border border-[#4b4d52]">{(['solid', 'dashed', 'dotted'] as const).map((style) => <button key={style} type="button" aria-label={`${style} position line`} aria-pressed={draft.borderStyle === style} onClick={() => updateDraft({ borderStyle: style })} className="grid h-8 place-items-center border-r border-[#4b4d52] last:border-r-0 aria-pressed:bg-white aria-pressed:text-black">{linePreview(style)}</button>)}</div></div></DrawingColorPalette> : null}</div>
          <div className="grid grid-cols-[5rem_1fr] items-center gap-4"><span className="text-ui-control">Stop color</span><ColorSwatch buttonRef={stopAnchorRef} label="Position stop color" color={draft.positionStopColor} opacity={draft.positionStopOpacity} expanded={openMenu === 'stop'} onClick={() => setOpenMenu((current) => current === 'stop' ? null : 'stop')} />{openMenu === 'stop' ? <DrawingColorPalette anchorRef={stopAnchorRef} ariaLabel="Position stop color palette" color={draft.positionStopColor} opacity={draft.positionStopOpacity} opacityLabel="Position stop opacity" positionKey={positionKey} onColor={(positionStopColor) => updateDraft({ positionStopColor })} onOpacity={(positionStopOpacity) => updateDraft({ positionStopOpacity })} /> : null}</div>
          <div className="grid grid-cols-[5rem_1fr] items-center gap-4"><span className="text-ui-control">Target color</span><ColorSwatch buttonRef={targetAnchorRef} label="Position target color" color={draft.positionTargetColor} opacity={draft.positionTargetOpacity} expanded={openMenu === 'target'} onClick={() => setOpenMenu((current) => current === 'target' ? null : 'target')} />{openMenu === 'target' ? <DrawingColorPalette anchorRef={targetAnchorRef} ariaLabel="Position target color palette" color={draft.positionTargetColor} opacity={draft.positionTargetOpacity} opacityLabel="Position target opacity" positionKey={positionKey} onColor={(positionTargetColor) => updateDraft({ positionTargetColor })} onOpacity={(positionTargetOpacity) => updateDraft({ positionTargetOpacity })} /> : null}</div>
        </div> : null}

        {activeTab === 'text' ? <div className="space-y-4">
          <div className="grid grid-cols-[5rem_1fr] items-center gap-4"><span className="text-ui-control">Text</span><div className="flex gap-2"><button ref={textAnchorRef} type="button" aria-label="Position text color" aria-expanded={openMenu === 'text'} onClick={() => setOpenMenu((current) => current === 'text' ? null : 'text')} className="grid size-9 place-items-center rounded-control border border-[#4b4d52] bg-[#202020]"><span className="size-6 rounded-[3px]" style={{ backgroundColor: draft.textColor }} /></button><select aria-label="Position font size" value={draft.fontSize} onChange={(event) => updateDraft({ fontSize: Number(event.target.value) })} className={`${PANEL_INPUT} w-[6.25rem]`}>{Array.from({ length: 24 }, (_, index) => index + 9).map((size) => <option key={size} value={size}>{size}</option>)}</select>{openMenu === 'text' ? <DrawingColorPalette anchorRef={textAnchorRef} ariaLabel="Position text color palette" color={draft.textColor} opacity={draft.textOpacity} opacityLabel="Position text opacity" positionKey={positionKey} onColor={(textColor) => { updateDraft({ textColor }); setOpenMenu(null) }} onOpacity={(textOpacity) => updateDraft({ textOpacity })} /> : null}</div></div>
          <label className="flex min-h-8 cursor-pointer items-center gap-2 text-ui-control"><input type="checkbox" checked={draft.positionPriceLabels} onChange={(event) => updateDraft({ positionPriceLabels: event.target.checked })} className={CHECKBOX} />Price labels</label>
          <p className="pt-1 text-ui-meta text-[#858585]">INFO</p>
          <div className="grid grid-cols-[5rem_1fr] items-center gap-4"><span className="text-ui-control">Stats</span><button ref={statsAnchorRef} type="button" aria-label="Position stats" aria-expanded={openMenu === 'stats'} onClick={() => setOpenMenu((current) => current === 'stats' ? null : 'stats')} className={`${PANEL_INPUT} flex w-[11.25rem] items-center justify-between gap-2 font-sans`}><span className="truncate">{statsSummary}</span><ChevronDown size={14} /></button>{openMenu === 'stats' ? <DrawingPropertyPopover anchorRef={statsAnchorRef} ariaLabel="Position stats options" positionKey={positionKey} className="w-[11.25rem] p-1.5">{POSITION_STAT_OPTIONS.map((option) => <label key={option.key} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-control px-1 text-ui-control hover:bg-[#2b2b2b]"><input type="checkbox" checked={draft.positionStats.includes(option.key)} onChange={() => toggleStat(option.key)} className={CHECKBOX} />{option.label}</label>)}</DrawingPropertyPopover> : null}</div>
          <label className="flex min-h-8 cursor-pointer items-center gap-2 text-ui-control"><input type="checkbox" checked={draft.positionCompactStats} onChange={(event) => updateDraft({ positionCompactStats: event.target.checked })} className={CHECKBOX} />Compact stats mode</label>
          <label className="flex min-h-8 cursor-pointer items-center gap-2 text-ui-control"><input type="checkbox" checked={draft.positionAlwaysShowStats} onChange={(event) => updateDraft({ positionAlwaysShowStats: event.target.checked })} className={CHECKBOX} />Always show stats</label>
        </div> : null}

        {activeTab === 'coordinates' ? <DrawingCoordinatesPanel drawing={draft} onChange={updateDraft} /> : null}
        {activeTab === 'visibility' ? <DrawingVisibilityPanel drawing={draft} onChange={updateDraft} /> : null}
      </div>

      <footer className="flex min-h-[4.1rem] shrink-0 items-center justify-between border-t border-[#3d3d3d] px-4 py-3"><div className="relative"><button type="button" aria-label="Drawing template" aria-expanded={openMenu === 'template'} onClick={() => setOpenMenu((current) => current === 'template' ? null : 'template')} className={`${PANEL_INPUT} flex min-w-[6.25rem] items-center justify-between gap-3 font-sans`}>Template<ChevronDown size={14} /></button>{openMenu === 'template' ? <div role="menu" aria-label="Drawing template menu" className="absolute bottom-[calc(100%+0.35rem)] left-0 z-30 w-56 rounded-panel border border-[#3f3f3f] bg-[#242424] p-1 shadow-overlay"><button type="button" role="menuitem" onClick={() => applyTemplate()} className="flex h-9 w-full items-center gap-2 rounded-control px-2 text-left text-ui-control hover:bg-[#333]"><Check size={14} />Default</button>{matchingTemplates.map((template) => <div key={template.id} className="flex"><button type="button" role="menuitem" onClick={() => applyTemplate(template)} className="h-9 min-w-0 flex-1 truncate rounded-control px-2 text-left text-ui-control hover:bg-[#333]">{template.name}</button><button type="button" aria-label={`Delete ${template.name} template`} onClick={() => onDeleteTemplate(template.id)} className="grid size-9 place-items-center rounded-control hover:bg-loss/10 hover:text-loss-bright"><Trash2 size={14} /></button></div>)}{templateError ? <p role="alert" className="px-2 py-1.5 text-ui-meta text-loss-bright">{templateError}</p> : null}</div> : null}</div><div className="flex gap-3"><button type="button" onClick={onClose} className="h-9 rounded-[6px] border border-[#e0e0e0] px-3 text-ui-control">Cancel</button><button type="button" onClick={onClose} className="h-9 rounded-[6px] bg-[#f0f0f0] px-3 text-ui-control text-[#171717]">Ok</button></div></footer>
    </section>
  )
}
