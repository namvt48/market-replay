import type { AnalyticsPerformance } from '../../api/analytics'

export interface PointDatum { label: string; value: number }
export interface SplitPointDatum { label: string; profit: number; loss: number }
export interface SessionDatum { label: string; values: number[] }

interface OutcomeRow { label: string; value: string }
interface FrequencyDatum { title: string; average: string; labels: string[]; values: number[] }
export interface CalendarDatum {
  date: string
  trades: number
  wins: number
  losses: number
  breakeven: number
  pnl: number
  pnlPercent: number
  riskReward: number | null
}

export interface AnalyticsReportView {
  id: string
  kind: string
  title: string
  subtitle: string
  status: string
  totalPnl: string
  pnlPercent: string
  balance: string
  winRate: string
  totalTrades: number
  longTrades: number
  shortTrades: number
  breakevenTrades: number
  equityCurve: number[]
  curveLabels: string[]
  averageRr: string
  maxRr: string
  idealAverageRr: string
  maxIdealRr: string
  couldHaveProfitOrBe: number
  couldHaveMaxIdealRr: string
  rrCurves: { rr: number[]; ideal: number[]; missed: number[] }
  expectancy: string
  averageWin: string
  averageLoss: string
  profitFactor: string
  winnerRows: OutcomeRow[]
  loserRows: OutcomeRow[]
  buyPercent: number
  sellPercent: number
  buyWinRate: number
  sellWinRate: number
  sessionData: SessionDatum[]
  performanceByTime: Record<'pnl' | 'rr' | 'profitPct' | 'winRate', PointDatum[] | SplitPointDatum[]>
  dayData: Array<{ label: string; profit: number; loss: number; winRate: number | null }>
  monthlyValues: string[]
  calendarInitialDate: string
  calendarEntries: CalendarDatum[]
  frequencyData: FrequencyDatum[]
}

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const shortDate = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })

function duration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

function percent(value: number, signed = false): string {
  const prefix = signed && value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(2)}%`
}

function normalizedSessionValues(report: AnalyticsPerformance, key: 'winRate' | 'totalTrades' | 'averageRr' | 'totalPnl'): number[] {
  const names = ['Asia', 'London', 'New York', 'Out of Session']
  const raw = names.map((name) => report.bySession.find((item) => item.session.toLowerCase() === name.toLowerCase())?.[key] ?? 0)
  const maximum = Math.max(1, ...raw.map((value) => Math.abs(value)))
  return raw.map((value) => Math.max(0, Math.abs(value) / maximum * 100))
}

function curveLabels(report: AnalyticsPerformance): string[] {
  const dates = report.equityCurve.flatMap((point) => point.closedAt ? [new Date(point.closedAt)] : [])
  if (dates.length === 0) return []
  const indexes = [0, .2, .4, .6, .8, 1].map((ratio) => Math.min(dates.length - 1, Math.round((dates.length - 1) * ratio)))
  return indexes.map((index) => shortDate.format(dates[index]))
}

function calendarDateKey(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp)
  const offset = /^UTC([+-])(\d{2}):(\d{2})$/.exec(timeZone)
  const offsetMinutes = offset
    ? (offset[1] === '+' ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3]))
    : 0
  const displayDate = offset ? new Date(date.getTime() + offsetMinutes * 60_000) : date
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: offset ? 'UTC' : timeZone,
  }).formatToParts(displayDate)
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function buildCalendar(report: AnalyticsPerformance, timeZone: string): { initialDate: string; entries: CalendarDatum[] } {
  const rrByDate = new Map<string, number>()
  report.riskReward.series.actual.forEach((point) => {
    if (!point.closedAt) return
    const date = calendarDateKey(point.closedAt, timeZone)
    rrByDate.set(date, (rrByDate.get(date) ?? 0) + point.rr)
  })
  const initialDate = report.calendar.at(-1)?.date ?? calendarDateKey(new Date().toISOString(), timeZone)
  return {
    initialDate,
    entries: report.calendar.map((item) => ({
      ...item,
      riskReward: rrByDate.get(item.date) ?? null,
    })),
  }
}

function monthValues(report: AnalyticsPerformance): string[] {
  const values = Array.from({ length: 12 }, () => '—')
  const years = report.byMonth.flatMap((item) => {
    const year = Number(item.month.slice(0, 4))
    return Number.isFinite(year) ? [year] : []
  })
  const year = years.length > 0 ? Math.max(...years) : new Date().getFullYear()
  report.byMonth.forEach((item) => {
    if (Number(item.month.slice(0, 4)) !== year) return
    const index = Number(item.month.slice(5, 7)) - 1
    if (index >= 0 && index < 12) values[index] = percent(item.monthlyGainPercent, true)
  })
  return [...values, percent(report.overview.pnlPercent, true)]
}

export function toAnalyticsReportView(report: AnalyticsPerformance, timeZone = 'UTC'): AnalyticsReportView {
  const calendar = buildCalendar(report, timeZone)
  const buyTotal = report.bySide.buy.trades + report.bySide.sell.trades
  const frequencyWeekdays = report.frequency.byWeekday
  return {
    id: report.source.id,
    kind: report.source.type === 'session' ? 'Replay session' : 'Evaluation account',
    title: report.source.title,
    subtitle: report.source.subtitle,
    status: report.source.status,
    totalPnl: currency.format(report.overview.totalPnl),
    pnlPercent: percent(report.overview.pnlPercent),
    balance: currency.format(report.overview.accountBalance),
    winRate: percent(report.overview.winRate),
    totalTrades: report.overview.totalTrades,
    longTrades: report.overview.longTrades,
    shortTrades: report.overview.shortTrades,
    breakevenTrades: report.overview.breakevenTrades,
    equityCurve: report.equityCurve.map((point) => point.cumulativePnl),
    curveLabels: curveLabels(report),
    averageRr: report.riskReward.averageRr.toFixed(2),
    maxRr: report.riskReward.maxRr.toFixed(2),
    idealAverageRr: report.riskReward.idealAverageRr.toFixed(2),
    maxIdealRr: report.riskReward.maxIdealRr.toFixed(2),
    couldHaveProfitOrBe: report.riskReward.couldHaveProfitOrBreakeven,
    couldHaveMaxIdealRr: report.riskReward.couldHaveMaxIdealRr.toFixed(2),
    rrCurves: {
      rr: report.riskReward.series.actual.map((point) => point.rr),
      ideal: report.riskReward.series.ideal.map((point) => point.rr),
      missed: report.riskReward.series.missed.map((point) => point.rr),
    },
    expectancy: currency.format(report.expectancy.value),
    averageWin: currency.format(report.expectancy.averageWin),
    averageLoss: currency.format(report.expectancy.averageLoss),
    profitFactor: report.expectancy.profitFactor?.toFixed(2) ?? '—',
    winnerRows: [
      { label: 'Total winners', value: String(report.winners.total) }, { label: 'Best win', value: percent(report.winners.bestWinPercent) },
      { label: 'Average win', value: percent(report.winners.averageWinPercent) }, { label: 'Average duration', value: duration(report.winners.averageDurationSeconds) },
      { label: 'Max consecutive wins', value: String(report.winners.maxConsecutive) }, { label: 'Avg consecutive wins', value: report.winners.averageConsecutive.toFixed(2) },
    ],
    loserRows: [
      { label: 'Total losers', value: String(report.losers.total) }, { label: 'Worst loss', value: percent(report.losers.worstLossPercent) },
      { label: 'Average loss', value: percent(report.losers.averageLossPercent) }, { label: 'Average duration', value: duration(report.losers.averageDurationSeconds) },
      { label: 'Max consecutive losses', value: String(report.losers.maxConsecutive) }, { label: 'Avg consecutive losses', value: report.losers.averageConsecutive.toFixed(2) },
    ],
    buyPercent: buyTotal > 0 ? report.bySide.buy.trades / buyTotal * 100 : 0,
    sellPercent: buyTotal > 0 ? report.bySide.sell.trades / buyTotal * 100 : 0,
    buyWinRate: report.bySide.buy.winRate,
    sellWinRate: report.bySide.sell.winRate,
    sessionData: [
      { label: 'Win Rate', values: normalizedSessionValues(report, 'winRate') },
      { label: 'Total Trades', values: normalizedSessionValues(report, 'totalTrades') },
      { label: 'Avg RR', values: normalizedSessionValues(report, 'averageRr') },
      { label: 'Profit', values: normalizedSessionValues(report, 'totalPnl') },
    ],
    performanceByTime: {
      pnl: report.byTime.pnl.map((item) => ({ label: `${item.hour}:00`, profit: item.profit, loss: item.loss })),
      rr: report.byTime.rr.map((item) => ({ label: `${item.hour}:00`, value: item.averageRr })),
      profitPct: report.byTime.profitPercent.map((item) => ({ label: `${item.hour}:00`, profit: Math.max(0, item.profitPercent), loss: Math.min(0, item.profitPercent) })),
      winRate: report.byTime.winRate.map((item) => ({ label: `${item.hour}:00`, value: item.winRate })),
    },
    dayData: report.byDay.map((item) => ({ label: item.day.slice(0, 3), profit: item.profit, loss: item.loss, winRate: item.totalTrades > 0 ? item.winRate : null })),
    monthlyValues: monthValues(report),
    calendarInitialDate: calendar.initialDate,
    calendarEntries: calendar.entries,
    frequencyData: [
      { title: 'Trades / day', average: report.frequency.averageTradesPerDay.toFixed(2), labels: frequencyWeekdays.map((item) => item.day.slice(0, 2)), values: frequencyWeekdays.map((item) => item.averageTrades) },
      { title: 'Trades / week', average: report.frequency.averageTradesPerWeek.toFixed(2), labels: report.frequency.byWeek.map((_, index) => String(index + 1)), values: report.frequency.byWeek.map((item) => item.totalTrades) },
      { title: 'Trades / month', average: report.frequency.averageTradesPerMonth.toFixed(2), labels: report.frequency.byMonth.map((item) => item.month.slice(5, 7)), values: report.frequency.byMonth.map((item) => item.totalTrades) },
    ],
  }
}
