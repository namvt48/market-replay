import { ArrowLeft, BarChart3, NotebookPen, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSession, deleteSession, fetchSessions, fetchTrades, patchSession } from '../../api/client'
import type { ClosedTrade, ReplaySession } from '../../api/types'
import { fetchAnalyticsPerformance, fetchAnalyticsSources } from '../../api/analytics'
import type { AnalyticsPerformance, AnalyticsSource } from '../../api/analytics'
import { createLiveTemplate, loadLiveTemplates } from '../../store/live-store'
import type { LiveTemplate } from '../../store/live-store'
import { LiveJournalDetail, StatCard } from './LiveJournalDetail'
import { TemplateEditor } from './TemplateEditor'
import { JournalComposer } from './JournalComposer'
import { PerformanceCalendar } from '../analytics/PerformanceCalendar'
import { LineChart } from '../analytics/InteractiveAnalyticsCharts'
import { mergeLiveCalendars, type AccountStage, type LiveCalendarReport } from './live-calendar'
import { DetailDialog } from '../ui/DetailDialog'

const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})
const pnlMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const calendarDate = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
const calendarTime = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })

// Default $10,000 starting balance, matching the live journal default.
const DEFAULT_BALANCE_CENTS = 1_000_000

interface AccountRow {
  session: ReplaySession
  source: AnalyticsSource | undefined
  report: LiveCalendarReport | undefined
  stage: AccountStage
  equity: number[]
}

interface CalendarDayState {
  date: string
  status: 'loading' | 'ready' | 'error'
  accounts: { session: ReplaySession; trades: ClosedTrade[] }[]
}

function tradeDayKey(trade: ClosedTrade): string {
  const timestamp = trade.exitTs < 100_000_000_000 ? trade.exitTs * 1000 : trade.exitTs
  return new Date(timestamp).toISOString().slice(0, 10)
}

function pnlLabel(value: number): string {
  const formatted = pnlMoney.format(Math.abs(value))
  return value > 0 ? `+${formatted}` : value < 0 ? `−${formatted}` : formatted
}

function CalendarDayDialog({ day, onClose }: { day: CalendarDayState; onClose: () => void }) {
  const title = calendarDate.format(new Date(`${day.date}T12:00:00Z`))
  return (
    <DetailDialog
      titleId="live-calendar-day-heading"
      title={<h2 id="live-calendar-day-heading" className="text-ui-title font-semibold text-ink">Trades · {title}</h2>}
      status={<span className="rounded-control bg-surface-2 px-2 py-1 font-mono text-ui-meta text-muted">{day.status === 'ready' ? `${day.accounts.reduce((count, account) => count + account.trades.length, 0)} trades` : 'Loading'}</span>}
      onClose={onClose}
    >
      <section className="p-4 sm:p-5">
        {day.status === 'loading' ? <p role="status" className="py-10 text-center text-ui-body text-muted">Loading trades for this day…</p> : null}
        {day.status === 'error' ? <p role="alert" className="py-10 text-center text-ui-body text-loss-bright">Unable to load this day’s trade history. Try again.</p> : null}
        {day.status === 'ready' && day.accounts.length === 0 ? <p className="py-10 text-center text-ui-body text-muted">No trade records found for this day.</p> : null}
        {day.status === 'ready' ? <ul className="space-y-3">{day.accounts.map(({ session, trades }) => (
          <li key={session.id} className="overflow-hidden rounded-control border border-line bg-surface-0">
            <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5"><strong className="min-w-0 truncate text-ui-control font-semibold text-ink">{session.name || 'Live account'}</strong><span className="font-mono text-ui-meta text-muted">{trades.length} trades</span></div>
            <ul className="divide-y divide-line">{trades.map((trade) => {
              const exitTimestamp = trade.exitTs < 100_000_000_000 ? trade.exitTs * 1000 : trade.exitTs
              const realized = trade.realizedCents / 100
              return <li key={trade.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"><span className="min-w-0"><strong className="block truncate text-ui-body font-semibold text-ink">{trade.symbol} · {trade.side === 'long' ? 'Long' : 'Short'}</strong><time dateTime={new Date(exitTimestamp).toISOString()} className="mt-0.5 block font-mono text-ui-meta text-muted">{calendarTime.format(new Date(exitTimestamp))} UTC · {trade.qty} qty</time></span><strong className={`font-mono text-ui-control tabular-nums ${realized > 0 ? 'text-profit-bright' : realized < 0 ? 'text-loss-bright' : 'text-muted'}`}>{pnlLabel(realized)}</strong></li>
            })}</ul>
          </li>
        ))}</ul> : null}
      </section>
    </DetailDialog>
  )
}

export function LiveAccountsScreen() {
  const [sessions, setSessions] = useState<ReplaySession[]>([])
  const [sources, setSources] = useState<AnalyticsSource[]>([])
  const [reports, setReports] = useState<LiveCalendarReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<LiveTemplate[]>(() => loadLiveTemplates())
  const [editorOpen, setEditorOpen] = useState(false)
  const [composerTarget, setComposerTarget] = useState<{ sessionId: string; templateId: string } | null>(null)
  const [calendarDay, setCalendarDay] = useState<CalendarDayState | null>(null)

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

  const rows = useMemo<AccountRow[]>(() => sessions.map((session) => {
    const source = sources.find((candidate) => candidate.id === session.id)
    const report = reports.find((candidate) => candidate.source.id === session.id)
    const stage: AccountStage = session.config?.stage === 'funded' ? 'funded' : 'eval'
    const equity = report?.equityCurve?.length
      ? report.equityCurve.filter((point) => point.closedAt).map((point) => point.balance)
      : []
    return { session, source, report, stage, equity }
  }), [sessions, sources, reports])

  const calendar = useMemo(() => mergeLiveCalendars(reports), [reports])

  const detail = useMemo(() => sessions.find((session) => session.id === detailId) ?? null, [sessions, detailId])
  const detailStage: AccountStage = detail?.config?.stage === 'funded' ? 'funded' : 'eval'

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

  const handleDeleteDetail = async () => {
    if (!detailId) return
    await deleteSession(detailId)
    setDetailId(null)
    setExpandedId((current) => current === detailId ? null : current)
    await refresh()
  }

  const openCalendarDay = async (date: string) => {
    const liveSessions = [...sessions]
    setCalendarDay({ date, status: 'loading', accounts: [] })
    const loaded = await Promise.allSettled(liveSessions.map(async (session) => ({ session, trades: (await fetchTrades(session.id)).filter((trade) => tradeDayKey(trade) === date) })))
    const accounts = loaded
      .filter((result): result is PromiseFulfilledResult<{ session: ReplaySession; trades: ClosedTrade[] }> => result.status === 'fulfilled')
      .map((result) => result.value)
      .filter((account) => account.trades.length > 0)
    setCalendarDay({ date, status: loaded.some((result) => result.status === 'rejected') ? 'error' : 'ready', accounts })
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain bg-surface-0 text-ink">
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
        ) : (
          <div className="space-y-10">
            <section aria-label="Accounts">
              <h2 className="mb-3 text-ui-title font-semibold text-ink">Accounts</h2>
              {rows.length === 0 ? (
                <div className="grid place-items-center rounded-control border border-dashed border-line py-12 text-center">
                  <div>
                    <NotebookPen size={28} className="mx-auto text-dim" />
                    <p className="mt-3 text-ui-body text-muted">No live accounts yet — create one with a name above.</p>
                  </div>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {rows.map(({ session, report, stage, equity }) => {
                    const expanded = expandedId === session.id
                    const name = session.name || 'Live account'
                    return (
                      <li key={session.id}>
                        <div className="flex min-h-14 w-full flex-wrap items-center gap-2 rounded-control border border-line bg-surface-0 px-3 py-2 sm:flex-nowrap">
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : session.id)}
                            aria-expanded={expanded}
                            aria-label={`Show stats for ${name}`}
                            className="flex min-h-10 min-w-40 flex-1 items-center text-left"
                          >
                            <span className="min-w-0 truncate text-ui-control font-semibold text-ink">{name}</span>
                          </button>
                          <div className="min-w-24 border-l border-line pl-3 sm:order-none" aria-label={`Net P&L ${report ? pnlLabel(report.overview.totalPnl) : 'unavailable'}`}>
                            <span className="block text-ui-meta text-muted">Net P&amp;L</span>
                            <strong className={`block font-mono text-ui-control font-semibold tabular-nums ${report && report.overview.totalPnl > 0 ? 'text-profit-bright' : report && report.overview.totalPnl < 0 ? 'text-loss-bright' : 'text-muted'}`}>{report ? pnlLabel(report.overview.totalPnl) : '—'}</strong>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleToggleStage(session, stage === 'eval' ? 'funded' : 'eval')}
                            aria-label={`Mark ${name} ${stage === 'eval' ? 'funded' : 'eval'}`}
                            className={`flex w-[4.5rem] shrink-0 items-center justify-center rounded-control px-2 py-1 font-mono text-ui-meta font-semibold transition-colors ${stage === 'eval' ? 'bg-[#f59e0b]/15 text-[#fbbf24] hover:bg-[#f59e0b]/25' : 'bg-[#10b981]/15 text-[#34d399] hover:bg-[#10b981]/25'}`}
                          >
                            {stage === 'eval' ? 'EVAL' : 'FUNDED'}
                          </button>
                          <a href={`/analytics?analytics=${encodeURIComponent(session.id)}&sourceType=live`} className="secondary-button h-8 shrink-0 gap-1 px-2.5" aria-label={`Open analytics for ${name}`}><BarChart3 size={13} />Analytics</a>
                          <button
                            type="button"
                            onClick={() => { setDetailId(session.id); setExpandedId(null) }}
                            aria-label={`Open details for ${name}`}
                            className="secondary-button h-8 shrink-0 gap-1 px-2.5"
                          >
                            Detail
                          </button>
                        </div>
                        {expanded && (
                          <div className="mt-1 rounded-control border border-line bg-surface-0 p-3">
                            <dl className="grid gap-2 sm:grid-cols-4">
                              <StatCard label="Total PnL" value={report ? dollars.format(report.overview.totalPnl) : '—'} tone={report && report.overview.totalPnl >= 0 ? 'text-profit-bright' : 'text-loss-bright'} />
                              <StatCard label="Win rate" value={report ? `${report.overview.winRate.toFixed(1)}%` : '—'} />
                              <StatCard label="Trades" value={report ? String(report.overview.totalTrades) : '—'} />
                              <StatCard
                                label="Avg R"
                                value={report ? `${report.riskReward.averageRr >= 0 ? '+' : ''}${report.riskReward.averageRr.toFixed(2)}R` : '—'}
                                tone={report && report.riskReward.averageRr < 0 ? 'text-loss-bright' : 'text-ink'}
                              />
                            </dl>
                            <div className="mt-3 rounded-[14px] border border-line-strong bg-surface-1 p-3">
                              <h4 className="mb-2 text-ui-meta font-semibold uppercase tracking-[0.08em] text-muted">Equity</h4>
                              {equity.length > 0
                                ? <LineChart compact values={equity} fillArea ariaLabel={`Equity curve for ${name}`} />
                                : <p className="py-8 text-center text-ui-body text-muted">No closed trades yet.</p>}
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section aria-label="Performance calendar">
              <h2 className="mb-3 text-ui-title font-semibold text-ink">Performance</h2>
              <PerformanceCalendar entries={calendar.entries} initialDate={calendar.initialDate} onSelectDate={(date) => void openCalendarDay(date)} />
            </section>
          </div>
        )}
      </main>

      {detail && (
        <LiveJournalDetail
          sessionId={detail.id}
          title={detail.name || 'Live account'}
          stage={detailStage}
          onClose={() => setDetailId(null)}
          onChanged={() => void refresh()}
          onDelete={() => void handleDeleteDetail()}
          onToggleStage={() => void handleToggleStage(detail, detailStage === 'eval' ? 'funded' : 'eval')}
          templates={templates}
          onCompose={(templateId) => { if (detailId) setComposerTarget({ sessionId: detailId, templateId }) }}
        />
      )}

      {composerTarget && detail && (
        <JournalComposer
          sessionId={composerTarget.sessionId}
          title={detail.name || 'Live account'}
          templateId={composerTarget.templateId}
          onClose={() => setComposerTarget(null)}
        />
      )}

      {editorOpen && <TemplateEditor onClose={() => setEditorOpen(false)} />}
      {calendarDay ? <CalendarDayDialog day={calendarDay} onClose={() => setCalendarDay(null)} /> : null}
    </div>
  )
}
