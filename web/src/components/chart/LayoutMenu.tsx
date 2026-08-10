import { Columns2, Grid2X2, LayoutDashboard, LayoutPanelTop, Minus, Plus, Rows2, Rows3, Save, Trash2 } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { useChartWorkspace } from '../../chart-workspace/use-chart-workspace'
import { paneIds } from '../../chart-workspace/layout-presets'
import { deleteSavedLayout, loadSavedLayouts, saveNamedLayout, type SavedChartLayout } from '../../chart-workspace/saved-layouts'
import type { LayoutPreset } from '../../chart-workspace/types'
import { useDismissableLayer } from '../../hooks/use-dismissable-layer'

const PRESETS: Array<{ id: LayoutPreset; label: string; icon: typeof LayoutPanelTop }> = [
  { id: 'single', label: '1 chart', icon: LayoutPanelTop },
  { id: '2v', label: '2 charts vertical', icon: Columns2 },
  { id: '2h', label: '2 charts horizontal', icon: Rows2 },
  { id: '3', label: '3 charts', icon: Rows3 },
  { id: '4', label: '4 charts', icon: Grid2X2 },
]

export function LayoutMenu() {
  const { state, dispatch, setPreset, loadLayout } = useChartWorkspace()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedChartLayout[]>(() => loadSavedLayouts())
  const layerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const ids = paneIds(state.root)
  const nextPreset: LayoutPreset = ids.length === 1 ? '2v' : ids.length === 2 ? '3' : '4'

  useDismissableLayer({
    open,
    layerRef,
    onDismiss: (reason) => {
      setOpen(false)
      if (reason === 'escape') queueMicrotask(() => triggerRef.current?.focus())
    },
  })

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    try {
      setSaved(saveNamedLayout(name, state))
      setName('')
      setError(null)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save layout')
    }
  }

  return (
    <div ref={layerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { setSaved(loadSavedLayouts()); setOpen((current) => !current) }}
        aria-label="Chart layouts"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="tool-button"
        title="Chart layouts"
      >
        <LayoutDashboard size={16} strokeWidth={1.7} />
      </button>
      {open ? (
        <div role="dialog" aria-label="Chart layouts" className="fixed inset-x-2 top-12 z-[90] overflow-hidden rounded-panel border border-line-strong bg-surface-1 shadow-overlay sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-[min(22rem,calc(100vw-1rem))]">
          <header className="flex h-10 items-center justify-between border-b border-line px-3">
            <div><h2 className="text-ui-title font-semibold text-ink">Chart layout</h2><p className="text-ui-meta text-dim">{ids.length} of 4 charts</p></div>
          </header>
          <div className="p-3">
            <div className="grid grid-cols-5 gap-1.5" aria-label="Layout presets">
              {PRESETS.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" onClick={() => { setPreset(id); setOpen(false) }} aria-label={label} aria-pressed={state.preset === id} className="grid h-12 place-items-center rounded-control border border-line text-muted transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink aria-pressed:border-active aria-pressed:bg-active/10 aria-pressed:text-active-bright">
                  <Icon size={18} strokeWidth={1.5} />
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              <button type="button" disabled={ids.length >= 4} onClick={() => setPreset(nextPreset)} className="secondary-button flex-1"><Plus size={14} />Add chart</button>
              <button type="button" disabled={ids.length <= 1} onClick={() => dispatch({ type: 'remove-pane', paneId: state.activePaneId })} className="secondary-button flex-1"><Minus size={14} />Remove active</button>
            </div>
          </div>

          <section className="border-t border-line">
            <div className="flex h-9 items-center justify-between px-3"><h3 className="text-ui-meta font-semibold text-muted">Saved layouts</h3><span className="font-mono text-ui-meta text-dim">{saved.length}</span></div>
            {saved.length > 0 ? (
              <ul className="max-h-44 overflow-y-auto border-y border-line">
                {saved.map((layout) => (
                  <li key={layout.id} className="group flex items-center gap-2 px-2 py-1.5 hover:bg-surface-2">
                    <button type="button" onClick={() => { loadLayout(layout.state); setOpen(false) }} className="min-w-0 flex-1 rounded-control px-1 py-1 text-left">
                      <span className="block truncate text-ui-body font-medium text-ink">{layout.name}</span>
                      <span className="block truncate font-mono text-ui-meta text-dim">{paneIds(layout.state.root).length} charts · {Object.values(layout.state.panes).map((pane) => pane.timeframe).join(' / ')}</span>
                    </button>
                    <button type="button" onClick={() => setSaved(deleteSavedLayout(layout.id))} className="grid size-8 shrink-0 place-items-center rounded-control text-dim opacity-60 hover:bg-loss/10 hover:text-loss-bright group-hover:opacity-100" aria-label={`Delete ${layout.name}`}><Trash2 size={13} /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="border-y border-line px-3 py-4 text-center text-ui-meta text-dim">Save the current arrangement, sizes, timeframes and chart settings.</p>}
            <form onSubmit={save} className="flex gap-1.5 p-3">
              <label className="sr-only" htmlFor="layout-name">Layout name</label>
              <input id="layout-name" value={name} onChange={(event) => { setName(event.target.value); setError(null) }} placeholder="Layout name" maxLength={40} className="field h-8 min-w-0 flex-1 px-2 text-ui-body" aria-invalid={error ? true : undefined} />
              <button type="submit" className="primary-button h-8 gap-1.5"><Save size={13} />Save</button>
            </form>
            {error ? <p role="alert" className="-mt-2 px-3 pb-3 text-ui-meta text-loss-bright">{error}</p> : null}
          </section>
        </div>
      ) : null}
    </div>
  )
}
