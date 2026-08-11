// Pure evaluation-simulator rules engine — prop-firm eval/funded rule logic
// extracted from the deployed namireplays.com site. No React, no DOM side
// effects at import time; safe to consume from the Zustand store, the setup
// screen, the progress panel, and vitest alike. All money values are plain
// dollar numbers (no cents conversion at this layer). Timestamps are epoch
// seconds, matching the replay engine.

import { z } from 'zod'

export type DrawdownType = 'static' | 'trailing'
export type EvalProgramPhase = 'eval' | 'challenge' | 'verification' | 'funded'
export type ConsistencyMode = 'net-profit' | 'of-profit-target' | 'positive-days'
export type DailyLossBase = 'day-start-equity' | 'midnight-balance'

export interface PayoutConfig {
  profitSplit: number
  eligibilityMode: 'winning-days' | 'consistency' | 'min-days'
  minWinningDays: number
  minDailyProfit: number
  eligibilityConsistencyPct: number
  minFundedDays: number
  /** Percentage of the current balance; 0 = no percentage cap. */
  maxPayoutPct: number
  /** Dollar cap; 0 = no dollar cap. */
  maxPayoutAmount: number
  minPayoutAmount: number
  /** 0 = unlimited payouts. */
  maxPayouts: number
  safetyNet: 'drawdown-plus' | 'none'
  safetyNetMargin: number
  requireProfitableSinceLastPayout: boolean
}

export interface EvalConfig {
  firm: string
  accountSize: number
  profitTarget: number
  /** Dollars of intraday loss allowed; 0 = no daily loss limit. */
  maxDailyLoss: number
  maxTotalLoss: number
  drawdownType: DrawdownType
  trailingLocksAtStart: boolean
  /** Lock the trailing floor once the configured target-plus-margin threshold is reached. */
  trailingLockAtTarget: boolean
  lockMargin: number
  /** EOD (end-of-day) trailing: the floor trails the last close-of-day peak. */
  trailingEod: boolean
  /** Maximum open position in contracts; 0 = unlimited. */
  maxPositionSize: number
  /** Minimum distinct trading days required to pass; 0 = none. */
  minTradingDays: number
  /** Largest winning day as a percentage of total net profit; 0 = disabled. */
  consistencyRulePct: number
  consistencyMode: ConsistencyMode
  dailyLossBase: DailyLossBase
  /** A non-zero target enables a second verification phase after the challenge. */
  verificationProfitTarget: number
  /** Hour of day when the trading day resets in the instrument session timezone. */
  dayResetHour: number
  phase?: EvalProgramPhase
  payout?: PayoutConfig
}

export const EVAL_PRESETS: EvalConfig[] = [
  {
    firm: 'FTMO 100K (static)', accountSize: 100000, profitTarget: 10000, verificationProfitTarget: 5000,
    maxDailyLoss: 5000, maxTotalLoss: 10000, drawdownType: 'static', trailingLocksAtStart: false,
    trailingLockAtTarget: false, lockMargin: 0, trailingEod: false, maxPositionSize: 0,
    minTradingDays: 4, consistencyRulePct: 0, consistencyMode: 'net-profit', dailyLossBase: 'midnight-balance', dayResetHour: 0,
    payout: {
      profitSplit: 90, eligibilityMode: 'min-days', minWinningDays: 0, minDailyProfit: 0,
      eligibilityConsistencyPct: 0, minFundedDays: 14, maxPayoutPct: 0, maxPayoutAmount: 0,
      minPayoutAmount: 20, maxPayouts: 0, safetyNet: 'none', safetyNetMargin: 0,
      requireProfitableSinceLastPayout: true,
    },
  },
  {
    firm: 'TopStep 50K (EOD trail)', accountSize: 50000, profitTarget: 3000, verificationProfitTarget: 0,
    maxDailyLoss: 1000, maxTotalLoss: 2000, drawdownType: 'trailing', trailingLocksAtStart: true,
    trailingLockAtTarget: false, lockMargin: 0, trailingEod: true, maxPositionSize: 5,
    minTradingDays: 0, consistencyRulePct: 50, consistencyMode: 'of-profit-target', dailyLossBase: 'day-start-equity', dayResetHour: 17,
    payout: {
      profitSplit: 90, eligibilityMode: 'winning-days', minWinningDays: 5, minDailyProfit: 150,
      eligibilityConsistencyPct: 40, minFundedDays: 0, maxPayoutPct: 50, maxPayoutAmount: 5000,
      minPayoutAmount: 0, maxPayouts: 0, safetyNet: 'none', safetyNetMargin: 0,
      requireProfitableSinceLastPayout: true,
    },
  },
  {
    firm: 'Apex 50K (trailing)', accountSize: 50000, profitTarget: 3000, verificationProfitTarget: 0,
    maxDailyLoss: 0, maxTotalLoss: 2500, drawdownType: 'trailing', trailingLocksAtStart: false,
    trailingLockAtTarget: true, lockMargin: 2000, trailingEod: false, maxPositionSize: 6,
    minTradingDays: 0, consistencyRulePct: 50, consistencyMode: 'net-profit', dailyLossBase: 'day-start-equity', dayResetHour: 17,
    payout: {
      profitSplit: 100, eligibilityMode: 'winning-days', minWinningDays: 5, minDailyProfit: 200,
      eligibilityConsistencyPct: 50, minFundedDays: 0, maxPayoutPct: 0, maxPayoutAmount: 0,
      minPayoutAmount: 500, maxPayouts: 6, safetyNet: 'drawdown-plus', safetyNetMargin: 100,
      requireProfitableSinceLastPayout: true,
    },
  },
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
    trailingLockAtTarget: false,
    lockMargin: 0,
    trailingEod: false,
    maxPositionSize: 0,
    minTradingDays: 0,
    consistencyRulePct: 40,
    consistencyMode: 'net-profit',
    dailyLossBase: 'day-start-equity',
    verificationProfitTarget: 0,
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
  dayStartBalance: number
  outcome: 'in_progress' | 'passed' | 'failed'
  failReason: 'total' | 'daily' | null
  failedAt: number | null
  passedAt: number | null
  payoutsTaken: number
  lastPayoutAt: number | null
  profitSinceLastPayout: number
  fundedStartTs: number
  winningDays: number
  bestDaySincePayout: number
  payoutWindowDailyProfits: Record<string, number>
}

export function newRuntime(config: EvalConfig, startTs = 0): EvalRuntime {
  return {
    startBalance: config.accountSize,
    peakEquity: config.accountSize,
    eodPeak: config.accountSize,
    lastEquity: config.accountSize,
    dayKey: null,
    dayStartEquity: config.accountSize,
    dayStartBalance: config.accountSize,
    outcome: 'in_progress',
    failReason: null,
    failedAt: null,
    passedAt: null,
    payoutsTaken: 0,
    lastPayoutAt: null,
    profitSinceLastPayout: 0,
    fundedStartTs: config.phase === 'funded' ? startTs : 0,
    winningDays: 0,
    bestDaySincePayout: 0,
    payoutWindowDailyProfits: {},
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
  if (config.trailingLockAtTarget
    && runtime.peakEquity >= runtime.startBalance + config.profitTarget + config.lockMargin) {
    return runtime.startBalance + config.maxTotalLoss
  }
  if (config.trailingLocksAtStart) return Math.min(runtime.startBalance, floor)
  return floor
}

/**
 * Advance the runtime with one equity tick. Returns a NEW runtime object;
 * the input runtime is never mutated. No-op (same reference) once the
 * attempt has ended.
 */
export function tickEval(
  config: EvalConfig,
  runtime: EvalRuntime,
  ts: number,
  equity: number,
  timeZone = 'UTC',
  balance = equity,
): EvalRuntime {
  if (runtime.outcome !== 'in_progress') return runtime
  const key = dayKey(ts, config.dayResetHour, timeZone)
  let next = { ...runtime }
  if (config.phase === 'funded' && next.fundedStartTs === 0) next = { ...next, fundedStartTs: ts }
  if (next.dayKey !== null && key !== next.dayKey && next.lastEquity > next.eodPeak) next = { ...next, eodPeak: next.lastEquity }
  if (next.dayKey === null || key !== next.dayKey) {
    next = { ...next, dayKey: key, dayStartEquity: equity, dayStartBalance: balance }
  }
  next = { ...next, lastEquity: equity }
  if (equity > next.peakEquity) next = { ...next, peakEquity: equity }
  const floor = totalFloor(config, next)
  if (equity < floor) return { ...next, outcome: 'failed', failReason: 'total', failedAt: ts }
  const dailyBase = config.dailyLossBase === 'midnight-balance' ? next.dayStartBalance : next.dayStartEquity
  if (config.maxDailyLoss > 0 && dailyBase - equity >= config.maxDailyLoss) return { ...next, outcome: 'failed', failReason: 'daily', failedAt: ts }
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
  positiveDaysProfit: number
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
  const positiveDaysProfit = [...dailyProfits.values()].reduce((sum, profit) => sum + Math.max(0, profit), 0)
  const consistencyMode = config.consistencyMode ?? 'net-profit'
  const consistencyBase = consistencyMode === 'of-profit-target'
    ? config.profitTarget
    : consistencyMode === 'positive-days'
      ? positiveDaysProfit
      : realizedProfit
  const consistencyPct = consistencyBase > 0 ? bestDayProfit / consistencyBase : 0
  const consistencyLimit = config.consistencyRulePct / 100
  const consistencyMet = consistencyLimit <= 0
    || (consistencyBase > 0 && consistencyPct <= consistencyLimit + Number.EPSILON)
  const consistencyRequiredBase = consistencyLimit > 0 && bestDayProfit > 0 ? bestDayProfit / consistencyLimit : 0
  const consistencyRemaining = consistencyMode === 'of-profit-target'
    ? Math.max(0, bestDayProfit - config.profitTarget * consistencyLimit)
    : Math.max(0, consistencyRequiredBase - consistencyBase)
  const dailyBase = config.dailyLossBase === 'midnight-balance' ? runtime.dayStartBalance : runtime.dayStartEquity
  const dailyLoss = Math.max(0, dailyBase - state.equity)
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
    positiveDaysProfit,
    consistencyPct,
    consistencyMet,
    consistencyRemaining,
  }
}

/** Rebuild the funded payout window from immutable closed-trade records. */
export function syncPayoutRuntime(
  config: EvalConfig,
  runtime: EvalRuntime,
  trades: EvalStatusInput['trades'],
  timeZone = 'UTC',
): EvalRuntime {
  if (config.phase !== 'funded') return runtime
  const dailyProfits = new Map<number, number>()
  let profitSinceLastPayout = 0
  for (const trade of trades) {
    if (trade.realizedCents === undefined || !Number.isFinite(trade.realizedCents)) continue
    if (runtime.lastPayoutAt !== null && trade.exitTime <= runtime.lastPayoutAt) continue
    const profit = trade.realizedCents / 100
    profitSinceLastPayout += profit
    const key = dayKey(trade.exitTime, config.dayResetHour, timeZone)
    dailyProfits.set(key, (dailyProfits.get(key) ?? 0) + profit)
  }
  const minDailyProfit = config.payout?.minDailyProfit ?? 0
  const profits = [...dailyProfits.values()]
  return {
    ...runtime,
    profitSinceLastPayout,
    winningDays: profits.filter((profit) => profit >= minDailyProfit).length,
    bestDaySincePayout: Math.max(0, ...profits),
    payoutWindowDailyProfits: Object.fromEntries([...dailyProfits].map(([key, profit]) => [String(key), profit])),
  }
}

export interface PayoutEligibility {
  eligible: boolean
  reason: string
  maxPayout: number
  traderShare: number
  nextEligibleAmount: number
  fundedDays: number
  winningDays: number
  consistencyPct: number
  safetyNetBalance: number
}

function roundedMoney(value: number): number {
  return Math.floor(Math.max(0, value) * 100 + Number.EPSILON) / 100
}

/** Pure payout decision for a funded account at its current status snapshot. */
export function payoutEligibility(
  config: EvalConfig,
  runtime: EvalRuntime,
  status: EvalStatus,
  timeZone = 'UTC',
): PayoutEligibility {
  const payout = config.payout
  const currentBalance = runtime.startBalance + status.realizedProfit
  const safetyNetBalance = payout?.safetyNet === 'drawdown-plus'
    ? runtime.startBalance + config.maxTotalLoss + payout.safetyNetMargin
    : runtime.startBalance
  const fundedStartKey = runtime.fundedStartTs > 0
    ? dayKey(runtime.fundedStartTs, config.dayResetHour, timeZone)
    : runtime.dayKey
  const fundedDays = runtime.dayKey !== null && fundedStartKey !== null
    ? Math.max(0, runtime.dayKey - fundedStartKey + 1)
    : 0
  const windowProfit = runtime.profitSinceLastPayout
  const consistencyPct = windowProfit > 0 ? runtime.bestDaySincePayout / windowProfit : 0

  if (!payout || config.phase !== 'funded') {
    return { eligible: false, reason: 'Payouts are available only on a configured funded account.', maxPayout: 0, traderShare: 0, nextEligibleAmount: 0, fundedDays, winningDays: runtime.winningDays, consistencyPct, safetyNetBalance }
  }

  const profitAvailable = Math.max(0, Math.min(status.realizedProfit, windowProfit))
  const safetyAvailable = payout.safetyNet === 'drawdown-plus'
    ? Math.max(0, currentBalance - safetyNetBalance)
    : profitAvailable
  const capByPct = payout.maxPayoutPct > 0 ? currentBalance * payout.maxPayoutPct / 100 : Number.POSITIVE_INFINITY
  const capByAmount = payout.maxPayoutAmount > 0 ? payout.maxPayoutAmount : Number.POSITIVE_INFINITY
  const maxPayout = roundedMoney(Math.min(profitAvailable, safetyAvailable, capByPct, capByAmount))
  const nextEligibleAmount = roundedMoney(Math.max(0, payout.minPayoutAmount - maxPayout))
  const consistencyLimit = payout.eligibilityConsistencyPct / 100
  const consistencyMet = consistencyLimit <= 0
    || (windowProfit > 0 && consistencyPct <= consistencyLimit + Number.EPSILON)

  let reason = 'Eligible for payout.'
  if (payout.maxPayouts > 0 && runtime.payoutsTaken >= payout.maxPayouts) {
    reason = `Maximum of ${payout.maxPayouts} payouts reached.`
  } else if (payout.requireProfitableSinceLastPayout && windowProfit <= 0) {
    reason = 'No profit has been earned since the previous payout.'
  } else if (payout.eligibilityMode === 'winning-days' && runtime.winningDays < payout.minWinningDays) {
    reason = `${payout.minWinningDays - runtime.winningDays} more qualifying winning day${payout.minWinningDays - runtime.winningDays === 1 ? '' : 's'} required.`
  } else if (payout.eligibilityMode === 'min-days' && fundedDays < payout.minFundedDays) {
    reason = `${payout.minFundedDays - fundedDays} more funded day${payout.minFundedDays - fundedDays === 1 ? '' : 's'} required.`
  } else if ((payout.eligibilityMode === 'consistency' || payout.eligibilityConsistencyPct > 0) && !consistencyMet) {
    reason = `Best day exceeds the ${payout.eligibilityConsistencyPct}% payout consistency limit.`
  } else if (payout.safetyNet === 'drawdown-plus' && currentBalance <= safetyNetBalance) {
    reason = `Balance must exceed the ${roundedMoney(safetyNetBalance).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} safety net.`
  } else if (maxPayout < payout.minPayoutAmount) {
    reason = `${roundedMoney(payout.minPayoutAmount - maxPayout).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} more withdrawable profit required.`
  } else if (maxPayout <= 0) {
    reason = 'No withdrawable profit is available.'
  }

  const eligible = reason === 'Eligible for payout.'
  return {
    eligible,
    reason,
    maxPayout,
    traderShare: roundedMoney(maxPayout * payout.profitSplit / 100),
    nextEligibleAmount,
    fundedDays,
    winningDays: runtime.winningDays,
    consistencyPct,
    safetyNetBalance,
  }
}

export function fundedConfig(config: EvalConfig): EvalConfig {
  return { ...config, phase: 'funded' }
}

export function verificationConfig(config: EvalConfig): EvalConfig {
  if (config.verificationProfitTarget <= 0) throw new Error('This evaluation does not have a verification phase')
  return { ...config, phase: 'verification', profitTarget: config.verificationProfitTarget }
}

export function evalAccountId(config: EvalConfig): string {
  const slug = `${config.phase ?? 'eval'}_${config.firm}_${config.accountSize}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return `eval_${slug}`
}

export function evalAccountName(config: EvalConfig): string {
  if (config.phase === 'funded') return `${config.firm} · Funded`
  if (config.phase === 'verification') return `${config.firm} · Verification`
  return config.firm
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

export interface PayoutRecord {
  id: string
  accountId?: string
  firm: string
  requestedAt: number
  grossAmount: number
  traderAmount: number
  profitSplit: number
  balanceAfter: number
  payoutNumber: number
}

const EVAL_HISTORY_KEY = 'replay:eval:history'
const PAYOUT_HISTORY_KEY = 'replay:eval:payouts'

export const payoutConfigSchema = z.object({
  profitSplit: z.number().finite().min(0).max(100).default(100),
  eligibilityMode: z.enum(['winning-days', 'consistency', 'min-days']).default('min-days'),
  minWinningDays: z.number().int().nonnegative().max(365).default(0),
  minDailyProfit: z.number().finite().nonnegative().max(1_000_000_000).default(0),
  eligibilityConsistencyPct: z.number().finite().nonnegative().max(100).default(0),
  minFundedDays: z.number().int().nonnegative().max(3650).default(0),
  maxPayoutPct: z.number().finite().nonnegative().max(100).default(0),
  maxPayoutAmount: z.number().finite().nonnegative().max(1_000_000_000).default(0),
  minPayoutAmount: z.number().finite().nonnegative().max(1_000_000_000).default(0),
  maxPayouts: z.number().int().nonnegative().max(10_000).default(0),
  safetyNet: z.enum(['drawdown-plus', 'none']).default('none'),
  safetyNetMargin: z.number().finite().nonnegative().max(1_000_000_000).default(0),
  requireProfitableSinceLastPayout: z.boolean().default(false),
})

export const evalConfigSchema = z.object({
  firm: z.string().trim().min(1).max(100),
  accountSize: z.number().finite().positive().max(1_000_000_000),
  profitTarget: z.number().finite().positive().max(1_000_000_000),
  maxDailyLoss: z.number().finite().nonnegative().max(1_000_000_000),
  maxTotalLoss: z.number().finite().positive().max(1_000_000_000),
  drawdownType: z.enum(['static', 'trailing']),
  trailingLocksAtStart: z.boolean(),
  trailingLockAtTarget: z.boolean().default(false),
  lockMargin: z.number().finite().nonnegative().max(1_000_000_000).default(0),
  trailingEod: z.boolean(),
  maxPositionSize: z.number().int().nonnegative().max(10_000).default(0),
  minTradingDays: z.number().int().nonnegative().max(365),
  consistencyRulePct: z.number().finite().nonnegative().max(100).default(0),
  consistencyMode: z.enum(['net-profit', 'of-profit-target', 'positive-days']).default('net-profit'),
  dailyLossBase: z.enum(['day-start-equity', 'midnight-balance']).default('day-start-equity'),
  verificationProfitTarget: z.number().finite().nonnegative().max(1_000_000_000).default(0),
  dayResetHour: z.number().int().min(0).max(23),
  phase: z.enum(['eval', 'challenge', 'verification', 'funded']).optional(),
  payout: payoutConfigSchema.optional(),
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
const payoutRecordSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().optional(),
  firm: z.string().min(1),
  requestedAt: z.number().finite().nonnegative(),
  grossAmount: z.number().finite().positive(),
  traderAmount: z.number().finite().nonnegative(),
  profitSplit: z.number().finite().min(0).max(100),
  balanceAfter: z.number().finite(),
  payoutNumber: z.number().int().positive(),
})
const payoutHistorySchema = z.array(payoutRecordSchema)

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

export function loadPayoutHistory(): PayoutRecord[] {
  try {
    const raw = localStorage.getItem(PAYOUT_HISTORY_KEY)
    return raw ? payoutHistorySchema.parse(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function logPayout(payout: PayoutRecord): void {
  const list = [payout, ...loadPayoutHistory()].slice(0, 200)
  try {
    localStorage.setItem(PAYOUT_HISTORY_KEY, JSON.stringify(list))
  } catch {
    // Storage full or unavailable — payout history is best-effort.
  }
}
