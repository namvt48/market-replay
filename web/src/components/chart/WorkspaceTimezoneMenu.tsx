import { Check, ChevronDown, Clock3 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useChartWorkspace } from '../../chart-workspace/use-chart-workspace'
import { useDismissableLayer } from '../../hooks/use-dismissable-layer'
import { timezoneLabel, type ChartTimezonePreset } from '../../replay/chart-timezone'

const PRESETS: readonly ChartTimezonePreset[] = ['ET', 'CT', 'MT', 'PT', 'UTC']
const OFFSETS = Array.from({ length: 53 }, (_, index) => -720 + index * 30)

export function WorkspaceTimezoneMenu(): ReactElement {
  const { state, dispatch } = useChartWorkspace()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useDismissableLayer({ open, layerRef: menuRef, onDismiss: () => setOpen(false) })
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus()
  }, [open])

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 items-center gap-1.5 rounded-control px-2 text-ui-control font-medium text-muted transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-active"
        aria-label={`Workspace timezone: ${timezoneLabel(state.timezone)}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Clock3 size={15} strokeWidth={1.7} />
        <span>{timezoneLabel(state.timezone)}</span>
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" aria-label="Workspace timezone" className="absolute right-0 top-9 z-[90] w-64 overflow-hidden rounded-panel border border-line-strong bg-[#111214] shadow-overlay">
          <div className="border-b border-line px-3 py-2.5">
            <strong className="block text-ui-body font-semibold text-ink">Workspace timezone</strong>
            <span className="mt-0.5 block text-ui-meta leading-relaxed text-dim">Charts, calendar, trades and analytics use one clock.</span>
          </div>
          <div className="p-1.5">
            {PRESETS.map((preset) => {
              const selected = state.timezone.kind === 'preset' && state.timezone.id === preset
              return (
                <button key={preset} type="button" role="menuitemradio" aria-checked={selected} onClick={() => { dispatch({ type: 'set-timezone', timezone: { kind: 'preset', id: preset } }); setOpen(false) }} className="flex h-8 w-full items-center justify-between rounded-control px-2.5 text-left text-ui-control text-muted hover:bg-surface-2 hover:text-ink focus-visible:bg-surface-2 focus-visible:text-ink">
                  <span>{preset}</span>{selected ? <Check size={14} className="text-active-bright" /> : null}
                </button>
              )
            })}
          </div>
          <label className="block border-t border-line p-3 text-ui-meta font-medium text-muted">
            Fixed UTC offset
            <select aria-label="Workspace fixed UTC offset" value={state.timezone.kind === 'offset' ? state.timezone.minutes : ''} onChange={(event) => { if (event.target.value === '') return; dispatch({ type: 'set-timezone', timezone: { kind: 'offset', minutes: Number(event.target.value) } }); setOpen(false) }} className="field-input mt-1.5 h-9 w-full">
              <option value="">Choose offset</option>
              {OFFSETS.map((minutes) => <option key={minutes} value={minutes}>{timezoneLabel({ kind: 'offset', minutes })}</option>)}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  )
}
