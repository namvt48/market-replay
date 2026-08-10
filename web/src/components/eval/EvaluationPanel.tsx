import { Activity, ArrowRight, History, Plus, RotateCcw, Trophy } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { evalAccountName, evalStatus, shortEvalAccountHash } from '../../eval/rules'
import type { EvalConfig, EvalRuntime, EvalStatus, EvalTradeRecord } from '../../eval/rules'
import { replayEngine } from '../../replay/replay-engine'
import { useEvalSession } from '../../replay/use-eval-session'
import { useReplaySelector } from '../../replay/use-replay'
import { deriveEvalFinancials, loadEvalAccounts } from '../../store/eval-store'
import type { EvalPhase } from '../../store/eval-store'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const accountTime = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const percentage = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
})

interface AccountView {
  id: string
  config: EvalConfig
  runtime: EvalRuntime
  instrument: string
  startDate: string
  lastCursorTs: number
  status: EvalStatus
  balance: number
  equity: number
  trades: EvalTradeRecord[]
  isCurrent: boolean
  phase: Exclude<EvalPhase, 'idle'>
}

function statusLabel(account: AccountView): string {
  if (account.phase === 'ready') return 'READY'
  if (account.runtime.outcome === 'passed') return 'PASSED'
  if (account.runtime.outcome === 'failed') return 'FAILED'
  return account.isCurrent && account.phase === 'running' ? 'LIVE' : 'PAUSED'
}

function statusTone(account: AccountView): string {
  if (account.phase === 'ready') return 'text-muted'
  if (account.runtime.outcome === 'passed') return 'text-profit-bright'
  if (account.runtime.outcome === 'failed') return 'text-loss-bright'
  return account.isCurrent && account.phase === 'running' ? 'text-active-bright' : 'text-muted'
}

function Metric({ label, value, tone = 'text-ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border-b border-line py-2.5 last:border-b-0">
      <dt className="text-ui-meta text-dim">{label}</dt>
      <dd className={`mt-0.5 font-mono text-ui-body font-medium tabular-nums ${tone}`}>{value}</dd>
    </div>
  )
}

type ProgressTone = 'accent' | 'profit' | 'loss'

function ProgressLine({ label, value, pct, tone = 'accent' }: { label: string; value: string; pct: number; tone?: ProgressTone }) {
  const progress = Math.max(0, Math.min(100, pct * 100))
  const width = `${progress}%`
  const fill = tone === 'profit' ? 'bg-profit' : tone === 'loss' ? 'bg-loss' : 'bg-active'
  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-ui-meta">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-ink">{value}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <div className={`h-full rounded-full ${fill}`} style={{ width }} />
      </div>
    </div>
  )
}

function TradeHistory({ trades }: { trades: EvalTradeRecord[] }) {
  if (trades.length === 0) {
    return (
      <div className="grid place-items-center px-5 py-8 text-center">
        <History size={20} className="mb-2 text-dim" />
        <p className="text-ui-body text-muted">Closed trades for this account will appear here.</p>
      </div>
    )
  }
  return (
    <ol className="divide-y divide-line">
      {trades.toReversed().map((trade, index) => {
        const pnl = trade.realizedCents === undefined ? null : trade.realizedCents / 100
        return (
          <li key={trade.id ?? `${trade.exitTime}-${index}`} className="px-3 py-2.5">
            <div className="flex items-start justify-between gap-2 text-ui-body">
              <span>
                {trade.side ? <strong className={trade.side === 'long' ? 'text-profit-bright' : 'text-loss-bright'}>{trade.side.toUpperCase()}</strong> : <strong className="text-ink">CLOSED</strong>}
                <span className="ml-1.5 text-ink">{trade.qty ?? '—'} {trade.symbol ?? ''}</span>
              </span>
              <span className={`font-mono font-semibold ${pnl === null || pnl >= 0 ? 'text-profit-bright' : 'text-loss-bright'}`}>
                {pnl === null ? '—' : currency.format(pnl)}
              </span>
            </div>
            <time dateTime={new Date(trade.exitTime * 1000).toISOString()} className="mt-1 block font-mono text-ui-meta text-dim">
              {trade.entryTime ? `${accountTime.format(trade.entryTime * 1000)} → ` : ''}{accountTime.format(trade.exitTime * 1000)}
            </time>
            {trade.mfeTicks !== undefined || trade.maeTicks !== undefined ? (
              <p className="mt-1 font-mono text-ui-meta text-muted">MFE {trade.mfeTicks ?? '—'}t · MAE {trade.maeTicks ?? '—'}t</p>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export function EvaluationPanel() {
  const { session } = useEvalSession()
  const replay = useReplaySelector((snapshot) => ({ fill: snapshot.fill }))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const accountRegistryKey = `${session.accountId ?? 'none'}:${session.phase}`
  const savedAccounts = useMemo(() => {
    void accountRegistryKey
    return loadEvalAccounts()
  }, [accountRegistryKey])

  // Recomputing evalStatus() for every saved account (up to 50) on every
  // tick was pure waste: only the live session's status needs to update
  // that often (~10Hz while running). Split so savedAccountViews only
  // recomputes when the saved list or the current account id changes,
  // while the per-tick current-account branch below stays cheap (a
  // filter, not another 50 evalStatus() calls).
  const savedAccountViews = useMemo<AccountView[]>(() => savedAccounts.map((account) => {
    const balance = account.lastEvalBalance
    const equity = account.lastEvalEquity
    return {
      id: account.accountId,
      config: account.config,
      runtime: account.runtime,
      instrument: account.instrument,
      startDate: account.startDate,
      lastCursorTs: account.lastCursorTs,
      balance,
      equity,
      status: evalStatus(account.config, account.runtime, { balance, equity, trades: account.trades }, account.sessionTimezone),
      trades: account.trades,
      isCurrent: account.accountId === session.accountId,
      phase: account.phase,
    }
  }), [savedAccounts, session.accountId])

  const accounts = useMemo<AccountView[]>(() => {
    const currentFinancials = deriveEvalFinancials(session, replay.fill)
    if (session.accountId && session.config && session.runtime && currentFinancials) {
      const current: AccountView = {
        id: session.accountId,
        config: session.config,
        runtime: session.runtime,
        instrument: session.instrument ?? '—',
        startDate: session.startDate ?? '—',
        lastCursorTs: session.lastCursorTs ?? session.startTs ?? 0,
        balance: currentFinancials.balance,
        equity: currentFinancials.equity,
        status: currentFinancials.status,
        trades: session.trades,
        isCurrent: true,
        phase: session.phase === 'idle' ? 'ready' : session.phase,
      }
      const withoutCurrent = savedAccountViews.filter((account) => account.id !== current.id)
      return [current, ...withoutCurrent]
    }
    return savedAccountViews
  }, [replay.fill, savedAccountViews, session])

  useEffect(() => {
    if (session.accountId) setSelectedId(session.accountId)
  }, [session.accountId])

  useEffect(() => {
    if (!selectedId && accounts[0]) setSelectedId(accounts[0].id)
  }, [accounts, selectedId])

  const selected = accounts.find((account) => account.id === selectedId) ?? accounts[0] ?? null
  const resumeSelected = (): void => {
    if (!selected) return
    if (!selected.isCurrent) session.restoreAccount(selected.id)
    session.activateEvaluation()
    void replayEngine.syncEvaluationSession()
  }
  const activate = (): void => {
    session.activateEvaluation()
    void replayEngine.syncEvaluationSession()
  }
  const retry = (): void => {
    session.retry()
    void replayEngine.syncEvaluationSession()
  }
  const goFunded = (): void => {
    session.goFunded()
    void replayEngine.syncEvaluationSession()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <div>
          <h2 className="text-ui-body font-semibold text-ink">Evaluation accounts</h2>
          <p className="text-ui-meta text-dim">{accounts.length} saved</p>
        </div>
        <a href="/start/eval" className="primary-button h-7 px-2.5" aria-label="Create new evaluation account"><Plus size={13} />New</a>
      </header>

      {accounts.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
          <div>
            <Activity size={24} className="mx-auto mb-3 text-dim" />
            <p className="text-ui-body font-medium text-ink">No evaluation accounts</p>
            <p className="mt-1 text-ui-meta leading-relaxed text-muted">Create an account to backtest prop rules and preserve its progress.</p>
            <a href="/start/eval" className="primary-button mt-4 inline-flex">Create evaluation</a>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <section aria-labelledby="eval-accounts-heading">
            <h3 id="eval-accounts-heading" className="border-b border-line px-3 py-2 text-ui-meta font-semibold tracking-[0.04em] text-muted">ACCOUNTS</h3>
            <ul className="divide-y divide-line">
              {accounts.map((account) => (
                <li key={account.id}>
                  <button type="button" onClick={() => setSelectedId(account.id)} aria-pressed={selected?.id === account.id} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-2 aria-pressed:bg-surface-3">
                    <span className={`size-2 shrink-0 rounded-full ${account.runtime.outcome === 'failed' ? 'bg-loss' : account.runtime.outcome === 'passed' ? 'bg-profit' : account.isCurrent && account.phase === 'running' ? 'bg-active' : 'bg-muted'}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-ui-body font-medium text-ink">{evalAccountName(account.config)}</strong>
                      <span className="mt-0.5 flex items-center gap-1.5 font-mono text-ui-meta text-dim">
                        <span>{account.instrument}</span>
                        <span aria-hidden="true">·</span>
                        <code className="text-muted" title={`Full account ID: ${account.id}`}>#{shortEvalAccountHash(account.id)}</code>
                        <span aria-hidden="true">·</span>
                        <span>{account.startDate}</span>
                      </span>
                    </span>
                    <span className={`text-ui-meta font-semibold ${statusTone(account)}`}>{statusLabel(account)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {selected ? (
            <section className="border-t border-line" aria-labelledby="eval-account-details-heading">
              <div className="flex items-start justify-between gap-3 px-3 py-3">
                <div>
                  <h3 id="eval-account-details-heading" className="text-ui-title font-semibold text-ink">{evalAccountName(selected.config)}</h3>
                  <p className="mt-0.5 font-mono text-ui-meta text-dim">
                    <code className="text-muted" title={`Full account ID: ${selected.id}`}>#{shortEvalAccountHash(selected.id)}</code>
                    <span aria-hidden="true"> · </span>
                    Updated {accountTime.format(selected.lastCursorTs * 1000)}
                  </p>
                </div>
                <span className={`text-ui-meta font-semibold ${statusTone(selected)}`}>{statusLabel(selected)}</span>
              </div>

              {selected.phase === 'ready' ? (
                <div className="border-t border-line px-3 py-5">
                  <p className="text-ui-body font-medium text-ink">This account has not started.</p>
                  <p className="mt-1 text-ui-meta leading-relaxed text-muted">Balance, equity, rule progress, and trade history begin only when you start the evaluation.</p>
                  <button type="button" onClick={selected.isCurrent ? activate : resumeSelected} className="primary-button mt-4 w-full"><ArrowRight size={14} />Start Eval</button>
                </div>
              ) : (
                <>
              <dl className="grid grid-cols-2 gap-x-3 border-y border-line px-3">
                <Metric label="Balance" value={currency.format(selected.balance)} />
                <Metric label="Equity" value={currency.format(selected.equity)} tone={selected.status.liveProfit >= 0 ? 'text-profit-bright' : 'text-loss-bright'} />
                <Metric label="Realized P&L" value={currency.format(selected.status.realizedProfit)} tone={selected.status.realizedProfit >= 0 ? 'text-profit-bright' : 'text-loss-bright'} />
                <Metric label="Peak equity" value={currency.format(selected.runtime.peakEquity)} />
                <Metric label="Trading days" value={String(selected.status.daysTraded)} />
                <Metric label="Closed trades" value={String(selected.trades.length)} />
              </dl>

              <div className="px-3 py-2">
                <ProgressLine label="Profit target" value={`${Math.round(selected.status.targetPct * 100)}%`} pct={selected.status.targetPct} />
                <ProgressLine label="Total drawdown" value={currency.format(selected.status.totalRemaining)} pct={selected.status.totalPct} tone="loss" />
                {selected.config.maxDailyLoss > 0 ? <ProgressLine label="Daily loss" value={currency.format(selected.status.dailyRemaining)} pct={selected.status.dailyPct} tone="loss" /> : null}
                {selected.config.consistencyRulePct > 0 ? (
                  <ProgressLine
                    label="Consistency"
                    value={`${selected.status.realizedProfit > 0 ? percentage.format(selected.status.consistencyPct) : '—'} / ${selected.config.consistencyRulePct}%`}
                    pct={selected.status.consistencyPct / (selected.config.consistencyRulePct / 100)}
                    tone={selected.status.consistencyMet ? 'profit' : selected.status.targetPct >= 1 ? 'loss' : 'accent'}
                  />
                ) : null}
              </div>

              {selected.runtime.outcome === 'in_progress' && (!selected.isCurrent || selected.phase === 'paused') ? (
                <div className="border-t border-line p-3"><button type="button" onClick={resumeSelected} className="primary-button w-full"><ArrowRight size={14} />Resume Eval</button></div>
              ) : null}
              {selected.isCurrent && selected.runtime.outcome === 'failed' ? (
                <div className="border-t border-line p-3"><button type="button" onClick={retry} className="primary-button w-full"><RotateCcw size={14} />Retry with new account</button></div>
              ) : null}
              {selected.isCurrent && selected.runtime.outcome === 'passed' ? (
                <div className="border-t border-line p-3"><button type="button" onClick={goFunded} className="primary-button w-full"><Trophy size={14} />Start funded account</button></div>
              ) : null}

              <h3 className="border-y border-line px-3 py-2 text-ui-meta font-semibold tracking-[0.04em] text-muted">TRADE HISTORY</h3>
              <TradeHistory trades={selected.trades} />
                </>
              )}
            </section>
          ) : null}
        </div>
      )}
    </div>
  )
}
