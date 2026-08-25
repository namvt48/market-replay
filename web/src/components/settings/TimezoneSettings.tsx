import { Check, Clock3 } from 'lucide-react'
import type { ReactElement } from 'react'
import { timezoneLabel, type ChartTimezone, type ChartTimezonePreset } from '../../replay/chart-timezone'

const PRESETS: ReadonlyArray<{ id: ChartTimezonePreset; city: string }> = [
  { id: 'ET', city: 'New York' },
  { id: 'CT', city: 'Chicago' },
  { id: 'MT', city: 'Denver' },
  { id: 'PT', city: 'Los Angeles' },
  { id: 'UTC', city: 'Coordinated Universal Time' },
]
const OFFSETS = Array.from({ length: 53 }, (_, index) => -720 + index * 30)

interface TimezoneSettingsProps {
  value: ChartTimezone
  onChange: (timezone: ChartTimezone) => void
}

export function TimezoneSettings({ value, onChange }: TimezoneSettingsProps): ReactElement {
  return (
    <section aria-labelledby="timezone-settings-title" className="mx-auto w-full max-w-4xl p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl">
        <p className="text-ui-meta font-semibold uppercase tracking-[0.08em] text-active-bright">Display clock</p>
        <h2 id="timezone-settings-title" className="mt-1 text-xl font-semibold tracking-tight text-ink">Workspace timezone</h2>
        <p className="mt-2 text-ui-body leading-relaxed text-muted">Charts, performance calendar, trade timestamps and analytics use this timezone together.</p>
      </div>

      <fieldset className="mt-7">
        <legend className="text-ui-meta font-semibold uppercase tracking-[0.06em] text-dim">Market presets</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PRESETS.map((preset) => {
            const selected = value.kind === 'preset' && value.id === preset.id
            return (
              <button key={preset.id} type="button" role="radio" aria-checked={selected} onClick={() => onChange({ kind: 'preset', id: preset.id })} className="flex min-h-16 items-center gap-3 rounded-panel border border-line-strong bg-surface-0/45 px-4 text-left transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-active aria-checked:border-active aria-checked:bg-active/8">
                <span className={`grid size-8 shrink-0 place-items-center rounded-control ${selected ? 'bg-active text-white' : 'bg-surface-3 text-dim'}`}>{selected ? <Check size={15} /> : <Clock3 size={15} />}</span>
                <span className="min-w-0"><strong className="block text-ui-control font-semibold text-ink">{preset.id}</strong><small className="block truncate text-ui-meta text-dim">{preset.city}</small></span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="mt-7 border-t border-line pt-6">
        <label className="block max-w-md text-ui-body font-medium text-ink">Fixed UTC offset
          <span className="mt-1 block text-ui-meta font-normal leading-relaxed text-dim">Use a fixed offset when your workflow should not follow daylight-saving changes.</span>
          <select aria-label="Workspace fixed UTC offset" value={value.kind === 'offset' ? value.minutes : ''} onChange={(event) => { if (event.target.value !== '') onChange({ kind: 'offset', minutes: Number(event.target.value) }) }} className="field-input mt-3 h-10 w-full">
            <option value="">Choose an offset</option>
            {OFFSETS.map((minutes) => <option key={minutes} value={minutes}>{timezoneLabel({ kind: 'offset', minutes })}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-7 flex items-center gap-3 rounded-control border border-line bg-surface-2/55 px-4 py-3"><Clock3 size={16} className="shrink-0 text-active-bright" /><p className="text-ui-body text-muted">Current workspace time: <strong className="font-mono font-semibold text-ink">{timezoneLabel(value)}</strong></p></div>
    </section>
  )
}
