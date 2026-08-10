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
import { evalConfigSchema, evalStatus, fundedConfig, logEvalAttempt, newRuntime, sessionDate, tickEval } from '../eval/rules'
import type { EvalConfig, EvalRuntime, EvalStatus, EvalTradeRecord } from '../eval/rules'
import type { FillEngineState } from '../fill-engine/types'

export type EvalPhase = 'idle' | 'ready' | 'paused' | 'running' | 'passed' | 'failed'
type StoredEvalPhase = Exclude<EvalPhase, 'idle'>

export const EVAL_SESSION_STORAGE_KEY = 'replay:eval'
export const EVAL_ACCOUNTS_STORAGE_KEY = 'replay:eval:accounts'
const EVAL_SESSION_VERSION = 2
const PERSIST_INTERVAL_MS = 1000

export interface EvalSessionState {
  phase: EvalPhase
  accountId: string | null
  config: EvalConfig | null // null when idle
  runtime: EvalRuntime | null // null when idle
  instrument: string | null // symbol code, e.g. 'NQ'
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

  createEvaluation(config: EvalConfig, instrument: string, startDate: string, startTs: number, sessionTimezone?: string): void
  startEvaluation(config: EvalConfig, instrument: string, startDate: string, startTs: number, sessionTimezone?: string): void
  activateEvaluation(): void
  /** Feed one replay-engine snapshot. No-op outside the running phase. */
  tick(snapshot: { cursorTs: number; fill: FillEngineState | null }): void
  prepareFillRebase(): void
  restoreAccount(accountId: string): void
  exitEvaluation(): void // checkpoint as paused, then clear the current session
  retry(): void // same config, fresh ready account — for breach retry
  goFunded(): void // pass → fresh funded account waiting in the ready phase
  abandon(): void // abandon the current eval → idle, clear everything
}

type EvalSessionData = Omit<EvalSessionState, 'createEvaluation' | 'startEvaluation' | 'activateEvaluation' | 'tick' | 'prepareFillRebase' | 'restoreAccount' | 'exitEvaluation' | 'retry' | 'goFunded' | 'abandon'>

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
  outcome: z.enum(['in_progress', 'passed', 'failed']),
  failReason: z.enum(['total', 'daily']).nullable(),
  failedAt: z.number().nullable(),
  passedAt: z.number().nullable(),
})

const persistedSessionSchema = z.object({
  version: z.literal(EVAL_SESSION_VERSION),
  phase: z.enum(['ready', 'paused', 'running', 'passed', 'failed']).optional(),
  accountId: z.string().min(1).optional(),
  config: evalConfigSchema,
  instrument: z.string().trim().min(1),
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
  })),
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

function idleSession(): EvalSessionData {
  return {
    phase: 'idle',
    accountId: null,
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
  }
}

function getBrowserStorage(): PreferenceStorage | null {
  return typeof window === 'undefined' ? null : preferenceStorage
}

function normalizedAccountId(account: PersistedEvalAccount): string {
  return account.accountId ?? `eval-${account.instrument}-${account.attemptStartedAt}`
}

function normalizedAccountPhase(account: PersistedEvalAccount): StoredEvalPhase {
  if (account.runtime.outcome === 'passed') return 'passed'
  if (account.runtime.outcome === 'failed') return 'failed'
  return account.phase ?? 'paused'
}

function createAccountId(instrument: string, startTs: number): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `eval-${instrument}-${startTs}-${suffix}`
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
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
let pendingPersistState: EvalSessionState | null = null
let lastPersistedAt = 0

function persistedPayload(state: EvalSessionState): PersistedEvalAccount | null {
  if (state.phase === 'idle' || !state.accountId || !state.config || !state.runtime || !state.instrument || !state.sessionTimezone || !state.startDate || state.startTs === null || state.attemptStartedAt === null || state.lastCursorTs === null) return null
  return {
    version: EVAL_SESSION_VERSION,
    phase: state.phase,
    accountId: state.accountId,
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

export function deriveEvalFinancials(session: EvalSessionState, fill: FillEngineState | null): EvalFinancials | null {
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
    if (!instrument.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(startTs) || startTs < 0) throw new Error('Evaluation instrument, date and start time are required')
    if (!isValidTimezone(sessionTimezone)) throw new Error(`Invalid evaluation timezone: ${sessionTimezone}`)
    set({
      phase: 'ready',
      accountId: createAccountId(instrument, startTs),
      config: parsed.data,
      runtime: newRuntime(parsed.data),
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
    })
    persistImmediately(get())
  },

  startEvaluation: (config, instrument, startDate, startTs, sessionTimezone = 'UTC') => {
    const parsed = evalConfigSchema.safeParse(config)
    if (!parsed.success) throw new Error(`Invalid evaluation configuration: ${parsed.error.issues[0]?.message ?? 'unknown error'}`)
    if (!instrument.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(startTs) || startTs < 0) throw new Error('Evaluation instrument, date and start time are required')
    if (!isValidTimezone(sessionTimezone)) throw new Error(`Invalid evaluation timezone: ${sessionTimezone}`)
    set({
      phase: 'running',
      accountId: createAccountId(instrument, startTs),
      config: parsed.data,
      runtime: newRuntime(parsed.data),
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
      lastTradeIds = new Set([...lastTradeIds, ...fill.trades.map((trade) => trade.id)])
      needsFillRebase = false
    } else if (baselineRealizedCents === null || baselineEquityCents === null) {
      // First tick since (re)start: anchor the baselines on the fill
      // engine's current accounting and absorb the ids of trades that
      // already closed (e.g. after a resumed session) without re-adding
      // them to the eval trade list.
      baselineRealizedCents = fill.realizedCents
      baselineEquityCents = fill.equityCents
      lastTradeIds = new Set(fill.trades.map((trade) => trade.id))
    } else {
      const unseen = fill.trades.filter((trade) => !lastTradeIds.has(trade.id))
      if (unseen.length > 0) {
        lastTradeIds = new Set(lastTradeIds)
        for (const trade of unseen) lastTradeIds.add(trade.id)
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
        }))]
      }
    }

    const evalBalance = config.accountSize + (fill.realizedCents - baselineRealizedCents) / 100
    const evalEquity = config.accountSize + (fill.equityCents - baselineEquityCents) / 100

    const timeZone = state.sessionTimezone ?? 'UTC'
    let next = tickEval(config, runtime, cursorTs, evalEquity, timeZone)
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
        instrument: state.instrument ?? '',
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
    })
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
      runtime: newRuntime(config),
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
    })
    persistImmediately(get())
  },

  goFunded: () => {
    const state = get()
    if (!state.config) return
    const funded = fundedConfig(state.config)
    const startTs = state.runtime?.passedAt ?? state.lastCursorTs ?? state.startTs ?? 0
    set({
      accountId: createAccountId(state.instrument ?? 'funded', startTs),
      config: funded,
      runtime: newRuntime(funded),
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
    })
    persistImmediately(get())
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
