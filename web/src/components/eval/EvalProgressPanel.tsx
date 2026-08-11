import { LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { evalAccountName, evalStatus, payoutEligibility } from '../../eval/rules'
import { useEvalSession } from '../../replay/use-eval-session'
import { useReplaySelector } from '../../replay/use-replay'
import { replayEngine } from '../../replay/replay-engine'
import { EvalResultCard } from './EvalResultCard'

const fmt$ = (n: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const fmtPct = (n: number): string =>
  new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(n)

const clampPct = (pct: number): number => Math.min(100, Math.max(0, pct * 100))

type GaugeTone = 'accent' | 'profit' | 'loss'

interface GaugeProps {
  label: string
  value: string
  pct: number
  buffer: string
  tone: GaugeTone
}

function Gauge({ label, value, pct, buffer, tone }: GaugeProps): ReactElement {
  const fill = tone === 'profit' ? 'bg-profit' : tone === 'loss' ? 'bg-loss' : 'bg-active'
  return (
    <div className="min-w-56 flex-1 bg-surface-1 p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-ui-meta text-dim">{label}</span>
        <span className="font-mono text-ui-body text-ink">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-surface-3" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clampPct(pct))}>
        <div
          className={`h-full rounded-full ${fill} transition-[width] duration-150`}
          style={{ width: `${clampPct(pct)}%` }}
        />
      </div>
      <div className="mt-1 text-ui-meta text-dim">{buffer}</div>
    </div>
  )
}

export function EvalProgressPanel(): ReactElement | null {
  const { session } = useEvalSession()
  const replay = useReplaySelector((snapshot) => ({ fill: snapshot.evalFill ?? snapshot.fill }))
  const [dismissed, setDismissed] = useState(false)
  const [payoutMessage, setPayoutMessage] = useState<string | null>(null)

  const phase = session.phase
  const config = session.config
  const runtime = session.runtime

  useEffect(() => {
    if (phase === 'running') setDismissed(false)
  }, [phase])

  if (phase === 'idle' || phase === 'ready' || phase === 'paused' || !config || !runtime) return null

  const fill = replay.fill
  const baselineRealized = session.baselineRealizedCents
  const baselineEquity = session.baselineEquityCents
  const baselinesReady = fill !== null && baselineRealized !== null && baselineEquity !== null && !session.needsFillRebase
  const derivedBalance = baselinesReady
    ? config.accountSize + (fill.realizedCents - baselineRealized) / 100
    : (session.lastEvalBalance ?? config.accountSize)
  const derivedEquity = baselinesReady
    ? config.accountSize + (fill.equityCents - baselineEquity) / 100
    : (session.lastEvalEquity ?? runtime.lastEquity)
  const status = evalStatus(config, runtime, {
    balance: derivedBalance,
    equity: derivedEquity,
    trades: session.trades,
  }, session.sessionTimezone ?? 'UTC')
  const isFunded = config.phase === 'funded'
  const payoutStatus = isFunded && config.payout
    ? payoutEligibility(config, runtime, status, session.sessionTimezone ?? 'UTC')
    : null

  const passTarget = config.accountSize + config.profitTarget
  const liveProfit = status.liveProfit
  const equityTone = liveProfit > 0 ? 'text-profit-bright' : liveProfit < 0 ? 'text-loss-bright' : 'text-ink'
  const meterTone = status.targetPct >= 1 ? 'bg-profit' : 'bg-active'
  const retry = (): void => {
    session.retry()
    void replayEngine.syncEvaluationSession()
  }
  const goFunded = (): void => {
    session.goFunded()
    void replayEngine.syncEvaluationSession()
  }
  const goVerification = (): void => {
    session.goVerification()
    void replayEngine.syncEvaluationSession()
  }
  const requestPayout = (): void => {
    const result = session.requestPayout()
    setPayoutMessage(result.success && result.payout
      ? `${fmt$(result.payout.traderAmount)} payout recorded after split.`
      : result.reason)
  }

  if (phase !== 'running') {
    if (dismissed) return null
    return (
      <EvalResultCard
        verdict={phase}
        failReason={status.failReason}
        config={config}
        runtime={runtime}
        status={status}
        endingEquity={derivedEquity}
        payoutHistory={session.payoutHistory}
        onRetry={retry}
        onGoVerification={goVerification}
        onGoFunded={goFunded}
        onAbandon={session.abandon}
        onClose={() => setDismissed(true)}
      />
    )
  }

  return (
    <section className="relative shrink-0 border-t border-line bg-surface-1" aria-label="Evaluation progress">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-ui-body">
          <span className="hidden text-ui-meta font-semibold tracking-wide text-muted lg:inline">{isFunded ? 'FUNDED' : config.phase === 'verification' ? 'VERIFICATION' : 'EVALUATION'}</span>
          <span className="max-w-36 truncate font-medium text-ink sm:max-w-none">{evalAccountName(config)}</span>
          <span className="text-dim" aria-hidden="true">·</span>
          <span className="font-mono text-muted">All symbols</span>
          <span className="hidden text-dim sm:inline" aria-hidden="true">·</span>
          <span className="hidden font-mono text-dim sm:inline">{session.startDate || '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          {payoutStatus?.eligible ? (
            <button type="button" onClick={requestPayout} className="primary-button min-h-11 px-2 sm:min-h-9">
              Request {fmt$(payoutStatus.maxPayout)} payout
            </button>
          ) : null}
          <button type="button" onClick={() => { void replayEngine.exitEvaluation() }} className="secondary-button min-h-11 px-2 sm:min-h-9" aria-label="Exit evaluation">
            <LogOut size={13} aria-hidden="true" />
            Exit Eval
          </button>
          <span className="flex items-center gap-1.5 rounded-control bg-surface-2 px-1.5 py-0.5 text-ui-meta font-semibold text-active-bright">
            <span className="size-1.5 animate-replay-pulse rounded-full bg-active" aria-hidden="true" />
            LIVE
          </span>
          <div className="text-right">
            <span className="block text-ui-meta text-dim">Equity</span>
            <span className={`block font-mono text-ui-body font-semibold tabular-nums ${equityTone}`}>
              {fmt$(derivedEquity)}
            </span>
          </div>
        </div>
      </div>

      <div className="px-3 pb-2.5">
        <div className="flex items-center justify-between text-ui-meta text-dim">
          <span className="font-mono">{fmt$(config.accountSize)}</span>
          <span>{isFunded ? 'Funded profit' : `${Math.round(status.targetPct * 100)}%`}</span>
          <span className="font-mono">{fmt$(passTarget)}</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-surface-3" role="progressbar" aria-label="Profit target progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(status.targetPct * 100)}>
          <div
            className={`h-full rounded-full ${meterTone} transition-[width] duration-150`}
            style={{ width: `${clampPct(status.targetPct)}%` }}
          />
        </div>
      </div>

      <div className="flex gap-px overflow-x-auto border-t border-line bg-line [scrollbar-width:thin]">
        {isFunded && payoutStatus ? (
          <Gauge
            label="Payout eligibility"
            value={payoutStatus.eligible ? fmt$(payoutStatus.maxPayout) : 'Not yet'}
            pct={payoutStatus.eligible ? 1 : 0}
            tone={payoutStatus.eligible ? 'profit' : 'accent'}
            buffer={payoutStatus.reason}
          />
        ) : (
          <Gauge
            label="Profit target"
            value={`${fmt$(status.realizedProfit)} / ${fmt$(config.profitTarget)}`}
            pct={status.targetPct}
            tone={status.targetPct >= 1 ? 'profit' : 'accent'}
            buffer={status.targetPct >= 1 ? 'Target reached' : `${fmt$(Math.max(0, config.profitTarget - status.realizedProfit))} to pass`}
          />
        )}
        <Gauge
          label="Drawdown"
          value={`${fmt$(status.totalDrawdown)} / ${fmt$(config.maxTotalLoss)}`}
          pct={status.totalPct}
          tone={status.totalPct >= 1 ? 'loss' : 'accent'}
          buffer={status.totalPct >= 1 ? 'Breached' : `${fmt$(status.totalRemaining)} to breach`}
        />
        {config.maxDailyLoss > 0 ? (
          <Gauge
            label="Daily loss"
            value={`${fmt$(status.dailyLoss)} / ${fmt$(config.maxDailyLoss)}`}
            pct={status.dailyPct}
            tone={status.dailyPct >= 1 ? 'loss' : 'accent'}
            buffer={status.dailyPct >= 1 ? 'Limit hit' : `${fmt$(status.dailyRemaining)} to limit`}
          />
        ) : null}
        {!isFunded && config.minTradingDays > 0 ? (
          <Gauge
            label="Trading days"
            value={`${status.daysTraded} / ${config.minTradingDays}`}
            pct={config.minTradingDays > 0 ? status.daysTraded / config.minTradingDays : 0}
            tone={status.minDaysMet ? 'profit' : 'accent'}
            buffer={status.minDaysMet ? 'Minimum met' : `${Math.max(0, config.minTradingDays - status.daysTraded)} days to go`}
          />
        ) : null}
        {!isFunded && config.consistencyRulePct > 0 ? (
          <Gauge
            label="Consistency"
            value={`${status.realizedProfit > 0 ? fmtPct(status.consistencyPct) : '—'} / ${config.consistencyRulePct}%`}
            pct={status.consistencyPct / (config.consistencyRulePct / 100)}
            tone={status.consistencyMet ? 'profit' : status.targetPct >= 1 ? 'loss' : 'accent'}
            buffer={status.consistencyMet
              ? `Best day ${fmt$(status.bestDayProfit)} · Within rule`
              : status.realizedProfit <= 0
                ? 'Starts after net profit'
                : `${fmt$(status.consistencyRemaining)} more net profit needed`}
          />
        ) : null}
        {isFunded && payoutStatus && config.payout?.eligibilityMode === 'winning-days' ? (
          <Gauge
            label="Payout winning days"
            value={`${runtime.winningDays} / ${config.payout.minWinningDays}`}
            pct={config.payout.minWinningDays > 0 ? runtime.winningDays / config.payout.minWinningDays : 1}
            tone={runtime.winningDays >= config.payout.minWinningDays ? 'profit' : 'accent'}
            buffer={`${fmt$(config.payout.minDailyProfit)} minimum per winning day`}
          />
        ) : null}
        {isFunded && payoutStatus && config.payout && config.payout.eligibilityConsistencyPct > 0 ? (
          <Gauge
            label="Payout consistency"
            value={`${runtime.profitSinceLastPayout > 0 ? fmtPct(payoutStatus.consistencyPct) : '—'} / ${config.payout.eligibilityConsistencyPct}%`}
            pct={payoutStatus.consistencyPct / (config.payout.eligibilityConsistencyPct / 100)}
            tone={payoutStatus.consistencyPct <= config.payout.eligibilityConsistencyPct / 100 ? 'profit' : 'loss'}
            buffer={`Best day ${fmt$(runtime.bestDaySincePayout)} since payout`}
          />
        ) : null}
        {isFunded && payoutStatus && config.payout?.eligibilityMode === 'min-days' ? (
          <Gauge
            label="Funded days"
            value={`${payoutStatus.fundedDays} / ${config.payout.minFundedDays}`}
            pct={config.payout.minFundedDays > 0 ? payoutStatus.fundedDays / config.payout.minFundedDays : 1}
            tone={payoutStatus.fundedDays >= config.payout.minFundedDays ? 'profit' : 'accent'}
            buffer={`${session.payoutHistory.length} payout${session.payoutHistory.length === 1 ? '' : 's'} taken`}
          />
        ) : null}
      </div>

      {payoutMessage ? <p className="border-t border-line px-3 py-1.5 text-ui-meta text-muted" role="status">{payoutMessage}</p> : null}

    </section>
  )
}
