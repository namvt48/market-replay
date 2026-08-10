import { ChevronDown, Clock3, Download, Pause, Play, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { deleteEmptySessions, deleteSession, fetchSessions, fetchTrades, patchSession } from '../../api/client'
import type { ClosedTrade, ReplaySession } from '../../api/types'
import { calculateTradeStats } from '../../fill-engine/stats'
import type { EngineTrade } from '../../fill-engine/types'
import { useDismissableLayer } from '../../hooks/use-dismissable-layer'
import { replayEngine } from '../../replay/replay-engine'
import { shortReplaySessionHash } from '../../replay/session-state'
import { useReplaySelector } from '../../replay/use-replay'
import { tradeHistoryCsv } from './trade-history-csv'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
const dateTime = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function durationLabel(seconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
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
  anchor.download = `${session.symbol}-${shortReplaySessionHash(session.id)}-trades.csv`
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
  onDelete: () => Promise<void>
}

function SessionDetails({ session, trades, loading, current, deleting, onRefresh, onDelete }: SessionDetailsProps) {
  const stats = calculateTradeStats(trades)
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
    <section id={`session-details-${session.id}`} aria-label={`${session.symbol} ${session.tf} session journal`} className="border-t border-line bg-surface-0/35">
      <div className="flex items-center gap-2 p-3">
        {!current ? (
          <button type="button" disabled={busy} onClick={() => void run(() => replayEngine.resumeSession(session))} className="primary-button flex-1"><Play size={14} fill="currentColor" /> Activate</button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void run(() => replayEngine.pauseReplaySession())} className="secondary-button flex-1"><Pause size={14} fill="currentColor" /> Pause</button>
        )}
        {session.status !== 'stopped' || current ? (
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            if (current) await replayEngine.stopReplaySession()
            else await patchSession(session.id, { status: 'stopped' })
          })} className="secondary-button flex-1"><Square size={13} fill="currentColor" /> Stop</button>
        ) : null}
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
          className={`secondary-button px-3 ${confirmDelete ? 'border-loss/60 text-loss-bright' : ''}`}
          aria-label={confirmDelete ? `Confirm delete replay session ${shortReplaySessionHash(session.id)}` : `Delete replay session ${shortReplaySessionHash(session.id)}`}
        >
          <Trash2 size={14} /> {confirmDelete ? 'Confirm' : 'Delete'}
        </button>
      </div>
      {actionError ? <p role="alert" className="border-t border-loss/20 bg-loss/8 px-3 py-2 text-ui-body text-loss-bright">{actionError}</p> : null}

      <dl className="grid grid-cols-3 border-t border-line px-3 text-ui-meta">
        <div className="py-2">
          <dt className="text-dim">Equity</dt>
          <dd className="mt-0.5 truncate font-mono text-ink">{money.format(session.equityCents / 100)}</dd>
        </div>
        <div className="border-x border-line px-3 py-2">
          <dt className="text-dim">Profit factor</dt>
          <dd className="mt-0.5 font-mono text-ink">{stats.profitFactor === null ? '—' : stats.profitFactor.toFixed(2)}</dd>
        </div>
        <div className="pl-3 py-2">
          <dt className="text-dim">Duration</dt>
          <dd className="mt-0.5 font-mono text-ink">{durationLabel(session.cursorTs - session.startTs)}</dd>
        </div>
      </dl>

      <div className="flex min-h-11 items-center justify-between gap-2 border-y border-line px-3">
        <div className="flex items-baseline gap-2"><h4 className="text-ui-meta font-semibold text-muted">TRADE JOURNAL</h4><span className="font-mono text-ui-meta text-dim">{loading ? 'Loading…' : `${trades.length} closed`}</span></div>
        <button type="button" disabled={loading || trades.length === 0} onClick={() => downloadTradeHistory(session, trades)} className="secondary-button h-8 min-h-8 px-2.5" aria-label="Download trade history"><Download size={13} />CSV</button>
      </div>
      {trades.length > 0 ? (
        <ol className="divide-y divide-line">
          {trades.toReversed().map((trade) => (
            <li key={trade.id} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2.5 text-ui-body [content-visibility:auto]">
              <div className="min-w-0">
                <span className={trade.side === 'long' ? 'text-profit-bright' : 'text-loss-bright'}>{trade.side.toUpperCase()}</span>
                <span className="ml-1.5 text-ink">{trade.qty} {trade.symbol}</span>
                <time className="mt-0.5 block truncate font-mono text-ui-meta text-dim" dateTime={new Date(trade.exitTs * 1000).toISOString()}>{dateTime.format(trade.entryTs * 1000)} → {dateTime.format(trade.exitTs * 1000)}</time>
                <span className="mt-0.5 block font-mono text-ui-meta text-muted">MFE {trade.mfeTicks}t · MAE {trade.maeTicks}t · R {trade.rMultiple === null ? '—' : trade.rMultiple.toFixed(2)}</span>
              </div>
              <span className={`font-mono font-semibold ${trade.realizedCents >= 0 ? 'text-profit-bright' : 'text-loss-bright'}`}>{money.format(trade.realizedCents / 100)}</span>
            </li>
          ))}
        </ol>
      ) : loading ? <p className="px-3 py-4 text-center text-ui-body text-dim">Loading the complete journal…</p> : null}
    </section>
  )
}

interface SessionContextMenu {
  sessionId: string
  left: number
  top: number
  confirming: boolean
}

export function SessionsPanel() {
  const replay = useReplaySelector((snapshot) => ({
    sessionId: snapshot.sessionId,
    sessionStatus: snapshot.sessionStatus,
    trades: snapshot.fill?.trades ?? null,
  }))
  const [sessions, setSessions] = useState<ReplaySession[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tradesBySession, setTradesBySession] = useState<Record<string, ClosedTrade[]>>({})
  const [loadingTradeIds, setLoadingTradeIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmCleanup, setConfirmCleanup] = useState(false)
  const [visibleCount, setVisibleCount] = useState(30)
  const [contextMenu, setContextMenu] = useState<SessionContextMenu | null>(null)
  const refreshVersion = useRef(0)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  useDismissableLayer({ open: contextMenu !== null, layerRef: contextMenuRef, onDismiss: () => setContextMenu(null) })
  useEffect(() => { contextMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus() }, [contextMenu])

  const refresh = useCallback(async (): Promise<void> => {
    const version = refreshVersion.current + 1
    refreshVersion.current = version
    try {
      const next = await fetchSessions()
      const ordered = next.toSorted((a, b) => b.updatedAt - a.updatedAt)
      if (version !== refreshVersion.current) return
      setSessions(ordered)
      setSelectedId((current) => {
        if (replay.sessionId && ordered.some((session) => session.id === replay.sessionId)) return replay.sessionId
        if (current && ordered.some((session) => session.id === current)) return current
        return ordered[0]?.id ?? null
      })
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
      if (failedHistory) setError('Some journals could not be loaded. Activate a session after persistence reconnects to restore its full history.')
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
      setSelectedId(null)
      await refresh()
    } finally {
      setDeletingId(null)
    }
  }

  const openContextMenu = (session: ReplaySession, left: number, top: number): void => {
    setSelectedId(session.id)
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

  return (
    <div className="min-h-0 overflow-y-auto">
      <div className="flex min-h-12 items-center justify-between border-b border-line px-3">
        <div>
          <h2 className="text-ui-body font-semibold text-ink">Journal</h2>
          <p className={`text-ui-meta ${replay.sessionId ? 'text-profit-bright' : 'text-dim'}`}>{replay.sessionId ? `Active #${shortReplaySessionHash(replay.sessionId)}` : 'No active session · replay is temporary'}</p>
        </div>
        <button type="button" onClick={() => replayEngine.beginReplaySelection({ createSession: true })} className="secondary-button h-8 min-h-8 px-2.5">New session</button>
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
          const selectedRow = session.id === selectedId
          const current = session.id === replay.sessionId && replay.sessionStatus === 'active'
          const trades = tradesFor(session.id)
          const stats = calculateTradeStats(trades)
          const loading = loadingTradeIds.has(session.id)
          const status = current ? 'active' : session.status
          return (
            <li key={session.id} onContextMenu={(event) => handleRowContextMenu(event, session)}>
              <button
                type="button"
                onClick={() => setSelectedId((currentId) => currentId === session.id ? null : session.id)}
                onKeyDown={(event) => handleRowKeyDown(event, session)}
                aria-expanded={selectedRow}
                aria-controls={`session-details-${session.id}`}
                aria-label={`Inspect ${session.symbol} ${session.tf} session ${shortReplaySessionHash(session.id)}`}
                className="w-full text-left hover:bg-surface-2 aria-expanded:bg-surface-2"
              >
                <span className="flex items-start gap-2.5 px-3 py-2.5">
                  <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-control ${current ? 'bg-active/15 text-active-bright' : 'bg-surface-3 text-muted'}`}><Clock3 size={13} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate"><strong className="text-ui-body text-ink">{session.symbol} · {session.tf}</strong><span className="ml-1.5 font-mono text-ui-meta text-dim">#{shortReplaySessionHash(session.id)}</span></span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className={`rounded-control px-1.5 py-0.5 text-ui-meta font-semibold uppercase ${statusTone(status)}`}>{status}</span>
                        <ChevronDown size={13} className={`text-dim transition-transform ${selectedRow ? 'rotate-180' : ''}`} aria-hidden="true" />
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-ui-meta text-dim">{dateTime.format((session.cursorTs || session.startTs) * 1000)}</span>
                  </span>
                </span>
                <dl className="grid grid-cols-4 border-t border-line text-center text-ui-meta">
                  <div className="min-w-0 px-1 py-1.5"><dt className="text-dim">Trades</dt><dd className="truncate font-mono font-medium text-ink">{loading ? '…' : stats.trades}</dd></div>
                  <div className="min-w-0 border-l border-line px-1 py-1.5"><dt className="text-dim">Win rate</dt><dd className="truncate font-mono font-medium text-ink">{loading ? '…' : `${(stats.winRate * 100).toFixed(0)}%`}</dd></div>
                  <div className="min-w-0 border-l border-line px-1 py-1.5"><dt className="text-dim">P&amp;L</dt><dd className={`truncate font-mono font-medium ${loading || stats.netCents === 0 ? 'text-ink' : stats.netCents > 0 ? 'text-profit-bright' : 'text-loss-bright'}`}>{loading ? '…' : money.format(stats.netCents / 100)}</dd></div>
                  <div className="min-w-0 border-l border-line px-1 py-1.5"><dt className="text-dim">Avg R</dt><dd className="truncate font-mono font-medium text-ink">{loading ? '…' : stats.averageR === null ? '—' : stats.averageR.toFixed(2)}</dd></div>
                </dl>
              </button>
              {selectedRow ? <SessionDetails key={session.id} session={session} trades={trades} loading={loading} current={current} deleting={deletingId === session.id} onRefresh={refresh} onDelete={() => remove(session)} /> : null}
            </li>
          )
        })}
      </ul>
      {sessions.length > visibleCount ? <button type="button" onClick={() => setVisibleCount((count) => count + 30)} className="h-10 w-full border-t border-line text-ui-body text-muted hover:bg-surface-2 hover:text-ink">Show 30 older sessions</button> : null}
      {!error && sessions.length === 0 ? <div className="grid place-items-center px-6 py-12 text-center"><Clock3 className="mb-3 text-dim" size={22} /><p className="text-ui-body text-muted">No saved sessions.</p><p className="mt-1 text-ui-meta text-dim">Replay normally for temporary practice, or create a session when you want to keep the journal.</p></div> : null}
      {contextMenu && contextSession ? createPortal(
        <div ref={contextMenuRef} role="menu" aria-label={`Session ${shortReplaySessionHash(contextSession.id)} actions`} style={{ left: contextMenu.left, top: contextMenu.top }} className="fixed z-[90] w-48 rounded-control border border-line-strong bg-[#111214] p-1 shadow-overlay">
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
    </div>
  )
}
