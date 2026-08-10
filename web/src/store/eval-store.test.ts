import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import * as rules from '../eval/rules'
import type { EvalAttempt, EvalConfig } from '../eval/rules'
import type { EngineTrade, FillEngineState } from '../fill-engine/types'
import { EVAL_ACCOUNTS_STORAGE_KEY, EVAL_SESSION_STORAGE_KEY, deriveEvalFinancials, flushEvalSessionPersistence, getEvalState, isEvalActive, loadEvalAccounts, useEvalStore } from './eval-store'

const DAY0 = 1705276800 // Mon 2024-01-15 00:00:00 UTC

const ftmo: EvalConfig = rules.EVAL_PRESETS[0]
const apex: EvalConfig = rules.EVAL_PRESETS[2]

/** Fill-engine snapshot as a plain object; the engine's bankroll is $10k (1_000_000 cents). */
function makeFill(overrides: Partial<FillEngineState> = {}): FillEngineState {
  return {
    config: { symbol: 'NQ', tickValueCents: 1250, commissionPerSideCents: 200, slippageTicks: 1, maxContracts: 10, startingEquityCents: 1_000_000 },
    position: null,
    orders: [],
    trades: [],
    realizedCents: 1_000_000,
    unrealizedCents: 0,
    equityCents: 1_000_000,
    lastTs: DAY0,
    sequence: 1,
    ...overrides,
  }
}

function makeTrade(id: string, exitTs: number, realizedCents = 0): EngineTrade {
  return {
    id,
    symbol: 'NQ',
    side: 'long',
    qty: 1,
    entryTs: exitTs - 3600,
    entryPriceTicks: 100,
    exitTs,
    exitPriceTicks: 110,
    realizedCents,
    feesCents: 0,
    mfeTicks: 0,
    maeTicks: 0,
    rMultiple: null,
  }
}

function readPersistedSession(): Record<string, unknown> | null {
  const raw = localStorage.getItem(EVAL_SESSION_STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

let logSpy: MockInstance<(attempt: EvalAttempt) => void>

beforeEach(() => {
  localStorage.clear()
  getEvalState().abandon()
  logSpy = vi.spyOn(rules, 'logEvalAttempt').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('eval session store', () => {
  it('keeps a paused account financial snapshot isolated from the live replay fill', () => {
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    getEvalState().tick({ cursorTs: DAY0, fill: makeFill() })
    getEvalState().tick({ cursorTs: DAY0 + 60, fill: makeFill({ realizedCents: 1_100_000, equityCents: 1_100_000 }) })
    useEvalStore.setState({ phase: 'paused' })

    getEvalState().tick({
      cursorTs: DAY0 + 120,
      fill: makeFill({ realizedCents: 500_000, equityCents: 500_000, trades: [makeTrade('unrelated-live-trade', DAY0 + 120)] }),
    })

    const financials = deriveEvalFinancials(
      getEvalState(),
      makeFill({ realizedCents: 500_000, equityCents: 500_000, trades: [makeTrade('unrelated-live-trade', DAY0 + 120)] }),
    )

    expect(financials).toMatchObject({ balance: 101_000, equity: 101_000 })
    expect(getEvalState().trades).toEqual([])
  })

  it('keeps a new evaluation ready until it is explicitly activated', () => {
    getEvalState().createEvaluation(ftmo, 'NQ', '2024-01-15', DAY0, 'America/New_York')
    const ready = getEvalState()

    expect(ready).toMatchObject({
      phase: 'ready',
      config: ftmo,
      instrument: 'NQ',
      lastEvalBalance: ftmo.accountSize,
      lastEvalEquity: ftmo.accountSize,
      needsFillRebase: false,
    })
    expect(isEvalActive()).toBe(false)
    expect(readPersistedSession()).toMatchObject({ phase: 'ready' })

    getEvalState().tick({ cursorTs: DAY0 + 60, fill: makeFill({ equityCents: 0 }) })
    expect(getEvalState().runtime).toEqual(rules.newRuntime(ftmo))
    expect(getEvalState().baselineEquityCents).toBeNull()

    getEvalState().activateEvaluation()
    expect(getEvalState()).toMatchObject({ phase: 'running', needsFillRebase: false })
    expect(isEvalActive()).toBe(true)
    expect(readPersistedSession()).toMatchObject({ phase: 'running' })
  })

  it('starts an evaluation with a fresh runtime and persists the session', () => {
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0, 'America/New_York')
    const state = getEvalState()
    expect(state.phase).toBe('running')
    expect(state.config).toEqual(ftmo)
    expect(state.runtime).toEqual(rules.newRuntime(ftmo))
    expect(state.instrument).toBe('NQ')
    expect(state.sessionTimezone).toBe('America/New_York')
    expect(state.startDate).toBe('2024-01-15')
    expect(state.startTs).toBe(DAY0)
    expect(state.baselineRealizedCents).toBeNull()
    expect(state.baselineEquityCents).toBeNull()
    expect(state.lastTradeIds.size).toBe(0)
    expect(state.trades).toEqual([])
    expect(readPersistedSession()).toMatchObject({
      version: 2,
      config: ftmo,
      instrument: 'NQ',
      startDate: '2024-01-15',
      startTs: DAY0,
      runtime: rules.newRuntime(ftmo),
    })
  })

  it('rejects a zero profit target instead of passing immediately', () => {
    expect(() => getEvalState().startEvaluation({ ...ftmo, profitTarget: 0 }, 'NQ', '2024-01-15', DAY0)).toThrow(/Invalid evaluation configuration/)
    expect(getEvalState().phase).toBe('idle')
  })

  it('ignores snapshots before the forward-only evaluation anchor', () => {
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    getEvalState().tick({ cursorTs: DAY0 - 60, fill: makeFill({ equityCents: 0 }) })
    expect(getEvalState().baselineEquityCents).toBeNull()
    expect(getEvalState().runtime).toEqual(rules.newRuntime(ftmo))
  })

  it('captures the fill baselines and absorbs pre-existing trades on the first tick', () => {
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    getEvalState().tick({
      cursorTs: DAY0,
      fill: makeFill({ realizedCents: 1_002_500, equityCents: 1_003_750, trades: [makeTrade('t-old', DAY0 - 100)] }),
    })
    const state = getEvalState()
    expect(state.baselineRealizedCents).toBe(1_002_500)
    expect(state.baselineEquityCents).toBe(1_003_750)
    expect(state.lastTradeIds).toEqual(new Set(['t-old']))
    expect(state.trades).toEqual([]) // absorbed ids, not re-added
    expect(state.runtime?.lastEquity).toBe(100000) // zero delta on the baseline tick
  })

  it('computes eval equity from the configured account size plus the fill delta', () => {
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    getEvalState().tick({ cursorTs: DAY0, fill: makeFill() })
    getEvalState().tick({ cursorTs: DAY0 + 60, fill: makeFill({ realizedCents: 1_200_000, equityCents: 1_250_000, sequence: 2 }) })
    const state = getEvalState()
    expect(state.baselineRealizedCents).toBe(1_000_000)
    expect(state.baselineEquityCents).toBe(1_000_000)
    // 100k account + (1_250_000 - 1_000_000)/100 = 100000 + 2500
    expect(state.runtime?.lastEquity).toBe(102500)
    expect(state.runtime?.peakEquity).toBe(102500)
  })

  it('appends only unseen closed trades to the eval trade list', () => {
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    const a = makeTrade('t-a', DAY0 + 60)
    getEvalState().tick({ cursorTs: DAY0, fill: makeFill({ trades: [a] }) }) // baseline absorbs t-a
    getEvalState().tick({ cursorTs: DAY0 + 120, fill: makeFill({ trades: [a], sequence: 2 }) }) // dupe skipped
    expect(getEvalState().trades).toEqual([])
    const b = makeTrade('t-b', DAY0 + 180)
    getEvalState().tick({ cursorTs: DAY0 + 240, fill: makeFill({ trades: [a, b], sequence: 3 }) })
    expect(getEvalState().trades).toEqual([expect.objectContaining({ id: 't-b', symbol: 'NQ', side: 'long', exitTime: DAY0 + 180 })])
    getEvalState().tick({ cursorTs: DAY0 + 300, fill: makeFill({ trades: [a, b], sequence: 4 }) })
    expect(getEvalState().trades).toHaveLength(1)
  })

  it('checkpoints active ticks at most once per second', () => {
    vi.useFakeTimers()
    const writeSpy = vi.spyOn(localStorage, 'setItem')
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    const sessionWrites = (): unknown[][] => writeSpy.mock.calls.filter(([key]) => key === EVAL_SESSION_STORAGE_KEY)
    expect(sessionWrites()).toHaveLength(1)
    for (let index = 0; index < 20; index += 1) {
      getEvalState().tick({ cursorTs: DAY0 + index * 60, fill: makeFill({ sequence: index + 1 }) })
    }
    expect(sessionWrites()).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(sessionWrites()).toHaveLength(2)
  })

  it('marks the eval passed and logs the attempt once realized profit hits the target', () => {
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    getEvalState().tick({ cursorTs: DAY0, fill: makeFill() })
    getEvalState().tick({
      cursorTs: DAY0 + 3600,
      fill: makeFill({ realizedCents: 2_000_000, equityCents: 2_000_000, trades: [makeTrade('t-win', DAY0 + 3600)], sequence: 2 }),
    })
    const state = getEvalState()
    expect(state.phase).toBe('passed')
    expect(state.runtime).toMatchObject({ outcome: 'passed', passedAt: DAY0 + 3600 })
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      config: ftmo,
      outcome: 'passed',
      failReason: null,
      startedAt: DAY0,
      endedAt: DAY0 + 3600,
      instrument: 'NQ',
      endingBalance: 110000,
      endingEquity: 110000,
      daysTraded: 1,
      trades: [expect.objectContaining({ id: 't-win' })],
    }))
    expect(readPersistedSession()).toMatchObject({ runtime: { outcome: 'passed' } })
  })

  it('keeps an eval running at the profit target until consistency is met', () => {
    const config = { ...ftmo, profitTarget: 1000, consistencyRulePct: 50 }
    getEvalState().startEvaluation(config, 'NQ', '2024-01-15', DAY0)
    getEvalState().tick({ cursorTs: DAY0, fill: makeFill() })
    const first = makeTrade('t-day-one', DAY0 + 3600, 100000)
    getEvalState().tick({
      cursorTs: DAY0 + 3600,
      fill: makeFill({ realizedCents: 1_100_000, equityCents: 1_100_000, trades: [first], sequence: 2 }),
    })
    expect(getEvalState()).toMatchObject({ phase: 'running', runtime: { outcome: 'in_progress' } })

    const second = makeTrade('t-day-two', DAY0 + 86400 + 3600, 100000)
    getEvalState().tick({
      cursorTs: DAY0 + 86400 + 3600,
      fill: makeFill({ realizedCents: 1_200_000, equityCents: 1_200_000, trades: [first, second], sequence: 3 }),
    })
    expect(getEvalState()).toMatchObject({ phase: 'passed', runtime: { outcome: 'passed' } })
  })

  it('fails with reason total when equity breaches the total floor', () => {
    getEvalState().startEvaluation(apex, 'NQ', '2024-01-15', DAY0)
    getEvalState().tick({ cursorTs: DAY0, fill: makeFill() })
    // 50k trailing account: floor is peak(50000) - 2500 = 47500; delta -2500.01 dips below it
    getEvalState().tick({ cursorTs: DAY0 + 60, fill: makeFill({ equityCents: 749_999, realizedCents: 749_999, sequence: 2 }) })
    const state = getEvalState()
    expect(state.phase).toBe('failed')
    expect(state.runtime).toMatchObject({ outcome: 'failed', failReason: 'total', failedAt: DAY0 + 60 })
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      config: apex,
      outcome: 'failed',
      failReason: 'total',
      startedAt: DAY0,
      endedAt: DAY0 + 60,
      instrument: 'NQ',
      endingEquity: 47499.99,
    }))
    expect(readPersistedSession()).toMatchObject({ runtime: { outcome: 'failed' } })
  })

  it('retry prepares the same config with a fresh runtime and waits for explicit start', () => {
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    getEvalState().tick({ cursorTs: DAY0, fill: makeFill() })
    // equity 100000 - 5000 reaches the FTMO daily loss limit
    getEvalState().tick({ cursorTs: DAY0 + 60, fill: makeFill({ equityCents: 500_000, realizedCents: 500_000, sequence: 2 }) })
    expect(getEvalState().phase).toBe('failed')
    expect(getEvalState().runtime).toMatchObject({ outcome: 'failed', failReason: 'daily' })
    getEvalState().retry()
    const state = getEvalState()
    expect(state.phase).toBe('ready')
    expect(state.config).toEqual(ftmo)
    expect(state.runtime).toEqual(rules.newRuntime(ftmo))
    expect(state.startTs).toBe(DAY0 + 60)
    expect(state.attemptStartedAt).toBe(DAY0 + 60)
    expect(state.baselineRealizedCents).toBeNull()
    expect(state.baselineEquityCents).toBeNull()
    expect(state.lastTradeIds.size).toBe(0)
    expect(state.trades).toEqual([])
    expect(readPersistedSession()).toMatchObject({ phase: 'ready', runtime: rules.newRuntime(ftmo) })
  })

  it('goFunded prepares a funded account and waits for explicit start', () => {
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    getEvalState().tick({ cursorTs: DAY0, fill: makeFill() })
    getEvalState().tick({ cursorTs: DAY0 + 60, fill: makeFill({ realizedCents: 2_000_000, equityCents: 2_000_000, sequence: 2 }) })
    expect(getEvalState().phase).toBe('passed')
    getEvalState().goFunded()
    const state = getEvalState()
    expect(state.phase).toBe('ready')
    expect(state.config).toEqual(rules.fundedConfig(ftmo))
    expect(state.runtime).toEqual(rules.newRuntime(rules.fundedConfig(ftmo)))
    expect(state.baselineRealizedCents).toBeNull()
    expect(state.lastTradeIds.size).toBe(0)
    expect(state.trades).toEqual([])
    expect(readPersistedSession()).toMatchObject({ phase: 'ready', config: rules.fundedConfig(ftmo) })
  })

  it('abandon resets to idle and removes the persisted session', () => {
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    expect(localStorage.getItem(EVAL_SESSION_STORAGE_KEY)).not.toBeNull()
    getEvalState().abandon()
    const state = getEvalState()
    expect(state.phase).toBe('idle')
    expect(state.config).toBeNull()
    expect(state.runtime).toBeNull()
    expect(state.instrument).toBeNull()
    expect(state.startDate).toBeNull()
    expect(state.startTs).toBeNull()
    expect(state.lastTradeIds.size).toBe(0)
    expect(state.trades).toEqual([])
    expect(localStorage.getItem(EVAL_SESSION_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(EVAL_ACCOUNTS_STORAGE_KEY)).not.toBeNull()
  })

  it('exits a running evaluation as paused without deleting its saved account', () => {
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    const accountId = getEvalState().accountId
    getEvalState().tick({ cursorTs: DAY0, fill: makeFill() })

    getEvalState().exitEvaluation()

    expect(getEvalState().phase).toBe('idle')
    expect(localStorage.getItem(EVAL_SESSION_STORAGE_KEY)).toBeNull()
    expect(loadEvalAccounts()).toContainEqual(expect.objectContaining({ accountId, phase: 'paused' }))
  })

  it('keeps previous accounts and can restore a paused in-progress account', () => {
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    const firstId = getEvalState().accountId
    getEvalState().tick({ cursorTs: DAY0, fill: makeFill() })
    getEvalState().startEvaluation(apex, 'ES', '2024-01-16', DAY0 + 86400)
    const secondId = getEvalState().accountId

    expect(firstId).not.toBeNull()
    expect(secondId).not.toBe(firstId)
    expect(loadEvalAccounts().map((account) => account.accountId)).toEqual(expect.arrayContaining([firstId, secondId]))

    getEvalState().restoreAccount(firstId!)
    expect(getEvalState()).toMatchObject({ accountId: firstId, instrument: 'NQ', phase: 'paused', needsFillRebase: false })
    getEvalState().activateEvaluation()
    expect(getEvalState()).toMatchObject({ accountId: firstId, phase: 'running', needsFillRebase: true })
  })

  it('isEvalActive mirrors the running phase', () => {
    expect(isEvalActive()).toBe(false)
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    expect(isEvalActive()).toBe(true)
    getEvalState().abandon()
    expect(isEvalActive()).toBe(false)
  })
})

describe('eval session hydration', () => {
  it('keeps an unstarted account ready after a reload', async () => {
    getEvalState().createEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    vi.resetModules()
    const reloaded = await import('./eval-store')

    expect(reloaded.getEvalState()).toMatchObject({ phase: 'ready', needsFillRebase: false })
    expect(reloaded.isEvalActive()).toBe(false)
    reloaded.getEvalState().tick({ cursorTs: DAY0 + 60, fill: makeFill({ equityCents: 0 }) })
    expect(reloaded.getEvalState().baselineEquityCents).toBeNull()
    expect(reloaded.getEvalState().runtime).toEqual(rules.newRuntime(ftmo))
  })

  it('pauses an in-progress session after a reload until explicitly resumed', async () => {
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    vi.resetModules()
    const reloaded = await import('./eval-store')
    const state = reloaded.getEvalState()
    expect(state.phase).toBe('paused')
    expect(state.config).toEqual(ftmo)
    expect(state.instrument).toBe('NQ')
    expect(state.startDate).toBe('2024-01-15')
    expect(state.startTs).toBe(DAY0)
    expect(state.runtime).toEqual(rules.newRuntime(ftmo))
    expect(state.baselineEquityCents).toBeNull()
    expect(state.needsFillRebase).toBe(false)
    expect(state.trades).toEqual([])

    state.activateEvaluation()
    expect(reloaded.getEvalState()).toMatchObject({ phase: 'running', needsFillRebase: true })
  })

  it('preserves progressed equity when a fresh fill engine attaches after reload', async () => {
    getEvalState().startEvaluation(apex, 'NQ', '2024-01-15', DAY0, 'America/New_York')
    getEvalState().tick({ cursorTs: DAY0, fill: makeFill() })
    getEvalState().tick({ cursorTs: DAY0 + 60, fill: makeFill({ realizedCents: 1_200_000, equityCents: 1_300_000, sequence: 2 }) })
    expect(getEvalState().runtime?.lastEquity).toBe(53000)
    flushEvalSessionPersistence()

    vi.resetModules()
    const reloaded = await import('./eval-store')
    expect(reloaded.getEvalState()).toMatchObject({ phase: 'paused', lastEvalBalance: 52000, lastEvalEquity: 53000, needsFillRebase: false })
    reloaded.getEvalState().activateEvaluation()
    expect(reloaded.getEvalState()).toMatchObject({ phase: 'running', needsFillRebase: true })
    reloaded.getEvalState().tick({ cursorTs: DAY0 + 60, fill: makeFill() })
    expect(reloaded.getEvalState().phase).toBe('running')
    expect(reloaded.getEvalState().runtime?.lastEquity).toBe(53000)
    expect(reloaded.getEvalState().needsFillRebase).toBe(false)
  })

  it('restores a finished eval as its terminal phase', async () => {
    getEvalState().startEvaluation(ftmo, 'NQ', '2024-01-15', DAY0)
    getEvalState().tick({ cursorTs: DAY0, fill: makeFill() })
    getEvalState().tick({ cursorTs: DAY0 + 60, fill: makeFill({ equityCents: 500_000, realizedCents: 500_000, sequence: 2 }) })
    vi.resetModules()
    const reloaded = await import('./eval-store')
    expect(reloaded.getEvalState().phase).toBe('failed')
    expect(reloaded.getEvalState().runtime).toMatchObject({ outcome: 'failed', failReason: 'daily', failedAt: DAY0 + 60 })
  })

  it('falls back to idle when the persisted session is corrupt', async () => {
    localStorage.setItem(EVAL_SESSION_STORAGE_KEY, '{not json')
    vi.resetModules()
    const reloaded = await import('./eval-store')
    expect(reloaded.getEvalState().phase).toBe('idle')
    expect(reloaded.getEvalState().config).toBeNull()
  })
})
