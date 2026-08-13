/*
 * THESIS: Indicators are a compact workstation library, not a generic app-store grid.
 * OWN-WORLD: Flat graphite registry rows, sparse blue state, Roboto labels and mono study codes.
 * STORY: Find a study, understand its chart role, add it, then return directly to analysis.
 * FIRST VIEWPORT: Search and active count lead; grouped studies fill one scan-friendly column.
 * FORM: Local Replay Desk extension; concept seeding is intentionally not applicable.
 */
import { Check, ChartSpline, LoaderCircle, Plus, RefreshCw, Search, X } from 'lucide-react'
import { useMemo, useRef, useState, type ReactElement } from 'react'
import type { IndicatorDescriptor } from '../../api/types'
import { useDismissableLayer } from '../../hooks/use-dismissable-layer'
import { replayEngine } from '../../replay/replay-engine'
import { useReplaySelector } from '../../replay/use-replay'
import { getIndicatorPresentation, INDICATOR_FAMILY_ORDER, indicatorMatchesQuery } from './indicator-presentation'
import { retryIndicatorCatalog, useIndicatorCatalog } from './use-indicator-catalog'

interface IndicatorGroup {
  family: string
  descriptors: IndicatorDescriptor[]
}

function groupIndicators(descriptors: IndicatorDescriptor[], query: string): IndicatorGroup[] {
  const matches = descriptors.filter((descriptor) => indicatorMatchesQuery(descriptor, query))
  return INDICATOR_FAMILY_ORDER.flatMap((family) => {
    const familyDescriptors = matches.filter((descriptor) => getIndicatorPresentation(descriptor).family === family)
    return familyDescriptors.length > 0 ? [{ family, descriptors: familyDescriptors }] : []
  })
}

export function IndicatorMenu(): ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const layerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const catalog = useIndicatorCatalog()
  const active = useReplaySelector((snapshot) => ({ indicators: snapshot.indicators, loading: snapshot.indicatorLoading, error: snapshot.indicatorError }))
  const activeScriptIds = useMemo(() => new Set((active.indicators ?? []).map((indicator) => indicator.scriptId)), [active.indicators])
  const activeIndicators = active.indicators ?? []
  const groups = useMemo(() => groupIndicators(catalog.descriptors, query), [catalog.descriptors, query])
  const resultCount = groups.reduce((total, group) => total + group.descriptors.length, 0)

  useDismissableLayer({
    open,
    layerRef,
    onDismiss: (reason) => {
      setOpen(false)
      if (reason === 'escape') queueMicrotask(() => triggerRef.current?.focus())
    },
  })

  const toggleOpen = (): void => {
    setOpen((current) => {
      if (!current) queueMicrotask(() => searchRef.current?.focus())
      return !current
    })
  }

  const addIndicator = (descriptor: IndicatorDescriptor): void => {
    replayEngine.addIndicator(descriptor)
    setOpen(false)
    setQuery('')
    queueMicrotask(() => triggerRef.current?.focus())
  }

  return (
    <div ref={layerRef} className="relative shrink-0">
      <button ref={triggerRef} type="button" onClick={toggleOpen} aria-label="Indicators" aria-expanded={open} aria-haspopup="dialog" className="flex h-8 items-center gap-1.5 rounded-control px-2 text-ui-control font-medium text-muted transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-active">
        {active.loading ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <ChartSpline size={15} strokeWidth={1.75} />}
        <span className="hidden xl:inline">Indicators</span>
        {activeIndicators.length > 0 ? <span className="min-w-4 rounded-control bg-surface-3 px-1 font-mono text-ui-meta text-active-bright" aria-label={`${activeIndicators.length} active indicators`}>{activeIndicators.length}</span> : null}
      </button>

      {open ? (
        <div role="dialog" aria-labelledby="indicator-library-title" className="fixed inset-x-2 top-12 z-[95] overflow-hidden rounded-panel border border-line-strong bg-surface-1 shadow-overlay sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-[28rem]">
          <header className="flex items-start justify-between gap-3 border-b border-line px-3 py-3">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h2 id="indicator-library-title" className="text-ui-title font-semibold text-ink">Indicator library</h2>
                {catalog.status === 'ready' ? <span className="font-mono text-ui-meta text-dim">{catalog.descriptors.length} studies</span> : null}
              </div>
              <p className="mt-0.5 text-ui-meta text-dim">Studies apply to every visible chart in this replay session.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="tool-button shrink-0" aria-label="Close indicator library"><X size={15} /></button>
          </header>

          {catalog.status === 'ready' ? (
            <div className="border-b border-line p-2.5">
              <label className="relative block">
                <span className="sr-only">Search indicators</span>
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
                <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, family or purpose" className="field h-9 w-full pl-8 pr-3 text-ui-body" />
              </label>
            </div>
          ) : null}

          {catalog.status === 'loading' || catalog.status === 'idle' ? <div className="flex items-center gap-2 px-3 py-6 text-ui-body text-muted"><LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />Loading indicator library…</div> : null}
          {catalog.status === 'error' ? <div className="p-3"><p role="alert" className="text-ui-body text-loss-bright">{catalog.error}</p><button type="button" onClick={retryIndicatorCatalog} className="secondary-button mt-3"><RefreshCw size={14} />Retry loading</button></div> : null}

          {catalog.status === 'ready' ? (
            <div className="max-h-[min(34rem,calc(100dvh-8rem))] overflow-y-auto py-1">
              {groups.map((group) => {
                const familyId = `indicator-family-${group.family.replaceAll(' ', '-').toLowerCase()}`
                return (
                  <section key={group.family} aria-labelledby={familyId}>
                    <div className="sticky top-0 z-10 flex h-7 items-center justify-between border-y border-line bg-surface-1 px-3 first:border-t-0">
                      <h3 id={familyId} className="text-ui-meta font-semibold text-muted">{group.family}</h3>
                      <span className="font-mono text-ui-meta text-dim">{group.descriptors.length}</span>
                    </div>
                    <ul>
                      {group.descriptors.map((descriptor) => {
                        const presentation = getIndicatorPresentation(descriptor)
                        const Icon = presentation.icon
                        const added = activeScriptIds.has(descriptor.id)
                        const groupCount = new Set(descriptor.inputs.map((input) => input.group || 'Inputs')).size
                        return (
                          <li key={descriptor.id} className="border-b border-line/70 last:border-b-0">
                            <button type="button" disabled={added} onClick={() => addIndicator(descriptor)} className="group flex min-h-[4.25rem] w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2 disabled:cursor-default disabled:bg-transparent">
                              <span className="grid size-9 shrink-0 place-items-center rounded-control bg-surface-0 text-muted ring-1 ring-inset ring-line group-hover:text-active-bright group-disabled:text-dim"><Icon size={16} strokeWidth={1.65} /></span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2"><span className="truncate text-ui-control font-medium text-ink">{descriptor.name}</span><span className="shrink-0 font-mono text-ui-meta text-dim">{presentation.code}</span></span>
                                <span className="mt-0.5 block truncate text-ui-meta text-muted">{presentation.summary}</span>
                                <span className="mt-0.5 block text-ui-meta text-dim">{descriptor.meta.onMainPanel ? 'Main chart' : 'Separate pane'} · {groupCount} {groupCount === 1 ? 'group' : 'groups'} · {descriptor.inputs.length} inputs</span>
                              </span>
                              <span className={`flex h-8 min-w-[3.75rem] shrink-0 items-center justify-center gap-1 rounded-control px-2 text-ui-meta font-semibold ${added ? 'text-muted' : 'border border-line text-active-bright group-hover:border-active'}`}>
                                {added ? <><Check size={13} />Added</> : <><Plus size={13} />Add</>}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}

              {catalog.descriptors.length === 0 ? <p className="px-3 py-8 text-center text-ui-body text-dim">No indicators are registered on the server.</p> : null}
              {catalog.descriptors.length > 0 && resultCount === 0 ? <div className="px-4 py-8 text-center"><p className="text-ui-body font-medium text-ink">No matching indicators</p><p className="mt-1 text-ui-meta text-dim">Try a study name such as “Fractals” or a family such as “Sessions”.</p></div> : null}
            </div>
          ) : null}

          {active.error ? <p role="alert" className="border-t border-line px-3 py-2 text-ui-meta text-loss-bright">Indicator calculation failed: {active.error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
