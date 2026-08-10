import { z } from 'zod'

export const chartTimezoneSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), id: z.enum(['ET', 'CT', 'MT', 'PT', 'UTC']) }),
  z.object({ kind: z.literal('offset'), minutes: z.number().int().min(-720).max(840).refine((minutes) => minutes % 30 === 0) }),
])

export type ChartTimezone = z.infer<typeof chartTimezoneSchema>
export type ChartTimezonePreset = Extract<ChartTimezone, { kind: 'preset' }>['id']

export const DEFAULT_CHART_TIMEZONE: ChartTimezone = { kind: 'preset', id: 'ET' }

const IANA_ZONES: Record<ChartTimezonePreset, string> = {
  ET: 'America/New_York',
  CT: 'America/Chicago',
  MT: 'America/Denver',
  PT: 'America/Los_Angeles',
  UTC: 'UTC',
}

export function parseChartTimezone(input: unknown): ChartTimezone {
  const parsed = chartTimezoneSchema.safeParse(input)
  return parsed.success ? parsed.data : DEFAULT_CHART_TIMEZONE
}

export function timezoneLabel(timezone: ChartTimezone): string {
  if (timezone.kind === 'preset') return timezone.id
  const sign = timezone.minutes >= 0 ? '+' : '−'
  const absolute = Math.abs(timezone.minutes)
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
}

export function formatChartTime(timestamp: number, timezone: ChartTimezone, includeDate = true): string {
  const date = new Date(timestamp * 1000)
  const options: Intl.DateTimeFormatOptions = includeDate
    ? { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  if (timezone.kind === 'preset') {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: IANA_ZONES[timezone.id] }).format(date)
  }
  const shifted = new Date(date.getTime() + timezone.minutes * 60_000)
  const rendered = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC', timeZoneName: undefined }).format(shifted)
  return rendered
}
