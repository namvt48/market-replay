import { Activity, AlertCircle, ArrowUpRight, BarChart3, BookOpen, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback } from 'react'
import { fetchAnalyticsSources } from '../../api/analytics'
import { useAnalyticsResource } from './use-analytics-resource'

export function AnalyticsPanel() {
  const load = useCallback((signal: AbortSignal) => fetchAnalyticsSources(signal), [])
  const sources = useAnalyticsResource(true, load)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-line px-3 py-3">
        <h2 className="text-ui-body font-semibold text-ink">Analytics</h2>
        <p className="mt-0.5 text-ui-meta text-dim">Open a replay session or evaluation in a focused report.</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-2 text-ui-meta font-semibold tracking-[0.04em] text-muted">AVAILABLE REPORTS</p>
        <ul className="space-y-2">
          {sources.status === 'loading' || sources.status === 'idle' ? <li className="flex min-h-20 items-center justify-center gap-2 text-ui-meta text-dim"><LoaderCircle size={14} className="animate-spin" />Loading sources…</li> : null}
          {sources.status === 'error' ? <li className="rounded-panel border border-loss/40 bg-loss/10 p-3 text-ui-meta text-ink"><p className="flex items-center gap-2"><AlertCircle size={14} className="text-loss-bright" />Unable to load analytics sources.</p><button type="button" onClick={() => window.location.reload()} className="mt-2 inline-flex items-center gap-1.5 text-active-bright"><RefreshCw size={12} />Retry</button></li> : null}
          {sources.status === 'success' && sources.data.length === 0 ? <li className="rounded-panel border border-dashed border-line-strong px-4 py-8 text-center"><strong className="text-ui-body text-ink">No analytics sources yet</strong><p className="mt-1 text-ui-meta leading-5 text-dim">Complete trades in a replay session or evaluation account to generate analytics.</p></li> : null}
          {sources.status === 'success' ? sources.data.map((source) => {
            const Icon = source.type === 'session' ? BookOpen : Activity
            return (
              <li key={`${source.type}-${source.id}`}>
                <a
                  href={`/?analytics=${encodeURIComponent(source.id)}&sourceType=${source.type}`}
                  className="group flex min-h-16 w-full items-center gap-3 rounded-panel border border-line bg-surface-0 px-3 py-2.5 transition-colors hover:border-line-strong hover:bg-surface-2"
                  aria-label={`Open ${source.title} analytics`}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-control bg-active/15 text-active-bright"><Icon size={17} /></span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-ui-body font-medium text-ink">{source.title}</strong>
                    <span className="mt-0.5 flex items-center gap-1.5 text-ui-meta text-dim"><BarChart3 size={12} />{source.type === 'session' ? 'Replay session' : 'Evaluation account'} · {source.tradeCount} trades</span>
                  </span>
                  <ArrowUpRight size={16} className="shrink-0 text-dim transition-colors group-hover:text-ink" />
                </a>
              </li>
            )
          }) : null}
        </ul>
      </div>
    </div>
  )
}
