import type { AnalyticsPerformance } from '../../api/analytics'
import type { CalendarDatum } from '../analytics/analytics-view-model'

export type AccountStage = 'eval' | 'funded'

export interface LiveCalendarReport {
  source: Pick<AnalyticsPerformance['source'], 'id'>
  overview: Pick<AnalyticsPerformance['overview'], 'accountBalance' | 'totalPnl' | 'winRate' | 'totalTrades'>
  riskReward: Pick<AnalyticsPerformance['riskReward'], 'series' | 'averageRr'>
  equityCurve: AnalyticsPerformance['equityCurve']
  calendar: AnalyticsPerformance['calendar']
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

// Reports are fetched with timezone=UTC, so the UTC calendar day matches the
// day key the backend used for calendar rows. Unparseable timestamps (e.g. a
// bad CSV import or legacy data) yield null instead of throwing, so one bad
// trade cannot take down the whole Live page; callers skip those points.
function dayKey(timestamp: string): string | null {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

/**
 * Merges per-account performance reports into a single portfolio calendar.
 * Calendar rows are summed by date (trades/wins/losses/breakeven/pnl), the
 * risk-reward series is summed by close date, and pnlPercent is recomputed
 * against the combined starting balance across accounts.
 */
export function mergeLiveCalendars(reports: LiveCalendarReport[]): { entries: CalendarDatum[]; initialDate: string } {
  const byDate = new Map<string, CalendarDatum>()
  let totalInitialBalance = 0
  for (const report of reports) {
    totalInitialBalance += Math.max(0, report.overview.accountBalance - report.overview.totalPnl)
    const rrByDate = new Map<string, number>()
    report.riskReward.series.actual.forEach((point) => {
      if (!point.closedAt) return
      const date = dayKey(point.closedAt)
      if (!date) return
      rrByDate.set(date, (rrByDate.get(date) ?? 0) + point.rr)
    })
    report.calendar.forEach((item) => {
      const previous = byDate.get(item.date)
      byDate.set(item.date, {
        date: item.date,
        trades: (previous?.trades ?? 0) + item.trades,
        wins: (previous?.wins ?? 0) + item.wins,
        losses: (previous?.losses ?? 0) + item.losses,
        breakeven: (previous?.breakeven ?? 0) + item.breakeven,
        pnl: round2((previous?.pnl ?? 0) + item.pnl),
        pnlPercent: 0,
        riskReward: rrByDate.has(item.date) ? round2((previous?.riskReward ?? 0) + (rrByDate.get(item.date) ?? 0)) : null,
      })
    })
  }
  const entries = [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({
      ...entry,
      pnlPercent: totalInitialBalance > 0 ? round2((entry.pnl / totalInitialBalance) * 100) : 0,
    }))
  const today = new Date().toISOString().slice(0, 10)
  return { entries, initialDate: entries.at(-1)?.date ?? today }
}