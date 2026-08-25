// Evaluation-session state for the eval simulator. The fill engine starts
// from a hardcoded $10k bankroll while the eval account size comes from the
// user's config (e.g. $100k), so this store keeps its own baselines,
// captured on the first tick after (re)start, and derives eval equity and
// balance purely from fill-engine deltas. The replay engine only consumes
// the session boundary and requests a rebase when it replaces its fill state.
// Framework-agnostic (same split as ui-store + use-replay): the
// React glue — reactive subscription and the engine ticker — lives in
// replay/use-eval-session.ts.
import { create } from 'zustand'
import { z } from 'zod'
import { preferenceStorage, type PreferenceStorage } from './preference-sync'
import { evalConfigSchema, evalStatus, fundedConfig, logEvalAttempt, logPayout, newRuntime, payoutEligibility, sessionDate, syncPayoutRuntime, tickEval, verificationConfig } from '../eval/rules'
import type { EvalConfig, EvalRuntime, EvalStatus, EvalTradeRecord, PayoutRecord } from '../eval/rules'
import type { FillEngineState } from '../fill-engine/types'
import { SOURCE_NAME_MAX_LENGTH, normalizedSourceName } from '../sources/source-name'

export type EvalFillState = Pick<FillEngineState, 'realizedCents' | 'equityCents' | 'trades'>

export type EvalPhase = 'idle' | 'ready' | 'paused' | 'running' | 'passed' | 'failed'
type StoredEvalPhase = Exclude<EvalPhase, 'idle'>

export const EVAL_SESSION_STORAGE_KEY = 'replay:eval'
export const EVAL_ACCOUNTS_STORAGE_KEY = 'replay:eval:accounts'
const EVAL_SESSION_VERSION = 2
const PERSIST_INTERVAL_MS = 1000

function persistedEvalName(value: string | null | undefined): string | null {
  const name = normalizedSourceName(value)
  if (/^Eval - (?:In Progress|Failed|Passed)$/.test(name)) return null
  return name || null
}

export interface EvalSessionState {
  phase: EvalPhase
  accountId: string | null
  name: string | null
  /**
   * Backend session this eval account persists its trades into. Durable
   * (saved with the account) so resuming an account reuses its session
   * instead of minting a second one that would receive a duplicate journal.
   */
  sessionId: string | null
  config: EvalConfig | null // null when idle
  runtime: EvalRuntime | null // null when idle
  /** Legacy display value for accounts created before evaluations became market-wide. */
  instrument: string | null
  sessionTimezone: string | null
  startDate: string | null // 'YYYY-MM-DD'
  startTs: number | null // epoch seconds the eval begins at (forward-only anchor)
  attemptStartedAt: number | null
  lastCursorTs: number | null
  baselineRealizedCents: number | null
  baselineEquityCents: number | null
  lastEvalBalance: number | null
  lastEvalEquity: number | null
  needsFillRebase: boolean
  lastTradeIds: Set<string> // trade ids already absorbed into the eval
  trades: EvalTradeRecord[] // eval-accumulated closed trades
  payoutHistory: PayoutRecord[]

  createEvaluation(config: EvalConfig, instrument: string | null, startDate: string, startTs: number, sessionTimezone?: string): void
  startEvaluation(config: EvalConfig, instrument: string | null, startDate: string, startTs: number, sessionTimezone?: string): void
  activateEvaluation(): void
  /** Feed one replay-engine snapshot. No-op outside the running phase. */
  tick(snapshot: { cursorTs: number; fill: EvalFillState | null }): void
  prepareFillRebase(): void
  restoreAccount(accountId: string): void
  /** Records the backend session the replay engine created for this account. */
  attachSession(sessionId: string): void
  exitEvaluation(): void // checkpoint as paused, then clear the current session
  retry(): void // same config, fresh ready account — for breach retry
  goVerification(): void // passed challenge → fresh verification account
  goFunded(): void // pass → fresh funded account waiting in the ready phase
  requestPayout(amount?: number): PayoutRequestResult
  abandon(): void // abandon the current eval → idle, clear everything
}

export interface PayoutRequestResult {
  success: boolean
  reason: string
  payout: PayoutRecord | null
}

type EvalSessionData = Omit<EvalSessionState, 'createEvaluation' | 'startEvaluation' | 'activateEvaluation' | 'tick' | 'prepareFillRebase' | 'restoreAccount' | 'attachSession' | 'exitEvaluation' | 'retry' | 'goVerification' | 'goFunded' | 'requestPayout' | 'abandon'>

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

const persistedRuntimeSchema = z.object({
  startBalance: z.number(),
  peakEquity: z.number(),
  eodPeak: z.number(),
  lastEquity: z.number(),
  dayKey: z.number().nullable(),
  dayStartEquity: z.number(),
  dayStartBalance: z.number().optional(),
  outcome: z.enum(['in_progress', 'passed', 'failed']),
  failReason: z.enum(['total', 'daily']).nullable(),
  failedAt: z.number().nullable(),
  passedAt: z.number().nullable(),
  payoutsTaken: z.number().int().nonnegative().optional(),
  lastPayoutAt: z.number().finite().nonnegative().nullable().optional(),
  profitSinceLastPayout: z.number().finite().optional(),
  fundedStartTs: z.number().finite().nonnegative().optional(),
  winningDays: z.number().int().nonnegative().optional(),
  bestDaySincePayout: z.number().finite().nonnegative().optional(),
  payoutWindowDailyProfits: z.record(z.string(), z.number().finite()).optional(),
}).transform((runtime): EvalRuntime => ({
  ...runtime,
  dayStartBalance: runtime.dayStartBalance ?? runtime.startBalance,
  payoutsTaken: runtime.payoutsTaken ?? 0,
  lastPayoutAt: runtime.lastPayoutAt ?? null,
  profitSinceLastPayout: runtime.profitSinceLastPayout ?? 0,
  fundedStartTs: runtime.fundedStartTs ?? 0,
  winningDays: runtime.winningDays ?? 0,
  bestDaySincePayout: runtime.bestDaySincePayout ?? 0,
  payoutWindowDailyProfits: runtime.payoutWindowDailyProfits ?? {},
}))

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

const persistedSessionSchema = z.object({
  version: z.literal(EVAL_SESSION_VERSION),
  phase: z.enum(['ready', 'paused', 'running', 'passed', 'failed']).optional(),
  accountId: z.string().min(1).optional(),
  name: z.string().trim().max(SOURCE_NAME_MAX_LENGTH).nullable().optional().transform(persistedEvalName),
  sessionId: z.string().min(1).nullish(),
  config: evalConfigSchema,
  instrument: z.string().trim().min(1).nullable().optional().transform((instrument) => instrument ?? null),
  sessionTimezone: z.string().trim().min(1).refine(isValidTimezone),
  startDate: z.iso.date(),
  startTs: z.number().finite().nonnegative(),
  attemptStartedAt: z.number().finite().nonnegative(),
  lastCursorTs: z.number().finite().nonnegative(),
  runtime: persistedRuntimeSchema,
  baselineRealizedCents: z.number().finite().nullable(),
  baselineEquityCents: z.number().finite().nullable(),
  lastEvalBalance: z.number().finite(),
  lastEvalEquity: z.number().finite(),
  lastTradeIds: z.array(z.string()),
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
    initialStopTicks: z.number().finite().nullable().optional(),
    initialTakeProfitTicks: z.number().finite().nullable().optional(),
    protectionAdjustments: z.array(z.object({
      role: z.enum(['stopLoss', 'takeProfit']), ts: z.number().finite().nonnegative(), priceTicks: z.number().finite(),
    })).optional(),
    exitReason: z.enum(['manual', 'stopLoss', 'takeProfit']).optional(),
  })),
  payoutHistory: z.array(payoutRecordSchema).default([]),
})

const persistedAccountsSchema = z.array(persistedSessionSchema).max(50)
type PersistedEvalAccount = z.infer<typeof persistedSessionSchema>

export interface SavedEvalAccount extends Omit<PersistedEvalAccount, 'accountId' | 'phase'> {
  accountId: string
  phase: StoredEvalPhase
}

export interface EvalFinancials {
  balance: number
  equity: number
  status: EvalStatus
}

type EvalFinancialSession = Pick<EvalSessionState,
  | 'config'
  | 'runtime'
  | 'phase'
  | 'baselineRealizedCents'
  | 'baselineEquityCents'
  | 'needsFillRebase'
  | 'lastEvalBalance'
  | 'lastEvalEquity'
  | 'trades'
  | 'sessionTimezone'
>

function idleSession(): EvalSessionData {
  return {
    phase: 'idle',
    accountId: null,
    name: null,
    sessionId: null,
    config: null,
    runtime: null,
    instrument: null,
    sessionTimezone: null,
    startDate: null,
    startTs: null,
    attemptStartedAt: null,
    lastCursorTs: null,
    baselineRealizedCents: null,
    baselineEquityCents: null,
    lastEvalBalance: null,
    lastEvalEquity: null,
    needsFillRebase: false,
    lastTradeIds: new Set<string>(),
    trades: [],
    payoutHistory: [],
  }
}

function getBrowserStorage(): PreferenceStorage | null {
  return typeof window === 'undefined' ? null : preferenceStorage
}

function normalizedAccountId(account: PersistedEvalAccount): string {
  return account.accountId ?? `eval-${account.instrument ?? 'all'}-${account.attemptStartedAt}`
}

function normalizedAccountPhase(account: PersistedEvalAccount): StoredEvalPhase {
  if (account.runtime.outcome === 'passed') return 'passed'
  if (account.runtime.outcome === 'failed') return 'failed'
  return account.phase ?? 'paused'
}

function createAccountId(instrument: string | null, startTs: number): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `eval-${instrument ?? 'all'}-${startTs}-${suffix}`
}

export function loadEvalAccounts(): SavedEvalAccount[] {
  const storage = getBrowserStorage()
  if (!storage) return []
  try {
    const raw = storage.getItem(EVAL_ACCOUNTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = persistedAccountsSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return []
    return parsed.data
      .map((account) => ({ ...account, accountId: normalizedAccountId(account), phase: normalizedAccountPhase(account) }))
      .toSorted((first, second) => second.lastCursorTs - first.lastCursorTs)
  } catch {
    return []
  }
}

function saveEvalAccount(account: PersistedEvalAccount): void {
  const storage = getBrowserStorage()
  if (!storage) return
  const accountId = normalizedAccountId(account)
  const existing = loadEvalAccounts().filter((item) => item.accountId !== accountId)
  storage.setItem(EVAL_ACCOUNTS_STORAGE_KEY, JSON.stringify([{ ...account, accountId }, ...existing].slice(0, 50)))
}

/**
 * Permanently removes a saved evaluation account from the account registry.
 * Unlike `abandon()` (which only clears the in-memory session but keeps the
 * account recoverable), this deletes the account record itself. If the
 * deleted account is the currently restored session, the session is cleared
 * too. Returns the id that was removed, or null when nothing matched.
 */
export function deleteEvalAccount(accountId: string): string | null {
  const storage = getBrowserStorage()
  if (!storage) return null
  const remaining = loadEvalAccounts().filter((item) => item.accountId !== accountId)
  if (remaining.length === loadEvalAccounts().length) return null
  try {
    storage.setItem(EVAL_ACCOUNTS_STORAGE_KEY, JSON.stringify(remaining))
  } catch {
    return null
  }
  if (getEvalState().accountId === accountId) getEvalState().abandon()
  return accountId
}

export function renameEvalAccount(accountId: string, name: string): SavedEvalAccount | null {
  const storage = getBrowserStorage()
  if (!storage) return null
  const normalized = normalizedSourceName(name) || null
  const accounts = loadEvalAccounts()
  const account = accounts.find((item) => item.accountId === accountId)
  if (!account) return null
  const renamed: SavedEvalAccount = { ...account, name: normalized }
  try {
    storage.setItem(EVAL_ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts.map((item) => item.accountId === accountId ? renamed : item)))
  } catch {
    return null
  }
  if (getEvalState().accountId === accountId) {
    useEvalStore.setState({ name: normalized })
    persistImmediately(getEvalState())
  }
  return renamed
}

function loadPersistedSession(): z.infer<typeof persistedSessionSchema> | null {
  const storage = getBrowserStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(EVAL_SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = persistedSessionSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) storage.removeItem(EVAL_SESSION_STORAGE_KEY)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function hydratedSession(): EvalSessionData | null {
  const persisted = loadPersistedSession()
  if (!persisted) return null
  const phase: StoredEvalPhase = persisted.runtime.outcome === 'passed'
    ? 'passed'
    : persisted.runtime.outcome === 'failed'
      ? 'failed'
      : persisted.phase === 'ready'
        ? 'ready'
        : 'paused'
  return {
    phase,
    accountId: normalizedAccountId(persisted),
    name: persisted.name ?? null,
    sessionId: persisted.sessionId ?? null,
    config: persisted.config,
    runtime: persisted.runtime,
    instrument: persisted.instrument,
    sessionTimezone: persisted.sessionTimezone,
    startDate: persisted.startDate,
    startTs: persisted.startTs,
    attemptStartedAt: persisted.attemptStartedAt,
    lastCursorTs: persisted.lastCursorTs,
    baselineRealizedCents: persisted.baselineRealizedCents,
    baselineEquityCents: persisted.baselineEquityCents,
    lastEvalBalance: persisted.lastEvalBalance,
    lastEvalEquity: persisted.lastEvalEquity,
    needsFillRebase: false,
    lastTradeIds: new Set(persisted.lastTradeIds),
    trades: persisted.trades,
    payoutHistory: persisted.payoutHistory,
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
let pendingPersistState: EvalSessionState | null = null
let lastPersistedAt = 0

function persistedPayload(state: EvalSessionState): PersistedEvalAccount | null {
  if (state.phase === 'idle' || !state.accountId || !state.config || !state.runtime || !state.sessionTimezone || !state.startDate || state.startTs === null || state.attemptStartedAt === null || state.lastCursorTs === null) return null
  return {
    version: EVAL_SESSION_VERSION,
    phase: state.phase,
    accountId: state.accountId,
    name: state.name,
    sessionId: state.sessionId,
    config: state.config,
    instrument: state.instrument,
    sessionTimezone: state.sessionTimezone,
    startDate: state.startDate,
    startTs: state.startTs,
    attemptStartedAt: state.attemptStartedAt,
    lastCursorTs: state.lastCursorTs,
    runtime: state.runtime,
    baselineRealizedCents: state.baselineRealizedCents,
    baselineEquityCents: state.baselineEquityCents,
    lastEvalBalance: state.lastEvalBalance ?? state.config.accountSize,
    lastEvalEquity: state.lastEvalEquity ?? state.runtime.lastEquity,
    lastTradeIds: [...state.lastTradeIds],
    trades: state.trades,
    payoutHistory: state.payoutHistory,
  }
}

function persistSession(state: EvalSessionState): void {
  const payload = persistedPayload(state)
  if (!payload) return
  const storage = getBrowserStorage()
  if (!storage) return
  try {
    storage.setItem(EVAL_SESSION_STORAGE_KEY, JSON.stringify(payload))
    saveEvalAccount(payload)
    lastPersistedAt = Date.now()
  } catch {
    // Storage may be unavailable or full. The live evaluation remains authoritative.
  }
}

function cancelScheduledPersistence(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  pendingPersistState = null
}

function persistImmediately(state: EvalSessionState): void {
  cancelScheduledPersistence()
  persistSession(state)
}

function schedulePersistence(state: EvalSessionState): void {
  pendingPersistState = state
  if (persistTimer) return
  const remaining = Math.max(0, PERSIST_INTERVAL_MS - (Date.now() - lastPersistedAt))
  if (remaining === 0) {
    const pending = pendingPersistState
    pendingPersistState = null
    if (pending) persistSession(pending)
    return
  }
  persistTimer = setTimeout(() => {
    persistTimer = null
    const pending = pendingPersistState
    pendingPersistState = null
    if (pending) persistSession(pending)
  }, remaining)
}

export function flushEvalSessionPersistence(): void {
  if (!pendingPersistState) return
  const pending = pendingPersistState
  cancelScheduledPersistence()
  persistSession(pending)
}

export function deriveEvalFinancials(session: EvalFinancialSession, fill: EvalFillState | null): EvalFinancials | null {
  const { config, runtime } = session
  if (!config || !runtime) return null
  const baselinesReady = session.phase === 'running'
    && fill !== null
    && session.baselineRealizedCents !== null
    && session.baselineEquityCents !== null
    && !session.needsFillRebase
  const balance = baselinesReady
    ? config.accountSize + (fill.realizedCents - session.baselineRealizedCents!) / 100
    : (session.lastEvalBalance ?? config.accountSize)
  const equity = baselinesReady
    ? config.accountSize + (fill.equityCents - session.baselineEquityCents!) / 100
    : (session.lastEvalEquity ?? runtime.lastEquity)
  return {
    balance,
    equity,
    status: evalStatus(config, runtime, { balance, equity, trades: session.trades }, session.sessionTimezone ?? 'UTC'),
  }
}

export const useEvalStore = create<EvalSessionState>((set, get) => ({
  ...(hydratedSession() ?? idleSession()),

  createEvaluation: (config, instrument, startDate, startTs, sessionTimezone = 'UTC') => {
    const parsed = evalConfigSchema.safeParse(config)
    if (!parsed.success) throw new Error(`Invalid evaluation configuration: ${parsed.error.issues[0]?.message ?? 'unknown error'}`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(startTs) || startTs < 0) throw new Error('Evaluation date and start time are required')
    if (!isValidTimezone(sessionTimezone)) throw new Error(`Invalid evaluation timezone: ${sessionTimezone}`)
    set({
      phase: 'ready',
      accountId: createAccountId(instrument, startTs),
      name: null,
      sessionId: null,
      config: parsed.data,
      runtime: newRuntime(parsed.data, startTs),
      instrument,
      sessionTimezone,
      startDate,
      startTs,
      attemptStartedAt: startTs,
      lastCursorTs: startTs,
      baselineRealizedCents: null,
      baselineEquityCents: null,
      lastEvalBalance: parsed.data.accountSize,
      lastEvalEquity: parsed.data.accountSize,
      needsFillRebase: false,
      lastTradeIds: new Set<string>(),
      trades: [],
      payoutHistory: [],
    })
    persistImmediately(get())
  },

  startEvaluation: (config, instrument, startDate, startTs, sessionTimezone = 'UTC') => {
    const parsed = evalConfigSchema.safeParse(config)
    if (!parsed.success) throw new Error(`Invalid evaluation configuration: ${parsed.error.issues[0]?.message ?? 'unknown error'}`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(startTs) || startTs < 0) throw new Error('Evaluation date and start time are required')
    if (!isValidTimezone(sessionTimezone)) throw new Error(`Invalid evaluation timezone: ${sessionTimezone}`)
    set({
      phase: 'running',
      accountId: createAccountId(instrument, startTs),
      name: null,
      sessionId: null,
      config: parsed.data,
      runtime: newRuntime(parsed.data, startTs),
      instrument,
      sessionTimezone,
      startDate,
      startTs,
      attemptStartedAt: startTs,
      lastCursorTs: startTs,
      baselineRealizedCents: null,
      baselineEquityCents: null,
      lastEvalBalance: parsed.data.accountSize,
      lastEvalEquity: parsed.data.accountSize,
      needsFillRebase: false,
      lastTradeIds: new Set<string>(),
      trades: [],
      payoutHistory: [],
    })
    persistImmediately(get())
  },

  activateEvaluation: () => {
    const state = get()
    if (state.phase !== 'ready' && state.phase !== 'paused') return
    set({ phase: 'running', needsFillRebase: state.phase === 'paused' })
    persistImmediately(get())
  },

  tick: ({ cursorTs, fill }) => {
    const state = get()
    const { config, runtime } = state
    if (state.phase !== 'running' || !config || !runtime || !fill || cursorTs < (state.startTs ?? 0)) return

    let baselineRealizedCents = state.baselineRealizedCents
    let baselineEquityCents = state.baselineEquityCents
    let lastTradeIds = state.lastTradeIds
    let trades = state.trades
    let needsFillRebase = state.needsFillRebase
    if (needsFillRebase) {
      baselineRealizedCents = fill.realizedCents - ((state.lastEvalBalance ?? config.accountSize) - config.accountSize) * 100
      baselineEquityCents = fill.equityCents - ((state.lastEvalEquity ?? runtime.lastEquity) - config.accountSize) * 100
      lastTradeIds = new Set([...lastTradeIds, ...fill.trades.map((trade) => `${trade.symbol}:${trade.id}`)])
      needsFillRebase = false
    } else if (baselineRealizedCents === null || baselineEquityCents === null) {
      // First tick since (re)start: anchor the baselines on the fill
      // engine's current accounting and absorb the ids of trades that
      // already closed (e.g. after a resumed session) without re-adding
      // them to the eval trade list.
      baselineRealizedCents = fill.realizedCents
      baselineEquityCents = fill.equityCents
      lastTradeIds = new Set(fill.trades.map((trade) => `${trade.symbol}:${trade.id}`))
    } else {
      const unseen = fill.trades.filter((trade) => {
        const compositeId = `${trade.symbol}:${trade.id}`
        const legacyMatch = state.instrument === trade.symbol && lastTradeIds.has(trade.id)
        return !lastTradeIds.has(compositeId) && !legacyMatch
      })
      if (unseen.length > 0) {
        lastTradeIds = new Set(lastTradeIds)
        for (const trade of unseen) lastTradeIds.add(`${trade.symbol}:${trade.id}`)
        trades = [...trades, ...unseen.map((trade) => ({
          id: trade.id,
          symbol: trade.symbol,
          side: trade.side,
          qty: trade.qty,
          entryTime: trade.entryTs,
          entryPriceTicks: trade.entryPriceTicks,
          exitTime: trade.exitTs,
          exitPriceTicks: trade.exitPriceTicks,
          realizedCents: trade.realizedCents,
          feesCents: trade.feesCents,
          mfeTicks: trade.mfeTicks,
          maeTicks: trade.maeTicks,
          rMultiple: trade.rMultiple,
          initialStopTicks: trade.initialStopTicks,
          initialTakeProfitTicks: trade.initialTakeProfitTicks,
          protectionAdjustments: trade.protectionAdjustments,
          exitReason: trade.exitReason,
        }))]
      }
    }

    const evalBalance = config.accountSize + (fill.realizedCents - baselineRealizedCents) / 100
    const evalEquity = config.accountSize + (fill.equityCents - baselineEquityCents) / 100

    const timeZone = state.sessionTimezone ?? 'UTC'
    let next = tickEval(config, runtime, cursorTs, evalEquity, timeZone, evalBalance)
    next = syncPayoutRuntime(config, next, trades, timeZone)
    let phase: EvalPhase = 'running'
    let status = evalStatus(config, next, { balance: evalBalance, equity: evalEquity, trades }, timeZone)
    if (next.outcome === 'failed') {
      phase = 'failed'
    } else if (next.outcome === 'in_progress') {
      // tickEval only detects breaches; passing uses the evalStatus rule
      // (realized target met with the minimum trading days, eval phase).
      if (status.outcome === 'passed') {
        next = { ...next, outcome: 'passed', passedAt: cursorTs }
        phase = 'passed'
        status = { ...status, outcome: 'passed' }
      }
    }

    if (phase !== 'running') {
      logEvalAttempt({
        accountId: state.accountId ?? undefined,
        config,
        outcome: phase,
        failReason: next.failReason,
        startedAt: state.attemptStartedAt ?? cursorTs,
        endedAt: cursorTs,
        instrument: 'ALL',
        startDate: state.startDate ?? undefined,
        sessionTimezone: state.sessionTimezone ?? undefined,
        endingBalance: evalBalance,
        endingEquity: evalEquity,
        realizedProfit: status.realizedProfit,
        peakEquity: next.peakEquity,
        daysTraded: status.daysTraded,
        trades,
      })
    }

    set({ phase, runtime: next, baselineRealizedCents, baselineEquityCents, lastEvalBalance: evalBalance, lastEvalEquity: evalEquity, needsFillRebase, lastCursorTs: cursorTs, lastTradeIds, trades })
    if (phase === 'running') schedulePersistence(get())
    else persistImmediately(get())
  },

  prepareFillRebase: () => {
    if (get().phase === 'running') set({ needsFillRebase: true })
  },

  restoreAccount: (accountId) => {
    const account = loadEvalAccounts().find((item) => item.accountId === accountId)
    if (!account || account.runtime.outcome !== 'in_progress') return
    const phase: EvalPhase = account.phase === 'ready' ? 'ready' : 'paused'
    set({
      phase,
      accountId: account.accountId,
      name: account.name ?? null,
      sessionId: account.sessionId ?? null,
      config: account.config,
      runtime: account.runtime,
      instrument: account.instrument,
      sessionTimezone: account.sessionTimezone,
      startDate: account.startDate,
      startTs: account.startTs,
      attemptStartedAt: account.attemptStartedAt,
      lastCursorTs: account.lastCursorTs,
      baselineRealizedCents: account.baselineRealizedCents,
      baselineEquityCents: account.baselineEquityCents,
      lastEvalBalance: account.lastEvalBalance,
      lastEvalEquity: account.lastEvalEquity,
      needsFillRebase: false,
      lastTradeIds: new Set(account.lastTradeIds),
      trades: account.trades,
      payoutHistory: account.payoutHistory,
    })
    persistImmediately(get())
  },

  attachSession: (sessionId) => {
    if (get().phase === 'idle' || !sessionId) return
    set({ sessionId })
    persistImmediately(get())
  },

  exitEvaluation: () => {
    if (get().phase !== 'running') return
    set({ phase: 'paused', needsFillRebase: false })
    persistImmediately(get())
    lastPersistedAt = 0
    set(idleSession())
    try {
      getBrowserStorage()?.removeItem(EVAL_SESSION_STORAGE_KEY)
    } catch {
      // The in-memory session is already idle; the saved account remains
      // recoverable from the account registry even if key cleanup fails.
    }
  },

  retry: () => {
    const state = get()
    const { config } = state
    if (!config) return
    const startTs = state.runtime?.failedAt ?? state.lastCursorTs ?? state.startTs ?? 0
    set({
      phase: 'ready',
      accountId: createAccountId(state.instrument ?? 'eval', startTs),
      name: null,
      sessionId: null,
      runtime: newRuntime(config, startTs),
      startTs,
      attemptStartedAt: startTs,
      lastCursorTs: startTs,
      startDate: sessionDate(startTs, config.dayResetHour, state.sessionTimezone ?? 'UTC'),
      baselineRealizedCents: null,
      baselineEquityCents: null,
      lastEvalBalance: config.accountSize,
      lastEvalEquity: config.accountSize,
      needsFillRebase: false,
      lastTradeIds: new Set<string>(),
      trades: [],
      payoutHistory: [],
    })
    persistImmediately(get())
  },

  goVerification: () => {
    const state = get()
    if (state.phase !== 'passed' || !state.config || state.config.phase === 'verification' || state.config.phase === 'funded') return
    let verification: EvalConfig
    try {
      verification = verificationConfig(state.config)
    } catch {
      return
    }
    const startTs = state.runtime?.passedAt ?? state.lastCursorTs ?? state.startTs ?? 0
    set({
      accountId: createAccountId(state.instrument ?? 'verification', startTs),
      name: null,
      sessionId: null,
      config: verification,
      runtime: newRuntime(verification, startTs),
      phase: 'ready',
      startTs,
      attemptStartedAt: startTs,
      lastCursorTs: startTs,
      startDate: sessionDate(startTs, verification.dayResetHour, state.sessionTimezone ?? 'UTC'),
      baselineRealizedCents: null,
      baselineEquityCents: null,
      lastEvalBalance: verification.accountSize,
      lastEvalEquity: verification.accountSize,
      needsFillRebase: false,
      lastTradeIds: new Set<string>(),
      trades: [],
      payoutHistory: [],
    })
    persistImmediately(get())
  },

  goFunded: () => {
    const state = get()
    if (state.phase !== 'passed' || !state.config) return
    if (state.config.verificationProfitTarget > 0 && state.config.phase !== 'verification') return
    const funded = fundedConfig(state.config)
    const startTs = state.runtime?.passedAt ?? state.lastCursorTs ?? state.startTs ?? 0
    set({
      accountId: createAccountId(state.instrument ?? 'funded', startTs),
      name: null,
      sessionId: null,
      config: funded,
      runtime: newRuntime(funded, startTs),
      phase: 'ready',
      startTs,
      attemptStartedAt: startTs,
      lastCursorTs: startTs,
      startDate: sessionDate(startTs, funded.dayResetHour, state.sessionTimezone ?? 'UTC'),
      baselineRealizedCents: null,
      baselineEquityCents: null,
      lastEvalBalance: funded.accountSize,
      lastEvalEquity: funded.accountSize,
      needsFillRebase: false,
      lastTradeIds: new Set<string>(),
      trades: [],
      payoutHistory: [],
    })
    persistImmediately(get())
  },

  requestPayout: (requestedAmount) => {
    const state = get()
    const { config, runtime } = state
    if (state.phase !== 'running' || !config || !runtime || config.phase !== 'funded' || !config.payout) {
      return { success: false, reason: 'A live funded account is required to request a payout.', payout: null }
    }
    const balance = state.lastEvalBalance ?? config.accountSize
    const equity = state.lastEvalEquity ?? runtime.lastEquity
    const timeZone = state.sessionTimezone ?? 'UTC'
    const syncedRuntime = syncPayoutRuntime(config, runtime, state.trades, timeZone)
    const status = evalStatus(config, syncedRuntime, { balance, equity, trades: state.trades }, timeZone)
    const eligibility = payoutEligibility(config, syncedRuntime, status, timeZone)
    if (!eligibility.eligible) return { success: false, reason: eligibility.reason, payout: null }

    const amount = Math.floor((requestedAmount ?? eligibility.maxPayout) * 100 + Number.EPSILON) / 100
    if (!Number.isFinite(amount) || amount <= 0) return { success: false, reason: 'Payout amount must be greater than zero.', payout: null }
    if (amount > eligibility.maxPayout) return { success: false, reason: `Payout cannot exceed ${eligibility.maxPayout.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}.`, payout: null }
    if (amount < config.payout.minPayoutAmount) return { success: false, reason: `Minimum payout is ${config.payout.minPayoutAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}.`, payout: null }

    const requestedAt = state.lastCursorTs ?? Math.floor(Date.now() / 1000)
    const balanceAfter = Math.floor((balance - amount) * 100 + Number.EPSILON) / 100
    const equityAfter = Math.floor((equity - amount) * 100 + Number.EPSILON) / 100
    const payoutNumber = syncedRuntime.payoutsTaken + 1
    const traderAmount = Math.floor(amount * config.payout.profitSplit + Number.EPSILON) / 100
    const payout: PayoutRecord = {
      id: `payout-${state.accountId ?? 'funded'}-${requestedAt}-${payoutNumber}`,
      accountId: state.accountId ?? undefined,
      firm: config.firm,
      requestedAt,
      grossAmount: amount,
      traderAmount,
      profitSplit: config.payout.profitSplit,
      balanceAfter,
      payoutNumber,
    }
    const nextRuntime: EvalRuntime = {
      ...syncedRuntime,
      lastEquity: equityAfter,
      dayStartEquity: syncedRuntime.dayStartEquity - amount,
      dayStartBalance: syncedRuntime.dayStartBalance - amount,
      payoutsTaken: payoutNumber,
      lastPayoutAt: requestedAt,
      profitSinceLastPayout: 0,
      winningDays: 0,
      bestDaySincePayout: 0,
      payoutWindowDailyProfits: {},
    }
    set({
      runtime: nextRuntime,
      lastEvalBalance: balanceAfter,
      lastEvalEquity: equityAfter,
      baselineRealizedCents: state.baselineRealizedCents === null ? null : state.baselineRealizedCents + amount * 100,
      baselineEquityCents: state.baselineEquityCents === null ? null : state.baselineEquityCents + amount * 100,
      payoutHistory: [...state.payoutHistory, payout],
    })
    logPayout(payout)
    persistImmediately(get())
    return { success: true, reason: 'Payout recorded.', payout }
  },

  abandon: () => {
    cancelScheduledPersistence()
    lastPersistedAt = 0
    set(idleSession())
    try {
      getBrowserStorage()?.removeItem(EVAL_SESSION_STORAGE_KEY)
    } catch {
      // Store is idle either way; dropping the persisted copy is best-effort.
    }
  },
}))

export function getEvalState(): EvalSessionState {
  return useEvalStore.getState()
}

export function isEvalActive(): boolean {
  return getEvalState().phase === 'running'
}
