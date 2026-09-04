import { BarChart3, ClipboardCheck, Clock3, Download, Pause, Play, Plus, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { deleteEmptySessions, deleteSession, fetchSessions, fetchTrades, patchSession } from '../../api/client'
import type { ClosedTrade, ReplaySession } from '../../api/types'
import { calculateTradeStats } from '../../fill-engine/stats'
import type { EngineTrade } from '../../fill-engine/types'
import { useDismissableLayer } from '../../hooks/use-dismissable-layer'
import { replayEngine } from '../../replay/replay-engine'
import { shortReplaySessionHash } from '../../replay/session-state'
import { useReplaySelector } from '../../replay/use-replay'
import { useUiStore } from '../../store/ui-store'
import { TradeHistoryTable } from '../trades/TradeHistoryTable'
import { tradeHistoryCsv } from './trade-history-csv'
import { useChartWorkspace } from '../../chart-workspace/use-chart-workspace'
import { formatChartTime, type ChartTimezone } from '../../replay/chart-timezone'
import { replaySessionDisplayName } from '../../sources/source-name'
import { SourceNameEditor } from '../sources/SourceNameEditor'
import { DetailDialog } from '../ui/DetailDialog'
import { LineChart } from '../analytics/InteractiveAnalyticsCharts'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function maxDrawdownPercent(session: ReplaySession, trades: EngineTrade[]): { value: string; tone: string } {
  if (trades.length === 0) return { value: '—', tone: 'text-ink' }
  const netCents = trades.reduce((total, trade) => total + trade.realizedCents, 0)
  let equity = session.equityCents - netCents
  let peak = equity
  let maximum = 0
  for (const trade of trades.toSorted((left, right) => left.exitTs - right.exitTs)) {
    equity += trade.realizedCents
    peak = Math.max(peak, equity)
    if (peak > 0) maximum = Math.max(maximum, (peak - equity) / peak)
  }
  return { value: `${(maximum * 100).toFixed(2)}%`, tone: maximum > 0 ? 'text-loss-bright' : 'text-ink' }
}

function statusTone(status: ReplaySession['status']): string {
  if (status === 'active') return 'bg-profit/12 text-profit-bright'
  if (status === 'stopped') return 'bg-loss/12 text-loss-bright'
  return 'bg-surface-3 text-muted'
}

function downloadTradeHistory(session: ReplaySession, trades: EngineTrade[]): void {
  const blob = new Blob([tradeHistoryCsv(session, trades)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  const safeName = replaySessionDisplayName(session).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '')
  anchor.download = `${safeName || shortReplaySessionHash(session.id)}-trades.csv`
  anchor.click()
  queueMicrotask(() => URL.revokeObjectURL(url))
}

interface SessionDetailsProps {
  session: ReplaySession
  trades: EngineTrade[]
  loading: boolean
  current: boolean
  deleting: boolean
  onRefresh: () => Promise<void>
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
  onReview: () => void
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
  timezone: ChartTimezone
}

function SessionDetails({ session, trades, loading, current, deleting, onRefresh, onRename, onDelete, onReview, onClose, returnFocusRef, timezone }: SessionDetailsProps) {
  const stats = calculateTradeStats(trades)
  const equityCurve = useMemo(() => {
    const netCents = trades.reduce((total, trade) => total + trade.realizedCents, 0)
    const values = [(session.equityCents - netCents) / 100]
    const labels = [new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(session.startTs * 1000))]
    let equity = session.equityCents - netCents
    for (const trade of trades.toSorted((left, right) => left.exitTs - right.exitTs)) {
      equity += trade.realizedCents
      values.push(equity / 100)
      labels.push(new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(trade.exitTs * 1000)))
    }
    return { values, labels }
  }, [session.equityCents, trades])
  const maxDrawdown = maxDrawdownPercent(session, trades)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      await onRefresh()
    } catch {
      setActionError('The session action could not be completed. Try again after persistence reconnects.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DetailDialog
      titleId={`session-details-${session.id}`}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      title={<div className="flex min-w-0 items-center gap-1.5"><h2 id={`session-details-${session.id}`} className="truncate text-ui-title font-semibold text-ink">{replaySessionDisplayName(session)}</h2><SourceNameEditor currentName={session.name} defaultName={`#${shortReplaySessionHash(session.id)}`} sourceLabel="replay session" onSave={onRename} /></div>}
      status={<span className={`rounded-control px-2 py-1 font-mono text-ui-meta font-semibold uppercase ${statusTone(current ? 'active' : session.status)}`}>{current ? 'active' : session.status}</span>}
    >
      <div className="p-4 sm:p-5">
      <dl className="grid gap-2 sm:grid-cols-2">
        <div className="min-h-20 rounded-[14px] border border-line-strong bg-surface-1 px-4 py-3"><dt className="text-ui-body text-muted">Equity</dt><dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">{money.format(session.equityCents / 100)}</dd></div>
        <div className="min-h-20 rounded-[14px] border border-line-strong bg-surface-1 px-4 py-3"><dt className="text-ui-body text-muted">Profit factor</dt><dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">{stats.profitFactor === null ? '—' : stats.profitFactor.toFixed(2)}</dd></div>
        <div className="min-h-20 rounded-[14px] border border-line-strong bg-surface-1 px-4 py-3"><dt className="text-ui-body text-muted">Duration</dt><dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">{durationLabel(session.cursorTs - session.startTs)}</dd></div>
        <div className="min-h-20 rounded-[14px] border border-line-strong bg-surface-1 px-4 py-3"><dt className="text-ui-body text-muted">Closed trades</dt><dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">{stats.trades}</dd></div>
        <div className="min-h-20 rounded-[14px] border border-line-strong bg-surface-1 px-4 py-3"><dt className="text-ui-body text-muted">Win rate</dt><dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">{stats.trades === 0 ? '—' : `${(stats.winRate * 100).toFixed(0)}%`}</dd></div>
        <div className="min-h-20 rounded-[14px] border border-line-strong bg-surface-1 px-4 py-3"><dt className="text-ui-body text-muted">Average R</dt><dd className={`mt-1 font-mono text-lg font-semibold tabular-nums ${stats.averageR !== null && stats.averageR < 0 ? 'text-loss-bright' : 'text-ink'}`}>{stats.averageR === null ? '—' : `${stats.averageR > 0 ? '+' : ''}${stats.averageR.toFixed(2)}R`}</dd></div>
        <div className="min-h-20 rounded-[14px] border border-line-strong bg-surface-1 px-4 py-3"><dt className="text-ui-body text-muted">Max drawdown</dt><dd className={`mt-1 font-mono text-lg font-semibold tabular-nums ${maxDrawdown.tone}`}>{maxDrawdown.value}</dd></div>
        <div className="min-h-20 rounded-[14px] border border-line-strong bg-surface-1 px-4 py-3"><dt className="text-ui-body text-muted">Realized P&amp;L</dt><dd className={`mt-1 font-mono text-lg font-semibold tabular-nums ${stats.netCents < 0 ? 'text-loss-bright' : stats.netCents > 0 ? 'text-profit-bright' : 'text-ink'}`}>{stats.netCents > 0 ? '+' : ''}{money.format(stats.netCents / 100)}</dd></div>
      </dl>
      <section className="mt-4 rounded-[14px] border border-line-strong bg-surface-1 p-4" aria-labelledby={`session-equity-curve-${session.id}`}>
        <h3 id={`session-equity-curve-${session.id}`} className="text-ui-body font-semibold text-ink">Equity curve</h3>
        <div className="mt-3 overflow-x-auto pb-1">
          <LineChart values={equityCurve.values} xLabels={equityCurve.labels} fillArea showPoints valueLabel="Equity" valueFormatter={(value) => money.format(value)} ariaLabel="Equity curve for this session" />
        </div>
      </section>
      <div className="mt-4 grid w-full grid-cols-2 gap-2 sm:grid-cols-6">
        {!current ? (
          <button type="button" disabled={busy} onClick={() => void run(() => replayEngine.resumeSession(session))} className="primary-button w-full justify-center"><Play size={14} fill="currentColor" /> Resume</button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void run(() => replayEngine.pauseReplaySession())} className="secondary-button w-full justify-center"><Pause size={14} fill="currentColor" /> Pause</button>
        )}
        {session.status !== 'stopped' || current ? (
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            if (current) await replayEngine.stopReplaySession()
            else await patchSession(session.id, { status: 'stopped' })
          })} className="secondary-button w-full justify-center"><Square size={13} fill="currentColor" /> Stop</button>
        ) : null}
        <button type="button" disabled={loading || trades.length === 0} onClick={() => downloadTradeHistory(session, trades)} className="secondary-button w-full justify-center" aria-label="Download session trade history as CSV"><Download size={14} />CSV</button>
        <a href={`/analytics?analytics=${encodeURIComponent(session.id)}&sourceType=session`} className="secondary-button w-full justify-center" aria-label={`Open replay session ${replaySessionDisplayName(session)} reports`}><BarChart3 size={14} />Reports</a>
        <button type="button" onClick={onReview} className="secondary-button w-full justify-center"><ClipboardCheck size={14} />Review</button>
        <button
          type="button"
          disabled={busy || deleting || current || session.status === 'active'}
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true)
              return
            }
            void run(onDelete)
          }}
          className={`secondary-button w-full justify-center px-3 ${confirmDelete ? 'border-loss/60 text-loss-bright' : ''}`}
          aria-label={confirmDelete ? `Confirm delete replay session ${shortReplaySessionHash(session.id)}` : `Delete replay session ${shortReplaySessionHash(session.id)}`}
        >
          <Trash2 size={14} /> {confirmDelete ? 'Confirm' : 'Delete'}
        </button>
      </div>
      {actionError ? <p role="alert" className="mt-3 border border-loss/30 bg-loss/8 px-3 py-2 text-ui-body text-loss-bright">{actionError}</p> : null}
      </div>
      <TradeHistoryTable
        timezone={timezone}
        headingId={`session-trade-history-${session.id}`}
        loading={loading}
        trades={trades.map((trade) => ({
          id: trade.id,
          symbol: trade.symbol,
          side: trade.side,
          qty: trade.qty,
          entryTime: trade.entryTs,
          exitTime: trade.exitTs,
          realizedCents: trade.realizedCents,
          mfeTicks: trade.mfeTicks,
          maeTicks: trade.maeTicks,
          rMultiple: trade.rMultiple,
        }))}
      />
    </DetailDialog>
  )
}

interface SessionContextMenu {
  sessionId: string
  left: number
  top: number
  confirming: boolean
}

export function SessionsPanel() {
  const { state: chartWorkspace } = useChartWorkspace()
  const openReview = useUiStore((state) => state.openReview)
  const replay = useReplaySelector((snapshot) => ({
    sessionId: snapshot.sessionId,
    sessionStatus: snapshot.sessionStatus,
    trades: snapshot.fill?.trades ?? null,
  }))
  const [sessions, setSessions] = useState<ReplaySession[]>([])
  const [detailSessionId, setDetailSessionId] = useState<string | null>(null)
  const [tradesBySession, setTradesBySession] = useState<Record<string, ClosedTrade[]>>({})
  const [loadingTradeIds, setLoadingTradeIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmCleanup, setConfirmCleanup] = useState(false)
  const [visibleCount, setVisibleCount] = useState(30)
  const [contextMenu, setContextMenu] = useState<SessionContextMenu | null>(null)
  const refreshVersion = useRef(0)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const detailTriggerRef = useRef<HTMLButtonElement>(null)

  useDismissableLayer({ open: contextMenu !== null, layerRef: contextMenuRef, onDismiss: () => setContextMenu(null) })
  useEffect(() => { contextMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus() }, [contextMenu])

  const refresh = useCallback(async (): Promise<void> => {
    const version = refreshVersion.current + 1
    refreshVersion.current = version
    try {
      // Evaluation accounts have their own lifecycle and UI. They share the
      // persistence API for journals/workspace recovery only; that backing
      // record must never appear as a duplicate replay Session.
      const next = (await fetchSessions()).filter((session) => session.kind === 'replay')
      const ordered = next.toSorted((a, b) => b.updatedAt - a.updatedAt)
      if (version !== refreshVersion.current) return
      setSessions(ordered)
      setDetailSessionId((current) => current && ordered.some((session) => session.id === current) ? current : null)
      setLoadingTradeIds(new Set(ordered.map((session) => session.id)))
      setError(null)

      const histories = await Promise.allSettled(ordered.map(async (session) => ({ sessionId: session.id, trades: await fetchTrades(session.id) })))
      if (version !== refreshVersion.current) return
      const nextTrades: Record<string, ClosedTrade[]> = {}
      let failedHistory = false
      for (const history of histories) {
        if (history.status === 'fulfilled') nextTrades[history.value.sessionId] = history.value.trades
        else failedHistory = true
      }
      setTradesBySession(nextTrades)
      setLoadingTradeIds(new Set())
      if (failedHistory) setError('Some trade histories could not be loaded. Activate a session after persistence reconnects to restore its full history.')
    } catch {
      if (version !== refreshVersion.current) return
      setLoadingTradeIds(new Set())
      setError('Sessions are unavailable while persistence is offline.')
    }
  }, [replay.sessionId])

  useEffect(() => { void refresh() }, [refresh, replay.sessionStatus])
  const tradesFor = useCallback((sessionId: string): EngineTrade[] => {
    if (sessionId === replay.sessionId && replay.trades) return replay.trades
    return tradesBySession[sessionId] ?? []
  }, [replay.sessionId, replay.trades, tradesBySession])

  const remove = async (session: ReplaySession): Promise<void> => {
    setDeletingId(session.id)
    try {
      await deleteSession(session.id)
      setContextMenu(null)
      setDetailSessionId(null)
      await refresh()
    } finally {
      setDeletingId(null)
    }
  }

  const rename = async (session: ReplaySession, name: string): Promise<void> => {
    await patchSession(session.id, { name })
    await refresh()
  }

  const openContextMenu = (session: ReplaySession, left: number, top: number): void => {
    setContextMenu({
      sessionId: session.id,
      left: Math.max(8, Math.min(left, window.innerWidth - 208)),
      top: Math.max(8, Math.min(top, window.innerHeight - 56)),
      confirming: false,
    })
  }

  const handleRowContextMenu = (event: MouseEvent<HTMLElement>, session: ReplaySession): void => {
    event.preventDefault()
    openContextMenu(session, event.clientX, event.clientY)
  }

  const handleRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, session: ReplaySession): void => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    openContextMenu(session, rect.left + 24, rect.top + 24)
  }

  const emptyLegacyCount = sessions.filter((session) => session.status !== 'active' && session.cursorTs === session.startTs && session.equityCents === 0 && Object.keys(session.config ?? {}).length === 0).length
  const contextSession = contextMenu ? sessions.find((session) => session.id === contextMenu.sessionId) ?? null : null
  const contextSessionCurrent = contextSession?.id === replay.sessionId && replay.sessionStatus === 'active'
  const activeSession = replay.sessionStatus === 'active'
    ? sessions.find((session) => session.id === replay.sessionId) ?? null
    : null
  const detailSession = detailSessionId ? sessions.find((session) => session.id === detailSessionId) ?? null : null

  return (
    <div className="min-h-0 overflow-y-auto">
      <div className="flex min-h-12 items-center justify-between border-b border-line px-3">
        <div>
          <h2 className="text-ui-body font-semibold text-ink">Replay sessions</h2>
          <p className={`max-w-44 truncate text-ui-meta ${replay.sessionId ? 'text-profit-bright' : 'text-dim'}`}>{activeSession ? `Active · ${replaySessionDisplayName(activeSession)}` : 'No active session · replay is temporary'}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {activeSession ? (
            <button type="button" onClick={() => openReview({ id: activeSession.id, type: 'session', title: replaySessionDisplayName(activeSession) })} className="secondary-button h-7 min-h-7 px-2.5" aria-label="Review active session"><ClipboardCheck size={13} />Review</button>
          ) : null}
          <button type="button" onClick={() => replayEngine.beginReplaySelection({ createSession: true })} className="primary-button h-7 px-2.5" aria-label="New session"><Plus size={13} />New</button>
        </div>
      </div>
      {emptyLegacyCount > 0 ? (
        <div className="flex items-center justify-between border-b border-line px-3 py-2 text-ui-meta">
          <span className="text-dim">{emptyLegacyCount} empty legacy session{emptyLegacyCount === 1 ? '' : 's'}</span>
          <button type="button" onClick={() => {
            if (!confirmCleanup) {
              setConfirmCleanup(true)
              return
            }
            void deleteEmptySessions().then(() => { setConfirmCleanup(false); void refresh() }).catch(() => setError('Empty sessions could not be removed.'))
          }} className={confirmCleanup ? 'text-loss-bright hover:text-loss' : 'text-muted hover:text-ink'}>{confirmCleanup ? 'Confirm cleanup' : 'Clean up'}</button>
        </div>
      ) : null}
      {error ? <p role="status" className="border-b border-loss/20 bg-loss/8 p-3 text-ui-body text-loss-bright">{error}</p> : null}
      <ul className="divide-y divide-line" aria-label="Saved replay sessions">
        {sessions.slice(0, visibleCount).map((session) => {
          const current = session.id === replay.sessionId && replay.sessionStatus === 'active'
          const trades = tradesFor(session.id)
          const stats = calculateTradeStats(trades)
          const loading = loadingTradeIds.has(session.id)
          const status = current ? 'active' : session.status
          const displayName = replaySessionDisplayName(session)
          const defaultName = `#${shortReplaySessionHash(session.id)}`
          return (
            <li key={session.id} onContextMenu={(event) => handleRowContextMenu(event, session)}>
              <button
                type="button"
                onClick={(event) => { detailTriggerRef.current = event.currentTarget; setDetailSessionId(session.id) }}
                onKeyDown={(event) => handleRowKeyDown(event, session)}
                aria-current={current ? 'true' : undefined}
                aria-label={`Inspect replay session ${displayName}`}
                className={`w-full text-left transition-colors ${current ? 'bg-active/10 ring-1 ring-inset ring-active/35 hover:bg-active/15' : 'hover:bg-surface-2'}`}
              >
                <span className="flex items-start gap-2.5 px-3 py-2.5">
                  <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-control ${current ? 'bg-active/15 text-active-bright' : 'bg-surface-3 text-muted'}`}><Clock3 size={13} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <strong className={`min-w-0 truncate text-ui-body ${current ? 'text-active-bright' : 'text-ink'}`}>{displayName}</strong>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className={`rounded-control px-1.5 py-0.5 text-ui-meta font-semibold uppercase ${statusTone(status)}`}>{status}</span>
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-ui-meta text-dim">{session.symbol} · {session.tf}{displayName !== defaultName ? ` · ${defaultName}` : ''} · <span className="font-mono">{formatChartTime(session.cursorTs || session.startTs, chartWorkspace.timezone)}</span></span>
                  </span>
                </span>
                <dl className="grid grid-cols-4 border-t border-line text-center text-ui-meta">
                  <div className="min-w-0 px-1 py-1.5"><dt className="text-dim">Trades</dt><dd className="truncate font-mono font-medium text-ink">{loading ? '…' : stats.trades}</dd></div>
                  <div className="min-w-0 border-l border-line px-1 py-1.5"><dt className="text-dim">Win rate</dt><dd className="truncate font-mono font-medium text-ink">{loading ? '…' : `${(stats.winRate * 100).toFixed(0)}%`}</dd></div>
                  <div className="min-w-0 border-l border-line px-1 py-1.5"><dt className="text-dim">P&amp;L</dt><dd className={`truncate font-mono font-medium ${loading || stats.netCents === 0 ? 'text-ink' : stats.netCents > 0 ? 'text-profit-bright' : 'text-loss-bright'}`}>{loading ? '…' : money.format(stats.netCents / 100)}</dd></div>
                  <div className="min-w-0 border-l border-line px-1 py-1.5"><dt className="text-dim">Avg R</dt><dd className="truncate font-mono font-medium text-ink">{loading ? '…' : stats.averageR === null ? '—' : stats.averageR.toFixed(2)}</dd></div>
                </dl>
              </button>
            </li>
          )
        })}
      </ul>
      {sessions.length > visibleCount ? <button type="button" onClick={() => setVisibleCount((count) => count + 30)} className="h-10 w-full border-t border-line text-ui-body text-muted hover:bg-surface-2 hover:text-ink">Show 30 older sessions</button> : null}
      {!error && sessions.length === 0 ? <div className="grid place-items-center px-6 py-12 text-center"><Clock3 className="mb-3 text-dim" size={22} /><p className="text-ui-body text-muted">No saved sessions.</p><p className="mt-1 text-ui-meta text-dim">Replay normally for temporary practice, or create a session when you want to preserve its trades and review.</p></div> : null}
      {contextMenu && contextSession ? createPortal(
        <div ref={contextMenuRef} role="menu" aria-label={`${replaySessionDisplayName(contextSession)} actions`} style={{ left: contextMenu.left, top: contextMenu.top }} className="fixed z-[90] w-48 rounded-control border border-line-strong bg-[#111214] p-1 shadow-overlay">
          <button
            type="button"
            role="menuitem"
            disabled={contextSessionCurrent || contextSession.status === 'active' || deletingId === contextSession.id}
            onClick={() => {
              if (!contextMenu.confirming) {
                setContextMenu({ ...contextMenu, confirming: true })
                return
              }
              void remove(contextSession)
            }}
            className={`flex h-9 w-full items-center gap-2 rounded-control px-2.5 text-left text-ui-control hover:bg-loss/10 focus-visible:bg-loss/10 disabled:cursor-not-allowed disabled:opacity-40 ${contextMenu.confirming ? 'text-loss-bright' : 'text-muted hover:text-loss-bright'}`}
          >
            <Trash2 size={14} strokeWidth={1.75} />{contextMenu.confirming ? 'Confirm delete' : 'Delete session'}
          </button>
        </div>,
        document.body,
      ) : null}
      {detailSession ? <SessionDetails key={detailSession.id} session={detailSession} trades={tradesFor(detailSession.id)} loading={loadingTradeIds.has(detailSession.id)} current={detailSession.id === replay.sessionId && replay.sessionStatus === 'active'} deleting={deletingId === detailSession.id} onRefresh={refresh} onRename={(name) => rename(detailSession, name)} onDelete={() => remove(detailSession)} onReview={() => { openReview({ id: detailSession.id, type: 'session', title: replaySessionDisplayName(detailSession) }); setDetailSessionId(null) }} onClose={() => setDetailSessionId(null)} returnFocusRef={detailTriggerRef} timezone={chartWorkspace.timezone} /> : null}
    </div>
  )
}
