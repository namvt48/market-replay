// This Pine Script™ code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/
// © I'm Duy
import type { IndicatorDrawIntent, IndicatorInputValue } from '../api/types'
import { sessionDayKeyFromParts, zonedDateParts } from './local-indicator-session'

export interface ZonedBarTime {
  year: number
  month: number
  date: number
  hour: number
  minute: number
  minuteOfDay: number
  day: string
  weekday: number
}

export interface PxBar {
  time: number
  o: number
  h: number
  l: number
  c: number
  index: number
}
export type DrawEx = IndicatorDrawIntent & { xOffset0?: number; xOffset1?: number }
export interface IndicatorColor { r: number; g: number; b: number; a: number }
type C = IndicatorColor

export function css(value: C): string {
  return `rgba(${Math.round(value.r)},${Math.round(value.g)},${Math.round(value.b)},${value.a})`
}

export function isColor(value: IndicatorInputValue): value is IndicatorColor {
  return typeof value === 'object' && value !== null
    && typeof value.r === 'number' && typeof value.g === 'number'
    && typeof value.b === 'number' && typeof value.a === 'number'
}

export function val(inputs: Record<string, IndicatorInputValue>, key: string, fallback: string): string
export function val(inputs: Record<string, IndicatorInputValue>, key: string, fallback: number): number
export function val(inputs: Record<string, IndicatorInputValue>, key: string, fallback: boolean): boolean
export function val(
  inputs: Record<string, IndicatorInputValue>,
  key: string,
  fallback: IndicatorColor,
): IndicatorColor
export function val(
  inputs: Record<string, IndicatorInputValue>,
  key: string,
  fallback: IndicatorInputValue,
): IndicatorInputValue
export function val(
  inputs: Record<string, IndicatorInputValue>,
  key: string,
  fallback: IndicatorInputValue,
): IndicatorInputValue {
  const value = inputs[key]
  if (value === undefined) return fallback
  if (typeof value === typeof fallback) return value
  return isColor(value) && isColor(fallback) ? value : fallback
}

export function timeframeSeconds(tf: string): number {
  const match = /^(\d+)([smhdwM]|D|W)$/.exec(tf)
  if (match) {
    const scales: Record<string, number> = {
      s: 1, m: 60, h: 3600, d: 86400, D: 86400,
      w: 604800, W: 604800, M: 2592000,
    }
    return Number(match[1]) * (scales[match[2]] ?? 0)
  }
  return /^\d+$/.test(tf) ? Number(tf) * 60 : 0
}


export function validHigherTimeframe(htf: string, chartSeconds: number): boolean {
  const seconds = timeframeSeconds(htf)
  return seconds > chartSeconds && (seconds >= 86400 || seconds % chartSeconds === 0)
}

export function weekday(parts: number[]): number {
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay()
}

export function bucketKey(
  bar: PxBar,
  tf: string,
  zone: string,
  custom: boolean,
  customAt: string,
  isFuture = false,
  localTime?: ZonedBarTime,
): string {
  const interval = timeframeSeconds(tf)
  if (interval > 0 && interval < 86400) {
    return `${tf}:${Math.trunc(bar.time / interval)}`
  }
  const parts = localTime
    ? [localTime.year, localTime.month, localTime.date, localTime.hour, localTime.minute]
    : zonedDateParts(bar.time, zone)
  if (custom && tf === '1D') {
    const boundaryMinutes = customAt === '8:30' ? 510 : customAt === '9:30' ? 570 : 0
    const shifted = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4])
      - boundaryMinutes * 60_000
    const boundary = new Date(shifted)
    return `d:${boundary.getUTCFullYear()}-${boundary.getUTCMonth()}-${boundary.getUTCDate()}`
  }
  const sessionDate = isFuture
    ? sessionDayKeyFromParts(parts, true)
    : parts[0] * 10_000 + parts[1] * 100 + parts[2]
  const year = Math.trunc(sessionDate / 10_000)
  const month = Math.trunc((sessionDate % 10_000) / 100)
  const day = sessionDate % 100
  if (tf === '1D') return `d:${year}-${month}-${day}`
  if (tf === '1W') {
    const monday = new Date(Date.UTC(year, month - 1, day))
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
    return `w:${monday.getUTCFullYear()}-${monday.getUTCMonth()}-${monday.getUTCDate()}`
  }
  if (tf === '1M') return `m:${year}-${month}`
  return `${tf}:${Math.trunc(bar.time / timeframeSeconds(tf))}`
}

export interface SessionRange {
  startMinute: number
  endMinute: number
}

export function parseSessionRange(session: string): SessionRange | undefined {
  const match = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(session)
  if (!match) return undefined
  const startHour = Number(match[1])
  const startMinute = Number(match[2])
  const endHour = Number(match[3])
  const endMinute = Number(match[4])
  if (startHour > 23 || startMinute > 59 || endHour > 24 || endMinute > 59
    || (endHour === 24 && endMinute !== 0)) return undefined
  return {
    startMinute: startHour * 60 + startMinute,
    endMinute: endHour * 60 + endMinute,
  }
}

export function sessionContainsMinute(minute: number, session: SessionRange): boolean {
  const { startMinute, endMinute } = session
  return startMinute < endMinute
    ? minute >= startMinute && minute < endMinute
    : minute >= startMinute || minute < endMinute
}

export function sessionInside(minute: number, session: string): boolean {
  const parsed = parseSessionRange(session)
  return parsed ? sessionContainsMinute(minute, parsed) : false
}

export function colorInput(
  inputs: Record<string, IndicatorInputValue>,
  key: string,
  fallback: C | string,
): string {
  const value = inputs[key]
  if (value !== undefined && isColor(value)) return css(value)
  return typeof fallback === 'string' ? fallback : css(fallback)
}

export function withTransparency(value: string, opacity: number): string {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(value)
  if (!match) return value
  const alpha = Number(match[4] ?? 1) * opacity
  return `rgba(${match[1]},${match[2]},${match[3]},${Math.max(0, Math.min(1, alpha))})`
}

export function zonedBarTimes(bars: PxBar[], zone: string): ZonedBarTime[] {
  return bars.map((bar) => {
    const [year, month, date, hour, minute] = zonedDateParts(bar.time, zone)
    return {
      year, month, date, hour, minute,
      minuteOfDay: hour * 60 + minute,
      day: `${year}-${month}-${date}`,
      weekday: new Date(Date.UTC(year, month - 1, date)).getUTCDay(),
    }
  })
}



export function fontPixels(size: string): number {
  const sizes: Record<string, number> = {
    tiny: 8, small: 10, normal: 12, large: 14, huge: 16, auto: 12,
  }
  return sizes[size] ?? 12
}

export function draw(
  kind: IndicatorDrawIntent['kind'],
  t0: number,
  y0: number,
  t1: number | undefined,
  y1: number | undefined,
  style: Record<string, unknown>,
  label?: string,
  xOffset0?: number,
  xOffset1?: number,
): DrawEx {
  const normalizedStyle = typeof style.fontSize === 'string'
    ? { ...style, fontSize: fontPixels(style.fontSize) }
    : style
  const visibleLabel = label
    ?? (typeof normalizedStyle.text === 'string' ? normalizedStyle.text : undefined)
    ?? (kind === 'marker' && typeof normalizedStyle.char === 'string'
      && normalizedStyle.char !== ' ' ? normalizedStyle.char : undefined)
  return {
    id: 0, kind, t0, y0, t1, y1, label: visibleLabel, style: normalizedStyle,
    ...(xOffset0 === undefined ? {} : { xOffset0 }),
    ...(xOffset1 === undefined ? {} : { xOffset1 }),
  }
}

export function groupBars(
  bars: PxBar[],
  tf: string,
  zone: string,
  custom: boolean,
  customAt: string,
  isFuture = false,
  localTimes?: readonly ZonedBarTime[],
): PxBar[][] {
  const groups: PxBar[][] = []
  let currentKey = ''
  for (const bar of bars) {
    const key = bucketKey(bar, tf, zone, custom, customAt, isFuture, localTimes?.[bar.index])
    if (key !== currentKey) {
      groups.push([])
      currentKey = key
    }
    groups[groups.length - 1].push(bar)
  }
  return groups
}

export function aggregateBars(
  bars: PxBar[],
  tf: string,
  zone: string,
  isFuture = false,
  localTimes?: readonly ZonedBarTime[],
): PxBar[] {
  return groupBars(bars, tf, zone, false, 'Midnight', isFuture, localTimes).map((group) => ({
    time: group[0].time,
    o: group[0].o,
    h: Math.max(...group.map((bar) => bar.h)),
    l: Math.min(...group.map((bar) => bar.l)),
    c: group[group.length - 1].c,
    index: group[group.length - 1].index,
  }))
}

export function styleColor(colorValue: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { color: colorValue, ...extra }
}
export function screenText(
  bar: PxBar,
  label: string,
  vertical: string,
  horizontal: string,
  fontSize: number,
  textColor: string,
  textAlign: string,
  backgroundColor?: string,
  screenOffsetX = 0,
  screenOffsetY = 0,
  screenWidth?: number,
): DrawEx {
  const style: Record<string, unknown> = {
    screenAnchor: `${vertical}-${horizontal}`,
    screenOffsetX,
    screenOffsetY,
    textColor,
    textAlign,
    fontSize,
  }
  if (backgroundColor !== undefined) style.backgroundColor = backgroundColor
  if (screenWidth !== undefined) {
    style.screenWidth = screenWidth
    style.screenHeight = 22
    style.padding = 4
    style.borderColor = '#000000'
    style.borderWidth = 1
  }
  return draw('screenText', bar.time, bar.c, undefined, undefined, style, label)
}
export function pineTimeframe(tf: string): string {
  const match = /^(\d+)([smhdw])$/.exec(tf)
  if (!match) return tf
  const amount = Number(match[1])
  const unit = match[2]
  if (unit === 'm') return `${amount}M`
  if (unit === 'h') return `${amount * 60}M`
  if (unit === 'd') return `${amount}D`
  if (unit === 'w') return `${amount}W`
  return `${amount}S`
}
export function htfLabel(tf: string): string {
  if (tf === '1D' || tf === '1W') return tf
  const seconds = timeframeSeconds(tf)
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${seconds / 60}m`
  if (seconds < 86400) return `${seconds / 3600}H`
  return tf
}
