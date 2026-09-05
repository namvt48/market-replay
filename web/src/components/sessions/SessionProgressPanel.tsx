import { ChevronDown, ChevronUp, LogOut } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { EngineTrade } from '../../fill-engine/types'
import { replaySessionDisplayName } from '../../sources/source-name'
import { replayEngine } from '../../replay/replay-engine'
import { useReplaySelector } from '../../replay/use-replay'
import { useEvalStore } from '../../store/eval-store'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function money(value: number): string {
  return currency.format(value)
}

function pnlTone(value: number): string {
  return value > 0 ? 'text-profit-bright' : value < 0 ? 'text-loss-bright' : 'text-ink'
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const minutes = Math.max(0, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

type OutcomeTone = 'profit' | 'loss'

interface OutcomeSummary {
  total: number
  extremePercent: number | null
  averagePercent: number | null
  averageDuration: number | null
  maximumStreak: number
  averageStreak: number | null
}

function outcomeSummary(trades: readonly EngineTrade[], tone: OutcomeTone, startBalance: number): OutcomeSummary {
  const isMatch = (trade: EngineTrade): boolean => tone === 'profit' ? trade.realizedCents > 0 : trade.realizedCents < 0
  const ordered = [...trades].sort((left, right) => left.exitTs - right.exitTs)
  const selected = ordered.filter(isMatch)
  const returns = selected.map((trade) => startBalance > 0 ? trade.realizedCents / 100 / startBalance * 100 : 0)
  const durations = selected.map((trade) => Math.max(0, trade.exitTs - trade.entryTs))
  const streaks: number[] = []
  let current = 0
  for (const trade of ordered) {
    if (isMatch(trade)) current += 1
    else if (current > 0) {
      streaks.push(current)
      current = 0
    }
  }
  if (current > 0) streaks.push(current)
  return {
    total: selected.length,
    extremePercent: returns.length === 0 ? null : tone === 'profit' ? Math.max(...returns) : Math.min(...returns),
    averagePercent: returns.length === 0 ? null : returns.reduce((total, value) => total + value, 0) / returns.length,
    averageDuration: durations.length === 0 ? null : durations.reduce((total, value) => total + value, 0) / durations.length,
    maximumStreak: streaks.length === 0 ? 0 : Math.max(...streaks),
    averageStreak: streaks.length === 0 ? null : streaks.reduce((total, value) => total + value, 0) / streaks.length,
  }
}

function averageDrawdownR(trades: readonly EngineTrade[]): number | null {
  const values = trades.flatMap((trade) => {
    if (trade.initialStopTicks === null) return []
    const riskTicks = Math.abs(trade.entryPriceTicks - trade.initialStopTicks)
    return riskTicks > 0 ? [trade.maeTicks / riskTicks] : []
  })
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length
}

interface LiveMetricProps {
  label: string
  value: string
  tone?: string
}

function LiveMetric({ label, value, tone = 'text-ink' }: LiveMetricProps): ReactElement {
  return (
    <div className="min-w-0 border-line px-3 py-2.5 sm:[&:not(:last-child)]:border-r">
      <dt className="text-ui-meta text-dim">{label}</dt>
      <dd className={`mt-1 truncate font-mono text-ui-body font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  )
}

interface OutcomeMetricProps {
  label: string
  value: string
}

function OutcomeMetric({ label, value }: OutcomeMetricProps): ReactElement {
  return <div className="min-w-0"><dt className="text-ui-meta text-dim">{label}</dt><dd className="mt-0.5 truncate font-mono text-ui-body font-semibold tabular-nums text-ink">{value}</dd></div>
}

interface OutcomeSectionProps {
  title: 'Winners' | 'Losers'
  summary: OutcomeSummary
  tone: OutcomeTone
}

function OutcomeSection({ title, summary, tone }: OutcomeSectionProps): ReactElement {
  const isProfit = tone === 'profit'
  return (
    <section className={`min-w-0 px-3 py-2 ${isProfit ? 'bg-profit/[0.035]' : 'bg-loss/[0.035]'}`} aria-label={`${title} performance`}>
      <h3 className={`mb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.09em] ${isProfit ? 'text-profit-bright' : 'text-loss-bright'}`}>{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 2xl:grid-cols-6">
        <OutcomeMetric label={`Total ${title.toLowerCase()}`} value={String(summary.total)} />
        <OutcomeMetric label={isProfit ? 'Best win' : 'Worst loss'} value={formatPercent(summary.extremePercent)} />
        <OutcomeMetric label={isProfit ? 'Average win' : 'Average loss'} value={formatPercent(summary.averagePercent)} />
        <OutcomeMetric label="Average duration" value={formatDuration(summary.averageDuration)} />
        <OutcomeMetric label={`Max consecutive ${title.toLowerCase()}`} value={String(summary.maximumStreak)} />
        <OutcomeMetric label={`Avg consecutive ${title.toLowerCase()}`} value={summary.averageStreak === null ? '—' : summary.averageStreak.toFixed(2)} />
      </dl>
    </section>
  )
}

export function SessionProgressPanel(): ReactElement | null {
  const evaluationRunning = useEvalStore((state) => state.phase === 'running')
  const replay = useReplaySelector((snapshot) => ({
    sessionId: snapshot.sessionId,
    sessionName: snapshot.sessionName,
    sessionStatus: snapshot.sessionStatus,
    fill: snapshot.fill,
    stats: snapshot.stats,
  }))
  const [collapsed, setCollapsed] = useState(false)
  const active = !evaluationRunning && replay.sessionId !== null && replay.sessionStatus === 'active' && replay.fill !== null

  useEffect(() => {
    if (active) setCollapsed(false)
  }, [active, replay.sessionId])

  if (!active || !replay.sessionId || !replay.fill) return null

  const displayName = replaySessionDisplayName({ id: replay.sessionId, name: replay.sessionName })
  const realized = replay.fill.realizedCents / 100
  const unrealized = replay.fill.unrealizedCents / 100
  const equity = replay.fill.equityCents / 100
  const startBalance = equity - realized - unrealized
  const winners = outcomeSummary(replay.fill.trades, 'profit', startBalance)
  const losers = outcomeSummary(replay.fill.trades, 'loss', startBalance)
  const drawdownR = averageDrawdownR(replay.fill.trades)
  const winRate = replay.stats.trades > 0 ? `${(replay.stats.winRate * 100).toFixed(0)}%` : '—'
  const averageR = replay.stats.averageR === null ? '—' : `${replay.stats.averageR > 0 ? '+' : ''}${replay.stats.averageR.toFixed(2)}R`
  const profitFactor = replay.stats.profitFactor === null ? '—' : replay.stats.profitFactor.toFixed(2)

  if (collapsed) {
    return (
      <section className="shrink-0 border-t border-line bg-surface-1" aria-label="Collapsed replay session progress">
        <div className="flex min-h-10 items-center justify-between gap-3 px-3">
          <div className="flex min-w-0 items-center gap-2 text-ui-meta"><span className="hidden font-semibold tracking-wide text-muted sm:inline">SESSION</span><span className="truncate font-medium text-ink">{displayName}</span><span className="flex shrink-0 items-center gap-1 text-active-bright"><span className="size-1.5 animate-replay-pulse rounded-full bg-active" aria-hidden="true" />LIVE</span></div>
          <div className="flex shrink-0 items-center gap-3"><span className="hidden font-mono text-ui-body font-semibold tabular-nums text-ink sm:inline">{money(equity)}</span><button type="button" onClick={() => setCollapsed(false)} className="secondary-button min-h-8 px-2" aria-label="Show replay session progress" aria-expanded="false">Show session<ChevronUp size={14} aria-hidden="true" /></button></div>
        </div>
      </section>
    )
  }

  return (
    <section className="relative shrink-0 border-t border-line bg-surface-1" aria-label="Replay session progress">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2 text-ui-body"><span className="hidden text-ui-meta font-semibold tracking-wide text-muted md:inline">REPLAY SESSION</span><span className="max-w-44 truncate font-medium text-ink sm:max-w-none">{displayName}</span></div>
        <div className="flex items-center gap-2"><button type="button" onClick={() => setCollapsed(true)} className="secondary-button min-h-11 px-2 sm:min-h-8" aria-label="Hide replay session progress" aria-expanded="true"><span className="hidden sm:inline">Hide</span><ChevronDown size={14} aria-hidden="true" /></button><button type="button" onClick={() => replayEngine.exitReplay()} className="secondary-button min-h-11 px-2 sm:min-h-9" aria-label="Exit replay session"><LogOut size={13} aria-hidden="true" />Exit session</button><span className="flex items-center gap-1.5 rounded-control bg-surface-2 px-1.5 py-0.5 text-ui-meta font-semibold text-active-bright"><span className="size-1.5 animate-replay-pulse rounded-full bg-active" aria-hidden="true" />LIVE</span><div className="text-right leading-tight"><span className="mr-1 text-ui-meta text-dim">Equity</span><span className="font-mono text-ui-body font-semibold tabular-nums text-ink">{money(equity)}</span></div></div>
      </div>
      <dl className="grid grid-cols-2 border-y border-line sm:grid-cols-4 xl:grid-cols-7">
        <LiveMetric label="Realized P&L" value={money(realized)} tone={pnlTone(realized)} />
        <LiveMetric label="Unrealized P&L" value={money(unrealized)} tone={pnlTone(unrealized)} />
        <LiveMetric label="Closed trades" value={String(replay.stats.trades)} />
        <LiveMetric label="Win rate" value={winRate} />
        <LiveMetric label="Average R" value={averageR} tone={replay.stats.averageR === null ? 'text-ink' : pnlTone(replay.stats.averageR)} />
        <LiveMetric label="Profit factor" value={profitFactor} tone={replay.stats.profitFactor !== null && replay.stats.profitFactor >= 1 ? 'text-profit-bright' : 'text-loss-bright'} />
        <LiveMetric label="Avg drawdown RR" value={drawdownR === null ? '—' : `${drawdownR.toFixed(2)}R`} tone="text-caution-bright" />
      </dl>
      <div className="grid divide-y divide-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
        <OutcomeSection title="Winners" summary={winners} tone="profit" />
        <OutcomeSection title="Losers" summary={losers} tone="loss" />
      </div>
    </section>
  )
}
