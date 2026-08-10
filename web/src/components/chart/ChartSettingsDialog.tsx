import { RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { DEFAULT_CHART_APPEARANCE, type ChartAppearanceSettings } from '../../replay/chart-settings'
import { DEFAULT_CHART_TIMEZONE, timezoneLabel, type ChartTimezone, type ChartTimezonePreset } from '../../replay/chart-timezone'
import type { ChartPaneSettings } from '../../replay/chart-settings-store'
import { HexColorField } from '../ui/HexColorField'

interface ChartSettingsDialogProps {
  value: ChartPaneSettings
  onPreview: (value: ChartPaneSettings) => void
  onApply: (value: ChartPaneSettings) => void
  onCancel: () => void
}

const PRESETS: ChartTimezonePreset[] = ['ET', 'CT', 'MT', 'PT', 'UTC']
const OFFSETS = Array.from({ length: 53 }, (_, index) => -720 + index * 30)

export function ChartSettingsDialog({ value, onPreview, onApply, onCancel }: ChartSettingsDialogProps) {
  const [draft, setDraft] = useState<ChartPaneSettings>(() => ({ appearance: { ...value.appearance }, timezone: { ...value.timezone }, marketSession: value.marketSession }))
  const [tab, setTab] = useState<'appearance' | 'timezone'>('appearance')
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    return () => previous?.focus()
  }, [])

  const updateAppearance = (patch: Partial<ChartAppearanceSettings>): void => {
    const next = { ...draft, appearance: { ...draft.appearance, ...patch } }
    setDraft(next)
    onPreview(next)
  }

  const updateTimezone = (timezone: ChartTimezone): void => {
    const next = { ...draft, timezone }
    setDraft(next)
    onPreview(next)
  }

  const reset = (): void => {
    const next: ChartPaneSettings = { appearance: { ...DEFAULT_CHART_APPEARANCE }, timezone: { ...DEFAULT_CHART_TIMEZONE }, marketSession: 'eth' }
    setDraft(next)
    onPreview(next)
  }

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); return }
    if (event.key !== 'Tab') return
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return (
    <div className="absolute inset-0 z-[70] flex items-end justify-center bg-black/45 sm:items-center" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="chart-settings-title" tabIndex={-1} onKeyDown={trapFocus} className="flex max-h-[88%] w-full flex-col overflow-hidden rounded-t-panel border border-line-strong bg-surface-1 shadow-overlay sm:w-[560px] sm:rounded-panel">
        <header className="flex h-11 items-center justify-between border-b border-line px-3">
          <h2 id="chart-settings-title" className="text-ui-title font-semibold text-ink">Chart settings</h2>
          <button type="button" className="tool-button" onClick={onCancel} aria-label="Close chart settings"><X size={16} /></button>
        </header>
        <div className="flex border-b border-line px-3" role="tablist" aria-label="Chart settings sections">
          {(['appearance', 'timezone'] as const).map((section) => <button key={section} type="button" role="tab" aria-selected={tab === section} onClick={() => setTab(section)} className="h-9 border-b-2 border-transparent px-3 text-ui-control font-medium capitalize text-muted aria-selected:border-active aria-selected:text-ink">{section}</button>)}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'appearance' ? (
            <div className="space-y-5">
              <SettingsSection title="Candle body"><div className="grid grid-cols-2 gap-3"><HexColorField label="Body up" value={draft.appearance.upColor} onChange={(upColor) => updateAppearance({ upColor })} /><HexColorField label="Body down" value={draft.appearance.downColor} onChange={(downColor) => updateAppearance({ downColor })} /></div></SettingsSection>
              <SettingsSection title="Wick"><div className="grid grid-cols-2 gap-3"><HexColorField label="Wick up" value={draft.appearance.wickUpColor} onChange={(wickUpColor) => updateAppearance({ wickUpColor })} /><HexColorField label="Wick down" value={draft.appearance.wickDownColor} onChange={(wickDownColor) => updateAppearance({ wickDownColor })} /></div></SettingsSection>
              <SettingsSection title="Border"><Toggle label="Show border" checked={draft.appearance.borderVisible} onChange={(borderVisible) => updateAppearance({ borderVisible })} /><div className="mt-3 grid grid-cols-2 gap-3"><HexColorField label="Border up" value={draft.appearance.borderUpColor} onChange={(borderUpColor) => updateAppearance({ borderUpColor })} /><HexColorField label="Border down" value={draft.appearance.borderDownColor} onChange={(borderDownColor) => updateAppearance({ borderDownColor })} /></div></SettingsSection>
              <SettingsSection title="Canvas"><div className="grid grid-cols-2 gap-3"><HexColorField label="Background" value={draft.appearance.backgroundColor} onChange={(backgroundColor) => updateAppearance({ backgroundColor })} /><HexColorField label="Price & time text" value={draft.appearance.textColor} onChange={(textColor) => updateAppearance({ textColor })} /></div></SettingsSection>
              <SettingsSection title="Grid"><Toggle label="Show grid" checked={draft.appearance.showGrid} onChange={(showGrid) => updateAppearance({ showGrid })} /><div className="mt-3 grid grid-cols-2 gap-3"><HexColorField label="Vertical grid" value={draft.appearance.verticalGridColor} onChange={(verticalGridColor) => updateAppearance({ verticalGridColor })} /><HexColorField label="Horizontal grid" value={draft.appearance.horizontalGridColor} onChange={(horizontalGridColor) => updateAppearance({ horizontalGridColor })} /></div></SettingsSection>
              <SettingsSection title="Volume"><Toggle label="Show volume" checked={draft.appearance.showVolume} onChange={(showVolume) => updateAppearance({ showVolume })} /></SettingsSection>
            </div>
          ) : (
            <div className="space-y-4">
              <fieldset><legend className="mb-2 text-ui-body font-semibold text-ink">Market zones</legend><div className="grid grid-cols-5 gap-1.5">{PRESETS.map((preset) => <button type="button" key={preset} aria-pressed={draft.timezone.kind === 'preset' && draft.timezone.id === preset} onClick={() => updateTimezone({ kind: 'preset', id: preset })} className="secondary-button h-9 px-2 aria-pressed:border-active aria-pressed:bg-active aria-pressed:text-white">{preset}</button>)}</div></fieldset>
              <label className="field-label">Fixed UTC offset<select aria-label="Fixed UTC offset" value={draft.timezone.kind === 'offset' ? draft.timezone.minutes : ''} onChange={(event) => { if (event.target.value !== '') updateTimezone({ kind: 'offset', minutes: Number(event.target.value) }) }} className="field-input h-9"><option value="">Choose offset</option>{OFFSETS.map((minutes) => <option key={minutes} value={minutes}>{timezoneLabel({ kind: 'offset', minutes })}</option>)}</select></label>
              <p className="text-ui-body leading-relaxed text-muted">Display timezone changes chart labels only. Replay timestamps, sessions, fills and drawing anchors remain unchanged.</p>
            </div>
          )}
        </div>
        <footer className="flex items-center justify-between border-t border-line p-3">
          <button type="button" onClick={reset} className="secondary-button"><RotateCcw size={14} />Reset</button>
          <div className="flex gap-2"><button type="button" onClick={onCancel} className="secondary-button">Cancel</button><button type="button" onClick={() => onApply(draft)} className="primary-button">Apply</button></div>
        </footer>
      </div>
    </div>
  )
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="border-b border-line pb-5 last:border-0 last:pb-0"><h3 className="mb-3 text-ui-body font-semibold text-ink">{title}</h3>{children}</section>
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex min-h-9 items-center justify-between gap-3 text-ui-body text-muted"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-active" /></label>
}
