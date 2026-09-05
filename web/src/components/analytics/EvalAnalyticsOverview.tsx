import { CheckCircle2, Clock3, MinusCircle, XCircle } from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactElement } from 'react'
import type { AnalyticsPerformance } from '../../api/analytics'
import { evalStatus, type EvalStatus } from '../../eval/rules'
import type { SavedEvalAccount } from '../../store/eval-store'
import { LineChart, type LineChartReferenceLine } from './InteractiveAnalyticsCharts'
import { AnalyticsInfoTip } from './AnalyticsFloatingTooltip'
import { groupEvalEquityCurve, type EvalChartPeriod } from './eval-analytics-period'

type ObjectiveState = 'passed' | 'failed' | 'pending' | 'recorded'

interface EvalAnalyticsOverviewProps {
  performance: AnalyticsPerformance
  account: SavedEvalAccount | null
  onThresholdChange: (value: number) => void
}

interface EvalObjective {
  id: string
  label: string
  rule: string
  result: string
  state: ObjectiveState
}

interface KpiProps {
  label: string
  value: string
  detail?: string
  tone?: 'default' | 'profit' | 'loss'
  info?: string
}

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const wholeCurrency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

const periods: ReadonlyArray<{ id: EvalChartPeriod; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'day', label: 'Day' },
  { id: 'hour', label: '1 Hour' },
  { id: '15m', label: '15 Min' },
]

function signedPercent(value: number): string {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(2)}%`
}

function signedMoneyAndPercent(value: number, base: number): string {
  const normalized = Object.is(value, -0) ? 0 : value
  const percent = base > 0 ? normalized / base * 100 : 0
  return `${currency.format(normalized)} (${signedPercent(percent)})`
}

function KpiInfo({ label, children }: { label: string; children: string }): ReactElement {
  return <AnalyticsInfoTip label={label}>{children}</AnalyticsInfoTip>
}

function curveLabels(points: AnalyticsPerformance['equityCurve'], timeZone: string): string[] {
  if (points.length === 0) return []
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const count = Math.min(6, points.length)
  const indexes = Array.from({ length: count }, (_, index) => Math.round(index / Math.max(1, count - 1) * (points.length - 1)))
  return indexes.map((index) => points[index]?.closedAt ? formatter.format(new Date(points[index].closedAt!)) : 'Start')
}

function elapsedTime(startTs: number, endTs: number): string {
  const minutes = Math.max(0, Math.floor((endTs - startTs) / 60))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor(minutes % 1440 / 60)
  const remainder = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${remainder}m`
  return `${remainder}m`
}

function Kpi({ label, value, detail, tone = 'default', info }: KpiProps): ReactElement {
  const toneClass = tone === 'profit' ? 'text-profit-bright' : tone === 'loss' ? 'text-loss-bright' : 'text-ink'
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-ui-body text-muted">
        {label}
        {info ? <KpiInfo label={label}>{info}</KpiInfo> : null}
      </p>
      <p className={`mt-1 flex flex-wrap items-baseline gap-2 text-[20px] font-semibold leading-7 tracking-[-0.02em] tabular-nums ${toneClass}`}>
        {value}
        {detail ? <span className={`font-mono text-ui-meta font-medium tracking-normal ${toneClass}`}>{detail}</span> : null}
      </p>
    </div>
  )
}

function ObjectiveStatus({ state }: { state: ObjectiveState }): ReactElement {
  if (state === 'passed') return <span className="inline-flex items-center gap-2 text-profit-bright"><CheckCircle2 size={15} />Passed</span>
  if (state === 'failed') return <span className="inline-flex items-center gap-2 text-loss-bright"><XCircle size={15} />Not passed</span>
  if (state === 'recorded') return <span className="inline-flex items-center gap-2 text-muted"><Clock3 size={15} />Recorded</span>
  return <span className="inline-flex items-center gap-2 text-muted"><MinusCircle size={15} />In progress</span>
}

function objectiveRows(account: SavedEvalAccount, status: EvalStatus): EvalObjective[] {
  const { config } = account
  const rows: EvalObjective[] = [{
    id: 'elapsed', label: 'Total time tested', rule: 'Observed',
    result: elapsedTime(account.attemptStartedAt, account.lastCursorTs), state: 'recorded',
  }]

  if (config.maxDailyLoss > 0) rows.push({
    id: 'daily-loss', label: 'Max daily loss', rule: wholeCurrency.format(config.maxDailyLoss),
    result: signedMoneyAndPercent(-status.dailyLoss, config.accountSize),
    state: status.outcome === 'failed' && status.failReason === 'daily' ? 'failed' : 'passed',
  })

  if (config.maxTotalLoss > 0) rows.push({
    id: 'total-loss', label: config.drawdownType === 'trailing' ? 'Max trailing loss' : 'Max total loss',
    rule: wholeCurrency.format(config.maxTotalLoss), result: signedMoneyAndPercent(-status.totalDrawdown, config.accountSize),
    state: status.outcome === 'failed' && status.failReason === 'total' ? 'failed' : 'passed',
  })

  if (config.profitTarget > 0) rows.push({
    id: 'profit-target', label: 'Profit target', rule: wholeCurrency.format(config.profitTarget),
    result: signedMoneyAndPercent(status.realizedProfit, config.accountSize),
    state: status.realizedProfit >= config.profitTarget ? 'passed' : status.outcome === 'failed' ? 'failed' : 'pending',
  })

  if (config.minTradingDays > 0) rows.push({
    id: 'minimum-days', label: 'Minimum trading days', rule: `${config.minTradingDays} days`,
    result: `${status.daysTraded} / ${config.minTradingDays} days`, state: status.minDaysMet ? 'passed' : status.outcome === 'failed' ? 'failed' : 'pending',
  })

  if (config.consistencyRulePct > 0) rows.push({
    id: 'consistency', label: 'Consistency limit', rule: `${config.consistencyRulePct}%`,
    result: status.realizedProfit > 0 ? `${(status.consistencyPct * 100).toFixed(1)}% / ${config.consistencyRulePct}%` : 'Awaiting positive profit',
    state: status.consistencyMet && status.realizedProfit > 0 ? 'passed' : status.outcome === 'failed' ? 'failed' : 'pending',
  })

  if (config.maxPositionSize > 0) {
    const largestPosition = Math.max(0, ...account.trades.map((trade) => trade.qty ?? 1))
    rows.push({
      id: 'position-size', label: 'Max position size', rule: `${config.maxPositionSize} contracts`,
      result: `${largestPosition} / ${config.maxPositionSize} contracts`, state: largestPosition <= config.maxPositionSize ? 'passed' : 'failed',
    })
  }

  return rows
}

function EvaluationObjectives({ account }: { account: SavedEvalAccount | null }): ReactElement {
  if (!account) {
    return (
      <section className="rounded-[14px] border border-line-strong bg-surface-1 px-4 py-8 sm:px-6" aria-labelledby="evaluation-objectives-title">
        <h2 id="evaluation-objectives-title" className="text-[19px] font-semibold text-ink">Evaluation objectives</h2>
        <p className="mt-2 max-w-2xl text-ui-body leading-5 text-muted">The exact rule snapshot is unavailable for this analytics source, so targets and pass/fail states are not estimated.</p>
      </section>
    )
  }

  const status = evalStatus(account.config, account.runtime, {
    balance: account.lastEvalBalance,
    equity: account.lastEvalEquity,
    trades: account.trades,
  }, account.sessionTimezone)
  const rows = objectiveRows(account, status)
  return (
    <section className="overflow-hidden rounded-[14px] border border-active/70 bg-surface-0" aria-labelledby="evaluation-objectives-title">
      <div className="grid gap-1 border-b border-line px-4 py-4 sm:grid-cols-[minmax(13rem,1.15fr)_minmax(10rem,1fr)_minmax(8rem,.7fr)] sm:gap-6 sm:px-6">
        <h2 id="evaluation-objectives-title" className="text-[19px] font-semibold text-ink">Challenge objectives</h2>
        <span className="hidden text-ui-body font-semibold text-muted sm:block">Results</span>
        <span className="hidden text-ui-body font-semibold text-muted sm:block">Summary</span>
      </div>
      <div className="divide-y divide-line/80">
        {rows.map((row) => (
          <div key={row.id} className="grid gap-2 px-4 py-3.5 sm:grid-cols-[minmax(13rem,1.15fr)_minmax(10rem,1fr)_minmax(8rem,.7fr)] sm:items-center sm:gap-6 sm:px-6">
            <div className="min-w-0"><h3 className="text-ui-control font-medium text-ink">{row.label}</h3><p className="mt-0.5 font-mono text-ui-meta text-muted">{row.rule}</p></div>
            <p className={`min-w-0 font-mono text-ui-body font-medium tabular-nums ${row.state === 'failed' ? 'text-loss-bright' : row.state === 'passed' ? 'text-profit-bright' : row.state === 'recorded' ? 'text-active-bright' : 'text-muted'}`}>{row.result}</p>
            <p className="text-ui-body font-medium"><ObjectiveStatus state={row.state} /></p>
          </div>
        ))}
      </div>
    </section>
  )
}

function EvaluationPnlPanel({ performance, account, onThresholdChange }: EvalAnalyticsOverviewProps): ReactElement {
  const [period, setPeriod] = useState<EvalChartPeriod>('all')
  const [threshold, setThreshold] = useState('0')
  const [appliedThreshold, setAppliedThreshold] = useState(0)
  const timeZone = account?.sessionTimezone ?? 'UTC'
  const points = useMemo(() => groupEvalEquityCurve(performance.equityCurve, period, timeZone), [performance.equityCurve, period, timeZone])
  const labels = useMemo(() => curveLabels(points, timeZone), [points, timeZone])
  const thresholdNumber = Number(threshold)
  const canApply = Number.isFinite(thresholdNumber) && thresholdNumber >= 0 && thresholdNumber !== appliedThreshold
  const accountStatus = account ? evalStatus(account.config, account.runtime, {
    balance: account.lastEvalBalance,
    equity: account.lastEvalEquity,
    trades: account.trades,
  }, account.sessionTimezone) : null
  const referenceLines: LineChartReferenceLine[] = account && accountStatus
    ? [
        ...(account.config.profitTarget > 0
          ? [{ value: account.config.profitTarget, label: 'Profit target', tone: 'profit' as const }]
          : []),
        ...(account.config.maxTotalLoss > 0
          ? [{ value: accountStatus.floor - account.runtime.startBalance, label: 'Loss limit', tone: 'loss' as const }]
          : []),
      ]
    : []
  const pnlTone = performance.overview.totalPnl > 0 ? 'profit' : performance.overview.totalPnl < 0 ? 'loss' : 'default'

  const applyThreshold = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!canApply) return
    setAppliedThreshold(thresholdNumber)
    onThresholdChange(thresholdNumber)
  }

  return (
    <section className="overflow-hidden rounded-[14px] border border-line-strong bg-surface-1 p-4 sm:p-6" aria-labelledby="evaluation-pnl-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 id="evaluation-pnl-title" className="text-[22px] font-semibold leading-7 tracking-[-0.025em] text-ink">Profit and loss</h2><p className="mt-0.5 text-ui-body text-muted">Evaluation equity over time</p></div>
        <div className="flex max-w-full overflow-x-auto rounded-control border border-line-strong bg-surface-0 p-0.5" aria-label="Profit and loss period">
          {periods.map((item) => <button key={item.id} type="button" aria-pressed={period === item.id} onClick={() => setPeriod(item.id)} className="min-h-11 shrink-0 rounded-control px-3 text-ui-body font-medium text-muted transition-colors hover:text-ink aria-pressed:bg-line-strong aria-pressed:text-ink sm:min-h-9">{item.label}</button>)}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-3 xl:grid-cols-[1.15fr_1.15fr_.7fr_.8fr_.8fr_1.2fr]">
        <Kpi label="Total P&L" value={currency.format(performance.overview.totalPnl)} detail={signedPercent(performance.overview.pnlPercent)} tone={pnlTone} info="Realized profit or loss across closed evaluation trades." />
        <Kpi label="Account balance" value={currency.format(performance.overview.accountBalance)} detail={signedPercent(performance.overview.pnlPercent)} tone={pnlTone} info="Starting account size plus realized P&L." />
        <Kpi label="Win rate" value={`${performance.overview.winRate.toFixed(2)}%`} />
        <Kpi label="Total trades" value={integer.format(performance.overview.totalTrades)} detail={`${performance.winners.total}W / ${performance.losers.total}L`} info="Winning and losing closed trades; breakeven trades are shown separately." />
        <Kpi label="Breakeven trades" value={integer.format(performance.overview.breakevenTrades)} />
        <form className="col-span-2 flex items-end gap-2 sm:col-span-1" onSubmit={applyThreshold}>
          <label className="min-w-0 flex-1 text-ui-body text-muted">Breakeven threshold
            <input aria-label="Breakeven threshold" className="mt-1 h-11 w-full rounded-control border border-line-strong bg-surface-0 px-3 font-mono text-ui-control text-ink outline-none transition-colors focus:border-active sm:h-10" inputMode="decimal" min="0" step="0.01" type="number" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
          </label>
          <button type="submit" disabled={!canApply} className="secondary-button h-11 px-4 disabled:cursor-not-allowed disabled:opacity-40 sm:h-10">Apply</button>
        </form>
      </div>

      <div className="mt-6 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active" tabIndex={0} role="region" aria-label="Scrollable evaluation profit and loss chart">
        <LineChart
          reportSized
          values={points.map((point) => point.cumulativePnl)}
          referenceLines={referenceLines}
          includeZero
          valueLabel="Cumulative P&L"
          valueFormatter={(value) => currency.format(value)}
          ariaLabel={`Evaluation profit and loss curve for ${periods.find((item) => item.id === period)?.label ?? 'All'} period`}
        />
        <div className="mt-1 flex min-w-[720px] justify-between px-6 font-mono text-ui-meta text-dim" aria-hidden="true">{labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
      </div>
    </section>
  )
}

export function EvalAnalyticsOverview({ performance, account, onThresholdChange }: EvalAnalyticsOverviewProps): ReactElement {
  return <div className="space-y-6"><EvaluationPnlPanel performance={performance} account={account} onThresholdChange={onThresholdChange} /><EvaluationObjectives account={account} /></div>
}
