import { ArchiveRestore, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { fetchDeletedSessions, permanentlyDeleteSession, restoreSession } from '../../api/client'
import type { ReplaySession } from '../../api/types'
import { replaySessionDisplayName } from '../../sources/source-name'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })

export function DeletedSessionsSettings(): ReactElement {
  const [sessions, setSessions] = useState<ReplaySession[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try { setSessions(await fetchDeletedSessions()) } catch { setError('Deleted sessions could not be loaded. Check persistence and try again.') } finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const act = async (id: string, action: () => Promise<void>): Promise<void> => {
    setBusyId(id)
    setError(null)
    try { await action(); setConfirmId(null); await refresh() } catch { setError('The session action failed. No data was changed.') } finally { setBusyId(null) }
  }

  return (
    <section aria-labelledby="deleted-sessions-title" className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="flex items-end justify-between gap-4"><div><p className="text-ui-meta font-semibold uppercase tracking-[0.08em] text-active-bright">Session archive</p><h2 id="deleted-sessions-title" className="mt-1 text-xl font-semibold tracking-tight text-ink">Deleted sessions</h2><p className="mt-2 max-w-2xl text-ui-body text-muted">Deleted replay sessions stay here with their full trade history until you remove them permanently.</p></div><button type="button" onClick={() => void refresh()} disabled={loading} className="secondary-button shrink-0"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</button></div>
      {error ? <p role="alert" className="mt-5 rounded-control border border-loss/30 bg-loss/8 px-3 py-2 text-ui-body text-loss-bright">{error}</p> : null}
      <div className="mt-6 overflow-x-auto rounded-panel border border-line-strong">
        <table className="w-full min-w-[760px] border-collapse text-left text-ui-body">
          <thead className="bg-surface-2/70 text-ui-meta font-semibold uppercase tracking-[0.05em] text-dim"><tr><th className="px-4 py-3">Session</th><th className="px-4 py-3">Period</th><th className="px-4 py-3">Market</th><th className="px-4 py-3 text-right">Balance</th><th className="px-4 py-3">Deleted</th><th className="w-44 px-4 py-3"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody className="divide-y divide-line bg-surface-0/35">
            {sessions.map((session) => <tr key={session.id} className="hover:bg-surface-2/50"><td className="px-4 py-3"><p className="font-semibold text-ink">{replaySessionDisplayName(session)}</p><p className="mt-0.5 font-mono text-ui-meta text-dim">{session.id.slice(0, 10)}</p></td><td className="px-4 py-3 text-muted">{dateTime.format(session.startTs * 1000)}<span className="mx-1 text-dim">→</span>{dateTime.format(session.cursorTs * 1000)}</td><td className="px-4 py-3"><strong className="font-mono text-ink">{session.symbol}</strong><span className="ml-2 text-dim">{session.tf}</span></td><td className="px-4 py-3 text-right font-mono text-ink">{money.format(session.equityCents / 100)}</td><td className="px-4 py-3 text-muted">{session.deletedAt ? dateTime.format(session.deletedAt * 1000) : '—'}</td><td className="px-4 py-3"><div className="flex justify-end gap-2"><button type="button" disabled={busyId !== null} onClick={() => void act(session.id, () => restoreSession(session.id))} className="secondary-button h-8 min-h-8 px-2.5"><ArchiveRestore size={14} />Restore</button><button type="button" disabled={busyId !== null} onClick={() => { if (confirmId === session.id) void act(session.id, () => permanentlyDeleteSession(session.id)); else setConfirmId(session.id) }} className={`tool-button ${confirmId === session.id ? 'w-auto border border-loss/40 px-2 text-loss-bright' : 'text-dim hover:text-loss-bright'}`} aria-label={confirmId === session.id ? `Confirm permanent deletion of ${replaySessionDisplayName(session)}` : `Permanently delete ${replaySessionDisplayName(session)}`}>{confirmId === session.id ? <><Trash2 size={13} /><span className="ml-1">Confirm</span></> : <MoreHorizontal size={16} />}</button></div></td></tr>)}
            {!loading && sessions.length === 0 ? <tr><td colSpan={6} className="px-4 py-16 text-center"><Trash2 size={22} className="mx-auto text-dim" /><p className="mt-3 text-ui-title font-semibold text-ink">Archive is empty</p><p className="mt-1 text-ui-body text-dim">Sessions you delete from the Sessions tab will appear here.</p></td></tr> : null}
            {loading ? <tr><td colSpan={6} className="px-4 py-16 text-center text-muted">Loading deleted sessions…</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
