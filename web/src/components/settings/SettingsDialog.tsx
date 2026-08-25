import { Archive, Clock3, FileText, Settings2, Tags, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { SymbolMeta } from '../../api/types'
import type { ChartTimezone } from '../../replay/chart-timezone'
import { DeletedSessionsSettings } from './DeletedSessionsSettings'
import { ExecutionSettings } from './ExecutionSettings'
import { TagsSettings } from './TagsSettings'
import { TemplatesSettings } from './TemplatesSettings'
import { TimezoneSettings } from './TimezoneSettings'

type SettingsSection = 'timezone' | 'execution' | 'tags' | 'deleted' | 'templates'

const NAV_ITEMS = [
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
  onClose: () => void
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

export function SettingsDialog({ symbols, timezone, onTimezoneChange, onClose }: SettingsDialogProps): ReactElement {
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
