import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Save, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  type DrawingAppearance,
  type DrawingAppearancePatch,
  type DrawingBorderStyle,
  type DrawingHorizontalAlign,
  type FibonacciLevelAppearance,
  type FibonacciLabelPosition,
  type FibonacciLabelVerticalPosition,
  type FibonacciLevelFormat,
  type DrawingVerticalAlign,
} from '../../replay/drawing-appearance'
import type { DrawingTemplate } from '../../replay/drawing-templates'
import { HexColorField } from '../ui/HexColorField'

interface OpacityFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
}

interface DrawingInspectorProps {
  drawing: DrawingAppearance
  templates: DrawingTemplate[]
  templateError: string | null
  onChange: (patch: DrawingAppearancePatch) => void
  onClose: () => void
  onSaveTemplate: (name: string) => void
  onApplyTemplate: (template: DrawingTemplate) => void
  onDeleteTemplate: (id: string) => void
}

function parseBorderStyle(value: string): DrawingBorderStyle {
  if (value === 'dashed' || value === 'dotted') return value
  return 'solid'
}

function parseVerticalAlign(value: string): DrawingVerticalAlign {
  if (value === 'top' || value === 'bottom') return value
  return 'inside'
}

function parseHorizontalAlign(value: string): DrawingHorizontalAlign {
  if (value === 'left' || value === 'right') return value
  return 'center'
}

function parseFibonacciLabelPosition(value: string): FibonacciLabelPosition {
  if (value === 'left' || value === 'center') return value
  return 'right'
}

function parseFibonacciLabelVerticalPosition(value: string): FibonacciLabelVerticalPosition {
  if (value === 'top' || value === 'bottom') return value
  return 'middle'
}

function parseFibonacciLevelFormat(value: string): FibonacciLevelFormat {
  return value === 'percents' ? 'percents' : 'values'
}

function OpacityField({ label, value, onChange }: OpacityFieldProps) {
  const percent = Math.round(value * 100)
  return (
    <label className="field-label">
      <span className="flex items-center justify-between"><span>{label}</span><span className="font-mono text-ink">{percent}%</span></span>
      <input type="range" min="0" max="100" value={percent} onChange={(event) => onChange(Number(event.target.value) / 100)} className="h-4 accent-active" />
    </label>
  )
}

interface FibonacciPropertiesProps {
  drawing: DrawingAppearance
  onChange: (patch: DrawingAppearancePatch) => void
}

function FibonacciProperties({ drawing, onChange }: FibonacciPropertiesProps) {
  const updateLevel = (index: number, patch: Partial<FibonacciLevelAppearance>): void => {
    onChange({
      fibonacciLevels: drawing.fibonacciLevels.map((level, levelIndex) => levelIndex === index ? { ...level, ...patch } : level),
    })
  }

  return (
    <>
      <section aria-labelledby="fibonacci-lines-heading">
        <h3 id="fibonacci-lines-heading" className="mb-2 text-ui-meta font-semibold text-muted">LINE</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="field-label">Line style<select value={drawing.borderStyle} onChange={(event) => onChange({ borderStyle: parseBorderStyle(event.target.value) })} className="field-input h-9"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
          <label className="field-label">Thickness (px)<input type="number" min="1" max="8" value={drawing.lineWidth} onChange={(event) => onChange({ lineWidth: Number(event.target.value) })} className="field-input h-9" /></label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-control border border-line bg-surface-0 px-3 py-2.5" role="group" aria-label="Fibonacci line options">
          <label className="flex min-h-7 cursor-pointer items-center gap-2 text-ui-body text-ink"><input type="checkbox" checked={drawing.fibonacciExtend} onChange={(event) => onChange({ fibonacciExtend: event.target.checked })} className="size-4 accent-active" />Extend lines</label>
          <label className="flex min-h-7 cursor-pointer items-center gap-2 text-ui-body text-ink"><input type="checkbox" checked={drawing.fibonacciDiagonalLine} onChange={(event) => onChange({ fibonacciDiagonalLine: event.target.checked })} className="size-4 accent-active" />Diagonal</label>
        </div>
      </section>

      <section className="border-t border-line pt-4" aria-labelledby="fibonacci-levels-heading">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="fibonacci-levels-heading" className="text-ui-meta font-semibold text-muted">LEVELS</h3>
          <span className="font-mono text-ui-meta text-dim">24 SLOTS</span>
        </div>
        <div className="mb-1 grid grid-cols-[2.25rem_1fr_3rem] items-center gap-2 px-1 text-ui-meta text-dim" aria-hidden="true"><span>SHOW</span><span>VALUE</span><span>COLOR</span></div>
        <div className="divide-y divide-line rounded-control border border-line bg-surface-0">
          {drawing.fibonacciLevels.map((level, index) => (
            <div key={index} className="grid min-h-10 grid-cols-[2.25rem_1fr_3rem] items-center gap-2 px-1.5">
              <label className="grid h-9 place-items-center" title={`Show level ${index + 1}`}>
                <input type="checkbox" checked={level.visible} onChange={(event) => updateLevel(index, { visible: event.target.checked })} className="size-4 accent-active" aria-label={`Show level ${index + 1}`} />
              </label>
              <input type="number" step="any" value={level.value} onChange={(event) => updateLevel(index, { value: Number(event.target.value) })} className="field-input h-8 min-h-8 w-full px-2" aria-label={`Level ${index + 1} value`} />
              <input type="color" value={level.color} onChange={(event) => updateLevel(index, { color: event.target.value.toLowerCase() })} className="h-8 w-full cursor-pointer rounded-control border border-line bg-surface-2 p-1" aria-label={`Level ${index + 1} color`} />
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-line pt-4" aria-labelledby="fibonacci-display-heading">
        <h3 id="fibonacci-display-heading" className="mb-2 text-ui-meta font-semibold text-muted">DISPLAY</h3>
        <div className="divide-y divide-line rounded-control border border-line bg-surface-0 px-3">
          <div className="grid grid-cols-[7rem_1fr] items-center gap-2 py-2.5">
            <span className="text-ui-body text-muted">Background</span>
            <div className="grid min-w-0 grid-cols-[2.75rem_1fr_2.5rem] items-center gap-2">
              <input type="color" value={drawing.fillColor} onChange={(event) => onChange({ fillColor: event.target.value.toLowerCase() })} className="h-9 w-11 cursor-pointer rounded-control border border-line bg-surface-2 p-1" aria-label="Fibonacci background color" />
              <input type="range" min="0" max="100" value={Math.round(drawing.fillOpacity * 100)} onChange={(event) => onChange({ fillOpacity: Number(event.target.value) / 100 })} className="h-4 min-w-0 accent-active" aria-label="Fibonacci background opacity" />
              <span className="text-right font-mono text-ui-meta text-ink">{Math.round(drawing.fillOpacity * 100)}%</span>
            </div>
          </div>

          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-ui-body text-ink"><input type="checkbox" checked={drawing.fibonacciReverse} onChange={(event) => onChange({ fibonacciReverse: event.target.checked })} className="size-4 accent-active" />Reverse</label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-ui-body text-ink"><input type="checkbox" checked={drawing.fibonacciPrices} onChange={(event) => onChange({ fibonacciPrices: event.target.checked })} className="size-4 accent-active" />Prices</label>

          <div className="grid min-h-12 grid-cols-[7rem_1fr] items-center gap-2 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-ui-body text-ink"><input type="checkbox" checked={drawing.fibonacciLevelLabels} onChange={(event) => onChange({ fibonacciLevelLabels: event.target.checked })} className="size-4 accent-active" />Levels</label>
            <select aria-label="Level label format" value={drawing.fibonacciLevelFormat} onChange={(event) => onChange({ fibonacciLevelFormat: parseFibonacciLevelFormat(event.target.value) })} className="field-input h-9"><option value="values">Values</option><option value="percents">Percents</option></select>
          </div>

          <div className="grid min-h-12 grid-cols-[7rem_1fr] items-center gap-2 py-2">
            <span className="text-ui-body text-muted">Labels</span>
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Label horizontal position" value={drawing.fibonacciLabelPosition} onChange={(event) => onChange({ fibonacciLabelPosition: parseFibonacciLabelPosition(event.target.value) })} className="field-input h-9"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select>
              <select aria-label="Label vertical position" value={drawing.fibonacciLabelVerticalPosition} onChange={(event) => onChange({ fibonacciLabelVerticalPosition: parseFibonacciLabelVerticalPosition(event.target.value) })} className="field-input h-9"><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select>
            </div>
          </div>

          <div className="grid min-h-12 grid-cols-[7rem_1fr] items-center gap-2 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-ui-body text-ink"><input type="checkbox" checked={drawing.fibonacciTextVisible} onChange={(event) => onChange({ fibonacciTextVisible: event.target.checked })} className="size-4 accent-active" />Text</label>
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Text horizontal position" value={drawing.horizontalAlign} onChange={(event) => onChange({ horizontalAlign: parseHorizontalAlign(event.target.value) })} className="field-input h-9"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select>
              <select aria-label="Text vertical position" value={drawing.verticalAlign} onChange={(event) => onChange({ verticalAlign: parseVerticalAlign(event.target.value) })} className="field-input h-9"><option value="top">Top</option><option value="inside">Middle</option><option value="bottom">Bottom</option></select>
            </div>
          </div>

          {drawing.fibonacciTextVisible ? <label className="field-label py-2">Text content<textarea rows={2} value={drawing.text} onChange={(event) => onChange({ text: event.target.value })} placeholder="Add text to this Fibonacci drawing" className="field-input min-h-16 resize-y py-2 leading-relaxed" /></label> : null}

          <div className="grid min-h-12 grid-cols-2 gap-2 py-2">
            <label className="field-label">Font size<input aria-label="Fibonacci font size" type="number" min="9" max="32" value={drawing.fontSize} onChange={(event) => onChange({ fontSize: Number(event.target.value) })} className="field-input h-9" /></label>
            <label className="field-label">Decimals<input aria-label="Fibonacci decimals" type="number" min="0" max="8" value={drawing.fibonacciLevelDecimals} onChange={(event) => onChange({ fibonacciLevelDecimals: Number(event.target.value) })} className="field-input h-9" /></label>
          </div>
        </div>
      </section>
    </>
  )
}

export function DrawingInspector({
  drawing,
  templates,
  templateError,
  onChange,
  onClose,
  onSaveTemplate,
  onApplyTemplate,
  onDeleteTemplate,
}: DrawingInspectorProps) {
  const [templateName, setTemplateName] = useState<string>('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const matchingTemplates = useMemo(() => templates.filter((template) => template.toolType === drawing.type), [drawing.type, templates])
  const selectedTemplate = matchingTemplates.find((template) => template.id === selectedTemplateId)

  useEffect(() => {
    if (selectedTemplateId && !matchingTemplates.some((template) => template.id === selectedTemplateId)) setSelectedTemplateId('')
  }, [matchingTemplates, selectedTemplateId])

  const saveTemplate = (): void => {
    const name = templateName.trim()
    if (!name) return
    onSaveTemplate(name)
    setTemplateName('')
  }

  return (
    <aside className="h-full max-h-full overflow-y-auto rounded-panel border border-line-strong bg-surface-1 shadow-overlay lg:h-auto lg:max-h-[min(620px,78vh)]" aria-label={`Edit ${drawing.type} drawing`}>
      <header className="sticky top-0 z-10 flex h-10 items-center justify-between border-b border-line bg-surface-1 px-3">
        <div className="min-w-0"><strong className="block truncate text-ui-body text-ink">Drawing properties</strong><span className="block font-mono text-ui-meta text-dim">{drawing.type}</span></div>
        <button type="button" onClick={onClose} className="tool-button" aria-label="Close drawing properties"><X size={15} /></button>
      </header>

      <div className="space-y-4 p-3">
        <section aria-labelledby="drawing-template-heading">
          <h3 id="drawing-template-heading" className="mb-2 text-ui-meta font-semibold text-muted">TEMPLATES · {drawing.type}</h3>
          <div className="grid grid-cols-[1fr_auto_auto] gap-1.5">
            <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} className="field-input h-9 min-w-0" aria-label="Drawing template">
              <option value="">Select template</option>
              {matchingTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
            <button type="button" disabled={!selectedTemplate} onClick={() => { if (selectedTemplate) onApplyTemplate(selectedTemplate) }} className="secondary-button px-2 disabled:opacity-35">Apply</button>
            <button type="button" disabled={!selectedTemplate} onClick={() => { if (selectedTemplate) onDeleteTemplate(selectedTemplate.id) }} className="secondary-button px-2 text-loss-bright disabled:opacity-35" aria-label="Delete selected template"><Trash2 size={13} /></button>
          </div>
          <div className="mt-2 grid grid-cols-[1fr_auto] gap-1.5">
            <input value={templateName} maxLength={80} onChange={(event) => setTemplateName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveTemplate() }} className="field-input h-9" placeholder="Name this setup" aria-label="Template name" />
            <button type="button" disabled={!templateName.trim()} onClick={saveTemplate} className="secondary-button gap-1.5 px-3 disabled:opacity-35"><Save size={13} />Save</button>
          </div>
          {templateError ? <p className="mt-2 text-ui-meta text-loss-bright" role="alert">{templateError}</p> : null}
        </section>

        {drawing.type === 'fib-retracement' ? <FibonacciProperties drawing={drawing} onChange={onChange} /> : (
          <>
        <section aria-labelledby="drawing-line-heading">
          <h3 id="drawing-line-heading" className="mb-2 text-ui-meta font-semibold text-muted">LINE &amp; BORDER</h3>
          <div className="grid grid-cols-2 gap-2">
            <HexColorField label="Stroke" value={drawing.strokeColor} onChange={(strokeColor) => onChange({ strokeColor })} />
            <label className="field-label">Thickness (px)<input type="number" min="1" max="8" value={drawing.lineWidth} onChange={(event) => onChange({ lineWidth: Number(event.target.value) })} className="field-input h-9" /></label>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="field-label">Border style<select value={drawing.borderStyle} onChange={(event) => onChange({ borderStyle: parseBorderStyle(event.target.value) })} className="field-input h-9"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
            <OpacityField label="Stroke opacity" value={drawing.strokeOpacity} onChange={(strokeOpacity) => onChange({ strokeOpacity })} />
          </div>
          {drawing.supportsExtend ? (
            <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Line extension">
              <button type="button" aria-pressed={drawing.extendLeft} onClick={() => onChange({ extendLeft: !drawing.extendLeft })} className="secondary-button aria-pressed:border-active aria-pressed:text-active-bright">Extend left</button>
              <button type="button" aria-pressed={drawing.extendRight} onClick={() => onChange({ extendRight: !drawing.extendRight })} className="secondary-button aria-pressed:border-active aria-pressed:text-active-bright">Extend right</button>
            </div>
          ) : null}
          {drawing.type === 'rectangle' ? (
            <div className="mt-3 rounded-control border border-line bg-surface-0 px-3 py-2.5">
              <label className="flex min-h-7 cursor-pointer items-center gap-2 text-ui-body text-ink"><input type="checkbox" checked={drawing.rectangleMiddleLine} onChange={(event) => onChange({ rectangleMiddleLine: event.target.checked })} className="size-4 accent-active" />Mid line</label>
              {drawing.rectangleMiddleLine ? (
                <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line pt-2.5">
                  <HexColorField label="Mid line color" value={drawing.rectangleMiddleLineColor} onChange={(rectangleMiddleLineColor) => onChange({ rectangleMiddleLineColor })} />
                  <label className="field-label">Thickness (px)<input aria-label="Mid line thickness" type="number" min="1" max="8" value={drawing.rectangleMiddleLineWidth} onChange={(event) => onChange({ rectangleMiddleLineWidth: Number(event.target.value) })} className="field-input h-9" /></label>
                  <label className="field-label">Style<select aria-label="Mid line style" value={drawing.rectangleMiddleLineStyle} onChange={(event) => onChange({ rectangleMiddleLineStyle: parseBorderStyle(event.target.value) })} className="field-input h-9"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
                  <OpacityField label="Mid line opacity" value={drawing.rectangleMiddleLineOpacity} onChange={(rectangleMiddleLineOpacity) => onChange({ rectangleMiddleLineOpacity })} />
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="border-t border-line pt-4" aria-labelledby="drawing-fill-heading">
          <h3 id="drawing-fill-heading" className="mb-2 text-ui-meta font-semibold text-muted">FILL</h3>
          <div className="grid grid-cols-2 gap-2">
            <HexColorField label="Fill color" value={drawing.fillColor} onChange={(fillColor) => onChange({ fillColor })} />
            <OpacityField label="Fill opacity" value={drawing.fillOpacity} onChange={(fillOpacity) => onChange({ fillOpacity })} />
          </div>
        </section>

        <section className="border-t border-line pt-4" aria-labelledby="drawing-text-heading">
          <h3 id="drawing-text-heading" className="mb-2 text-ui-meta font-semibold text-muted">TEXT</h3>
          <label className="field-label">Label<textarea rows={3} value={drawing.text} onChange={(event) => onChange({ text: event.target.value })} placeholder="Add text to this drawing" className="field-input min-h-20 resize-y py-2 leading-relaxed" /></label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <HexColorField label="Text color" value={drawing.textColor} onChange={(textColor) => onChange({ textColor })} />
            <OpacityField label="Text opacity" value={drawing.textOpacity} onChange={(textOpacity) => onChange({ textOpacity })} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <HexColorField label="Background" value={drawing.backgroundColor} onChange={(backgroundColor) => onChange({ backgroundColor })} />
            <OpacityField label="Background opacity" value={drawing.backgroundOpacity} onChange={(backgroundOpacity) => onChange({ backgroundOpacity })} />
          </div>

          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <div className="grid grid-cols-3 rounded-control border border-line bg-surface-0 p-1" role="group" aria-label="Horizontal text alignment">
              <button type="button" onClick={() => onChange({ horizontalAlign: 'left' })} aria-pressed={drawing.horizontalAlign === 'left'} className="tool-button !w-full" aria-label="Align text left"><AlignLeft size={14} /></button>
              <button type="button" onClick={() => onChange({ horizontalAlign: 'center' })} aria-pressed={drawing.horizontalAlign === 'center'} className="tool-button !w-full" aria-label="Align text center"><AlignCenter size={14} /></button>
              <button type="button" onClick={() => onChange({ horizontalAlign: 'right' })} aria-pressed={drawing.horizontalAlign === 'right'} className="tool-button !w-full" aria-label="Align text right"><AlignRight size={14} /></button>
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => onChange({ bold: !drawing.bold })} aria-pressed={drawing.bold} className="tool-button border border-line bg-surface-0" aria-label="Bold text"><Bold size={14} /></button>
              <button type="button" onClick={() => onChange({ italic: !drawing.italic })} aria-pressed={drawing.italic} className="tool-button border border-line bg-surface-0" aria-label="Italic text"><Italic size={14} /></button>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="field-label">Vertical position<select value={drawing.verticalAlign} onChange={(event) => onChange({ verticalAlign: parseVerticalAlign(event.target.value) })} className="field-input h-9"><option value="top">Top</option><option value="inside">Inside</option><option value="bottom">Bottom</option></select></label>
            <label className="field-label">Font size (px)<input type="number" min="9" max="32" value={drawing.fontSize} onChange={(event) => onChange({ fontSize: Number(event.target.value) })} className="field-input h-9" /></label>
          </div>
        </section>
          </>
        )}
      </div>
    </aside>
  )
}
