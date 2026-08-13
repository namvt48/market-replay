import { ArrowRight, RotateCcw, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { ActiveIndicator, IndicatorColor, IndicatorDescriptor, IndicatorInputDescriptor, IndicatorInputValue } from '../../api/types'

interface IndicatorSettingsDialogProps {
  indicator: ActiveIndicator
  descriptor: IndicatorDescriptor
  onApply: (inputs: Record<string, IndicatorInputValue>) => void
  onClose: () => void
}

interface IndicatorFieldProps {
  descriptor: IndicatorInputDescriptor
  value: IndicatorInputValue
  onChange: (value: IndicatorInputValue) => void
}

interface IndicatorGroup {
  name: string
  inputs: IndicatorInputDescriptor[]
}

function isIndicatorColor(value: IndicatorInputValue): value is IndicatorColor {
  return typeof value === 'object' && value !== null && 'r' in value && 'g' in value && 'b' in value && 'a' in value
}

function toHex(value: IndicatorColor): string {
  return `#${[value.r, value.g, value.b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

function fromHex(hex: string, alpha: number): IndicatorColor {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
    a: alpha,
  }
}

function normalizedTime(value: IndicatorInputValue): string {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(2359, Math.round(value))) : 0
  const hours = Math.floor(numeric / 100)
  const minutes = numeric % 100
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function timeInputValue(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':')
  return Number(hours) * 100 + Number(minutes)
}

function sessionParts(value: IndicatorInputValue): { start: string; end: string } {
  const raw = typeof value === 'string' ? value : '0000-0000'
  const [start = '0000', end = '0000'] = raw.split('-')
  const format = (part: string): string => `${part.padStart(4, '0').slice(0, 2)}:${part.padStart(4, '0').slice(2, 4)}`
  return { start: format(start), end: format(end) }
}

function sessionValue(start: string, end: string): string {
  return `${start.replace(':', '')}-${end.replace(':', '')}`
}

function FieldHelp({ text }: { text?: string }): ReactElement | null {
  return text ? <span className="text-ui-meta leading-4 text-dim">{text}</span> : null
}

function BooleanField({ descriptor, value, onChange }: IndicatorFieldProps): ReactElement {
  const checked = value === true
  return (
    <label className="flex min-h-11 items-center justify-between gap-4 rounded-control px-1 text-ui-body text-ink hover:bg-surface-2/60">
      <span className="min-w-0"><span className="block">{descriptor.label}</span><FieldHelp text={descriptor.tooltip} /></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
      <span aria-hidden="true" className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-active ${checked ? 'justify-end bg-active' : 'justify-start bg-line-strong'}`}><span className="size-4 rounded-full bg-white" /></span>
    </label>
  )
}

function ColorField({ descriptor, value, onChange }: IndicatorFieldProps): ReactElement {
  const color = isIndicatorColor(value) ? value : { r: 128, g: 128, b: 128, a: 1 }
  const colorHex = toHex(color)
  const [hexDraft, setHexDraft] = useState(() => colorHex)

  useEffect(() => { setHexDraft(colorHex) }, [colorHex])

  const updateHex = (hex: string): void => {
    setHexDraft(hex)
    if (/^#[0-9a-f]{6}$/i.test(hex)) onChange(fromHex(hex, color.a))
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="text-ui-body text-ink">{descriptor.label}</legend>
      <div className="grid grid-cols-[2.25rem_minmax(0,7rem)_minmax(7rem,1fr)_2.75rem] items-center gap-2">
        <input aria-label={`${descriptor.label} color`} type="color" value={colorHex} onChange={(event) => { setHexDraft(event.target.value); onChange(fromHex(event.target.value, color.a)) }} className="h-9 w-9 cursor-pointer rounded-control border border-line bg-surface-0 p-1" />
        <input aria-label={`${descriptor.label} hex`} type="text" value={hexDraft} onChange={(event) => updateHex(event.target.value)} onBlur={() => setHexDraft(colorHex)} maxLength={7} spellCheck={false} className="field h-9 px-2 font-mono text-ui-meta uppercase" />
        <input aria-label={`${descriptor.label} opacity`} type="range" min={0} max={100} step={5} value={Math.round(color.a * 100)} onChange={(event) => onChange({ ...color, a: Number(event.target.value) / 100 })} className="h-9 w-full accent-active" />
        <output className="text-right font-mono text-ui-meta text-muted">{Math.round(color.a * 100)}%</output>
      </div>
      <FieldHelp text={descriptor.tooltip} />
    </fieldset>
  )
}

function SessionField({ descriptor, value, onChange }: IndicatorFieldProps): ReactElement {
  const session = sessionParts(value)
  return (
    <fieldset className="grid gap-1.5">
      <legend className="text-ui-body text-ink">{descriptor.label}</legend>
      <div className="grid grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)] items-center gap-2">
        <label className="grid gap-1"><span className="text-ui-meta text-dim">Start</span><input aria-label={`${descriptor.label} start`} type="time" value={session.start} onChange={(event) => onChange(sessionValue(event.target.value, session.end))} className="field h-9 px-2 font-mono" /></label>
        <ArrowRight size={13} className="mt-5 text-dim" aria-hidden="true" />
        <label className="grid gap-1"><span className="text-ui-meta text-dim">End</span><input aria-label={`${descriptor.label} end`} type="time" value={session.end} onChange={(event) => onChange(sessionValue(session.start, event.target.value))} className="field h-9 px-2 font-mono" /></label>
      </div>
      <FieldHelp text={descriptor.tooltip} />
    </fieldset>
  )
}

function TimeField({ descriptor, value, onChange }: IndicatorFieldProps): ReactElement {
  return (
    <label className="grid gap-1.5 text-ui-body text-ink">
      <span>{descriptor.label}</span>
      <input type="time" value={normalizedTime(value)} onChange={(event) => onChange(timeInputValue(event.target.value))} className="field h-9 px-2 font-mono" />
      <FieldHelp text={descriptor.tooltip} />
    </label>
  )
}

function SelectField({ descriptor, value, onChange }: IndicatorFieldProps): ReactElement {
  return (
    <label className="grid gap-1.5 text-ui-body text-ink">
      <span>{descriptor.label}</span>
      <select value={String(value)} onChange={(event) => onChange(event.target.value)} className="field h-9 px-2">
        {(descriptor.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <FieldHelp text={descriptor.tooltip} />
    </label>
  )
}

function ValueField({ descriptor, value, onChange }: IndicatorFieldProps): ReactElement {
  const numeric = descriptor.kind === 'int' || descriptor.kind === 'float'
  return (
    <label className="grid gap-1.5 text-ui-body text-ink">
      <span>{descriptor.label}</span>
      <input type={numeric ? 'number' : 'text'} value={String(value)} min={descriptor.min} max={descriptor.max} step={descriptor.step ?? (descriptor.kind === 'int' ? 1 : undefined)} onChange={(event) => onChange(numeric ? Number(event.target.value) : event.target.value)} className={`field h-9 px-2 ${numeric ? 'font-mono' : ''}`} />
      <FieldHelp text={descriptor.tooltip} />
    </label>
  )
}

function Field(props: IndicatorFieldProps): ReactElement {
  if (props.descriptor.kind === 'bool') return <BooleanField {...props} />
  if (props.descriptor.kind === 'color') return <ColorField {...props} />
  if (props.descriptor.kind === 'session') return <SessionField {...props} />
  if (props.descriptor.kind === 'time') return <TimeField {...props} />
  if (props.descriptor.kind === 'str' && (props.descriptor.options?.length ?? 0) > 0) return <SelectField {...props} />
  return <ValueField {...props} />
}

function defaultInputs(descriptor: IndicatorDescriptor): Record<string, IndicatorInputValue> {
  const result: Record<string, IndicatorInputValue> = {}
  for (const input of descriptor.inputs) result[input.key] = input.default
  return result
}

function inputGroups(descriptor: IndicatorDescriptor): IndicatorGroup[] {
  const result = new Map<string, IndicatorInputDescriptor[]>()
  for (const input of descriptor.inputs) {
    const group = input.group || 'Inputs'
    result.set(group, [...(result.get(group) ?? []), input])
  }
  return [...result.entries()].map(([name, inputs]) => ({ name, inputs }))
}

export function IndicatorSettingsDialog({ indicator, descriptor, onApply, onClose }: IndicatorSettingsDialogProps): ReactElement {
  const titleId = useId()
  const dialogRef = useRef<HTMLFormElement>(null)
  const defaults = useMemo(() => defaultInputs(descriptor), [descriptor])
  const [draft, setDraft] = useState<Record<string, IndicatorInputValue>>(() => ({ ...defaults, ...indicator.inputs }))
  const groups = useMemo(() => inputGroups(descriptor), [descriptor])
  const [activeGroup, setActiveGroup] = useState(() => groups[0]?.name ?? 'Inputs')
  const selectedGroup = groups.find((group) => group.name === activeGroup) ?? groups[0]
  const selectedIndex = Math.max(0, groups.findIndex((group) => group.name === selectedGroup?.name))

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    return () => previous?.focus()
  }, [])

  const trapFocus = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab') return
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    onApply(draft)
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/55 sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <form ref={dialogRef} onSubmit={submit} role="dialog" aria-modal="true" aria-label={`${indicator.name} settings`} tabIndex={-1} onKeyDown={trapFocus} className="flex max-h-[calc(100dvh-0.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-t-panel border border-line-strong bg-surface-1 shadow-overlay sm:max-h-[min(46rem,calc(100dvh-2rem))] sm:rounded-panel">
        <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <div className="min-w-0"><h2 id={titleId} className="truncate text-ui-title font-semibold text-ink">{indicator.name}</h2><p className="text-ui-meta text-dim">Session-wide study settings · {descriptor.inputs.length} inputs in {groups.length} groups</p></div>
          <button type="button" onClick={onClose} className="tool-button" aria-label="Close indicator settings"><X size={16} /></button>
        </header>

        <div className="border-b border-line p-3 md:hidden">
          <label className="field-label">Settings group<select value={selectedGroup?.name ?? ''} onChange={(event) => setActiveGroup(event.target.value)} className="field-input h-9 font-sans">{groups.map((group) => <option key={group.name} value={group.name}>{group.name} ({group.inputs.length})</option>)}</select></label>
        </div>

        <div className="grid min-h-0 flex-1 md:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="Indicator settings groups" className="hidden min-h-0 overflow-y-auto border-r border-line p-2 md:block">
            {groups.map((group, index) => (
              <button key={group.name} type="button" onClick={() => setActiveGroup(group.name)} aria-current={selectedGroup?.name === group.name ? 'page' : undefined} className="flex min-h-10 w-full items-center gap-2 rounded-control px-2.5 text-left text-ui-body text-muted hover:bg-surface-2 hover:text-ink aria-[current=page]:bg-surface-3 aria-[current=page]:text-ink">
                <span className="w-5 shrink-0 font-mono text-ui-meta text-dim">{String(index + 1).padStart(2, '0')}</span>
                <span className="min-w-0 flex-1 leading-4">{group.name}</span>
                <span className="font-mono text-ui-meta text-dim">{group.inputs.length}</span>
              </button>
            ))}
          </nav>

          <section aria-labelledby="indicator-settings-group-title" className="min-h-0 overflow-y-auto p-4 sm:p-5">
            {selectedGroup ? (
              <>
                <div className="mb-5 flex items-end justify-between gap-4 border-b border-line pb-3">
                  <div><h3 id="indicator-settings-group-title" className="text-ui-title font-semibold text-ink">{selectedGroup.name}</h3><p className="mt-0.5 text-ui-meta text-dim">Configure {selectedGroup.inputs.length} {selectedGroup.inputs.length === 1 ? 'input' : 'inputs'} for this study.</p></div>
                  <span className="shrink-0 font-mono text-ui-meta text-muted">{selectedIndex + 1} / {groups.length}</span>
                </div>
                <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                  {selectedGroup.inputs.map((input) => (
                    <div key={input.key} className={input.kind === 'color' || input.kind === 'session' ? 'sm:col-span-2' : ''}>
                      <Field descriptor={input} value={draft[input.key] ?? input.default} onChange={(value) => setDraft((current) => ({ ...current, [input.key]: value }))} />
                    </div>
                  ))}
                </div>
              </>
            ) : <p className="text-ui-body text-dim">This indicator has no configurable inputs.</p>}
          </section>
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-line p-3">
          <button type="button" onClick={() => setDraft({ ...defaults })} className="secondary-button"><RotateCcw size={14} />Defaults</button>
          <div className="flex gap-2"><button type="button" onClick={onClose} className="secondary-button">Cancel</button><button type="submit" className="primary-button">Apply</button></div>
        </footer>
      </form>
    </div>,
    document.body,
  )
}
