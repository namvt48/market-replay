import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EVAL_PRESETS,
  customConfig,
  dayKey,
  evalAccountId,
  evalAccountName,
  evalConfigSchema,
  evalStatus,
  fundedConfig,
  loadEvalHistory,
  logEvalAttempt,
  newRuntime,
  shortEvalAccountHash,
  tickEval,
  totalFloor,
} from './rules'
import type { EvalAttempt, EvalConfig, EvalRuntime } from './rules'

const ftmo = EVAL_PRESETS[0]
const topstep = EVAL_PRESETS[1]
const apex = EVAL_PRESETS[2]

// Mon 2024-01-15 00:00:00 UTC — a multiple of 86400, handy anchor.
const DAY0 = 1705276800

function makeRuntime(config: EvalConfig, fields: Partial<EvalRuntime> = {}): EvalRuntime {
  return { ...newRuntime(config), ...fields }
}

function makeAttempt(overrides: Partial<EvalAttempt> = {}): EvalAttempt {
  return {
    config: ftmo,
    outcome: 'failed',
    failReason: 'total',
    startedAt: DAY0,
    endedAt: DAY0 + 3600,
    instrument: 'NQ',
    ...overrides,
  }
}

describe('EVAL_PRESETS', () => {
  it('matches the production presets exactly', () => {
    expect(EVAL_PRESETS).toEqual([
      { firm: 'FTMO 100K (static)', accountSize: 100000, profitTarget: 10000, maxDailyLoss: 5000, maxTotalLoss: 10000, drawdownType: 'static', trailingLocksAtStart: false, trailingEod: false, minTradingDays: 0, consistencyRulePct: 0, dayResetHour: 0 },
      { firm: 'TopStep 50K (EOD trail)', accountSize: 50000, profitTarget: 3000, maxDailyLoss: 1000, maxTotalLoss: 2000, drawdownType: 'trailing', trailingLocksAtStart: true, trailingEod: true, minTradingDays: 0, consistencyRulePct: 50, dayResetHour: 17 },
      { firm: 'Apex 50K (trailing)', accountSize: 50000, profitTarget: 3000, maxDailyLoss: 0, maxTotalLoss: 2500, drawdownType: 'trailing', trailingLocksAtStart: false, trailingEod: false, minTradingDays: 0, consistencyRulePct: 0, dayResetHour: 17 },
    ])
  })
})

describe('customConfig', () => {
  const cases: { name: string; size: number | undefined; want: { accountSize: number; profitTarget: number; maxDailyLoss: number; maxTotalLoss: number } }[] = [
    { name: 'defaults to a 50k account', size: undefined, want: { accountSize: 50000, profitTarget: 4000, maxDailyLoss: 2000, maxTotalLoss: 3000 } },
    { name: 'scales 8% target / 4% daily / 6% total', size: 100000, want: { accountSize: 100000, profitTarget: 8000, maxDailyLoss: 4000, maxTotalLoss: 6000 } },
    { name: 'rounds to whole dollars', size: 12345, want: { accountSize: 12345, profitTarget: 988, maxDailyLoss: 494, maxTotalLoss: 741 } },
  ]
  for (const tc of cases) {
    it(tc.name, () => {
      const config = tc.size === undefined ? customConfig() : customConfig(tc.size)
      expect(config).toMatchObject(tc.want)
    })
  }

  it('uses a trailing drawdown with a 17:00 day reset and no min days', () => {
    expect(customConfig(50000)).toEqual({
      firm: 'Custom',
      accountSize: 50000,
      profitTarget: 4000,
      maxDailyLoss: 2000,
      maxTotalLoss: 3000,
      drawdownType: 'trailing',
      trailingLocksAtStart: false,
      trailingEod: false,
      minTradingDays: 0,
      consistencyRulePct: 40,
      dayResetHour: 17,
    })
  })
})

describe('dayKey', () => {
  const cases: { name: string; ts: number; hour: number; want: number }[] = [
    { name: 'epoch origin at UTC midnight reset', ts: 0, hour: 0, want: 0 },
    { name: 'last second before UTC midnight rollover', ts: 86399, hour: 0, want: 0 },
    { name: 'UTC midnight rollover', ts: 86400, hour: 0, want: 1 },
    { name: 'second day at UTC midnight reset', ts: DAY0, hour: 0, want: 19737 },
    { name: '17h reset: just before 5pm UTC belongs to the previous day', ts: 61199, hour: 17, want: -1 },
    { name: '17h reset: at 5pm UTC exactly', ts: 61200, hour: 17, want: 0 },
    { name: '17h reset: next 5pm UTC rolls the key', ts: 61200 + 86400, hour: 17, want: 1 },
    { name: '17h reset: UTC midnight on Jan 15 sits in the Jan 14 session', ts: DAY0, hour: 17, want: 19736 },
    { name: '17h reset: Jan 15 16:00 UTC is still the Jan 14 session', ts: DAY0 + 16 * 3600, hour: 17, want: 19736 },
    { name: '17h reset: Jan 15 17:00 UTC starts the Jan 15 session', ts: DAY0 + 17 * 3600, hour: 17, want: 19737 },
  ]
  for (const tc of cases) {
    it(tc.name, () => {
      expect(dayKey(tc.ts, tc.hour)).toBe(tc.want)
    })
  }

  it('keeps a whole 5pm-to-5pm session under one key across UTC midnight', () => {
    expect(dayKey(DAY0, 17)).toBe(dayKey(DAY0 + 16 * 3600, 17))
    expect(dayKey(DAY0 + 17 * 3600, 17)).toBe(dayKey(DAY0 + 16 * 3600, 17) + 1)
  })

  it('resets at 5pm New York local time across daylight-saving time', () => {
    const before = Date.parse('2024-03-10T20:59:59Z') / 1000 // 16:59:59 EDT
    const after = Date.parse('2024-03-10T21:00:00Z') / 1000 // 17:00:00 EDT
    expect(dayKey(after, 17, 'America/New_York')).toBe(dayKey(before, 17, 'America/New_York') + 1)
  })
})

describe('newRuntime', () => {
  it('starts everything at the account size with no day assigned', () => {
    expect(newRuntime(apex)).toEqual({
      startBalance: 50000,
      peakEquity: 50000,
      eodPeak: 50000,
      lastEquity: 50000,
      dayKey: null,
      dayStartEquity: 50000,
      outcome: 'in_progress',
      failReason: null,
      failedAt: null,
      passedAt: null,
    })
  })
})

describe('totalFloor', () => {
  const cases: { name: string; config: EvalConfig; fields: Partial<EvalRuntime>; want: number }[] = [
    {
      name: 'static: start balance minus max total loss',
      config: ftmo,
      fields: {},
      want: 90000,
    },
    {
      name: 'static: ignores an equity peak above the start',
      config: ftmo,
      fields: { peakEquity: 115000, eodPeak: 115000 },
      want: 90000,
    },
    {
      name: 'trailing intraday: trails the live peak',
      config: apex,
      fields: { peakEquity: 52000 },
      want: 49500,
    },
    {
      name: 'trailing EOD: trails the EOD peak, not the intraday peak',
      config: { ...topstep, trailingLocksAtStart: false },
      fields: { eodPeak: 51500, peakEquity: 53000 },
      want: 49500,
    },
    {
      name: 'trailing + lock: floor stays below when the locked value is lower',
      config: topstep,
      fields: { eodPeak: 51000 },
      want: 49000,
    },
    {
      name: 'trailing + lock: floor locks at the start balance once the trail rises past it',
      config: topstep,
      fields: { eodPeak: 53000 },
      want: 50000,
    },
  ]
  for (const tc of cases) {
    it(tc.name, () => {
      expect(totalFloor(tc.config, makeRuntime(tc.config, tc.fields))).toBe(tc.want)
    })
  }
})

describe('tickEval', () => {
  it('initializes the day on the first tick', () => {
    const next = tickEval(apex, newRuntime(apex), DAY0, 50100)
    expect(next).toMatchObject({
      dayKey: dayKey(DAY0, 17),
      dayStartEquity: 50100,
      lastEquity: 50100,
      peakEquity: 50100,
      eodPeak: 50000,
      outcome: 'in_progress',
    })
  })

  it('rolls the EOD peak forward from lastEquity on a day change', () => {
    const runtime = makeRuntime(topstep, { dayKey: dayKey(DAY0, 17), lastEquity: 50500, peakEquity: 50500, eodPeak: 50200 })
    const next = tickEval(topstep, runtime, DAY0 + 86400, 50300)
    expect(next.eodPeak).toBe(50500) // prior lastEquity, not the current tick
    expect(next.dayStartEquity).toBe(50300)
    expect(next.lastEquity).toBe(50300)
    expect(next.dayKey).toBe(dayKey(DAY0 + 86400, 17))
    expect(next.peakEquity).toBe(50500)
    expect(next.outcome).toBe('in_progress')
  })

  it('keeps the EOD peak when lastEquity is not above it on a day change', () => {
    const runtime = makeRuntime(topstep, { dayKey: dayKey(DAY0, 17), lastEquity: 50100, eodPeak: 50200 })
    const next = tickEval(topstep, runtime, DAY0 + 86400, 50300)
    expect(next.eodPeak).toBe(50200)
  })

  it('does not touch the EOD peak within the same day', () => {
    const runtime = makeRuntime(topstep, { dayKey: dayKey(DAY0, 17), lastEquity: 50500, eodPeak: 50200 })
    const next = tickEval(topstep, runtime, DAY0 + 3600, 50300)
    expect(next.eodPeak).toBe(50200)
    expect(next.dayStartEquity).toBe(50000)
  })

  it('fails on breaching the total floor with reason total', () => {
    const ts = DAY0 + 3600
    const next = tickEval(ftmo, newRuntime(ftmo), ts, 89999)
    expect(next).toMatchObject({ outcome: 'failed', failReason: 'total', failedAt: ts })
  })

  it('does not fail at exactly the total floor', () => {
    const next = tickEval(ftmo, newRuntime(ftmo), DAY0 + 3600, 90000)
    expect(next).toMatchObject({ outcome: 'in_progress', failReason: null })
  })

  it('fails when the daily loss reaches maxDailyLoss with reason daily', () => {
    const ts = DAY0 + 7200
    const runtime = makeRuntime(ftmo, { dayKey: dayKey(DAY0, 0) })
    const next = tickEval(ftmo, runtime, ts, 95000) // 100000 - 95000 = 5000 >= 5000
    expect(next).toMatchObject({ outcome: 'failed', failReason: 'daily', failedAt: ts })
  })

  it('does not fail one dollar short of the daily limit', () => {
    const runtime = makeRuntime(ftmo, { dayKey: dayKey(DAY0, 0) })
    const next = tickEval(ftmo, runtime, DAY0 + 7200, 95001)
    expect(next).toMatchObject({ outcome: 'in_progress', failReason: null })
  })

  it('never fails on daily loss when maxDailyLoss is 0', () => {
    const runtime = makeRuntime(apex, { dayKey: dayKey(DAY0, 17) })
    const next = tickEval(apex, runtime, DAY0 + 3600, 48000) // -2000 intraday, still above the 47500 floor
    expect(next).toMatchObject({ outcome: 'in_progress', failReason: null })
  })

  it('returns the same reference once the attempt has ended', () => {
    const failed = tickEval(ftmo, newRuntime(ftmo), DAY0, 89999)
    expect(failed.outcome).toBe('failed')
    expect(tickEval(ftmo, failed, DAY0 + 3600, 200000)).toBe(failed)
  })

  it('never mutates the input runtime', () => {
    const runtime = makeRuntime(ftmo, { dayKey: dayKey(DAY0, 0) })
    const snapshot = structuredClone(runtime)
    tickEval(ftmo, runtime, DAY0 + 3600, 89999)
    expect(runtime).toEqual(snapshot)
  })
})

describe('evalStatus', () => {
  it('passes when realized profit hits the target and min days are met', () => {
    const config = { ...ftmo, minTradingDays: 2 }
    const status = evalStatus(config, newRuntime(config), {
      balance: 110000,
      equity: 110000,
      trades: [{ exitTime: DAY0 }, { exitTime: DAY0 + 86400 }],
    })
    expect(status).toMatchObject({ outcome: 'passed', failReason: null, realizedProfit: 10000, daysTraded: 2, minDaysMet: true, targetPct: 1 })
  })

  it('passes on realized profit even when live equity is below the target', () => {
    const status = evalStatus(ftmo, newRuntime(ftmo), {
      balance: 110000, // realized +10000 hits the 10000 target
      equity: 102000, // live +2000 only
      trades: [{ exitTime: DAY0 }],
    })
    expect(status).toMatchObject({ outcome: 'passed', targetPct: 1 })
  })

  it('blocks the pass when min trading days are not met', () => {
    const config = { ...ftmo, minTradingDays: 3 }
    const status = evalStatus(config, newRuntime(config), {
      balance: 110000,
      equity: 110000,
      trades: [{ exitTime: DAY0 }, { exitTime: DAY0 + 86400 }],
    })
    expect(status).toMatchObject({ outcome: 'in_progress', minDaysMet: false, daysTraded: 2 })
  })

  it('blocks the pass when realized profit is below the target', () => {
    const status = evalStatus(ftmo, newRuntime(ftmo), { balance: 109999, equity: 109999, trades: [{ exitTime: DAY0 }] })
    expect(status).toMatchObject({ outcome: 'in_progress' })
  })

  it('blocks the pass entirely in the funded phase', () => {
    const config = fundedConfig({ ...ftmo, minTradingDays: 2 })
    const status = evalStatus(config, newRuntime(config), {
      balance: 110000,
      equity: 110000,
      trades: [{ exitTime: DAY0 }, { exitTime: DAY0 + 86400 }],
    })
    expect(status).toMatchObject({ outcome: 'in_progress', failReason: null })
  })

  it('fails on a total-floor breach', () => {
    const status = evalStatus(ftmo, newRuntime(ftmo), { balance: 89999, equity: 89999, trades: [] })
    expect(status).toMatchObject({ outcome: 'failed', failReason: 'total' })
  })

  it('fails when the daily loss reaches the limit', () => {
    const status = evalStatus(ftmo, newRuntime(ftmo), { balance: 95000, equity: 95000, trades: [] })
    expect(status).toMatchObject({ outcome: 'failed', failReason: 'daily', dailyLoss: 5000, dailyRemaining: 0 })
  })

  it('preserves a terminal runtime outcome instead of re-evaluating', () => {
    const runtime = makeRuntime(ftmo, { outcome: 'failed', failReason: 'daily', failedAt: DAY0 })
    const status = evalStatus(ftmo, runtime, { balance: 110000, equity: 110000, trades: [] })
    expect(status).toMatchObject({ outcome: 'failed', failReason: 'daily' })
  })

  it('measures trailing drawdown from the EOD peak on EOD configs', () => {
    const runtime = makeRuntime(topstep, { eodPeak: 51000, dayKey: dayKey(DAY0, 17) })
    const status = evalStatus(topstep, runtime, { balance: 49500, equity: 49500, trades: [] })
    expect(status).toMatchObject({
      outcome: 'in_progress',
      totalDrawdown: 1500,
      totalPct: 0.75,
      floor: 49000,
      totalRemaining: 500,
    })
  })

  it('clamps percentages into [0, 1]', () => {
    const status = evalStatus(ftmo, newRuntime(ftmo), { balance: 150000, equity: 150000, trades: [] })
    expect(status.targetPct).toBe(1) // +50000 vs 10000 target
    expect(status.dailyPct).toBe(0)
    expect(status.totalPct).toBe(0)
    expect(status.dailyRemaining).toBe(5000)
    expect(status.totalRemaining).toBe(60000)
    expect(status.totalDrawdown).toBe(0)
  })

  it('clamps negative progress to zero and guards zero limits', () => {
    const losing = evalStatus(ftmo, newRuntime(ftmo), { balance: 91000, equity: 91000, trades: [] })
    expect(losing.targetPct).toBe(0) // liveProfit -9000
    const noTarget = evalStatus({ ...ftmo, profitTarget: 0 }, newRuntime(ftmo), { balance: 150000, equity: 150000, trades: [] })
    expect(noTarget.targetPct).toBe(0)
    const noDaily = evalStatus(apex, newRuntime(apex), { balance: 48000, equity: 48000, trades: [] })
    expect(noDaily.dailyPct).toBe(0)
  })

  it('reports realized and live profit separately', () => {
    const status = evalStatus(ftmo, newRuntime(ftmo), { balance: 103000, equity: 105500, trades: [] })
    expect(status.realizedProfit).toBe(3000)
    expect(status.liveProfit).toBe(5500)
  })

  it('counts distinct trading days using the config day reset hour', () => {
    // Under a 17:00 reset, Jan 15 00:00 and Jan 15 16:00 UTC fall in the same session.
    const sameSession = evalStatus(topstep, newRuntime(topstep), {
      balance: 50000,
      equity: 50000,
      trades: [{ exitTime: DAY0 }, { exitTime: DAY0 + 16 * 3600 }],
    })
    expect(sameSession.daysTraded).toBe(1)
    const nextSession = evalStatus(topstep, newRuntime(topstep), {
      balance: 50000,
      equity: 50000,
      trades: [{ exitTime: DAY0 }, { exitTime: DAY0 + 16 * 3600 }, { exitTime: DAY0 + 17 * 3600 }],
    })
    expect(nextSession.daysTraded).toBe(2)
  })

  it('blocks passing when the best winning day exceeds the configured consistency limit', () => {
    const config = { ...ftmo, profitTarget: 1000, consistencyRulePct: 40 }
    const status = evalStatus(config, newRuntime(config), {
      balance: 101000,
      equity: 101000,
      trades: [{ exitTime: DAY0 + 3600, realizedCents: 100000 }],
    })

    expect(status).toMatchObject({
      outcome: 'in_progress',
      bestDayProfit: 1000,
      consistencyPct: 1,
      consistencyMet: false,
      consistencyRemaining: 1500,
    })
  })

  it('passes when daily net profits bring consistency down to the limit', () => {
    const config = { ...ftmo, profitTarget: 2500, consistencyRulePct: 40 }
    const status = evalStatus(config, newRuntime(config), {
      balance: 102500,
      equity: 102500,
      trades: [
        { exitTime: DAY0 + 3600, realizedCents: 100000 },
        { exitTime: DAY0 + 86400 + 3600, realizedCents: 80000 },
        { exitTime: DAY0 + 2 * 86400 + 3600, realizedCents: 70000 },
      ],
    })

    expect(status).toMatchObject({
      outcome: 'passed',
      bestDayProfit: 1000,
      consistencyPct: 0.4,
      consistencyMet: true,
      consistencyRemaining: 0,
    })
  })

  it('nets all closed trades inside the same trading day for consistency', () => {
    const config = { ...ftmo, consistencyRulePct: 50 }
    const status = evalStatus(config, newRuntime(config), {
      balance: 100800,
      equity: 100800,
      trades: [
        { exitTime: DAY0 + 3600, realizedCents: 100000 },
        { exitTime: DAY0 + 7200, realizedCents: -20000 },
      ],
    })

    expect(status.bestDayProfit).toBe(800)
    expect(status.consistencyPct).toBe(1)
  })
})

describe('evalConfigSchema', () => {
  it('migrates saved configs created before consistency rules existed', () => {
    const { consistencyRulePct: _removed, ...legacy } = ftmo
    expect(evalConfigSchema.parse(legacy)).toEqual({ ...legacy, consistencyRulePct: 0 })
  })
})

describe('fundedConfig', () => {
  it('marks the phase funded without mutating the input', () => {
    const funded = fundedConfig(ftmo)
    expect(funded).toEqual({ ...ftmo, phase: 'funded' })
    expect(ftmo.phase).toBeUndefined()
  })
})

describe('evalAccountId', () => {
  const cases: { name: string; config: EvalConfig; want: string }[] = [
    { name: 'slugs the eval phase preset', config: ftmo, want: 'eval_eval-ftmo-100k-static-100000' },
    { name: 'slugs the funded phase', config: fundedConfig(ftmo), want: 'eval_funded-ftmo-100k-static-100000' },
    { name: 'slugs the EOD trail preset', config: topstep, want: 'eval_eval-topstep-50k-eod-trail-50000' },
    { name: 'slugs the apex preset', config: apex, want: 'eval_eval-apex-50k-trailing-50000' },
    { name: 'slugs a custom config', config: customConfig(50000), want: 'eval_eval-custom-50000' },
    { name: 'collapses symbol runs into single dashes', config: { ...customConfig(1000), firm: 'My Firm!!' }, want: 'eval_eval-my-firm-1000' },
  ]
  for (const tc of cases) {
    it(tc.name, () => {
      expect(evalAccountId(tc.config)).toBe(tc.want)
    })
  }
})

describe('evalAccountName', () => {
  const cases: { name: string; config: EvalConfig; want: string }[] = [
    { name: 'shows the firm in the eval phase', config: ftmo, want: 'FTMO 100K (static)' },
    { name: 'shows the firm for an explicit eval phase', config: { ...ftmo, phase: 'eval' }, want: 'FTMO 100K (static)' },
    { name: 'appends Funded in the funded phase', config: fundedConfig(topstep), want: 'TopStep 50K (EOD trail) · Funded' },
  ]
  for (const tc of cases) {
    it(tc.name, () => {
      expect(evalAccountName(tc.config)).toBe(tc.want)
    })
  }
})

describe('shortEvalAccountHash', () => {
  it('returns a stable compact code for an account id', () => {
    const accountId = 'eval-NQ-1705276800-11111111-2222-4333-8444-555555555555'
    const code = shortEvalAccountHash(accountId)

    expect(code).toMatch(/^[A-Z0-9]{6}$/)
    expect(shortEvalAccountHash(accountId)).toBe(code)
  })

  it('distinguishes different account ids', () => {
    expect(shortEvalAccountHash('eval-account-one')).not.toBe(shortEvalAccountHash('eval-account-two'))
  })
})

describe('eval history storage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('roundtrips a logged attempt', () => {
    const attempt = makeAttempt()
    logEvalAttempt(attempt)
    expect(loadEvalHistory()).toEqual([attempt])
  })

  it('prepends newest attempts first', () => {
    const older = makeAttempt({ instrument: 'ES' })
    const newer = makeAttempt({ instrument: 'NQ' })
    logEvalAttempt(older)
    logEvalAttempt(newer)
    expect(loadEvalHistory().map((a) => a.instrument)).toEqual(['NQ', 'ES'])
  })

  it('caps the history at 100 entries', () => {
    for (let i = 0; i < 105; i++) logEvalAttempt(makeAttempt({ instrument: `a${i}` }))
    const history = loadEvalHistory()
    expect(history).toHaveLength(100)
    expect(history[0].instrument).toBe('a104')
    expect(history[99].instrument).toBe('a5')
  })

  it('returns an empty list when nothing is stored', () => {
    expect(loadEvalHistory()).toEqual([])
  })

  it('returns an empty list for corrupt JSON', () => {
    localStorage.setItem('replay:eval:history', '{not json')
    expect(loadEvalHistory()).toEqual([])
  })

  it('rejects stored entries that do not match the attempt schema', () => {
    localStorage.setItem('replay:eval:history', JSON.stringify([{ foo: 1 }]))
    expect(loadEvalHistory()).toEqual([])
  })

  it('keeps logEvalAttempt silent when storage throws', () => {
    const seed = makeAttempt({ instrument: 'seed' })
    logEvalAttempt(seed)
    const stored = localStorage.getItem('replay:eval:history')
    vi.stubGlobal('localStorage', {
      getItem: () => stored,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    })
    expect(() => logEvalAttempt(makeAttempt({ instrument: 'lost' }))).not.toThrow()
    vi.unstubAllGlobals()
    expect(loadEvalHistory().map((a) => a.instrument)).toEqual(['seed'])
  })
})
