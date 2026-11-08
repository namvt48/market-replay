import type { ChartBarTicks, IndicatorDescriptor, IndicatorDrawIntent, IndicatorInputValue, IndicatorRunResult, Timeframe } from '../api/types'

const SESSIONS = [
  { key: 'sydney', name: 'Sydney', start: '08:00', end: '17:00', timezone: 'Australia/Sydney', color: { r: 41, g: 98, b: 255, a: 0.12 } },
  { key: 'tokyo', name: 'Tokyo', start: '09:00', end: '18:00', timezone: 'Asia/Tokyo', color: { r: 255, g: 152, b: 0, a: 0.12 } },
  { key: 'london', name: 'London', start: '08:00', end: '17:00', timezone: 'Europe/London', color: { r: 38, g: 166, b: 154, a: 0.12 } },
  { key: 'new-york', name: 'New York', start: '08:00', end: '17:00', timezone: 'America/New_York', color: { r: 171, g: 71, b: 188, a: 0.12 } },
] as const

export const tradingSessionsDescriptor: IndicatorDescriptor = {
  id: 'trading-sessions', name: 'Trading Sessions', version: 1, meta: { onMainPanel: true },
  inputs: [
    ...SESSIONS.flatMap((session) => [
      { kind: 'bool' as const, key: `${session.key}Enabled`, label: `${session.name} enabled`, group: session.name, default: true },
      { kind: 'time' as const, key: `${session.key}Start`, label: 'Start', group: session.name, default: Number(session.start.slice(0, 2)) * 100 + Number(session.start.slice(3)) },
      { kind: 'time' as const, key: `${session.key}End`, label: 'End', group: session.name, default: Number(session.end.slice(0, 2)) * 100 + Number(session.end.slice(3)) },
      { kind: 'str' as const, key: `${session.key}Timezone`, label: 'Timezone', group: session.name, default: session.timezone },
      { kind: 'color' as const, key: `${session.key}Color`, label: 'Color', group: session.name, default: session.color },
    ]),
    { kind: 'bool', key: 'showLabels', label: 'Show labels', default: true },
    { kind: 'str', key: 'display', label: 'Display', default: 'box', options: ['box', 'background'] },
    { kind: 'int', key: 'retainedSessions', label: 'Retained sessions', default: 80, min: 1, max: 500, step: 1 },
    { kind: 'bool', key: 'excludeWeekends', label: 'Exclude weekends', default: true },
  ],
}

type SessionConfig = { name: string; start: string; end: string; timezone: string; color: { r: number; g: number; b: number; a: number } }
type Civil = { year: number; month: number; day: number; hour: number; minute: number; weekday: number }
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timezone, formatter)
  }
  return formatter
}

function civilTime(seconds: number, timezone: string): Civil {
  let year = 0
  let month = 0
  let day = 0
  let hour = 0
  let minute = 0
  for (const part of formatterFor(timezone).formatToParts(new Date(seconds * 1000))) {
    const value = Number(part.value)
    if (part.type === 'year') year = value
    else if (part.type === 'month') month = value
    else if (part.type === 'day') day = value
    else if (part.type === 'hour') hour = value
    else if (part.type === 'minute') minute = value
  }
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return { year, month, day, hour, minute, weekday }
}

function timeText(value: IndicatorInputValue, key: string): string {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2359) {
    return `${String(Math.floor(value / 100)).padStart(2, '0')}:${String(value % 100).padStart(2, '0')}`
  }
  if (typeof value === 'string') return value
  throw new Error(`Invalid ${key}: expected HHmm`)
}

function minuteOfDay(time: string, key: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error(`Invalid ${key}: expected HH:mm`)
  return Number(match[1]) * 60 + Number(match[2])
}

function configFor(key: string, name: string, inputs: Record<string, IndicatorInputValue>, defaults: { start: string; end: string; timezone: string; color: SessionConfig['color'] }): SessionConfig | undefined {
  const enabled = inputs[`${key}Enabled`] ?? true
  if (typeof enabled !== 'boolean') throw new Error(`Invalid input ${key}Enabled`)
  if (!enabled) return undefined
  const startValue = inputs[`${key}Start`] ?? defaults.start
  const endValue = inputs[`${key}End`] ?? defaults.end
  const timezone = inputs[`${key}Timezone`] ?? defaults.timezone
  const color = inputs[`${key}Color`] ?? defaults.color
  if (typeof timezone !== 'string' || typeof color !== 'object' || color === null || !('r' in color) || !('g' in color) || !('b' in color) || !('a' in color)) throw new Error(`Invalid input for ${name}`)
  const start = timeText(startValue, `${key}Start`)
  const end = timeText(endValue, `${key}End`)
  const startMinute = minuteOfDay(start, `${key}Start`)
  const endMinute = minuteOfDay(end, `${key}End`)
  if (startMinute === endMinute) throw new Error(`Invalid ${key} window: start and end must differ`)
  try { formatterFor(timezone).format(0) } catch { throw new Error(`Invalid ${key}Timezone: ${timezone}`) }
  for (const channel of [color.r, color.g, color.b, color.a]) if (typeof channel !== 'number' || !Number.isFinite(channel)) throw new Error(`Invalid ${key}Color`)
  return { name, start, end, timezone, color }
}

function civilKey(date: Pick<Civil, 'year' | 'month' | 'day'>): number { return date.year * 10_000 + date.month * 100 + date.day }
function previousDate(date: Civil): Civil {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day - 1))
  return { ...date, year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() }
}

type SessionGroup = { day: Civil; bars: ChartBarTicks[]; lastIndex: number }
type SessionSettings = {
  showLabels: boolean
  display: 'box' | 'background'
  retainedSessions: number
  excludeWeekends: boolean
}

function sessionSettings(inputs: Record<string, IndicatorInputValue>): SessionSettings {
  const showLabels = inputs.showLabels ?? true
  const display = inputs.display ?? 'box'
  const retainedSessions = inputs.retainedSessions ?? 80
  const excludeWeekends = inputs.excludeWeekends ?? true
  if (
    typeof showLabels !== 'boolean' ||
    typeof excludeWeekends !== 'boolean' ||
    (display !== 'box' && display !== 'background') ||
    typeof retainedSessions !== 'number' ||
    !Number.isInteger(retainedSessions) ||
    retainedSessions < 1 ||
    retainedSessions > 500
  ) throw new Error('Invalid trading-sessions input')
  return { showLabels, display, retainedSessions, excludeWeekends }
}

function collectSessionBars(
  bars: ChartBarTicks[],
  config: SessionConfig,
  excludeWeekends: boolean,
  retainedSessions: number,
): SessionGroup[] {
  const startMinute = minuteOfDay(config.start, `${config.name} start`)
  const endMinute = minuteOfDay(config.end, `${config.name} end`)
  const overnight = endMinute < startMinute
  const byDay = new Map<number, SessionGroup>()
  for (const [barIndex, bar] of bars.entries()) {
    if (!Number.isFinite(bar.time)) continue
    const local = civilTime(bar.time, config.timezone)
    const minute = local.hour * 60 + local.minute
    const inWindow = overnight
      ? minute >= startMinute || minute < endMinute
      : minute >= startMinute && minute < endMinute
    if (!inWindow) continue
    const anchor = overnight && minute < endMinute ? previousDate(local) : local
    const weekday = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day)).getUTCDay()
    if (excludeWeekends && (weekday === 0 || weekday === 6)) continue
    const key = civilKey(anchor)
    const group = byDay.get(key) ?? { day: anchor, bars: [], lastIndex: barIndex }
    group.bars.push(bar)
    group.lastIndex = barIndex
    byDay.set(key, group)
  }
  return [...byDay.values()]
    .sort((left, right) => civilKey(left.day) - civilKey(right.day))
    .slice(-retainedSessions)
}

function sessionDrawing(
  bars: ChartBarTicks[],
  session: SessionGroup,
  config: SessionConfig,
  tickSize: number,
  settings: SessionSettings,
  id: number,
): IndicatorDrawIntent {
  const first = session.bars[0]
  const last = session.bars[session.bars.length - 1]
  let high = -Infinity
  let low = Infinity
  for (const bar of session.bars) {
    high = Math.max(high, bar.highTicks * tickSize)
    low = Math.min(low, bar.lowTicks * tickSize)
  }
  return {
    id,
    kind: 'rectangle',
    label: settings.showLabels ? config.name : undefined,
    t0: first.time,
    y0: high,
    t1: bars[session.lastIndex + 1]?.time ?? last.time,
    y1: low,
    style: { color: config.color, fillColor: config.color, display: settings.display, borderColor: config.color },
  }
}

export function calculateTradingSessions(
  bars: ChartBarTicks[],
  inputs: Record<string, IndicatorInputValue>,
  tickSize: number,
  _timeframe: Timeframe | string,
  _sessionTz: string,
  _isFuture = false,
): IndicatorRunResult {
  if (!Number.isFinite(tickSize) || tickSize <= 0) throw new Error('Invalid tickSize')
  const settings = sessionSettings(inputs)
  const configs = SESSIONS.map((session) => configFor(session.key, session.name, inputs, session))
    .filter((config): config is SessionConfig => config !== undefined)
  const draws: IndicatorDrawIntent[] = []
  for (const config of configs) {
    const groups = collectSessionBars(bars, config, settings.excludeWeekends, settings.retainedSessions)
    for (const group of groups) draws.push(sessionDrawing(bars, group, config, tickSize, settings, draws.length))
  }
  return { draws, plots: [], onMainPanel: true }
}
