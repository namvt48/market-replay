import type { SymbolMeta, Timeframe } from '../api/types'
import type { Bar1m } from '../fill-engine/types'
import type { DisplayBar } from './chart-adapter'
import { marketSessionIncludes, type MarketSession } from './market-session'
import { parseTimeframe, timeframeSeconds, type ParsedTimeframe } from './timeframe'

const sessionFormatters = new Map<string, Intl.DateTimeFormat>()
interface SessionBucket { key: string; time: number }
interface DisplayBucket { key: string | number; time: number }

const sessionKeys = new Map<string, SessionBucket>()
const regularSessionKeys = new Map<string, SessionBucket>()
const calendarKeys = new Map<string, SessionBucket>()
const SESSION_KEY_BLOCK_SECONDS = 15 * 60
const MAX_SESSION_KEY_BLOCKS = 4096

function sessionFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = sessionFormatters.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  sessionFormatters.set(timeZone, formatter)
  return formatter
}

function sessionBucket(timestamp: number, symbol: SymbolMeta, keyPrefix: string): SessionBucket {
  const cacheKey = keyPrefix + Math.floor(timestamp / SESSION_KEY_BLOCK_SECONDS)
  const cached = sessionKeys.get(cacheKey)
  if (cached) return cached
  const parts = sessionFormatter(symbol.sessionTz).formatToParts(new Date(timestamp * 1000))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const date = new Date(`${values.year}-${values.month}-${values.day}T00:00:00Z`)
  if (symbol.kind === 'future' && Number(values.hour) >= 18) date.setUTCDate(date.getUTCDate() + 1)
  const key = date.toISOString().slice(0, 10)
  const hour = Number(values.hour)
  const secondsIntoSession = symbol.kind === 'future'
    ? ((hour >= 18 ? hour - 18 : hour + 6) * 3600) + Number(values.minute) * 60 + Number(values.second)
    : hour * 3600 + Number(values.minute) * 60 + Number(values.second)
  const bucket = { key, time: timestamp - secondsIntoSession }
  if (sessionKeys.size >= MAX_SESSION_KEY_BLOCKS) {
    const oldest = sessionKeys.keys().next().value
    if (oldest !== undefined) sessionKeys.delete(oldest)
  }
  sessionKeys.set(cacheKey, bucket)
  return bucket
}

function zonedEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0)
  let guess = target
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = sessionFormatter(timeZone).formatToParts(new Date(guess))
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    const observed = Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day),
      Number(values.hour), Number(values.minute), Number(values.second),
    )
    const adjustment = target - observed
    guess += adjustment
    if (adjustment === 0) break
  }
  return Math.floor(guess / 1000)
}

function regularSessionBucket(timestamp: number, context: BucketContext): SessionBucket {
  const blockKey = context.regularSessionKeyPrefix + Math.floor(timestamp / SESSION_KEY_BLOCK_SECONDS)
  let session = regularSessionKeys.get(blockKey)
  if (!session) {
    const parts = sessionFormatter(context.symbol.sessionTz).formatToParts(new Date(timestamp * 1000))
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    const year = Number(values.year)
    const month = Number(values.month)
    const day = Number(values.day)
    session = {
      key: `${values.year}-${values.month}-${values.day}`,
      time: zonedEpoch(year, month, day, 9, 30, context.symbol.sessionTz),
    }
    if (regularSessionKeys.size >= MAX_SESSION_KEY_BLOCKS) {
      const oldest = regularSessionKeys.keys().next().value
      if (oldest !== undefined) regularSessionKeys.delete(oldest)
    }
    regularSessionKeys.set(blockKey, session)
  }

  if (context.mode !== 'fixed') return session
  const bucketTime = session.time + Math.floor((timestamp - session.time) / context.seconds) * context.seconds
  return { key: String(bucketTime), time: bucketTime }
}

function calendarBucket(timestamp: number, context: BucketContext): SessionBucket {
  const { parsed, symbol } = context
  if (!parsed || (parsed.unit !== 'w' && parsed.unit !== 'M')) return sessionBucket(timestamp, symbol, context.sessionKeyPrefix)
  const session = context.marketSession === 'rth'
    ? regularSessionBucket(timestamp, context)
    : sessionBucket(timestamp, symbol, context.sessionKeyPrefix)
  const cacheKey = context.calendarKeyPrefix + session.key
  const cached = calendarKeys.get(cacheKey)
  if (cached) return cached

  const date = new Date(`${session.key}T12:00:00Z`)
  if (parsed.unit === 'w') {
    const daysFromMonday = (date.getUTCDay() + 6) % 7
    date.setUTCDate(date.getUTCDate() - daysFromMonday)
    const anchorDays = Math.floor(Date.UTC(1970, 0, 5) / 86_400_000)
    const weekStartDays = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000)
    const groupedWeek = Math.floor(((weekStartDays - anchorDays) / 7) / parsed.multiplier) * parsed.multiplier
    date.setTime((anchorDays + groupedWeek * 7) * 86_400_000)
  } else {
    const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth()
    const groupedMonth = Math.floor(monthIndex / parsed.multiplier) * parsed.multiplier
    date.setUTCFullYear(Math.floor(groupedMonth / 12), groupedMonth % 12, 1)
  }

  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  const openDate = new Date(Date.UTC(year, month - 1, day))
  if (context.marketSession === 'eth' && symbol.kind === 'future') openDate.setUTCDate(openDate.getUTCDate() - 1)
  const time = zonedEpoch(
    openDate.getUTCFullYear(), openDate.getUTCMonth() + 1, openDate.getUTCDate(),
    context.marketSession === 'rth' ? 9 : symbol.kind === 'future' ? 18 : 0,
    context.marketSession === 'rth' ? 30 : 0,
    symbol.sessionTz,
  )
  const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const bucket = { key, time }
  if (calendarKeys.size >= MAX_SESSION_KEY_BLOCKS) {
    const oldest = calendarKeys.keys().next().value
    if (oldest !== undefined) calendarKeys.delete(oldest)
  }
  calendarKeys.set(cacheKey, bucket)
  return bucket
}

/**
 * Everything derivable from (timeframe, symbol) alone, resolved once per
 * aggregation instead of once per bar.
 *
 * bucketFor used to call parseTimeframe — a trim, a regex exec and an
 * object literal — and then timeframeSeconds, which parses again, for every
 * single bar. Rebuilding a 6,000-bar display history therefore ran 12,000
 * regex executions, which was most of its measured 2.83 ms. The two cache
 * key prefixes are hoisted for the same reason: they were rebuilt as
 * template literals per bar purely to look up a cache.
 */
interface BucketContext {
  parsed: ParsedTimeframe | null
  timeframe: Timeframe
  symbol: SymbolMeta
  mode: 'session' | 'calendar' | 'fixed'
  seconds: number
  sessionKeyPrefix: string
  calendarKeyPrefix: string
  regularSessionKeyPrefix: string
  marketSession: MarketSession
}

function bucketContext(timeframe: Timeframe, symbol: SymbolMeta, marketSession: MarketSession): BucketContext {
  const parsed = parseTimeframe(timeframe)
  return {
    parsed,
    timeframe,
    symbol,
    mode: parsed?.isSessionDaily ? 'session' : parsed?.unit === 'w' || parsed?.unit === 'M' ? 'calendar' : 'fixed',
    // 0 when the timeframe is unparseable, so bucketFor still raises through
    // timeframeSeconds on the first bar rather than from a constructor that
    // may never be pushed to.
    seconds: parsed?.seconds ?? 0,
    sessionKeyPrefix: `${symbol.sessionTz}:${symbol.kind}:`,
    calendarKeyPrefix: `${symbol.sessionTz}:${symbol.kind}:${marketSession}:${timeframe}:`,
    regularSessionKeyPrefix: `${symbol.sessionTz}:rth:`,
    marketSession,
  }
}

function bucketFor(bar: Bar1m, context: BucketContext): DisplayBucket {
  if (context.marketSession === 'rth' && context.mode !== 'calendar') return regularSessionBucket(bar.ts, context)
  if (context.mode === 'session') return sessionBucket(bar.ts, context.symbol, context.sessionKeyPrefix)
  if (context.mode === 'calendar') return calendarBucket(bar.ts, context)
  const seconds = context.seconds || timeframeSeconds(context.timeframe)
  const time = Math.floor(bar.ts / seconds) * seconds
  return { key: time, time }
}

export class DisplayAggregator {
  private currentKey: string | number | null = null
  private current: DisplayBar | null = null

  private readonly context: BucketContext
  private readonly tickSize: number

  constructor(timeframe: Timeframe, symbol: SymbolMeta, tickSize: number, marketSession: MarketSession = 'eth') {
    this.context = bucketContext(timeframe, symbol, marketSession)
    this.tickSize = tickSize
  }

  push(bar: Bar1m): { closed: DisplayBar | null; forming: DisplayBar } {
    const bucket = bucketFor(bar, this.context)
    const price = (ticks: number): number => ticks * this.tickSize
    let closed: DisplayBar | null = null
    if (this.currentKey !== bucket.key || !this.current) {
      closed = this.current
      this.currentKey = bucket.key
      this.current = {
        time: bucket.time,
        open: price(bar.openTicks), high: price(bar.highTicks), low: price(bar.lowTicks), close: price(bar.closeTicks), volume: bar.volume,
      }
    } else {
      this.current.high = Math.max(this.current.high, price(bar.highTicks))
      this.current.low = Math.min(this.current.low, price(bar.lowTicks))
      this.current.close = price(bar.closeTicks)
      this.current.volume += bar.volume
    }
    return { closed, forming: { ...this.current } }
  }
}

export function aggregateRange(
  bars: Iterable<Bar1m>,
  timeframe: Timeframe,
  symbol: SymbolMeta,
  tickSize: number,
  marketSession: MarketSession = 'eth',
): DisplayBar[] {
  return buildDisplayHistory(bars, timeframe, symbol, tickSize, marketSession).bars
}

export interface DisplayHistoryBuild {
  bars: DisplayBar[]
  aggregator: DisplayAggregator
}

export function buildDisplayHistory(
  bars: Iterable<Bar1m>,
  timeframe: Timeframe,
  symbol: SymbolMeta,
  tickSize: number,
  marketSession: MarketSession = 'eth',
): DisplayHistoryBuild {
  const aggregator = new DisplayAggregator(timeframe, symbol, tickSize, marketSession)
  const output: DisplayBar[] = []
  for (const bar of bars) {
    if (!marketSessionIncludes(bar.ts, marketSession, symbol)) continue
    const result = aggregator.push(bar)
    if (output.length === 0 || output.at(-1)?.time !== result.forming.time) output.push(result.forming)
    else output[output.length - 1] = result.forming
  }
  return { bars: output, aggregator }
}
