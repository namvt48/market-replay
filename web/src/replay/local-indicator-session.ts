import type { ChartBarTicks } from '../api/types'

const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

export function zonedDateParts(seconds: number, zone: string): number[] {
  let formatter = zoneFormatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    zoneFormatters.set(zone, formatter)
  }
  const parts = formatter.formatToParts(new Date(seconds * 1000))
  const part = (key: string): number => Number(parts.find((item) => item.type === key)?.value ?? 0)
  return [part('year'), part('month'), part('day'), part('hour'), part('minute')]
}

export function sessionDayKey(seconds: number, zone: string, isFuture: boolean): number {
  let [year, month, day, hour] = zonedDateParts(seconds, zone)
  if (isFuture && hour >= 18) {
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1))
    year = nextDay.getUTCFullYear()
    month = nextDay.getUTCMonth() + 1
    day = nextDay.getUTCDate()
  }
  return year * 10_000 + month * 100 + day
}

function sameBarPrefix(prefix: ChartBarTicks[], bars: ChartBarTicks[]): boolean {
  if (prefix.length > bars.length) return false
  for (let index = 0; index < prefix.length; index += 1) {
    const before = prefix[index]
    const next = bars[index]
    if (before.time !== next.time || before.openTicks !== next.openTicks || before.highTicks !== next.highTicks || before.lowTicks !== next.lowTicks || before.closeTicks !== next.closeTicks || before.volume !== next.volume) return false
  }
  return true
}

export function isIndicatorHistoryPrefix(
  previousBars: ChartBarTicks[],
  previousDailyBars: ChartBarTicks[],
  bars: ChartBarTicks[],
  dailyBars: ChartBarTicks[],
  sessionTz: string,
  isFuture: boolean,
): boolean {
  const today = sessionDayKey(bars.at(-1)?.time ?? 0, sessionTz, isFuture)
  const previousClosedDays = previousDailyBars.filter((bar) => sessionDayKey(bar.time, sessionTz, isFuture) < today)
  const currentClosedDays = dailyBars.filter((bar) => sessionDayKey(bar.time, sessionTz, isFuture) < today)
  return sameBarPrefix(previousBars, bars) && sameBarPrefix(previousClosedDays, currentClosedDays)
}
