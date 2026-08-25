import type { AnalyticsPerformance } from '../../api/analytics'

export type EvalChartPeriod = 'all' | 'day' | 'hour' | '15m'

function bucketKey(value: string, period: Exclude<EvalChartPeriod, 'all'>, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const day = `${fields.year}-${fields.month}-${fields.day}`
  if (period === 'day') return day
  const hour = `${day}T${fields.hour}`
  if (period === 'hour') return hour
  const quarter = Math.floor(Number(fields.minute) / 15) * 15
  return `${hour}:${String(quarter).padStart(2, '0')}`
}

export function groupEvalEquityCurve(
  points: AnalyticsPerformance['equityCurve'],
  period: EvalChartPeriod,
  timeZone: string,
): AnalyticsPerformance['equityCurve'] {
  if (period === 'all') return points
  const seed = points.find((point) => point.closedAt === null)
  const grouped = new Map<string, AnalyticsPerformance['equityCurve'][number]>()
  for (const point of points) {
    if (!point.closedAt) continue
    grouped.set(bucketKey(point.closedAt, period, timeZone), point)
  }
  return seed ? [seed, ...grouped.values()] : [...grouped.values()]
}
