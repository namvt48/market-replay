import { Archive, CalendarRange, Clock3, Crosshair, FileText, Lock, Settings2, Tags, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { SymbolMeta } from '../../api/types'
import type { ChartTimezone } from '../../replay/chart-timezone'
import { DeletedSessionsSettings } from './DeletedSessionsSettings'
import { ExecutionSettings } from './ExecutionSettings'
import { TagsSettings } from './TagsSettings'
import { TemplatesSettings } from './TemplatesSettings'
import { TimezoneSettings } from './TimezoneSettings'
import type { ChartSyncFlags } from '../../chart-workspace/types'

type SettingsSection = 'charts' | 'timezone' | 'execution' | 'tags' | 'deleted' | 'templates'

const NAV_ITEMS = [
  { id: 'charts', label: 'Chart synchronization', description: 'Crosshair, range & zoom', icon: Crosshair },
  { id: 'timezone', label: 'Timezone', description: 'Workspace clock', icon: Clock3 },
  { id: 'execution', label: 'Spreads & commissions', description: 'Execution costs', icon: Settings2 },
  { id: 'tags', label: 'Journal tags', description: 'Review taxonomy', icon: Tags },
  { id: 'deleted', label: 'Deleted sessions', description: 'Restore or remove', icon: Archive },
  { id: 'templates', label: 'Templates', description: 'Reusable journal notes', icon: FileText },
] as const

interface SettingsDialogProps {
  symbols: SymbolMeta[]
  timezone: ChartTimezone
  onTimezoneChange: (timezone: ChartTimezone) => void
  syncFlags: ChartSyncFlags
  onSyncFlagsChange: (syncFlags: Partial<ChartSyncFlags>) => void
  onClose: () => void
}

interface SyncControl {
  flag: keyof ChartSyncFlags
  label: string
  description: string
  icon: LucideIcon
}

const SYNC_CONTROLS: readonly SyncControl[] = [
  { flag: 'crosshair', label: 'Crosshair', description: 'Share crosshair time and price across every chart.', icon: Crosshair },
  { flag: 'dateRange', label: 'Date range', description: 'Keep every chart centered on the same visible dates.', icon: CalendarRange },
  { flag: 'lockZoom', label: 'Zoom', description: 'Use the same horizontal zoom span on every chart.', icon: Lock },
]

function ChartSynchronizationSettings({ value, onChange }: { value: ChartSyncFlags; onChange: (syncFlags: Partial<ChartSyncFlags>) => void }): ReactElement {
  return (
    <section className="p-4 sm:p-6" aria-labelledby="chart-sync-title">
      <h2 id="chart-sync-title" className="text-xl font-semibold tracking-tight text-ink">Chart synchronization</h2>
      <p className="mt-2 max-w-2xl text-ui-body leading-5 text-muted">Choose which interactions stay linked across the workspace. Each setting applies immediately.</p>
      <div className="mt-6 divide-y divide-line border-y border-line">
        {SYNC_CONTROLS.map(({ flag, label, description, icon: Icon }) => (
          <div key={flag} className="flex min-h-16 items-center gap-3 py-3">
            <span className={`grid size-9 shrink-0 place-items-center rounded-control bg-surface-3 ${value[flag] ? 'text-active-bright' : 'text-muted'}`}><Icon size={16} /></span>
            <div className="min-w-0 flex-1"><h3 className="text-ui-body font-semibold text-ink">{label}</h3><p className="mt-0.5 text-ui-meta leading-4 text-dim">{description}</p></div>
            <button type="button" role="switch" aria-label={`Sync ${label.toLowerCase()} across charts`} aria-checked={value[flag]} onClick={() => onChange({ [flag]: !value[flag] })} className="group relative h-7 w-12 shrink-0 rounded-full bg-surface-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-active aria-checked:bg-active"><span className="absolute left-1 top-1 size-5 rounded-full bg-white transition-transform group-aria-checked:translate-x-5" /></button>
          </div>
        ))}
      </div>
    </section>
  )
}

function trapFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab') return
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
  if (items.length === 0) return
  const first = items[0]
  const last = items.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

export function SettingsDialog({ symbols, timezone, onTimezoneChange, syncFlags, onSyncFlagsChange, onClose }: SettingsDialogProps): ReactElement {
  const [section, setSection] = useState<SettingsSection>('execution')
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => { dialogRef.current?.focus() }, [])

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/70 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title" tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); return }; trapFocus(event) }} className="flex h-[96dvh] w-full flex-col overflow-hidden rounded-t-panel border border-line-strong bg-[#101114] shadow-overlay outline-none sm:h-[min(54rem,calc(100dvh-2rem))] sm:w-[min(88rem,calc(100vw-2rem))] sm:rounded-panel">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-control bg-surface-3 text-ink"><Settings2 size={16} /></span><div className="min-w-0"><h1 id="workspace-settings-title" className="text-ui-title font-semibold text-ink">Workspace settings</h1><p className="truncate text-ui-meta text-dim">Timezone, replay costs, journal structure and session archive</p></div></div>
          <button type="button" onClick={onClose} className="tool-button" aria-label="Close workspace settings"><X size={17} /></button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav aria-label="Settings sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface-0/55 p-2 [scrollbar-width:none] md:w-64 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:p-3">
            {NAV_ITEMS.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setSection(item.id)} aria-current={section === item.id ? 'page' : undefined} className="flex min-h-11 shrink-0 items-center gap-3 rounded-control px-3 text-left text-ui-body text-muted transition-colors hover:bg-surface-2 hover:text-ink aria-[current=page]:bg-surface-3 aria-[current=page]:text-ink md:w-full"><Icon size={16} className={section === item.id ? 'text-active-bright' : 'text-dim'} /><span><strong className="block whitespace-nowrap font-medium">{item.label}</strong><small className="hidden text-ui-meta font-normal text-dim md:block">{item.description}</small></span></button> })}
          </nav>
          <main className="min-h-0 flex-1 overflow-y-auto bg-[#121316]" id={`settings-panel-${section}`} role="tabpanel">
            {section === 'charts' ? <ChartSynchronizationSettings value={syncFlags} onChange={onSyncFlagsChange} /> : null}
            {section === 'timezone' ? <TimezoneSettings value={timezone} onChange={onTimezoneChange} /> : null}
            {section === 'execution' ? <ExecutionSettings symbols={symbols} /> : null}
            {section === 'tags' ? <TagsSettings /> : null}
            {section === 'deleted' ? <DeletedSessionsSettings /> : null}
            {section === 'templates' ? <TemplatesSettings /> : null}
          </main>
        </div>
      </div>
    </div>,
    document.body,
  )
}
