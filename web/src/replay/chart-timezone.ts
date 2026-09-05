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

export interface ChartTimezoneIntlContext {
  timeZone: string
  offsetSeconds: number
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

/** Value accepted by the calendar API, including fixed UTC offsets. */
export function chartTimezoneQueryValue(timezone: ChartTimezone): string {
  if (timezone.kind === 'preset') return IANA_ZONES[timezone.id]
  const sign = timezone.minutes >= 0 ? '+' : '-'
  const absolute = Math.abs(timezone.minutes)
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
}

/**
 * Intl does not accept arbitrary UTC offsets as timeZone identifiers. Fixed
 * offsets are therefore shifted once and formatted in UTC; named presets
 * retain their IANA zone so daylight-saving transitions stay correct.
 */
export function chartTimezoneIntlContext(timezone: ChartTimezone): ChartTimezoneIntlContext {
  return timezone.kind === 'preset'
    ? { timeZone: IANA_ZONES[timezone.id], offsetSeconds: 0 }
    : { timeZone: 'UTC', offsetSeconds: timezone.minutes * 60 }
}

export function chartTimezoneDisplayTimestamp(timestamp: number, timezone: ChartTimezone): number {
  return timestamp + chartTimezoneIntlContext(timezone).offsetSeconds
}

export function formatChartTime(timestamp: number, timezone: ChartTimezone, includeDate = true, includeSeconds = false): string {
  const context = chartTimezoneIntlContext(timezone)
  const date = new Date((timestamp + context.offsetSeconds) * 1000)
  const options: Intl.DateTimeFormatOptions = includeDate
    ? { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: includeSeconds ? '2-digit' : undefined, hourCycle: 'h23' }
    : { hour: '2-digit', minute: '2-digit', second: includeSeconds ? '2-digit' : undefined, hourCycle: 'h23' }
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: context.timeZone }).format(date)
}

export function formatChartDate(timestamp: number, timezone: ChartTimezone): string {
  const context = chartTimezoneIntlContext(timezone)
  const date = new Date((timestamp + context.offsetSeconds) * 1000)
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: '2-digit', timeZone: context.timeZone }).format(date)
}

export function chartTimezoneDateValue(timestamp: number, timezone: ChartTimezone): string {
  const context = chartTimezoneIntlContext(timezone)
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: context.timeZone,
  }).formatToParts(new Date((timestamp + context.offsetSeconds) * 1000))
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

/** A datetime-local value rendered in the workspace timezone, not browser time. */
export function chartTimezoneDateTimeValue(timestamp: number, timezone: ChartTimezone): string {
  const context = chartTimezoneIntlContext(timezone)
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: context.timeZone,
  }).formatToParts(new Date((timestamp + context.offsetSeconds) * 1000))
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`
}

/** Interprets a datetime-local value as wall-clock time in the workspace timezone. */
export function chartTimezoneTimestampFromDateTimeValue(value: string, timezone: ChartTimezone): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute] = match
  const desired = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
  if (!Number.isFinite(desired)) return null
  if (timezone.kind === 'offset') return Math.floor(desired / 1000) - timezone.minutes * 60
  let candidate = desired
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rendered = chartTimezoneDateTimeValue(Math.floor(candidate / 1000), timezone)
    const renderedMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(rendered)
    if (!renderedMatch) return null
    const [, renderedYear, renderedMonth, renderedDay, renderedHour, renderedMinute] = renderedMatch
    const renderedUtc = Date.UTC(Number(renderedYear), Number(renderedMonth) - 1, Number(renderedDay), Number(renderedHour), Number(renderedMinute))
    if (renderedUtc === desired) return Math.floor(candidate / 1000)
    candidate += desired - renderedUtc
  }
  return Math.floor(candidate / 1000)
}
