/*
THESIS: A trading review is an evidence trail, not a wall of interchangeable metric cards.
OWN-WORLD: Flat night-session sheets, hairline frames, mono data, blue navigation, and semantic P&L only.
STORY: Choose a review lens, scan the equity story, then move from outcomes to timing and frequency evidence.
FIRST VIEWPORT: Compact report header, three-segment lens switch, then one dominant P&L work surface.
FORM: A dense vertical trading report, faithfully extending the incumbent Replay Desk grammar.
*/
import {
  Activity, ArrowLeft, BarChart3, ChevronDown, FlaskConical, Gauge, Tags,
  LineChart as LineChartIcon, TrendingDown,
} from 'lucide-react'
import { useCallback, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  analyticsSourceTypeSchema, fetchAnalyticsDrawdown, fetchAnalyticsEdge, fetchAnalyticsExecution, fetchAnalyticsPerformance, fetchAnalyticsSources,
  type AnalyticsPerformance, type AnalyticsSource, type AnalyticsSourceType,
} from '../../api/analytics'
import {
  Donut, FrequencyChart, HorizontalDayBars, LineChart, Radar, SplitBars, VerticalBars, WinRateRings,
} from './InteractiveAnalyticsCharts'
import type { PointDatum, SplitPointDatum, AnalyticsReportView } from './analytics-view-model'
import { toAnalyticsReportView } from './analytics-view-model'
import { DrawdownTab, SimulationTab } from './ConnectedAnalyticsTabs'
import { EdgeTab } from './EdgeTab'
import { ExecutionDisciplineTab } from './ExecutionDisciplineTab'
import { EvalAnalyticsOverview } from './EvalAnalyticsOverview'
import { AnalyticsInfoTip } from './AnalyticsFloatingTooltip'
import { PerformanceCalendar } from './PerformanceCalendar'
import { TagAnalyticsTab } from './TagAnalyticsTab'
import { useAnalyticsResource, type ResourceState } from './use-analytics-resource'
import { loadChartLayout } from '../../chart-workspace/layout-storage'
import { chartTimezoneQueryValue } from '../../replay/chart-timezone'
import { loadEvalAccounts, type SavedEvalAccount } from '../../store/eval-store'
import { evaluationDisplayName } from '../../sources/source-name'

type AnalyticsTab = 'performance' | 'drawdown' | 'simulation' | 'edge' | 'discipline' | 'tags'
type TimeMetric = 'pnl' | 'rr' | 'profitPct' | 'winRate'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

const metricLabels: Record<TimeMetric, string> = {
  pnl: 'Total Profit/Loss',
  rr: 'Risk-Reward',
  profitPct: '% Profit',
  winRate: 'Win Rate',
}

interface InfoTipProps {
  label: string
  children: ReactNode
}

function InfoTip({ label, children }: InfoTipProps) {
  return <AnalyticsInfoTip label={label} className="ml-1">{children}</AnalyticsInfoTip>
}

interface SectionTitleProps {
  children: ReactNode
  info?: string
  action?: ReactNode
}

function SectionTitle({ children, info, action }: SectionTitleProps) {
  return (
    <div className="mb-4 flex min-h-10 items-center justify-between gap-3">
      <h2 className="text-[21px] font-semibold leading-7 tracking-[-0.02em] text-[#f1f3f5]">{children}{info ? <InfoTip label={String(children)}>{info}</InfoTip> : null}</h2>
      {action}
    </div>
  )
}

interface MetricProps {
  label: string
  value: string
  detail?: string
  tone?: 'default' | 'profit' | 'loss' | 'active' | 'caution'
  info?: string
}

function Metric({ label, value, detail, tone = 'default', info }: MetricProps) {
  const toneClass = tone === 'profit' ? 'text-profit-bright' : tone === 'loss' ? 'text-loss-bright' : tone === 'active' ? 'text-active-bright' : tone === 'caution' ? 'text-caution-bright' : 'text-ink'
  const detailClass = tone === 'default' ? 'text-muted' : toneClass
  return (
    <div className="min-w-0">
      <p className="flex items-center text-ui-body text-[#b0b6bf]">{label}{info ? <InfoTip label={label}>{info}</InfoTip> : null}</p>
      <p className={`mt-0.5 flex flex-wrap items-baseline gap-2 text-[21px] font-semibold leading-7 tracking-[-0.02em] tabular-nums ${toneClass}`}>
        {value}{detail ? <span className={`font-mono text-ui-meta font-medium tracking-normal ${detailClass}`}>{detail}</span> : null}
      </p>
    </div>
  )
}

interface ReportPanelProps {
  children: ReactNode
  className?: string
}

function ReportPanel({ children, className = '' }: ReportPanelProps) {
  return <section className={`rounded-[14px] border border-[#3c4046] bg-[#121416] ${className}`}>{children}</section>
}

type PnlPeriod = 'all' | 'day' | 'hour' | '15m'

function periodCurve(report: AnalyticsReportView, period: PnlPeriod): { values: number[]; labels: string[] } {
  if (period === 'all') return { values: report.equityCurve, labels: report.curveLabels }
  const buckets = new Map<string, { value: number; date: Date }>()
  report.equityCurve.forEach((value, index) => {
    const timestamp = report.equityCurveDates[index]
    if (!timestamp) return
    const date = new Date(timestamp)
    const minute = period === '15m' ? Math.floor(date.getUTCMinutes() / 15) * 15 : 0
    const key = period === 'day'
      ? date.toISOString().slice(0, 10)
      : `${date.toISOString().slice(0, 13)}:${String(minute).padStart(2, '0')}`
    buckets.set(key, { value, date })
  })
  const entries = [...buckets.values()]
  const labels = entries.map(({ date }) => period === 'day' ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }))
  return { values: [0, ...entries.map(({ value }) => value)], labels: ['', ...labels] }
}

function PnlOverview({ report, onThresholdChange }: { report: AnalyticsReportView; onThresholdChange: (value: number) => void }) {
  const [period, setPeriod] = useState<PnlPeriod>('all')
  const [threshold, setThreshold] = useState('0')
  const [appliedThreshold, setAppliedThreshold] = useState(0)
  const curve = periodCurve(report, period)
  const pnlTone = report.pnlPercent.startsWith('-') ? 'loss' as const : report.pnlPercent === '0.00%' ? 'default' as const : 'profit' as const
  return (
    <ReportPanel className="overflow-hidden p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-semibold leading-7 tracking-[-0.025em] text-[#f4f5f7]">Profit and loss</h2>
          <p className="mt-0.5 text-ui-body text-[#a1a7b0]">Over time</p>
        </div>
        <div className="flex rounded-lg border border-[#464a51] bg-[#090a0c] p-0.5" aria-label="Profit and loss period">
          {([['all', 'All'], ['day', 'Day'], ['hour', '1 Hour'], ['15m', '15 Min']] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)} className="min-h-8 rounded-md px-3 text-ui-body font-medium text-[#aab0b9] transition-colors hover:text-white aria-pressed:bg-[#4a505b] aria-pressed:text-white">{label}</button>
          ))}
        </div>
      </div>
      <div className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-[1.2fr_1.2fr_.72fr_.95fr_.75fr_1.15fr]">
        <Metric label="Total PnL" value={report.totalPnl} detail={report.pnlPercent} tone={pnlTone} />
        <Metric label="Account Balance" value={report.balance} detail={report.pnlPercent} tone={pnlTone} />
        <Metric label="Win Rate" value={report.winRate} tone="active" />
        <Metric label="Total Trades" value={String(report.totalTrades)} detail={`${report.longTrades} long · ${report.shortTrades} short`} info="Shows long trades, short trades, and the combined total." />
        <Metric label="Breakeven Trades" value={String(report.breakevenTrades)} />
        <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); const value = Number(threshold) || 0; setAppliedThreshold(value); onThresholdChange(value) }}>
          <label className="min-w-0 flex-1 text-ui-body text-[#b0b6bf]">Breakeven threshold
            <input aria-label="Breakeven threshold" className="mt-1 h-10 w-full rounded-lg border border-[#464a51] bg-[#090a0c] px-3 font-mono text-sm text-white outline-none transition-colors focus:border-active" inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
          </label>
          <button type="submit" className="h-10 rounded-lg border border-[#464a51] bg-[#202328] px-4 text-ui-body font-medium text-[#d8dce2] transition-colors hover:border-[#626872] hover:bg-[#292d33]">Apply</button>
        </form>
      </div>
      <span className="sr-only" role="status">Applied breakeven threshold: {appliedThreshold}</span>
      <div className="mt-5 overflow-x-auto">
        <LineChart values={curve.values} valueLabel="Cumulative PnL" valueFormatter={(value) => money.format(value)} ariaLabel={`${report.kind} profit and loss curve for ${period} period`} />
      </div>
      <div className="mt-1 flex min-w-[720px] justify-between px-6 font-mono text-ui-meta text-dim" aria-hidden="true">
        {curve.labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
      </div>
    </ReportPanel>
  )
}

function RrSummary({ report }: { report: AnalyticsReportView }) {
  return (
    <section className="grid gap-3 lg:grid-cols-3">
      <ReportPanel className="overflow-hidden pt-5">
        <dl className="grid grid-cols-2 gap-4 px-5">
          <Metric label="Average RR" value={report.averageRr} tone={Number(report.averageRr) < 0 ? 'loss' : 'profit'} /><Metric label="Max RR" value={report.maxRr} tone="active" />
        </dl>
        <LineChart compact values={report.rrCurves.rr} valueLabel="Risk-reward" valueFormatter={(value) => `${value.toFixed(2)}R`} ariaLabel="Average and maximum risk reward distribution" />
      </ReportPanel>
      <ReportPanel className="overflow-hidden pt-5">
        <dl className="grid grid-cols-2 gap-4 px-5">
          <Metric label="Ideal Average RR" value={report.idealAverageRr} tone="active" info="The maximum profit each trade could have delivered if held for up to one week after entry, averaged across all trades. More peaks can indicate profits were taken too early." />
          <Metric label="Max Ideal RR" value={report.maxIdealRr} tone="active" />
        </dl>
        <LineChart compact values={report.rrCurves.ideal} valueLabel="Ideal risk-reward" valueFormatter={(value) => `${value.toFixed(2)}R`} ariaLabel="Ideal risk reward distribution" />
      </ReportPanel>
      <ReportPanel className="overflow-hidden pt-5">
        <dl className="grid grid-cols-2 gap-4 px-5">
          <Metric label="Could have profit/BE" value={String(report.couldHaveProfitOrBe)} tone={report.couldHaveProfitOrBe > 0 ? 'caution' : 'default'} info="Trades that reached more than 1.2R in unrealized profit but finished as a loss. A 5–15% share is typically reasonable; higher may indicate missed chances to reduce risk." />
          <Metric label="Max Ideal RR" value={report.couldHaveMaxIdealRr} tone="active" />
        </dl>
        <LineChart compact values={report.rrCurves.missed} valueLabel="Potential R" valueFormatter={(value) => `${value.toFixed(2)}R`} ariaLabel="Missed profit or breakeven opportunities" />
      </ReportPanel>
    </section>
  )
}

function Expectancy({ report }: { report: AnalyticsReportView }) {
  return (
    <section>
      <SectionTitle info="Expectancy estimates the average amount won or lost per trade from win rate, average win, loss rate, average loss, and breakeven trades.">Expectancy &amp; profit factor</SectionTitle>
      <div className="grid gap-3 lg:grid-cols-2">
        <ReportPanel className="grid min-h-28 items-center gap-6 p-5 sm:grid-cols-[1fr_1.3fr]">
          <Metric label="Expectancy" value={report.expectancy} tone={report.expectancy.startsWith('-') ? 'loss' : 'profit'} />
          <div>
            <div className="grid h-4 grid-cols-[1.2fr_1fr] gap-1" aria-label={`Average win ${report.averageWin}, average loss ${report.averageLoss}`}><span className="rounded-full border border-[#38bca3] bg-profit" /><span className="rounded-full border border-[#f07167] bg-loss" /></div>
            <div className="mt-1.5 flex justify-between font-mono text-ui-body"><span className="text-profit-bright">{report.averageWin}</span><span className="text-loss-bright">{report.averageLoss}</span></div>
          </div>
        </ReportPanel>
        <ReportPanel className="flex min-h-28 items-center justify-between p-5">
          <Metric label="Profit factor" value={report.profitFactor} tone={Number(report.profitFactor) >= 1 ? 'profit' : Number(report.profitFactor) < 1 ? 'loss' : 'default'} />
          <div className="grid size-16 place-items-center rounded-full border-[6px] border-[#24272b] border-t-[#d7a600] font-mono text-ui-meta text-[#c4c8ce]" aria-label={`Profit factor ${report.profitFactor}`}>{report.profitFactor}</div>
        </ReportPanel>
      </div>
    </section>
  )
}

function WinnersLosers({ report }: { report: AnalyticsReportView }) {
  return (
    <section>
      <SectionTitle>Winners and losers</SectionTitle>
      <div className="grid gap-3 lg:grid-cols-2">
        {[
          { title: 'Winners', rows: report.winnerRows, borderTone: 'border-profit', valueTone: 'text-profit-bright' },
          { title: 'Losers', rows: report.loserRows, borderTone: 'border-loss', valueTone: 'text-loss-bright' },
        ].map(({ title, rows, borderTone, valueTone }) => (
          <ReportPanel key={title} className={`p-6 ${borderTone}`}>
            <h3 className="mb-3 text-[17px] font-semibold text-[#f1f3f5]">{title}</h3>
            <dl className="space-y-2">
              {rows.map(({ label, value }) => <div key={label} className="flex items-center justify-between gap-4 rounded px-0.5 transition-colors hover:bg-white/[0.025]"><dt className="text-ui-control text-muted">{label}</dt><dd className={`font-mono text-ui-control font-semibold ${valueTone}`}>{value}</dd></div>)}
            </dl>
          </ReportPanel>
        ))}
      </div>
    </section>
  )
}

function PerformanceBySide({ report }: { report: AnalyticsReportView }) {
  return (
    <section>
      <SectionTitle info="Compares trade direction and outcome for long and short positions.">Performance by side</SectionTitle>
      <div className="grid gap-3 lg:grid-cols-2">
        <ReportPanel className="p-6">
          <h3 className="text-[17px] font-semibold text-[#f1f3f5]">Total trades</h3>
          <p className="mt-2 text-center text-ui-meta text-[#aeb4bd]"><span className="text-profit-bright">● Buy</span><span className="ml-4 text-active-bright">● Sell</span></p>
          <Donut buy={report.buyPercent} sell={report.sellPercent} ariaLabel={`${report.buyPercent} percent buy trades and ${report.sellPercent} percent sell trades`} />
        </ReportPanel>
        <ReportPanel className="p-6">
          <h3 className="text-[17px] font-semibold text-[#f1f3f5]">Win rate</h3>
          <p className="mt-2 text-center text-ui-meta text-[#aeb4bd]"><span className="text-profit-bright">● Buy</span><span className="ml-4 text-active-bright">● Sell</span></p>
          <WinRateRings buy={report.buyWinRate} sell={report.sellWinRate} />
        </ReportPanel>
      </div>
    </section>
  )
}

function PerformanceBySession({ report }: { report: AnalyticsReportView }) {
  return (
    <section>
      <SectionTitle info="Compares results across Asia, London, New York, and out-of-session trades.">Performance by session</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {report.sessionData.map((datum) => <ReportPanel key={datum.label} className="p-5"><h3 className="text-[17px] font-semibold text-[#f1f3f5]">{datum.label}</h3><Radar datum={datum} /></ReportPanel>)}
      </div>
    </section>
  )
}

function PerformanceByTime({ report }: { report: AnalyticsReportView }) {
  const [metric, setMetric] = useState<TimeMetric>('pnl')
  const data = report.performanceByTime[metric]
  const split = metric === 'pnl' || metric === 'profitPct'
  const splitFormatter = metric === 'profitPct'
    ? (value: number): string => `${value.toFixed(2)}%`
    : (value: number): string => money.format(value)
  return (
    <section>
      <SectionTitle info="Groups closed trades by their entry hour." action={
        <label className="relative">
          <span className="sr-only">Performance by time metric</span>
          <select value={metric} onChange={(event) => setMetric(event.target.value as TimeMetric)} className="h-11 appearance-none rounded-xl border border-[#464a51] bg-[#090a0c] pl-4 pr-10 text-ui-control font-medium text-[#eef0f3] outline-none transition-colors focus:border-active">
            {(Object.keys(metricLabels) as TimeMetric[]).map((key) => <option key={key} value={key}>{metricLabels[key]}</option>)}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
        </label>
      }>Performance by time</SectionTitle>
      <ReportPanel className="overflow-x-auto p-3 sm:p-5">
        {split
          ? <SplitBars data={data as SplitPointDatum[]} valueFormatter={splitFormatter} ariaLabel={`${metricLabels[metric]} by entry hour`} />
          : <VerticalBars data={data as PointDatum[]} valueSuffix={metric === 'winRate' ? '%' : 'R'} tone={metric === 'winRate' ? 'green' : 'blue'} ariaLabel={`${metricLabels[metric]} by entry hour`} />}
      </ReportPanel>
    </section>
  )
}

function PerformanceByDay({ report }: { report: AnalyticsReportView }) {
  return (
    <section>
      <SectionTitle>Performance by day</SectionTitle>
      <ReportPanel className="overflow-x-auto px-4 py-5"><HorizontalDayBars data={report.dayData} /></ReportPanel>
    </section>
  )
}

function PerformanceByMonth({ report }: { report: AnalyticsReportView }) {
  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'YTD']
  return (
    <section>
      <SectionTitle>Performance by month</SectionTitle>
      <ReportPanel className="overflow-x-auto p-5">
        <div className="min-w-[860px]">
          <div className="mb-5 flex flex-wrap justify-between gap-4 text-[14px] text-[#b4bac3]">
            <p><span className="text-active-bright">●</span> Accum. sessions gains % <span className="ml-3 text-dim">○ Overall gain %</span></p>
            <p><span className="text-active-bright">●</span> Initial balance <span className="ml-3 text-dim">○ Current balance</span></p>
          </div>
          <div className="grid grid-cols-[70px_repeat(13,minmax(62px,1fr))] gap-3">
            <div /><>{labels.map((label) => <div key={label} className="grid h-14 place-items-center rounded-xl border border-[#3c4046] bg-[#15181c] text-[14px] font-semibold text-[#f0f2f4]">{label}</div>)}</>
            <div className="grid h-14 place-items-center rounded-xl border border-[#3c4046] bg-[#15181c] font-mono text-[14px] font-semibold text-[#f0f2f4]">2025</div>
            {report.monthlyValues.map((value, index) => <div key={`${labels[index]}-${value}`} aria-label={`${labels[index]} 2025: ${value}`} className={`grid h-14 place-items-center rounded-xl border border-[#454a52] bg-[#30343a] font-mono text-[14px] font-semibold ${value.startsWith('+') ? 'text-profit-bright' : value.startsWith('-') ? 'text-loss-bright' : 'text-[#aeb4bd]'}`}>{value}</div>)}
          </div>
        </div>
      </ReportPanel>
    </section>
  )
}

function TradeFrequency({ report }: { report: AnalyticsReportView }) {
  return (
    <section>
      <SectionTitle info="Trades per week shows how many trades you take each week so you can track consistency and spot when momentum drops.">Average trade frequency</SectionTitle>
      <div className="grid gap-3 lg:grid-cols-3">
        {report.frequencyData.map((datum) => <ReportPanel key={datum.title} className="p-5">
          <div className="flex items-baseline justify-between gap-3"><h3 className="text-[17px] font-semibold text-[#f1f3f5]">{datum.title}</h3><p className="text-[15px] text-[#aeb4bd]">Avg <span className="font-mono font-semibold text-white">{datum.average}</span></p></div>
          <FrequencyChart labels={datum.labels} values={datum.values} ariaLabel={`${datum.title}, average ${datum.average}`} />
        </ReportPanel>)}
      </div>
    </section>
  )
}

function PerformanceDetails({ report }: { report: AnalyticsReportView }) {
  return (
    <div className="space-y-11">
      <RrSummary report={report} />
      <Expectancy report={report} />
      <WinnersLosers report={report} />
      <PerformanceBySide report={report} />
      <PerformanceBySession report={report} />
      <PerformanceByTime report={report} />
      <PerformanceByDay report={report} />
      <PerformanceByMonth report={report} />
      <PerformanceCalendar entries={report.calendarEntries} initialDate={report.calendarInitialDate} />
      <TradeFrequency report={report} />
    </div>
  )
}

function PerformanceContent({ report, onThresholdChange }: { report: AnalyticsReportView; onThresholdChange: (value: number) => void }) {
  return <div className="space-y-11"><PnlOverview report={report} onThresholdChange={onThresholdChange} /><PerformanceDetails report={report} /></div>
}

interface EvaluationPerformanceContentProps {
  performance: AnalyticsPerformance
  account: SavedEvalAccount | null
  report: AnalyticsReportView
  onThresholdChange: (value: number) => void
}

function EvaluationPerformanceContent({ performance, account, report, onThresholdChange }: EvaluationPerformanceContentProps) {
  return <div className="space-y-11"><EvalAnalyticsOverview performance={performance} account={account} onThresholdChange={onThresholdChange} /><PerformanceDetails report={report} /></div>
}

function ResourcePanel<T>({ state, children }: { state: ResourceState<T>; children: (data: T) => ReactNode }) {
  if (state.status === 'success') return <>{children(state.data)}</>
  if (state.status === 'error') return <ReportPanel className="p-8 text-center"><p className="text-ui-control font-medium text-loss-bright">Unable to load this analytics report.</p><p className="mx-auto mt-2 max-w-xl text-ui-body text-[#9299a3]">{state.error.message}</p><button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-lg border border-[#464a51] px-4 py-2 text-ui-body font-medium text-white">Retry</button></ReportPanel>
  return <ReportPanel className="flex min-h-64 items-center justify-center"><span className="text-sm text-[#9299a3]">Loading analytics…</span></ReportPanel>
}

export function AnalyticsScreen() {
  const [tab, setTab] = useState<AnalyticsTab>('performance')
  const [breakevenThreshold, setBreakevenThreshold] = useState(5)
  const params = useMemo(() => typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams(), [])
  const sourceId = params.get('analytics') ?? ''
  const parsedType = analyticsSourceTypeSchema.safeParse(params.get('sourceType'))
  const sourceType: AnalyticsSourceType | null = parsedType.success ? parsedType.data : null
  const validSource = sourceId.length > 0 && sourceType !== null
  const evalAccounts = useMemo(() => loadEvalAccounts(), [])
  const evalAccount = useMemo(() => sourceType === 'evaluation'
    ? evalAccounts.find((account) => account.sessionId === sourceId) ?? null
    : null, [evalAccounts, sourceId, sourceType])
  const workspaceTimezone = useMemo(() => chartTimezoneQueryValue(loadChartLayout().timezone), [])
  const loadPerformance = useCallback((signal: AbortSignal) => {
    if (!sourceType) return Promise.reject(new Error('Missing analytics source type'))
    return fetchAnalyticsPerformance(sourceType, sourceId, breakevenThreshold, workspaceTimezone, signal)
  }, [breakevenThreshold, sourceId, sourceType, workspaceTimezone])
  const loadDrawdown = useCallback((signal: AbortSignal) => {
    if (!sourceType) return Promise.reject(new Error('Missing analytics source type'))
    return fetchAnalyticsDrawdown(sourceType, sourceId, signal)
  }, [sourceId, sourceType])
  const loadEdge = useCallback((signal: AbortSignal) => {
    if (!sourceType) return Promise.reject(new Error('Missing analytics source type'))
    return fetchAnalyticsEdge(sourceType, sourceId, signal)
  }, [sourceId, sourceType])
  const loadExecution = useCallback((signal: AbortSignal) => {
    if (!sourceType) return Promise.reject(new Error('Missing analytics source type'))
    return fetchAnalyticsExecution(sourceType, sourceId, signal)
  }, [sourceId, sourceType])
  const loadSources = useCallback((signal: AbortSignal) => fetchAnalyticsSources(signal), [])
  const performance = useAnalyticsResource(validSource, loadPerformance)
  const drawdown = useAnalyticsResource(validSource && tab === 'drawdown', loadDrawdown)
  const edge = useAnalyticsResource(validSource && tab === 'edge', loadEdge)
  const execution = useAnalyticsResource(validSource && tab === 'discipline', loadExecution)
  const sources = useAnalyticsResource(true, loadSources)
  const report = performance.status === 'success' ? toAnalyticsReportView(performance.data, workspaceTimezone) : null
  const tabs = [
    { id: 'performance' as const, label: 'Performance', icon: LineChartIcon },
    { id: 'drawdown' as const, label: 'Drawdown', icon: TrendingDown },
    { id: 'simulation' as const, label: 'Simulation', icon: Gauge },
    { id: 'edge' as const, label: 'Edge', icon: FlaskConical },
    { id: 'discipline' as const, label: 'Execution & Discipline', icon: Activity },
    { id: 'tags' as const, label: 'Tags', icon: Tags },
  ]
  const sourceName = (source: AnalyticsSource): string => {
    if (source.type !== 'evaluation') return source.title
    const account = evalAccounts.find((candidate) => candidate.sessionId === source.id)
    return account ? evaluationDisplayName(account) : source.title
  }
  const switchSource = (event: ChangeEvent<HTMLSelectElement>): void => {
    const selected = sources.status === 'success' ? sources.data.find((source) => `${source.type}:${source.id}` === event.target.value) : undefined
    if (!selected) return
    window.location.assign(`/?analytics=${encodeURIComponent(selected.id)}&sourceType=${selected.type}`)
  }
  const groupedSources = sources.status === 'success' ? {
    evaluations: sources.data.filter((source) => source.type === 'evaluation'),
    sessions: sources.data.filter((source) => source.type === 'session'),
  } : { evaluations: [], sessions: [] }
  return (
    <div className="scrollbar-gutter-stable h-full overflow-y-auto bg-[#070809] font-sans text-ink">
      <header className="sticky top-0 z-30 border-b border-[#292c31] bg-[#0d0f11]/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-14 max-w-[1500px] flex-wrap items-center gap-2 px-3 py-2 sm:flex-nowrap sm:gap-3 sm:px-6">
          <a href="/" className="tool-button shrink-0" aria-label="Back to replay workspace"><ArrowLeft size={18} /></a>
          <div className="min-w-0 flex-1 border-l border-[#34373c] pl-3"><h1 className="truncate text-[16px] font-semibold leading-5 tracking-[-0.01em] text-[#f4f5f7]">{evalAccount ? evaluationDisplayName(evalAccount) : report?.title ?? 'Analytics report'}</h1></div>
          <label className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto">
            <span className="shrink-0 text-xs font-medium text-[#9ba2ad]">Report</span>
            <select aria-label="Analytics source" value={sourceType ? `${sourceType}:${sourceId}` : ''} onChange={switchSource} disabled={sources.status !== 'success' || sources.data.length === 0} className="h-9 min-w-0 flex-1 rounded-lg border border-[#454a52] bg-[#090b0d] px-3 text-sm font-medium text-[#edf0f3] outline-none transition-colors hover:border-[#626873] focus:border-active disabled:opacity-50 sm:w-64">
              {groupedSources.evaluations.length > 0 ? <optgroup label="Eval accounts">{groupedSources.evaluations.map((source) => <option key={`evaluation:${source.id}`} value={`evaluation:${source.id}`}>{sourceName(source)}</option>)}</optgroup> : null}
              {groupedSources.sessions.length > 0 ? <optgroup label="Replay sessions">{groupedSources.sessions.map((source) => <option key={`session:${source.id}`} value={`session:${source.id}`}>{sourceName(source)}</option>)}</optgroup> : null}
            </select>
          </label>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-3 py-5 sm:px-6 sm:py-7">
        <nav className="flex overflow-x-auto rounded-[26px] border border-[#40444a] bg-[#151719] p-1 xl:grid xl:grid-cols-6" role="tablist" aria-label="Analytics views">
          {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={tab === id} aria-controls={`analytics-panel-${id}`} id={`analytics-tab-${id}`} onClick={() => setTab(id)} className="flex min-h-10 min-w-[148px] items-center justify-center gap-2 rounded-[21px] border border-transparent px-3 text-ui-control font-medium text-[#aeb4bd] transition-colors hover:text-white aria-selected:border-[#454a51] aria-selected:bg-[#070809] aria-selected:text-white sm:min-w-0"><Icon size={15} strokeWidth={1.75} />{label}</button>)}
        </nav>
        <div className="mt-6" role="tabpanel" id={`analytics-panel-${tab}`} aria-labelledby={`analytics-tab-${tab}`}>
          {!validSource ? <ReportPanel className="p-8 text-center"><p className="text-base font-semibold text-white">Choose an analytics source</p><p className="mt-2 text-sm text-[#9299a3]">Open a replay session or evaluation account from the Analytics sidebar.</p><a href="/" className="mt-5 inline-flex rounded-lg bg-active px-4 py-2 text-sm font-medium text-white">Back to workspace</a></ReportPanel> : null}
          {validSource && tab === 'performance' ? <ResourcePanel state={performance}>{(data) => {
            const performanceReport = toAnalyticsReportView(data, workspaceTimezone)
            return sourceType === 'evaluation'
              ? <EvaluationPerformanceContent performance={data} account={evalAccount} report={performanceReport} onThresholdChange={setBreakevenThreshold} />
              : <PerformanceContent report={performanceReport} onThresholdChange={setBreakevenThreshold} />
          }}</ResourcePanel> : null}
          {validSource && tab === 'drawdown' ? <ResourcePanel state={drawdown}>{(data) => <DrawdownTab report={data} />}</ResourcePanel> : null}
          {validSource && tab === 'simulation' ? <ResourcePanel state={performance}>{(data) => sourceType ? <SimulationTab source={{ id: sourceId, type: sourceType }} performance={data} /> : null}</ResourcePanel> : null}
          {validSource && tab === 'edge' ? <ResourcePanel state={edge}>{(data) => <EdgeTab report={data} />}</ResourcePanel> : null}
          {validSource && tab === 'discipline' ? <ResourcePanel state={execution}>{(data) => <ExecutionDisciplineTab report={data} />}</ResourcePanel> : null}
          {validSource && tab === 'tags' && sourceType ? <TagAnalyticsTab sourceType={sourceType} sourceId={sourceId} /> : null}
        </div>
      </main>
      <footer className="mx-auto flex max-w-[1500px] items-center justify-between border-t border-[#292c31] px-6 py-5 text-xs text-[#858b94]"><span>Market Replay analytics</span><span className="flex items-center gap-1.5"><BarChart3 size={13} />{report ? `${report.kind} · live trade data` : 'Live analytics'}</span></footer>
    </div>
  )
}
