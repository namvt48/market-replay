// Pure evaluation-simulator rules engine — prop-firm eval/funded rule logic
// extracted from the deployed namireplays.com site. No React, no DOM side
// effects at import time; safe to consume from the Zustand store, the setup
// screen, the progress panel, and vitest alike. All money values are plain
// dollar numbers (no cents conversion at this layer). Timestamps are epoch
// seconds, matching the replay engine.

import { z } from 'zod'

export type DrawdownType = 'static' | 'trailing'

export interface EvalConfig {
  firm: string
  accountSize: number
  profitTarget: number
  /** Dollars of intraday loss allowed; 0 = no daily loss limit. */
  maxDailyLoss: number
  maxTotalLoss: number
  drawdownType: DrawdownType
  trailingLocksAtStart: boolean
  /** EOD (end-of-day) trailing: the floor trails the last close-of-day peak. */
  trailingEod: boolean
  /** Minimum distinct trading days required to pass; 0 = none. */
  minTradingDays: number
  /** Largest winning day as a percentage of total net profit; 0 = disabled. */
  consistencyRulePct: number
  /** Hour of day when the trading day resets in the instrument session timezone. */
  dayResetHour: number
  phase?: 'eval' | 'funded'
}

export const EVAL_PRESETS: EvalConfig[] = [
  { firm: 'FTMO 100K (static)', accountSize: 100000, profitTarget: 10000, maxDailyLoss: 5000, maxTotalLoss: 10000, drawdownType: 'static', trailingLocksAtStart: false, trailingEod: false, minTradingDays: 0, consistencyRulePct: 0, dayResetHour: 0 },
  { firm: 'TopStep 50K (EOD trail)', accountSize: 50000, profitTarget: 3000, maxDailyLoss: 1000, maxTotalLoss: 2000, drawdownType: 'trailing', trailingLocksAtStart: true, trailingEod: true, minTradingDays: 0, consistencyRulePct: 50, dayResetHour: 17 },
  { firm: 'Apex 50K (trailing)', accountSize: 50000, profitTarget: 3000, maxDailyLoss: 0, maxTotalLoss: 2500, drawdownType: 'trailing', trailingLocksAtStart: false, trailingEod: false, minTradingDays: 0, consistencyRulePct: 0, dayResetHour: 17 },
]

export function customConfig(accountSize = 50000): EvalConfig {
  return {
    firm: 'Custom',
    accountSize,
    profitTarget: Math.round(0.08 * accountSize),
    maxDailyLoss: Math.round(0.04 * accountSize),
    maxTotalLoss: Math.round(0.06 * accountSize),
    drawdownType: 'trailing',
    trailingLocksAtStart: false,
    trailingEod: false,
    minTradingDays: 0,
    consistencyRulePct: 40,
    dayResetHour: 17,
  }
}

export interface EvalRuntime {
  startBalance: number
  peakEquity: number
  eodPeak: number
  lastEquity: number
  /** Day number derived from ts + dayResetHour; null before the first tick. */
  dayKey: number | null
  dayStartEquity: number
  outcome: 'in_progress' | 'passed' | 'failed'
  failReason: 'total' | 'daily' | null
  failedAt: number | null
  passedAt: number | null
}

export function newRuntime(config: EvalConfig): EvalRuntime {
  return {
    startBalance: config.accountSize,
    peakEquity: config.accountSize,
    eodPeak: config.accountSize,
    lastEquity: config.accountSize,
    dayKey: null,
    dayStartEquity: config.accountSize,
    outcome: 'in_progress',
    failReason: null,
    failedAt: null,
    passedAt: null,
  }
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>()

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dayFormatters.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  })
  dayFormatters.set(timeZone, formatter)
  return formatter
}

/** Trading-day number for a timestamp, using the instrument's IANA timezone. */
export function dayKey(ts: number, dayResetHour: number, timeZone = 'UTC'): number {
  const parts = dayFormatter(timeZone).formatToParts(new Date(ts * 1000))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const localDate = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)))
  if (Number(values.hour) < dayResetHour) localDate.setUTCDate(localDate.getUTCDate() - 1)
  return Math.floor(localDate.getTime() / 86_400_000)
}

export function sessionDate(ts: number, dayResetHour: number, timeZone = 'UTC'): string {
  return new Date(dayKey(ts, dayResetHour, timeZone) * 86_400_000).toISOString().slice(0, 10)
}

/** Equity floor below which the account blows up (total-loss breach). */
export function totalFloor(config: EvalConfig, runtime: EvalRuntime): number {
  if (config.drawdownType === 'static') return runtime.startBalance - config.maxTotalLoss
  const floor = (config.trailingEod ? runtime.eodPeak : runtime.peakEquity) - config.maxTotalLoss
  if (config.trailingLocksAtStart) return Math.min(runtime.startBalance, floor)
  return floor
}

/**
 * Advance the runtime with one equity tick. Returns a NEW runtime object;
 * the input runtime is never mutated. No-op (same reference) once the
 * attempt has ended.
 */
export function tickEval(config: EvalConfig, runtime: EvalRuntime, ts: number, equity: number, timeZone = 'UTC'): EvalRuntime {
  if (runtime.outcome !== 'in_progress') return runtime
  const key = dayKey(ts, config.dayResetHour, timeZone)
  let next = { ...runtime }
  if (next.dayKey !== null && key !== next.dayKey && next.lastEquity > next.eodPeak) next = { ...next, eodPeak: next.lastEquity }
  if (next.dayKey === null || key !== next.dayKey) next = { ...next, dayKey: key, dayStartEquity: equity }
  next = { ...next, lastEquity: equity }
  if (equity > next.peakEquity) next = { ...next, peakEquity: equity }
  const floor = totalFloor(config, next)
  if (equity < floor) return { ...next, outcome: 'failed', failReason: 'total', failedAt: ts }
  if (config.maxDailyLoss > 0 && next.dayStartEquity - equity >= config.maxDailyLoss) return { ...next, outcome: 'failed', failReason: 'daily', failedAt: ts }
  return next
}

export interface EvalStatusInput {
  /** Cash balance (starting + realized), dollars. */
  balance: number
  /** Mark-to-market equity, dollars. */
  equity: number
  /** Closed trades used for days-traded and daily net-profit calculations. */
  trades: { exitTime: number; realizedCents?: number }[]
}

export interface EvalStatus {
  outcome: 'in_progress' | 'passed' | 'failed'
  failReason: 'total' | 'daily' | null
  realizedProfit: number
  liveProfit: number
  targetPct: number
  dailyLoss: number
  dailyRemaining: number
  dailyPct: number
  totalDrawdown: number
  totalRemaining: number
  totalPct: number
  floor: number
  daysTraded: number
  minDaysMet: boolean
  bestDayProfit: number
  consistencyPct: number
  consistencyMet: boolean
  consistencyRemaining: number
}

/** Derived progress/failure snapshot for the panel; re-checks breach and pass conditions on top of the runtime. */
export function evalStatus(config: EvalConfig, runtime: EvalRuntime, state: EvalStatusInput, timeZone = 'UTC'): EvalStatus {
  const realizedProfit = state.balance - runtime.startBalance
  const liveProfit = state.equity - runtime.startBalance
  const daysTraded = new Set(state.trades.map((trade) => dayKey(trade.exitTime, config.dayResetHour, timeZone))).size
  const minDaysMet = daysTraded >= config.minTradingDays
  const dailyProfits = new Map<number, number>()
  for (const trade of state.trades) {
    if (trade.realizedCents === undefined || !Number.isFinite(trade.realizedCents)) continue
    const key = dayKey(trade.exitTime, config.dayResetHour, timeZone)
    dailyProfits.set(key, (dailyProfits.get(key) ?? 0) + trade.realizedCents / 100)
  }
  const bestDayProfit = Math.max(0, ...dailyProfits.values())
  const consistencyPct = realizedProfit > 0 ? bestDayProfit / realizedProfit : 0
  const consistencyLimit = config.consistencyRulePct / 100
  const consistencyMet = consistencyLimit <= 0
    || (realizedProfit > 0 && consistencyPct <= consistencyLimit + Number.EPSILON)
  const consistencyRequiredProfit = consistencyLimit > 0 && bestDayProfit > 0
    ? bestDayProfit / consistencyLimit
    : 0
  const consistencyRemaining = Math.max(0, consistencyRequiredProfit - realizedProfit)
  const dailyLoss = Math.max(0, runtime.dayStartEquity - state.equity)
  const floor = totalFloor(config, runtime)
  const totalDrawdown = Math.max(0, (config.drawdownType === 'static' ? runtime.startBalance : config.trailingEod ? runtime.eodPeak : runtime.peakEquity) - state.equity)
  let outcome = runtime.outcome
  let failReason = runtime.failReason
  if (outcome === 'in_progress') {
    if (state.equity < floor) {
      outcome = 'failed'
      failReason = 'total'
    } else if (config.maxDailyLoss > 0 && dailyLoss >= config.maxDailyLoss) {
      outcome = 'failed'
      failReason = 'daily'
    } else if (config.phase !== 'funded' && realizedProfit >= config.profitTarget && minDaysMet && consistencyMet) {
      outcome = 'passed'
    }
  }
  const clamp = (x: number) => Math.max(0, Math.min(1, x))
  return {
    outcome,
    failReason,
    realizedProfit,
    liveProfit,
    targetPct: config.profitTarget > 0 ? clamp(realizedProfit / config.profitTarget) : 0,
    dailyLoss,
    dailyRemaining: config.maxDailyLoss - dailyLoss,
    dailyPct: config.maxDailyLoss > 0 ? clamp(dailyLoss / config.maxDailyLoss) : 0,
    totalDrawdown,
    totalRemaining: state.equity - floor,
    totalPct: config.maxTotalLoss > 0 ? clamp(totalDrawdown / config.maxTotalLoss) : 0,
    floor,
    daysTraded,
    minDaysMet,
    bestDayProfit,
    consistencyPct,
    consistencyMet,
    consistencyRemaining,
  }
}

export function fundedConfig(config: EvalConfig): EvalConfig {
  return { ...config, phase: 'funded' }
}

export function evalAccountId(config: EvalConfig): string {
  const slug = `${config.phase ?? 'eval'}_${config.firm}_${config.accountSize}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return `eval_${slug}`
}

export function evalAccountName(config: EvalConfig): string {
  return config.phase === 'funded' ? `${config.firm} · Funded` : config.firm
}

/** Stable six-character display hash derived from the canonical account id. */
export function shortEvalAccountHash(accountId: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < accountId.length; index += 1) {
    hash ^= accountId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6)
}

export interface EvalAttempt {
  accountId?: string
  config: EvalConfig
  outcome: 'passed' | 'failed'
  failReason: 'total' | 'daily' | null
  startedAt: number
  endedAt: number
  instrument: string
  startDate?: string
  sessionTimezone?: string
  endingBalance?: number
  endingEquity?: number
  realizedProfit?: number
  peakEquity?: number
  daysTraded?: number
  trades?: EvalTradeRecord[]
}

export interface EvalTradeRecord {
  exitTime: number
  id?: string
  symbol?: string
  side?: 'long' | 'short'
  qty?: number
  entryTime?: number
  entryPriceTicks?: number
  exitPriceTicks?: number
  realizedCents?: number
  feesCents?: number
  mfeTicks?: number
  maeTicks?: number
  rMultiple?: number | null
}

const EVAL_HISTORY_KEY = 'replay:eval:history'

export const evalConfigSchema = z.object({
  firm: z.string().trim().min(1).max(100),
  accountSize: z.number().finite().positive().max(1_000_000_000),
  profitTarget: z.number().finite().positive().max(1_000_000_000),
  maxDailyLoss: z.number().finite().nonnegative().max(1_000_000_000),
  maxTotalLoss: z.number().finite().positive().max(1_000_000_000),
  drawdownType: z.enum(['static', 'trailing']),
  trailingLocksAtStart: z.boolean(),
  trailingEod: z.boolean(),
  minTradingDays: z.number().int().nonnegative().max(365),
  consistencyRulePct: z.number().finite().nonnegative().max(100).default(0),
  dayResetHour: z.number().int().min(0).max(23),
  phase: z.enum(['eval', 'funded']).optional(),
})

const evalAttemptSchema = z.object({
  accountId: z.string().optional(),
  config: evalConfigSchema,
  outcome: z.enum(['passed', 'failed']),
  failReason: z.enum(['total', 'daily']).nullable(),
  startedAt: z.number(),
  endedAt: z.number(),
  instrument: z.string(),
  startDate: z.iso.date().optional(),
  sessionTimezone: z.string().optional(),
  endingBalance: z.number().finite().optional(),
  endingEquity: z.number().finite().optional(),
  realizedProfit: z.number().finite().optional(),
  peakEquity: z.number().finite().optional(),
  daysTraded: z.number().int().nonnegative().optional(),
  trades: z.array(z.object({
    exitTime: z.number().finite().nonnegative(),
    id: z.string().optional(),
    symbol: z.string().optional(),
    side: z.enum(['long', 'short']).optional(),
    qty: z.number().int().positive().optional(),
    entryTime: z.number().finite().nonnegative().optional(),
    entryPriceTicks: z.number().finite().optional(),
    exitPriceTicks: z.number().finite().optional(),
    realizedCents: z.number().finite().optional(),
    feesCents: z.number().finite().optional(),
    mfeTicks: z.number().finite().optional(),
    maeTicks: z.number().finite().optional(),
    rMultiple: z.number().finite().nullable().optional(),
  })).optional(),
})

const evalHistorySchema = z.array(evalAttemptSchema)

export function loadEvalHistory(): EvalAttempt[] {
  try {
    const raw = localStorage.getItem(EVAL_HISTORY_KEY)
    return raw ? evalHistorySchema.parse(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function logEvalAttempt(attempt: EvalAttempt): void {
  const list = [attempt, ...loadEvalHistory()].slice(0, 100)
  try {
    localStorage.setItem(EVAL_HISTORY_KEY, JSON.stringify(list))
  } catch {
    // Storage full or unavailable — history is best-effort.
  }
}
