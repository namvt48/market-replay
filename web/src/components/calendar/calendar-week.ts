const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

/** Returns the local Monday date for a timestamp without making DST assumptions. */
export function economicCalendarWeekKey(timestamp: number, timeZone: string): string {
  if (timestamp <= 0) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', timeZone,
  }).formatToParts(timestamp * 1000)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const day = Number(parts.find((part) => part.type === 'day')?.value)
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'
  const monday = new Date(Date.UTC(year, month - 1, day - (WEEKDAY_INDEX[weekday] ?? 0)))
  return monday.toISOString().slice(0, 10)
}
