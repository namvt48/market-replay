import { ArrowLeft, NotebookPen, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSession, fetchSessions, patchSession } from '../../api/client'
import type { ReplaySession } from '../../api/types'
import { fetchAnalyticsPerformance, fetchAnalyticsSources } from '../../api/analytics'
import type { AnalyticsPerformance, AnalyticsSource } from '../../api/analytics'
import { createLiveTemplate, loadLiveTemplates } from '../../store/live-store'
import type { LiveTemplate } from '../../store/live-store'
import { LiveJournalDetail } from './LiveJournalDetail'
import { TemplateEditor } from './TemplateEditor'
import { JournalComposer } from './JournalComposer'
import { PerformanceCalendar } from '../analytics/PerformanceCalendar'
import { mergeLiveCalendars, type AccountStage, type LiveCalendarReport } from './live-calendar'

const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

// Default $10,000 starting balance, matching the live journal default.
const DEFAULT_BALANCE_CENTS = 1_000_000

export function LiveAccountsScreen() {
  const [sessions, setSessions] = useState<ReplaySession[]>([])
  const [sources, setSources] = useState<AnalyticsSource[]>([])
  const [reports, setReports] = useState<LiveCalendarReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<LiveTemplate[]>(() => loadLiveTemplates())
  const [editorOpen, setEditorOpen] = useState(false)
  const [composerTarget, setComposerTarget] = useState<{ sessionId: string; templateId: string } | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [allSources, allSessions] = await Promise.all([fetchAnalyticsSources(), fetchSessions()])
      const live = allSessions.filter((session) => session.kind === 'live')
      const settled = await Promise.allSettled(live.map((session) => fetchAnalyticsPerformance('live', session.id, 5, 'UTC')))
      setSessions(live)
      setSources(allSources)
      setReports(settled
        .filter((result): result is PromiseFulfilledResult<AnalyticsPerformance> => result.status === 'fulfilled')
        .map((result) => result.value))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const rows = useMemo(() => sessions.map((session) => {
    const source = sources.find((candidate) => candidate.id === session.id)
    const report = reports.find((candidate) => candidate.source.id === session.id)
    const stage: AccountStage = session.config?.stage === 'funded' ? 'funded' : 'eval'
    return { session, source, report, stage }
  }), [sessions, sources, reports])

  const calendar = useMemo(() => mergeLiveCalendars(reports), [reports])

  const selected = useMemo(() => sessions.find((session) => session.id === selectedId) ?? null, [sessions, selectedId])

  const handleCreate = async () => {
    const name = draftName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      await createSession('LIVE', '1d', Math.floor(Date.now() / 1000), {
        kind: 'live',
        initialBalanceCents: DEFAULT_BALANCE_CENTS,
        name,
      })
      setDraftName('')
      setDraftOpen(false)
      await refresh()
    } finally {
      setCreating(false)
    }
  }

  const handleToggleStage = async (session: ReplaySession, next: AccountStage) => {
    await patchSession(session.id, { config: { ...(session.config ?? {}), stage: next } })
    await refresh()
  }

  return (
    <div className="min-h-dvh bg-surface-0 text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-[#101114]/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <a href="/" className="tool-button grid size-9 shrink-0 place-items-center rounded-control" aria-label="Back to workspace" title="Back to workspace">
            <ArrowLeft size={16} />
          </a>
          <h1 className="flex min-w-0 items-center gap-2 text-ui-title font-semibold tracking-[-0.015em] text-ink">
            <NotebookPen size={17} strokeWidth={1.75} />Live accounts
          </h1>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button type="button" className="primary-button gap-1.5" aria-label="Create live account" onClick={() => setDraftOpen((open) => !open)} aria-expanded={draftOpen}>
              <Plus size={14} /> Account
            </button>
            <button type="button" className="secondary-button gap-1.5" aria-label="Create stats template" onClick={() => { createLiveTemplate('Untitled stats template'); setTemplates(loadLiveTemplates()); setEditorOpen(true) }}>
              <Plus size={14} /> Template
            </button>
          </div>
        </div>
        {draftOpen && (
          <div className="border-t border-line bg-[#0b0d10]">
            <form className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3" onSubmit={(event) => { event.preventDefault(); void handleCreate() }}>
              <label className="contents">
                <span className="sr-only">Account name</span>
                <input className="field-input h-9 min-w-0 flex-1" placeholder="Account name" value={draftName} onChange={(event) => setDraftName(event.target.value)} autoFocus />
              </label>
              <button type="submit" className="primary-button h-9" disabled={creating || !draftName.trim()}>{creating ? 'Creating…' : 'Create'}</button>
              <button type="button" className="secondary-button h-9" onClick={() => { setDraftOpen(false); setDraftName('') }}>Cancel</button>
            </form>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        {loading ? (
          <div role="status" className="grid place-items-center py-24 text-ui-body text-dim">Loading accounts…</div>
        ) : error ? (
          <div role="alert" className="grid place-items-center gap-3 py-24 text-ui-body text-muted">
            <p>{error}</p>
            <button type="button" className="secondary-button h-9" onClick={() => void refresh()}>Retry</button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="grid place-items-center py-24 text-center">
            <div>
              <NotebookPen size={28} className="mx-auto text-dim" />
              <p className="mt-3 text-ui-body text-muted">No live accounts yet — create one with a name above.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-10">
            <section aria-label="Accounts">
              <h2 className="mb-3 text-ui-title font-semibold text-ink">Accounts</h2>
              <ul className="space-y-1">
                {rows.map(({ session, source, report, stage }) => (
                  <li key={session.id}>
                    <div className="flex min-h-12 w-full items-center gap-2 rounded-control border border-line bg-surface-0 px-3">
                      <button type="button" onClick={() => setSelectedId(session.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left">
                        <span className="min-w-0 flex-1 truncate text-ui-body font-medium text-ink">{session.name || 'Live account'}</span>
                        <span className="shrink-0 text-ui-meta text-muted">{source?.tradeCount ?? 0} trades</span>
                        {report ? (
                          <span className={`shrink-0 font-mono text-ui-meta font-medium tabular-nums ${report.overview.totalPnl >= 0 ? 'text-profit-bright' : 'text-loss-bright'}`}>
                            {dollars.format(report.overview.totalPnl)}
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleStage(session, stage === 'eval' ? 'funded' : 'eval')}
                        aria-label={`Mark ${session.name || 'account'} ${stage === 'eval' ? 'funded' : 'eval'}`}
                        className={`shrink-0 rounded-control px-2 py-1 font-mono text-ui-meta font-semibold transition-colors ${stage === 'eval' ? 'bg-[#f59e0b]/15 text-[#fbbf24] hover:bg-[#f59e0b]/25' : 'bg-[#10b981]/15 text-[#34d399] hover:bg-[#10b981]/25'}`}
                      >
                        {stage === 'eval' ? 'EVAL' : 'FUNDED'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-label="Performance calendar">
              <h2 className="mb-3 text-ui-title font-semibold text-ink">Performance</h2>
              <PerformanceCalendar entries={calendar.entries} initialDate={calendar.initialDate} />
            </section>
          </div>
        )}
      </main>

      {selected && (
        <LiveJournalDetail
          sessionId={selected.id}
          title={selected.name || 'Live account'}
          onClose={() => setSelectedId(null)}
          onChanged={() => void refresh()}
          templates={templates}
          onCompose={(templateId) => { if (selectedId) setComposerTarget({ sessionId: selectedId, templateId }) }}
        />
      )}

      {composerTarget && selected && (
        <JournalComposer
          sessionId={composerTarget.sessionId}
          title={selected.name || 'Live account'}
          templateId={composerTarget.templateId}
          onClose={() => setComposerTarget(null)}
        />
      )}

      {editorOpen && <TemplateEditor onClose={() => setEditorOpen(false)} />}
    </div>
  )
}