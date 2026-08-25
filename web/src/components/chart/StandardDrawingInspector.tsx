import { AlignCenter, AlignLeft, AlignRight, Bold, Check, ChevronDown, Italic, Pencil, Save, Trash2, X } from 'lucide-react'
import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react'
import type { DrawingAppearance, DrawingAppearancePatch, DrawingBorderStyle, DrawingVerticalAlign } from '../../replay/drawing-appearance'
import { defaultDrawingTemplateAppearance, type DrawingTemplate } from '../../replay/drawing-templates'
import { HexColorField } from '../ui/HexColorField'
import { DrawingCoordinatesPanel, DrawingVisibilityPanel } from './DrawingPropertySharedPanels'

interface StandardDrawingInspectorProps {
  drawing: DrawingAppearance
  drawingName: string
  templates: DrawingTemplate[]
  templateError: string | null
  onChange: (patch: DrawingAppearancePatch) => void
  onClose: () => void
  onSaveTemplate: (name: string) => void
  onApplyTemplate: (template: DrawingTemplate) => void
  onDeleteTemplate: (id: string) => void
  moving: boolean
  onMovePointerDown: (event: PointerEvent<HTMLButtonElement>) => void
  onMovePointerMove: (event: PointerEvent<HTMLButtonElement>) => void
  onMovePointerUp: (event: PointerEvent<HTMLButtonElement>) => void
  onMoveKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

type PropertyTab = 'style' | 'text' | 'coordinates' | 'visibility'

const TABS: readonly { id: PropertyTab; label: string }[] = [
  { id: 'style', label: 'Style' },
  { id: 'text', label: 'Text' },
  { id: 'coordinates', label: 'Coordinates' },
  { id: 'visibility', label: 'Visibility' },
]

const INPUT = 'h-9 rounded-control border border-[#4b4d52] bg-[#202020] px-2.5 text-ui-control text-[#d6d6d6] outline-none transition-colors hover:border-[#5a5c61] focus:border-active disabled:cursor-not-allowed disabled:text-[#686868]'
const ICON_BUTTON = 'grid size-9 place-items-center rounded-control border border-[#4b4d52] bg-[#202020] text-[#d6d6d6] outline-none transition-colors hover:bg-[#292929] focus-visible:ring-2 focus-visible:ring-active aria-pressed:bg-[#ededed] aria-pressed:text-[#171717]'

function borderStyle(value: string): DrawingBorderStyle {
  return value === 'dashed' || value === 'dotted' ? value : 'solid'
}

function verticalAlign(value: string): DrawingVerticalAlign {
  return value === 'top' || value === 'bottom' ? value : 'inside'
}

function OpacityField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }): ReactElement {
  const percent = Math.round(value * 100)
  return <label className="field-label"><span className="flex items-center justify-between"><span>{label}</span><output className="font-mono text-ink">{percent}%</output></span><input aria-label={label} type="range" min="0" max="100" value={percent} onChange={(event) => onChange(Number(event.target.value) / 100)} className="h-4 accent-active" /></label>
}

export function StandardDrawingInspector({ drawing, drawingName, templates, templateError, onChange, onClose, onSaveTemplate, onApplyTemplate, onDeleteTemplate, moving, onMovePointerDown, onMovePointerMove, onMovePointerUp, onMoveKeyDown }: StandardDrawingInspectorProps): ReactElement {
  const [draft, setDraft] = useState<DrawingAppearance>(() => structuredClone(drawing))
  const [activeTab, setActiveTab] = useState<PropertyTab>('style')
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const tabsId = useId()
  const matchingTemplates = useMemo(() => templates.filter((template) => template.toolType === drawing.type), [drawing.type, templates])

  const update = (patch: DrawingAppearancePatch): void => {
    setDraft((current) => ({ ...current, ...patch }))
    onChange(patch)
  }

  const applyDefault = (): void => {
    const appearance = defaultDrawingTemplateAppearance(drawing)
    setDraft((current) => ({ ...current, ...structuredClone(appearance) }))
    onChange(appearance)
    setTemplateOpen(false)
  }

  const applyTemplate = (template: DrawingTemplate): void => {
    setDraft((current) => ({ ...current, ...structuredClone(template.appearance) }))
    onApplyTemplate(template)
    setTemplateOpen(false)
  }

  const saveTemplate = (): void => {
    const name = templateName.trim()
    if (!name) return
    onSaveTemplate(name)
    setTemplateName('')
    setTemplateOpen(false)
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

  return (
    <section role="dialog" aria-modal="false" aria-label={`Edit ${drawing.type} drawing`} onKeyDown={(event) => { if (event.key !== 'Escape') return; if (templateOpen) setTemplateOpen(false); else onClose() }} className={`flex h-auto w-full max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-[6px] border border-[#3a3a3a] bg-[#1f1f1f] text-[#d6d6d6] shadow-overlay transition-[width] duration-100 motion-reduce:transition-none sm:max-h-[min(42rem,calc(100dvh-1rem))] ${activeTab === 'coordinates' || activeTab === 'visibility' ? 'sm:w-[28.5rem]' : 'sm:w-[23.75rem]'}`}>
      <header className="flex h-[3.5rem] shrink-0 items-center justify-between px-5">
        <button type="button" aria-label="Move drawing properties" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight" onPointerDown={onMovePointerDown} onPointerMove={onMovePointerMove} onPointerUp={onMovePointerUp} onPointerCancel={onMovePointerUp} onLostPointerCapture={onMovePointerUp} onKeyDown={onMoveKeyDown} className={`flex h-full min-w-0 flex-1 touch-none items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-active ${moving ? 'cursor-grabbing' : 'cursor-grab'}`}><span className="truncate text-[1.25rem] font-semibold leading-6 text-[#dcdcdc]">{drawingName}</span><Pencil aria-hidden="true" size={16} strokeWidth={1.5} /></button>
        <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-control text-[#c6c6c6] hover:bg-[#2b2b2b] focus-visible:ring-2 focus-visible:ring-active" aria-label="Close drawing properties"><X size={22} strokeWidth={1.35} /></button>
      </header>

      <div role="tablist" aria-label="Drawing property sections" onKeyDown={moveTabFocus} className="mx-5 flex h-11 shrink-0 border-b-4 border-[#555]">
        {TABS.map((tab) => <button key={tab.id} id={`${tabsId}-${tab.id}-tab`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`${tabsId}-panel`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => { setActiveTab(tab.id); setTemplateOpen(false) }} className="relative h-10 px-3 text-[0.95rem] font-semibold text-[#d2d2d2] outline-none after:absolute after:-bottom-1 after:left-0 after:h-1 after:w-full after:rounded-sm after:bg-transparent hover:text-white focus-visible:ring-2 focus-visible:ring-active aria-selected:after:bg-[#dedede] first:pl-0 last:pr-0">{tab.label}</button>)}
      </div>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${activeTab}-tab`} className="relative min-h-[22rem] flex-1 overflow-y-auto px-5 py-6 [scrollbar-color:#454545_transparent] [scrollbar-width:thin]">
        {activeTab === 'style' ? <div className="space-y-6">
          <section><h3 className="mb-3 text-ui-meta font-semibold text-[#8e8e8e]">LINE &amp; BORDER</h3><div className="grid grid-cols-2 gap-3"><HexColorField label="Stroke" value={draft.strokeColor} onChange={(strokeColor) => update({ strokeColor })} /><label className="field-label">Thickness (px)<input type="number" min="1" max="8" value={draft.lineWidth} onChange={(event) => update({ lineWidth: Number(event.target.value) })} className={`${INPUT} font-mono`} /></label><label className="field-label">Border style<select value={draft.borderStyle} onChange={(event) => update({ borderStyle: borderStyle(event.target.value) })} className={INPUT}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label><OpacityField label="Stroke opacity" value={draft.strokeOpacity} onChange={(strokeOpacity) => update({ strokeOpacity })} /></div>{draft.supportsExtend ? <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Line extension"><button type="button" aria-pressed={draft.extendLeft} onClick={() => update({ extendLeft: !draft.extendLeft })} className="secondary-button aria-pressed:border-active aria-pressed:text-active-bright">Extend left</button><button type="button" aria-pressed={draft.extendRight} onClick={() => update({ extendRight: !draft.extendRight })} className="secondary-button aria-pressed:border-active aria-pressed:text-active-bright">Extend right</button></div> : null}</section>
          <section><h3 className="mb-3 text-ui-meta font-semibold text-[#8e8e8e]">FILL</h3><div className="grid grid-cols-2 gap-3"><HexColorField label="Fill color" value={draft.fillColor} onChange={(fillColor) => update({ fillColor })} /><OpacityField label="Fill opacity" value={draft.fillOpacity} onChange={(fillOpacity) => update({ fillOpacity })} /></div></section>
        </div> : null}

        {activeTab === 'text' ? <div className="space-y-4"><div className="flex items-end gap-2"><HexColorField label="Text color" value={draft.textColor} onChange={(textColor) => update({ textColor })} /><select aria-label="Font size" value={draft.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} className={`${INPUT} w-[5rem] font-mono`}>{Array.from({ length: 24 }, (_, index) => index + 9).map((size) => <option key={size} value={size}>{size}</option>)}</select><button type="button" aria-label="Bold text" aria-pressed={draft.bold} onClick={() => update({ bold: !draft.bold })} className={ICON_BUTTON}><Bold size={18} /></button><button type="button" aria-label="Italic text" aria-pressed={draft.italic} onClick={() => update({ italic: !draft.italic })} className={ICON_BUTTON}><Italic size={18} /></button></div><textarea aria-label="Drawing text" rows={4} value={draft.text} onChange={(event) => update({ text: event.target.value })} placeholder="Add text" className={`${INPUT} min-h-24 w-full resize-y py-2 leading-relaxed`} /><div className="grid grid-cols-2 gap-2"><label className="field-label">Text alignment<select aria-label="Vertical text alignment" value={draft.verticalAlign} onChange={(event) => update({ verticalAlign: verticalAlign(event.target.value) })} className={INPUT}><option value="top">Top</option><option value="inside">Inside</option><option value="bottom">Bottom</option></select></label><div className="grid grid-cols-3 self-end overflow-hidden rounded-control border border-[#4b4d52]" role="group" aria-label="Horizontal text alignment">{([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([alignment, Icon]) => <button key={alignment} type="button" aria-label={`Align text ${alignment}`} aria-pressed={draft.horizontalAlign === alignment} onClick={() => update({ horizontalAlign: alignment })} className="grid h-9 place-items-center border-r border-[#4b4d52] bg-[#202020] last:border-r-0 hover:bg-[#292929] focus-visible:ring-2 focus-visible:ring-active aria-pressed:bg-[#ededed] aria-pressed:text-[#171717]"><Icon size={16} /></button>)}</div></div><div className="grid grid-cols-2 gap-3"><HexColorField label="Text background" value={draft.backgroundColor} onChange={(backgroundColor) => update({ backgroundColor })} /><OpacityField label="Background opacity" value={draft.backgroundOpacity} onChange={(backgroundOpacity) => update({ backgroundOpacity })} /></div></div> : null}
        {activeTab === 'coordinates' ? <DrawingCoordinatesPanel drawing={draft} onChange={update} /> : null}
        {activeTab === 'visibility' ? <DrawingVisibilityPanel drawing={draft} onChange={update} /> : null}
      </div>

      <footer className="flex min-h-[4.1rem] shrink-0 items-center justify-between border-t border-[#3d3d3d] px-5 py-3"><div className="relative"><button type="button" aria-label="Drawing template" aria-expanded={templateOpen} onClick={() => setTemplateOpen((current) => !current)} className={`${INPUT} flex min-w-[6.25rem] items-center justify-between gap-3`}>Template<ChevronDown size={14} /></button>{templateOpen ? <div role="menu" aria-label="Drawing template menu" className="absolute bottom-[calc(100%+0.35rem)] left-0 z-30 w-64 rounded-panel border border-[#3f3f3f] bg-[#242424] p-1 shadow-overlay"><button type="button" role="menuitem" onClick={applyDefault} className="flex h-9 w-full items-center gap-2 rounded-control px-2 text-left text-ui-control hover:bg-[#333]"><Check size={14} />Default</button>{matchingTemplates.map((template) => <div key={template.id} className="flex"><button type="button" role="menuitem" onClick={() => applyTemplate(template)} className="h-9 min-w-0 flex-1 truncate rounded-control px-2 text-left text-ui-control hover:bg-[#333]">{template.name}</button><button type="button" aria-label={`Delete ${template.name} template`} onClick={() => onDeleteTemplate(template.id)} className="grid size-9 place-items-center rounded-control hover:bg-loss/10 hover:text-loss-bright"><Trash2 size={14} /></button></div>)}<div className="mt-1 grid grid-cols-[1fr_auto] gap-1 border-t border-[#3f3f3f] pt-1"><input aria-label="Template name" value={templateName} maxLength={80} onChange={(event) => setTemplateName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveTemplate() }} className={`${INPUT} min-w-0`} placeholder="Name setup" /><button type="button" aria-label="Save template" disabled={!templateName.trim()} onClick={saveTemplate} className="grid size-9 place-items-center rounded-control hover:bg-[#333] disabled:opacity-35"><Save size={14} /></button></div>{templateError ? <p role="alert" className="px-2 py-1.5 text-ui-meta text-loss-bright">{templateError}</p> : null}</div> : null}</div><div className="flex gap-3"><button type="button" onClick={onClose} className="h-9 rounded-[6px] border border-[#e0e0e0] px-3 text-ui-control">Cancel</button><button type="button" onClick={onClose} className="h-9 rounded-[6px] bg-[#f0f0f0] px-3 text-ui-control text-[#171717]">Ok</button></div></footer>
    </section>
  )
}
