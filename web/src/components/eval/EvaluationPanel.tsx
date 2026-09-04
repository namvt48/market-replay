import { Activity, ArrowRight, BarChart3, ClipboardCheck, Download, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { evalAccountName, evalStatus, shortEvalAccountHash } from '../../eval/rules'
import type { EvalConfig, EvalRuntime, EvalStatus, EvalTradeRecord } from '../../eval/rules'
import { replayEngine } from '../../replay/replay-engine'
import { useEvalSession } from '../../replay/use-eval-session'
import { useReplaySelector } from '../../replay/use-replay'
import { deleteEvalAccount, deriveEvalFinancials, loadEvalAccounts, renameEvalAccount } from '../../store/eval-store'
import type { EvalPhase } from '../../store/eval-store'
import { useUiStore } from '../../store/ui-store'
import { TradeHistoryTable } from '../trades/TradeHistoryTable'
import { useChartWorkspace } from '../../chart-workspace/use-chart-workspace'
import type { ChartTimezone } from '../../replay/chart-timezone'
import { patchSession } from '../../api/client'
import { evaluationDisplayName } from '../../sources/source-name'
import { SourceNameEditor } from '../sources/SourceNameEditor'
import { DetailDialog } from '../ui/DetailDialog'
import { LineChart, type LineChartReferenceLine } from '../analytics/InteractiveAnalyticsCharts'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const percentage = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
})

interface AccountView {
  id: string
  name: string | null
  sessionId: string | null
  config: EvalConfig
  runtime: EvalRuntime
  startDate: string
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

function profitFactor(trades: EvalTradeRecord[]): string {
  let wins = 0
  let losses = 0
  for (const trade of trades) {
    const realized = trade.realizedCents ?? 0
    if (realized > 0) wins += realized
    else losses += Math.abs(realized)
  }
  return losses > 0 ? (wins / losses).toFixed(2) : '—'
}

function equityCurve(trades: EvalTradeRecord[], startBalance: number, startDate: string): { values: number[]; labels: string[] } {
  const values = [startBalance]
  const labels = [startDate]
  let balance = startBalance
  for (const trade of trades.toSorted((left, right) => left.exitTime - right.exitTime)) {
    balance += (trade.realizedCents ?? 0) / 100
    values.push(balance)
    labels.push(new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(trade.exitTime * 1000)))
  }
  return { values, labels }
}

function Metric({ label, value, tone = 'text-ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-h-20 rounded-[14px] border border-line-strong bg-surface-1 px-4 py-3">
      <dt className="text-ui-body text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  )
}

type ProgressTone = 'accent' | 'profit' | 'loss' | 'caution'

function ProgressLine({ label, value, pct, tone = 'accent' }: { label: string; value: string; pct: number; tone?: ProgressTone }) {
  const progress = Math.max(0, Math.min(100, pct * 100))
  const width = `${progress}%`
  const fill = tone === 'profit' ? 'bg-profit' : tone === 'loss' ? 'bg-loss' : tone === 'caution' ? 'bg-caution' : 'bg-active'
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

function TradeHistory({ trades, timezone }: { trades: EvalTradeRecord[]; timezone: ChartTimezone }) {
  return (
    <TradeHistoryTable
      timezone={timezone}
      headingId="evaluation-trade-history"
      fullBleed
      trades={trades.map((trade, index) => ({
        id: trade.id ?? `${trade.exitTime}-${index}`,
        symbol: trade.symbol ?? '—',
        side: trade.side ?? null,
        qty: trade.qty ?? 1,
        entryTime: trade.entryTime,
        exitTime: trade.exitTime,
        realizedCents: trade.realizedCents ?? 0,
        mfeTicks: trade.mfeTicks ?? 0,
        maeTicks: trade.maeTicks ?? 0,
        rMultiple: trade.rMultiple ?? null,
      }))}
    />
  )
}

function downloadEvalTradeHistory(account: AccountView): void {
  const rows = [
    ['account_id', 'account_name', 'symbol', 'side', 'quantity', 'entry_time', 'exit_time', 'realized_cents', 'fees_cents', 'mfe_ticks', 'mae_ticks', 'r_multiple'],
    ...account.trades.map((trade) => [
      account.id, evaluationDisplayName({ accountId: account.id, name: account.name }), trade.symbol ?? '', trade.side ?? '', String(trade.qty ?? 1),
      trade.entryTime ? new Date(trade.entryTime * 1_000).toISOString() : '', trade.exitTime ? new Date(trade.exitTime * 1_000).toISOString() : '',
      String(trade.realizedCents ?? 0), String(trade.feesCents ?? 0), String(trade.mfeTicks ?? 0), String(trade.maeTicks ?? 0), trade.rMultiple?.toFixed(2) ?? '',
    ]),
  ].map((row) => row.map((value) => /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(',')).join('\n')
  const blob = new Blob([rows], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${evaluationDisplayName({ accountId: account.id, name: account.name }).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || shortEvalAccountHash(account.id)}-trades.csv`
  anchor.click()
  queueMicrotask(() => URL.revokeObjectURL(url))
}

export function EvaluationPanel() {
  const { state: chartWorkspace } = useChartWorkspace()
  const openReview = useUiStore((state) => state.openReview)
  const session = useEvalSession((state) => ({
    accountId: state.accountId,
    name: state.name,
    sessionId: state.sessionId,
    phase: state.phase,
    config: state.config,
    runtime: state.runtime,
    startDate: state.startDate,
    startTs: state.startTs,
    baselineRealizedCents: state.baselineRealizedCents,
    baselineEquityCents: state.baselineEquityCents,
    lastEvalBalance: state.lastEvalBalance,
    lastEvalEquity: state.lastEvalEquity,
    needsFillRebase: state.needsFillRebase,
    trades: state.trades,
    sessionTimezone: state.sessionTimezone,
    restoreAccount: state.restoreAccount,
    activateEvaluation: state.activateEvaluation,
    retry: state.retry,
  }))
  const replay = useReplaySelector((snapshot) => ({ fill: snapshot.evalFill ?? snapshot.fill }))
  const [detailAccountId, setDetailAccountId] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [accountsVersion, setAccountsVersion] = useState(0)
  const detailTriggerRef = useRef<HTMLButtonElement>(null)
  const accountRegistryKey = `${session.accountId ?? 'none'}:${session.phase}`
  const savedAccounts = useMemo(() => {
    void accountRegistryKey
    void accountsVersion
    return loadEvalAccounts()
  }, [accountRegistryKey, accountsVersion])

  // Recomputing evalStatus() for every saved account (up to 50) on every
  // tick was pure waste: only the live session's status needs to update
  // that often (~10Hz while running). Split so savedAccountViews only
  // recomputes when the saved list or the current account id changes,
  // while the per-tick current-account branch below stays cheap (a
  // filter, not another 50 evalStatus() calls).
  const savedAccountViews = useMemo<AccountView[]>(() => savedAccounts.map((account) => {
    const balance = account.lastEvalBalance
    const equity = account.lastEvalEquity
    const status = evalStatus(account.config, account.runtime, { balance, equity, trades: account.trades }, account.sessionTimezone)
    return {
      id: account.accountId,
      name: account.name ?? null,
      sessionId: account.sessionId ?? null,
      config: account.config,
      runtime: account.runtime,
      startDate: account.startDate,
      balance,
      equity,
      status,
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
        name: session.name,
        sessionId: session.sessionId,
        config: session.config,
        runtime: session.runtime,
        startDate: session.startDate ?? '—',
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

  const selected = detailAccountId ? accounts.find((account) => account.id === detailAccountId) ?? null : null
  const selectedDisplayName = selected ? evaluationDisplayName({ accountId: selected.id, name: selected.name }) : ''
  const selectedEquityCurve = selected ? equityCurve(selected.trades, selected.runtime.startBalance, selected.startDate) : null
  const selectedEquityReferenceLines: LineChartReferenceLine[] = selected ? [
    ...(selected.config.profitTarget > 0 ? [{ value: selected.runtime.startBalance + selected.config.profitTarget, label: 'Profit target', tone: 'profit' as const }] : []),
    ...(selected.config.maxTotalLoss > 0 ? [{ value: selected.runtime.startBalance - selected.config.maxTotalLoss, label: 'Max loss', tone: 'loss' as const }] : []),
  ] : []
  const selectedReportsHref = selected?.sessionId ? `/analytics?analytics=${encodeURIComponent(selected.sessionId)}&sourceType=evaluation` : null
  const releaseActiveSession = async (): Promise<boolean> => {
    if (replayEngine.getSnapshot().sessionStatus !== 'active') return true
    await replayEngine.pauseReplaySession()
    return replayEngine.getSnapshot().sessionStatus !== 'active'
  }
  const resumeSelected = async (): Promise<void> => {
    if (!selected) return
    if (!await releaseActiveSession()) return
    if (!selected.isCurrent) session.restoreAccount(selected.id)
    session.activateEvaluation()
    await replayEngine.syncEvaluationSession()
  }
  const activate = async (): Promise<void> => {
    if (!await releaseActiveSession()) return
    session.activateEvaluation()
    await replayEngine.syncEvaluationSession()
  }
  const retry = async (): Promise<void> => {
    if (!await releaseActiveSession()) return
    session.retry()
    await replayEngine.syncEvaluationSession()
  }
  const deleteSelected = (): void => {
    if (!selected) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    deleteEvalAccount(selected.id)
    setAccountsVersion((version) => version + 1)
    setConfirmingDelete(false)
    setDetailAccountId(null)
  }
  const renameSelected = async (name: string): Promise<void> => {
    if (!selected) return
    if (selected.sessionId) {
      const backendName = name.trim() || `#${shortEvalAccountHash(selected.id)}`
      await patchSession(selected.sessionId, { name: backendName })
    }
    const renamed = renameEvalAccount(selected.id, name)
    if (!renamed) throw new Error('Evaluation account could not be renamed')
    setAccountsVersion((version) => version + 1)
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
              {accounts.map((account) => {
                const live = account.isCurrent && account.phase === 'running'
                const displayName = evaluationDisplayName({ accountId: account.id, name: account.name })
                const hash = `#${shortEvalAccountHash(account.id)}`
                const ruleLabel = evalAccountName(account.config)
                const metadata = [
                  ruleLabel === 'Custom' ? null : ruleLabel,
                  displayName !== hash ? hash : null,
                  account.startDate,
                ].filter((item): item is string => item !== null)
                return (
                  <li key={account.id}>
                    <button type="button" onClick={(event) => { if (account.phase === 'ready') return; detailTriggerRef.current = event.currentTarget; setDetailAccountId(account.id); setConfirmingDelete(false) }} aria-current={live ? 'true' : undefined} aria-label={`Inspect evaluation account ${displayName}, ${ruleLabel}`} className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${live ? 'bg-active/10 ring-1 ring-inset ring-active/35 hover:bg-active/15' : account.phase === 'ready' ? 'cursor-default hover:bg-surface-2' : 'hover:bg-surface-2'}`}>
                      <span className={`size-2 shrink-0 rounded-full ${account.runtime.outcome === 'failed' ? 'bg-loss' : account.runtime.outcome === 'passed' ? 'bg-profit' : live ? 'bg-active' : 'bg-muted'}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <strong className={`block truncate text-ui-body font-medium ${live ? 'text-active-bright' : 'text-ink'}`}>{displayName}</strong>
                        <span className="mt-0.5 flex items-center gap-1.5 text-ui-meta text-dim">
                          {metadata.map((item, index) => (
                            <span key={item} className="contents">
                              {index > 0 ? <span aria-hidden="true">·</span> : null}
                              {item === hash ? <code className="text-muted" title={`Full account ID: ${account.id}`}>{item}</code> : <span className={item === account.startDate ? 'shrink-0 font-mono' : 'truncate'}>{item}</span>}
                            </span>
                          ))}
                        </span>
                      </span>
                      <span className={`text-ui-meta font-semibold ${statusTone(account)}`}>{statusLabel(account)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          {selected ? (
            <DetailDialog
              titleId="eval-account-details-heading"
              onClose={() => setDetailAccountId(null)}
              returnFocusRef={detailTriggerRef}
              title={<div className="flex min-w-0 items-center gap-1.5"><h2 id="eval-account-details-heading" className="truncate text-ui-title font-semibold text-ink">{selectedDisplayName}</h2><SourceNameEditor currentName={selected.name} defaultName={`#${shortEvalAccountHash(selected.id)}`} sourceLabel="evaluation account" onSave={renameSelected} /></div>}
              status={<span className={`flex items-center gap-1 rounded-control bg-surface-2 px-2 py-1 font-mono text-ui-meta font-semibold ${statusTone(selected)}`}>{selected.isCurrent && selected.phase === 'running' ? <span className="size-1.5 animate-replay-pulse rounded-full bg-active" aria-hidden="true" /> : null}{statusLabel(selected)}</span>}
            >
            <section className="p-4 sm:p-5" aria-labelledby="eval-account-details-heading">

              {selected.phase === 'ready' ? (
                <div className="border-t border-line px-3 py-5">
                  <p className="text-ui-body font-medium text-ink">This account has not started.</p>
                  <p className="mt-1 text-ui-meta leading-relaxed text-muted">Balance, equity, rule progress, and trade history begin only when you start the evaluation.</p>
                  <div className="mt-4 flex gap-2">
                    <button type="button" onClick={selected.isCurrent ? activate : resumeSelected} className="primary-button flex-1"><ArrowRight size={14} />Start Eval</button>
                    <button type="button" onClick={deleteSelected} className={`shrink-0 ${confirmingDelete ? 'primary-button bg-loss text-white' : 'secondary-button text-loss'}`} aria-label={confirmingDelete ? `Confirm delete ${evalAccountName(selected.config)} evaluation` : `Delete ${evalAccountName(selected.config)} evaluation`}><Trash2 size={14} />{confirmingDelete ? 'Confirm delete' : 'Delete Eval'}</button>
                  </div>
                </div>
              ) : (
                <>
              <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-[14px] border border-line-strong bg-surface-1 p-4" aria-labelledby="account-rules-heading">
              <h3 id="account-rules-heading" className="text-ui-body font-semibold text-ink">Account rules</h3>
              <div className="mt-2 divide-y divide-line">
              <ProgressLine
                label="Account size"
                value={`${currency.format(selected.balance)} / ${currency.format(selected.config.accountSize)}`}
                pct={selected.balance / selected.config.accountSize}
                tone="accent"
              />
              <ProgressLine
                label="Profit target"
                value={`${currency.format(selected.status.realizedProfit)} / ${currency.format(selected.config.profitTarget)}`}
                pct={selected.status.targetPct}
                tone={selected.status.targetPct >= 1 ? 'profit' : selected.runtime.outcome === 'failed' ? 'loss' : 'accent'}
              />
              <ProgressLine
                label="Max drawdown"
                value={`${currency.format(selected.status.totalDrawdown)} / ${currency.format(selected.config.maxTotalLoss)}`}
                pct={selected.status.totalPct}
                tone={selected.status.totalPct >= 1 || selected.status.failReason === 'total' ? 'loss' : 'caution'}
              />
              {selected.config.maxDailyLoss > 0 ? (
                <ProgressLine label="Daily loss limit" value={`${currency.format(selected.status.dailyLoss)} / ${currency.format(selected.config.maxDailyLoss)}`} pct={selected.status.dailyPct} tone={selected.status.dailyPct >= 1 || selected.status.failReason === 'daily' ? 'loss' : 'caution'} />
              ) : null}
              {selected.config.minTradingDays > 0 ? (
                <ProgressLine label="Min trading days" value={`${selected.status.daysTraded} / ${selected.config.minTradingDays}`} pct={selected.status.daysTraded / selected.config.minTradingDays} tone={selected.status.minDaysMet ? 'profit' : 'accent'} />
              ) : null}
              {selected.config.consistencyRulePct > 0 ? (
                <ProgressLine label="Consistency" value={`${selected.status.realizedProfit > 0 ? percentage.format(selected.status.consistencyPct) : '—'} / ${selected.config.consistencyRulePct}%`} pct={selected.status.consistencyPct / (selected.config.consistencyRulePct / 100)} tone={selected.status.consistencyMet ? 'profit' : selected.status.targetPct >= 1 ? 'loss' : 'caution'} />
              ) : null}
              </div>
              </section>
              <dl className="grid grid-cols-2 gap-2">
                <Metric label="Balance" value={currency.format(selected.balance)} />
                <Metric label="Equity" value={currency.format(selected.equity)} tone={selected.status.liveProfit >= 0 ? 'text-profit-bright' : 'text-loss-bright'} />
                <Metric label="Realized P&L" value={currency.format(selected.status.realizedProfit)} tone={selected.status.realizedProfit >= 0 ? 'text-profit-bright' : 'text-loss-bright'} />
                <Metric label="Peak equity" value={currency.format(selected.runtime.peakEquity)} />
                <Metric label="Closed trades" value={String(selected.trades.length)} />
                <Metric label="Profit factor" value={profitFactor(selected.trades)} />
              </dl>
              </div>
              {selectedEquityCurve ? <section className="mt-4 rounded-[14px] border border-line-strong bg-surface-1 p-4" aria-labelledby="evaluation-equity-curve-heading">
                <h3 id="evaluation-equity-curve-heading" className="text-ui-body font-semibold text-ink">Equity curve</h3>
                <div className="mt-3 overflow-x-auto pb-1">
                  <LineChart values={selectedEquityCurve.values} xLabels={selectedEquityCurve.labels} referenceLines={selectedEquityReferenceLines} fillArea showPoints valueLabel="Equity" valueFormatter={(value) => currency.format(value)} ariaLabel="Equity curve for this evaluation account" />
                </div>
              </section> : null}
              {selected.isCurrent && selected.phase === 'running' ? <div className="mt-4 grid w-full grid-cols-2 gap-2 sm:grid-cols-3"><button type="button" disabled={selected.trades.length === 0} onClick={() => downloadEvalTradeHistory(selected)} className="secondary-button w-full justify-center" aria-label="Download evaluation trade history as CSV"><Download size={14} />CSV</button><a href={selectedReportsHref ?? '/analytics'} className="secondary-button w-full justify-center" aria-label={`Open evaluation account ${selectedDisplayName} reports`}><BarChart3 size={14} />Reports</a><button type="button" onClick={() => { openReview({ id: selected.id, type: 'evaluation', title: selectedDisplayName }); setDetailAccountId(null) }} className="secondary-button w-full justify-center"><ClipboardCheck size={14} />Review</button></div> : null}

              {selected.runtime.outcome === 'in_progress' && (!selected.isCurrent || selected.phase === 'paused') ? (
                <div className="mt-4 grid w-full grid-cols-2 gap-2 sm:grid-cols-5">
                  <button type="button" onClick={resumeSelected} className="primary-button w-full justify-center"><ArrowRight size={14} />Resume Eval</button>
                  <button type="button" disabled={selected.trades.length === 0} onClick={() => downloadEvalTradeHistory(selected)} className="secondary-button w-full justify-center" aria-label="Download evaluation trade history as CSV"><Download size={14} />CSV</button>
                  <a href={selectedReportsHref ?? '/analytics'} className="secondary-button w-full justify-center" aria-label={`Open evaluation account ${selectedDisplayName} reports`}><BarChart3 size={14} />Reports</a>
                  <button type="button" onClick={() => { openReview({ id: selected.id, type: 'evaluation', title: selectedDisplayName }); setDetailAccountId(null) }} className="secondary-button w-full justify-center"><ClipboardCheck size={14} />Review</button>
                  <button type="button" onClick={deleteSelected} className={`w-full justify-center ${confirmingDelete ? 'primary-button bg-loss text-white' : 'secondary-button text-loss'}`} aria-label={confirmingDelete ? `Confirm delete ${evalAccountName(selected.config)} evaluation` : `Delete ${evalAccountName(selected.config)} evaluation`}><Trash2 size={14} />{confirmingDelete ? 'Confirm delete' : 'Delete Eval'}</button>
                </div>
              ) : null}
              {selected.runtime.outcome === 'failed' ? (
                <div className="mt-4 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
                  {selected.isCurrent ? <button type="button" onClick={retry} className="primary-button w-full justify-center"><RotateCcw size={14} />Retry with new account</button> : null}
                  <button type="button" disabled={selected.trades.length === 0} onClick={() => downloadEvalTradeHistory(selected)} className="secondary-button w-full justify-center" aria-label="Download evaluation trade history as CSV"><Download size={14} />CSV</button>
                  <a href={selectedReportsHref ?? '/analytics'} className="secondary-button w-full justify-center" aria-label={`Open evaluation account ${selectedDisplayName} reports`}><BarChart3 size={14} />Reports</a>
                  <button type="button" onClick={deleteSelected} className={`w-full justify-center ${confirmingDelete ? 'primary-button bg-loss text-white' : 'secondary-button text-loss'}`} aria-label={confirmingDelete ? `Confirm delete ${evalAccountName(selected.config)} evaluation` : `Delete ${evalAccountName(selected.config)} evaluation`}><Trash2 size={14} />{confirmingDelete ? 'Confirm delete' : 'Delete Eval'}</button>
                </div>
              ) : null}
              {selected.runtime.outcome === 'passed' ? (
                <div className="mt-4 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
                  <button type="button" disabled={selected.trades.length === 0} onClick={() => downloadEvalTradeHistory(selected)} className="secondary-button w-full justify-center" aria-label="Download evaluation trade history as CSV"><Download size={14} />CSV</button>
                  <a href={selectedReportsHref ?? '/analytics'} className="secondary-button w-full justify-center" aria-label={`Open evaluation account ${selectedDisplayName} reports`}><BarChart3 size={14} />Reports</a>
                  <button type="button" onClick={() => { openReview({ id: selected.id, type: 'evaluation', title: selectedDisplayName }); setDetailAccountId(null) }} className="secondary-button w-full justify-center"><ClipboardCheck size={14} />Review</button>
                  <button type="button" onClick={deleteSelected} className={`w-full justify-center ${confirmingDelete ? 'primary-button bg-loss text-white' : 'secondary-button text-loss'}`} aria-label={confirmingDelete ? `Confirm delete ${evalAccountName(selected.config)} evaluation` : `Delete ${evalAccountName(selected.config)} evaluation`}><Trash2 size={14} />{confirmingDelete ? 'Confirm delete' : 'Delete Eval'}</button>
                </div>
              ) : null}
                </>
              )}

              <TradeHistory trades={selected.trades} timezone={chartWorkspace.timezone} />
            </section>
            </DetailDialog>
          ) : null}
        </div>
      )}
    </div>
  )
}
