import { LayoutDashboard, Minus, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useChartWorkspace } from '../../chart-workspace/use-chart-workspace'
import { createPane, LAYOUT_TEMPLATES, paneIds, type LayoutTemplateNode } from '../../chart-workspace/layout-presets'
import { deleteSavedLayout, loadSavedLayouts, saveNamedLayout, type SavedChartLayout } from '../../chart-workspace/saved-layouts'
import { useDismissableLayer } from '../../hooks/use-dismissable-layer'
import { DEFAULT_CHART_PANE_SETTINGS } from '../../replay/chart-settings-store'

interface PreviewRect { x: number; y: number; width: number; height: number }

function templateRects(node: LayoutTemplateNode, x = 0, y = 0, width = 24, height = 20, result: PreviewRect[] = []): PreviewRect[] {
  if (typeof node === 'number') {
    result.push({ x, y, width, height })
    return result
  }
  if (node.orientation === 'horizontal') {
    const firstWidth = width * node.ratio
    templateRects(node.first, x, y, firstWidth, height, result)
    templateRects(node.second, x + firstWidth, y, width - firstWidth, height, result)
  } else {
    const firstHeight = height * node.ratio
    templateRects(node.first, x, y, width, firstHeight, result)
    templateRects(node.second, x, y + firstHeight, width, height - firstHeight, result)
  }
  return result
}

function LayoutPreview({ root }: { root: LayoutTemplateNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 20" className="h-5 w-6 overflow-visible" fill="none">
      {templateRects(root).map((rect, index) => (
        <rect key={index} x={rect.x + 0.75} y={rect.y + 0.75} width={Math.max(0.5, rect.width - 1.5)} height={Math.max(0.5, rect.height - 1.5)} rx="0.7" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}

const PRESET_GROUPS = Array.from({ length: 8 }, (_, index) => {
  const count = index + 1
  return { count, templates: LAYOUT_TEMPLATES.filter((template) => template.count === count) }
})

interface LayoutMenuProps {
  openRequest?: number
}

export function LayoutMenu({ openRequest = 0 }: LayoutMenuProps) {
  const { state, dispatch, setPreset, loadLayout } = useChartWorkspace()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedChartLayout[]>(() => loadSavedLayouts())
  const layerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const ids = paneIds(state.root)

  const addChart = (): void => {
    const active = state.panes[state.activePaneId]
    let index = 1
    while (state.panes[`pane-${index}`]) index += 1
    dispatch({ type: 'add-pane', pane: createPane(`pane-${index}`, active?.timeframe ?? '1m', active?.settings ?? DEFAULT_CHART_PANE_SETTINGS, active?.symbol ?? null) })
  }

  useEffect(() => {
    if (openRequest <= 0) return
    setSaved(loadSavedLayouts())
    setOpen(true)
  }, [openRequest])

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
        <div role="dialog" aria-label="Chart layouts" className="fixed inset-x-2 top-12 z-[90] max-h-[calc(100dvh-3.5rem)] overflow-y-auto rounded-panel border border-line-strong bg-surface-1 shadow-overlay sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-[min(27rem,calc(100vw-1rem))]">
          <h2 className="sr-only">Chart layout</h2>
          <div aria-label="Layout presets" className="divide-y divide-line px-2">
            {PRESET_GROUPS.map(({ count, templates }) => (
              <div key={count} role="group" aria-label={`${count} chart layout${count === 1 ? '' : 's'}`} className="flex min-h-10 items-center gap-2 py-1.5">
                <span aria-hidden="true" className="w-3 shrink-0 text-center font-mono text-ui-meta tabular-nums text-dim">{count}</span>
                <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => { setPreset(template.id); setOpen(false) }}
                      aria-label={template.label}
                      aria-pressed={state.preset === template.id}
                      title={template.label}
                      className="grid size-11 shrink-0 place-items-center rounded-control border border-transparent text-muted transition-[color,background-color,border-color] duration-100 hover:border-line-strong hover:bg-surface-3 hover:text-ink focus-visible:z-10 sm:size-8 aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface-0"
                    >
                      <LayoutPreview root={template.root} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5 border-t border-line p-2.5">
            <button type="button" onClick={addChart} className="secondary-button flex-1"><Plus size={14} />Add chart</button>
            <button type="button" disabled={ids.length <= 1} onClick={() => dispatch({ type: 'remove-pane', paneId: state.activePaneId })} className="secondary-button flex-1"><Minus size={14} />Remove active</button>
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
