import { useCallback, type ReactElement } from 'react'
import type { AnalyticsSource } from '../../api/analytics'
import { fetchAnalyticsSources } from '../../api/analytics'
import { evaluationDisplayName } from '../../sources/source-name'
import { loadEvalAccounts, type SavedEvalAccount } from '../../store/eval-store'
import { useAnalyticsResource } from './use-analytics-resource'

function evalStatus(account: SavedEvalAccount | null): string {
  if (!account) return 'SAVED'
  if (account.runtime.outcome === 'passed' || account.phase === 'passed') return 'PASSED'
  if (account.runtime.outcome === 'failed' || account.phase === 'failed') return 'FAILED'
  if (account.phase === 'ready') return 'READY'
  return 'IN PROGRESS'
}

function statusTone(status: string): string {
  if (status === 'PASSED' || status === 'ACTIVE') return 'text-profit-bright'
  if (status === 'FAILED' || status === 'STOPPED') return 'text-loss-bright'
  if (status === 'IN PROGRESS') return 'text-active-bright'
  return 'text-muted'
}

function sourceContext(source: AnalyticsSource): string {
  if (source.tradeCount === 0) return ''
  return source.subtitle.replace(/\s*·\s*\d+ closed trades$/, '')
}

interface SourceGroupProps {
  label: string
  countLabel: string
  sources: AnalyticsSource[]
  evalAccounts: Map<string, SavedEvalAccount>
}

function SourceGroup({ label, countLabel, sources, evalAccounts }: SourceGroupProps): ReactElement | null {
  if (sources.length === 0) return null
  const headingId = `analytics-${label.toLowerCase().replaceAll(' ', '-')}`
  return (
    <section aria-labelledby={headingId} className="overflow-hidden border border-line-strong bg-surface-0/35">
      <div className="flex min-h-10 items-center justify-between border-b border-line bg-surface-2/60 px-3">
        <h3 id={headingId} className="text-ui-body font-semibold text-ink">{label}</h3>
        <span className="text-ui-meta text-dim">{sources.length} {countLabel}{sources.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="divide-y divide-line">
        {sources.map((source) => {
          const account = source.type === 'evaluation' ? evalAccounts.get(source.id) ?? null : null
          const name = account ? evaluationDisplayName(account) : source.title
          const status = source.type === 'evaluation' ? (account ? evalStatus(account) : source.status.toUpperCase()) : source.status.toUpperCase()
          const type = source.type === 'evaluation' ? 'Evaluation' : source.type === 'live' ? 'Live account' : 'Replay session'
          const context = sourceContext(source)
          return (
            <li key={`${source.type}-${source.id}`}>
              <a
                href={`/?analytics=${encodeURIComponent(source.id)}&sourceType=${source.type}`}
                className="group block min-h-16 px-3 py-2.5 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
                aria-label={`Open ${type.toLowerCase()} ${name} analytics`}
              >
                <span className="flex items-center justify-between gap-3">
                  <strong className="min-w-0 truncate text-ui-body font-semibold text-ink transition-colors group-hover:text-white">{name}</strong>
                  <span className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${statusTone(status)}`}>{status}</span>
                </span>
                <span className="mt-1 block text-ui-meta text-dim">{source.tradeCount} trades{context ? ` · ${context}` : ''}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function AnalyticsPanel() {
  const load = useCallback((signal: AbortSignal) => fetchAnalyticsSources(signal), [])
  const sources = useAnalyticsResource(true, load)
  const evalAccounts = new Map(loadEvalAccounts().flatMap((account) => account.sessionId ? [[account.sessionId, account] as const] : []))
  const grouped = sources.status === 'success'
    ? {
        evaluations: sources.data.filter((source) => source.type === 'evaluation'),
        sessions: sources.data.filter((source) => source.type === 'session'),
        live: sources.data.filter((source) => source.type === 'live'),
      }
    : { evaluations: [], sessions: [], live: [] }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-11 shrink-0 items-center border-b border-line px-3">
        <h2 className="text-ui-body font-semibold text-ink">Analytics</h2>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {sources.status === 'loading' || sources.status === 'idle' ? <p className="py-8 text-center text-ui-meta text-dim">Loading reports…</p> : null}
        {sources.status === 'error' ? <div className="border-y border-loss/40 py-4 text-ui-meta text-ink"><p>Unable to load analytics reports.</p><button type="button" onClick={() => window.location.reload()} className="mt-2 text-active-bright underline-offset-4 hover:underline">Retry</button></div> : null}
        {sources.status === 'success' && sources.data.length === 0 ? <div className="border-y border-dashed border-line-strong py-8 text-center"><strong className="text-ui-body text-ink">No reports yet</strong><p className="mt-1 text-ui-meta leading-5 text-dim">Complete trades in an evaluation or replay session to generate analytics.</p></div> : null}
        {sources.status === 'success' ? <>
          <SourceGroup label="Eval accounts" countLabel="account" sources={grouped.evaluations} evalAccounts={evalAccounts} />
          <SourceGroup label="Replay sessions" countLabel="session" sources={grouped.sessions} evalAccounts={evalAccounts} />
          <SourceGroup label="Live accounts" countLabel="account" sources={grouped.live} evalAccounts={evalAccounts} />
        </> : null}
      </div>
    </div>
  )
}
