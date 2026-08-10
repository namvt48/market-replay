import { z } from 'zod'
import type { SymbolMeta } from '../api/types'

export const marketSessionSchema = z.enum(['eth', 'rth'])
export type MarketSession = z.infer<typeof marketSessionSchema>

export const DEFAULT_MARKET_SESSION: MarketSession = 'eth'

const RTH_OPEN_MINUTE = 9 * 60 + 30
const RTH_CLOSE_MINUTE = 16 * 60
const MAX_CACHED_MINUTES_PER_ZONE = 50_000

const formatters = new Map<string, Intl.DateTimeFormat>()
const minuteCaches = new Map<string, Map<number, boolean>>()

function sessionFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  formatters.set(timeZone, formatter)
  return formatter
}

interface ZonedMinuteParts {
  year: number
  month: number
  day: number
  weekday: string
  minute: number
}

function zonedMinuteParts(timestamp: number, timeZone: string): ZonedMinuteParts {
  const values = Object.fromEntries(
    sessionFormatter(timeZone).formatToParts(new Date(timestamp * 1000)).map((part) => [part.type, part.value]),
  )
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: values.weekday,
    minute: Number(values.hour) * 60 + Number(values.minute),
  }
}

function zonedEpoch(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0)
  let guess = target
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observedParts = zonedMinuteParts(guess / 1000, timeZone)
    const observed = Date.UTC(
      observedParts.year,
      observedParts.month - 1,
      observedParts.day,
      Math.floor(observedParts.minute / 60),
      observedParts.minute % 60,
      0,
    )
    const adjustment = target - observed
    guess += adjustment
    if (adjustment === 0) break
  }
  return Math.floor(guess / 1000)
}

/**
 * RTH is the cash-session window traders use to remove overnight price
 * action from US index/equity charts. The symbol timezone, rather than the
 * browser timezone, keeps the boundary correct through US daylight saving.
 */
export function isRegularTradingHours(timestamp: number, timeZone: string): boolean {
  const epochMinute = Math.floor(timestamp / 60)
  let cache = minuteCaches.get(timeZone)
  if (!cache) {
    cache = new Map()
    minuteCaches.set(timeZone, cache)
  }
  const cached = cache.get(epochMinute)
  if (cached !== undefined) return cached

  const parts = zonedMinuteParts(epochMinute * 60, timeZone)
  const included = parts.weekday !== 'Sat' && parts.weekday !== 'Sun' && parts.minute >= RTH_OPEN_MINUTE && parts.minute < RTH_CLOSE_MINUTE

  if (cache.size >= MAX_CACHED_MINUTES_PER_ZONE) cache.clear()
  cache.set(epochMinute, included)
  return included
}

export function marketSessionIncludes(timestamp: number, session: MarketSession, symbol: SymbolMeta): boolean {
  return session === 'eth' || isRegularTradingHours(timestamp, symbol.sessionTz)
}

export function nextRegularTradingTimestamp(timestamp: number, stepSeconds: number, timeZone: string): number {
  const candidate = timestamp + stepSeconds
  if (isRegularTradingHours(candidate, timeZone)) return candidate

  const parts = zonedMinuteParts(candidate, timeZone)
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  if (parts.weekday !== 'Sat' && parts.weekday !== 'Sun' && parts.minute < RTH_OPEN_MINUTE) {
    return zonedEpoch(parts.year, parts.month, parts.day, 9, 30, timeZone)
  }

  do date.setUTCDate(date.getUTCDate() + 1)
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6)
  return zonedEpoch(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 9, 30, timeZone)
}
