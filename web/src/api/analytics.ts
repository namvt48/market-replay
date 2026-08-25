import { z } from 'zod'
import { fetchApi } from './client'

export const analyticsSourceTypeSchema = z.enum(['session', 'evaluation'])
export type AnalyticsSourceType = z.infer<typeof analyticsSourceTypeSchema>

const nullableString = z.string().nullable()
function arrayOrEmpty<T extends z.ZodType>(schema: T) {
  return z.array(schema).nullable().transform((value) => value ?? [])
}
const sourceIdentitySchema = z.object({
  id: z.string(), type: analyticsSourceTypeSchema, title: z.string(), subtitle: z.string(), status: z.string(),
})

export const analyticsSourceSchema = sourceIdentitySchema.extend({
  tradeCount: z.number().int().nonnegative(), startedAt: nullableString, endedAt: nullableString,
})
export type AnalyticsSource = z.infer<typeof analyticsSourceSchema>

const sourceSummarySchema = sourceIdentitySchema.extend({ initialBalance: z.number().nonnegative() })
const decisionSourceSchema = z.object({
  id: z.string(), type: analyticsSourceTypeSchema, title: z.string(), tradeCount: z.number().int().nonnegative(),
})
const simSourceSchema = z.object({ id: z.string(), type: analyticsSourceTypeSchema, tradeCount: z.number().int().nonnegative() })

const equityPointSchema = z.object({
  tradeIndex: z.number().int().nonnegative(), tradeId: nullableString, closedAt: nullableString,
  cumulativePnl: z.number(), balance: z.number(),
})
const rrPointSchema = z.object({
  tradeIndex: z.number().int().nonnegative(), tradeId: z.string(), closedAt: nullableString, rr: z.number(),
})
const outcomeSchema = z.object({
  total: z.number().int().nonnegative(),
  averageDurationSeconds: z.number().nonnegative(), maxConsecutive: z.number().int().nonnegative(), averageConsecutive: z.number().nonnegative(),
})
const sideStatSchema = z.object({
  trades: z.number().int().nonnegative(), tradePercent: z.number(), wins: z.number().int().nonnegative(), winRate: z.number(),
})
const sessionStatSchema = z.object({
  session: z.string(), totalTrades: z.number().int().nonnegative(), winRate: z.number(), averageRr: z.number(), totalPnl: z.number(),
})
const hourStatSchema = z.object({
  hour: z.number().int().min(0).max(23), profit: z.number(), loss: z.number(), netPnl: z.number(), averageRr: z.number(),
  profitPercent: z.number(), winRate: z.number(), totalTrades: z.number().int().nonnegative(),
})
const dayStatSchema = z.object({
  day: z.string(), profit: z.number(), loss: z.number(), netPnl: z.number(), totalTrades: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(), winRate: z.number(),
})
const monthStatSchema = z.object({
  month: z.string(), monthlyPnl: z.number(), monthlyGainPercent: z.number(), endingBalance: z.number(), totalTrades: z.number().int().nonnegative(),
})
const calendarDaySchema = z.object({
  date: z.string(), trades: z.number().int().nonnegative(), wins: z.number().int().nonnegative(), losses: z.number().int().nonnegative(),
  breakeven: z.number().int().nonnegative(), pnl: z.number(), pnlPercent: z.number(), endingBalance: z.number(),
})

export const analyticsPerformanceSchema = z.object({
  source: sourceSummarySchema,
  overview: z.object({
    totalPnl: z.number(), pnlPercent: z.number(), accountBalance: z.number(), winRate: z.number(),
    totalTrades: z.number().int().nonnegative(), longTrades: z.number().int().nonnegative(), shortTrades: z.number().int().nonnegative(),
    breakevenTrades: z.number().int().nonnegative(),
  }),
  equityCurve: arrayOrEmpty(equityPointSchema),
  riskReward: z.object({
    averageRr: z.number(), maxRr: z.number(), idealAverageRr: z.number(), maxIdealRr: z.number(),
    couldHaveProfitOrBreakeven: z.number().int().nonnegative(), couldHaveMaxIdealRr: z.number(),
    series: z.object({ actual: arrayOrEmpty(rrPointSchema), ideal: arrayOrEmpty(rrPointSchema), missed: arrayOrEmpty(rrPointSchema) }),
    excludedTrades: z.number().int().nonnegative(), missingMarketDataTrades: z.number().int().nonnegative(),
  }),
  expectancy: z.object({
    value: z.number(), averageWin: z.number(), averageLoss: z.number(), profitFactor: z.number().nullable(), profitFactorNote: z.string().optional(),
  }),
  winners: outcomeSchema.extend({ bestWinPercent: z.number(), averageWinPercent: z.number() }),
  losers: outcomeSchema.extend({ worstLossPercent: z.number(), averageLossPercent: z.number() }),
  bySide: z.object({ buy: sideStatSchema, sell: sideStatSchema }),
  bySession: arrayOrEmpty(sessionStatSchema),
  byTime: z.object({ pnl: arrayOrEmpty(hourStatSchema), rr: arrayOrEmpty(hourStatSchema), profitPercent: arrayOrEmpty(hourStatSchema), winRate: arrayOrEmpty(hourStatSchema) }),
  byDay: arrayOrEmpty(dayStatSchema), byMonth: arrayOrEmpty(monthStatSchema), calendar: arrayOrEmpty(calendarDaySchema),
  frequency: z.object({
    byWeekday: arrayOrEmpty(z.object({ day: z.string(), averageTrades: z.number().nonnegative() })),
    byWeek: arrayOrEmpty(z.object({ weekStart: z.string(), weekEnd: z.string(), totalTrades: z.number().int().nonnegative() })),
    byMonth: arrayOrEmpty(z.object({ month: z.string(), totalTrades: z.number().int().nonnegative() })),
    averageTradesPerDay: z.number().nonnegative(), averageTradesPerWeek: z.number().nonnegative(), averageTradesPerMonth: z.number().nonnegative(),
  }),
})
export type AnalyticsPerformance = z.infer<typeof analyticsPerformanceSchema>

const drawdownPointSchema = z.object({
  tradeIndex: z.number().int().nonnegative(), tradeId: nullableString, closedAt: nullableString,
  equity: z.number(), peakEquity: z.number(), drawdownAmount: z.number(), drawdownPercent: z.number(),
})
export const analyticsDrawdownSchema = z.object({
  source: sourceSummarySchema,
  equityDrawdown: z.object({
    points: arrayOrEmpty(drawdownPointSchema), maxDrawdownAmount: z.number(), maxDrawdownPercent: z.number(),
    averageDrawdownAmount: z.number(), averageDrawdownPercent: z.number(), averageRecoveryDays: z.number(),
    drawdownFrequency: z.number().int().nonnegative(), completedEpisodes: z.number().int().nonnegative(), openEpisode: z.boolean(),
  }),
  maximumAdverseExcursion: z.object({
    unit: z.string(), histogram: arrayOrEmpty(z.object({ fromInclusive: z.number(), toExclusive: z.number().nullable(), label: z.string(), count: z.number().int().nonnegative() })),
    winningTrades: z.object({
      averageMaeR: z.number(), minMaeR: z.number(), maxMaeR: z.number(), includedTrades: z.number().int().nonnegative(),
      excludedNoInitialRisk: z.number().int().nonnegative(), missingMarketDataTrades: z.number().int().nonnegative(),
    }),
  }),
})
export type AnalyticsDrawdown = z.infer<typeof analyticsDrawdownSchema>

const confidenceIntervalSchema = z.object({ lower: z.number(), median: z.number(), upper: z.number() })
const sensitivitySchema = z.object({
  method: z.string(), shape: z.enum(['plateau', 'knife-edge']), rangeR: z.number(),
  points: arrayOrEmpty(z.object({ stopDeltaPercent: z.number(), targetDeltaPercent: z.number(), expectancyR: z.number() })),
})
export const analyticsEdgeSchema = z.object({
  source: decisionSourceSchema, calculationVersion: z.string(),
  audit: z.object({
    totalTrades: z.number().int().nonnegative(), eligibleRTrades: z.number().int().nonnegative(), excludedNoRMultiple: z.number().int().nonnegative(),
    eligibleExcursionTrades: z.number().int().nonnegative(), excludedNoInitialRisk: z.number().int().nonnegative(), marketDataCoverageTrades: z.number().int().nonnegative(),
    warnings: arrayOrEmpty(z.string()).optional(),
  }),
  edge: z.object({
    sampleSize: z.number().int().nonnegative(), expectancyR: z.number(), winRate: z.number(), averageWinR: z.number(), averageLossR: z.number(),
    averageRR: z.number().nullable(), breakevenRate: z.number().nullable(), tStatistic: z.number().nullable(), pValue: z.number(),
    verdict: z.enum(['insufficient', 'no-evidence', 'zero-edge', 'edge']),
  }),
  bootstrap: z.object({
    expectancyR: confidenceIntervalSchema, maxDrawdownR: confidenceIntervalSchema, sharpe: confidenceIntervalSchema,
    iterations: z.number().int().positive(), confidence: z.number(), seed: z.number().int(),
  }),
  decomposition: z.object({
    payoffAsymmetry: z.number(), averageMfeR: z.number(), averageMaeR: z.number(), averageRealizedR: z.number(), captureRatio: z.number(),
    timingFlag: z.enum(['balanced', 'exit-leak', 'entry-good', 'entry-risk']), topN: z.number().int().positive(),
    topNConcentrationPercent: z.number(), concentrationFlag: z.enum(['diversified', 'watch', 'concentrated']),
  }),
  walkForward: z.object({
    split: z.number(), inSample: z.object({ trades: z.number().int().nonnegative(), expectancyR: z.number() }),
    outOfSample: z.object({ trades: z.number().int().nonnegative(), expectancyR: z.number() }), expectancyDeltaR: z.number(), retentionRatio: z.number(),
    windows: arrayOrEmpty(z.object({ label: z.string(), startTs: z.number().int().nullable(), endTs: z.number().int().nullable(), trades: z.number().int().nonnegative(), expectancyR: z.number() })),
    parameterSensitivity: sensitivitySchema.nullable(),
  }),
  sizing: z.object({
    method: z.string(), fullKelly: z.number(), fraction: z.number(), fractionalKelly: z.number(), suggestedRiskPerTrade: z.number(), maxRiskCap: z.number(), capped: z.boolean(),
  }).nullable(),
})
export type AnalyticsEdge = z.infer<typeof analyticsEdgeSchema>

const decisionClassificationSchema = z.enum(['goodWin', 'goodLoss', 'badWin', 'badLoss'])
export type DecisionClassification = z.infer<typeof decisionClassificationSchema>
export const analyticsExecutionSchema = z.object({
  source: decisionSourceSchema, calculationVersion: z.string(),
  audit: z.object({
    totalTrades: z.number().int().nonnegative(), eligibleExecutionTrades: z.number().int().nonnegative(), excludedNoInitialRisk: z.number().int().nonnegative(),
    excludedNoCostConfig: z.number().int().nonnegative().optional(), protectionTelemetryTrades: z.number().int().nonnegative(), costModelSource: z.string(),
    marketDataCoverageTrades: z.number().int().nonnegative(), unknownExitReasonTrades: z.number().int().nonnegative().optional(),
  }),
  execution: z.object({
    trades: arrayOrEmpty(z.object({ tradeId: z.string(), realizedR: z.number(), mfeR: z.number(), mfePercentile: z.number(), captureRatio: z.number() })),
    averageMfePercentile: z.number(), averageCaptureRatio: z.number(), grossExpectancyR: z.number(), netExpectancyR: z.number(), netWinRate: z.number(),
    edgeAfterCosts: z.boolean(), averageCostR: z.number(),
    costModel: z.object({ tickValueCents: z.number(), spreadTicks: z.number(), slippageTicks: z.number(), feesIncluded: z.boolean() }),
    mfeHistogram: arrayOrEmpty(z.object({ fromInclusiveR: z.number(), toExclusiveR: z.number().nullable(), count: z.number().int().nonnegative() })),
    exitReasonBreakdown: z.object({ manual: z.number().int().nonnegative(), stopLoss: z.number().int().nonnegative(), takeProfit: z.number().int().nonnegative(), unknown: z.number().int().nonnegative().optional() }),
  }),
  decision: z.object({
    trades: arrayOrEmpty(z.object({ tradeId: z.string(), classification: decisionClassificationSchema, adherenceScore: z.number(), tamperedStop: z.boolean(), tamperedTarget: z.boolean() })),
    matrix: z.object({ goodWin: z.number().int().nonnegative(), goodLoss: z.number().int().nonnegative(), badWin: z.number().int().nonnegative(), badLoss: z.number().int().nonnegative() }),
    planAdherenceScore: z.number(), ruleFollowingDividendR: z.number().nullable(), ruleFollowingDividendCents: z.number().int().nullable(), breakevenTrades: z.number().int().nonnegative(),
  }),
  psychology: z.object({
    tiltScore: z.number(), slTamperingScore: z.number(), sizingConsistency: z.number(), antiStreakScore: z.number(),
    postLossSizeEscalations: z.number().int().nonnegative(), rapidReentriesAfterLoss: z.number().int().nonnegative(),
    profile: z.enum(['composed', 'size-chaser', 'revenge-risk', 'plan-drifter']),
  }),
})
export type AnalyticsExecution = z.infer<typeof analyticsExecutionSchema>

const simAuditSchema = z.object({ noInitialStop: z.number().int().nonnegative(), invalidRisk: z.number().int().nonnegative(), missingMarketData: z.number().int().nonnegative() })
const simEquityPointSchema = z.object({
  tradeIndex: z.number().int().nonnegative(), tradeId: nullableString, closedAt: nullableString, cumulativeR: z.number(), balance: z.number(),
})
const simMetadataSchema = z.object({ intrabarPolicy: z.string() })
export const stopLossSimulationSchema = z.object({
  source: simSourceSchema, includedTrades: z.number().int().nonnegative(), excludedTrades: simAuditSchema,
  scenarios: arrayOrEmpty(z.object({
    reductionPercent: z.number(), winRate: z.number(), stoppedOutTrades: z.number().int().nonnegative(), averageWinR: z.number(), expectancyR: z.number(),
    totalR: z.number(), profit: z.number(), profitFactor: z.number().nullable(), profitFactorNote: z.string().optional(), averageDrawdownR: z.number(), equityCurve: arrayOrEmpty(simEquityPointSchema),
  })),
  bestScenario: z.object({ reductionPercent: z.number(), criterion: z.string() }), metadata: simMetadataSchema,
})
export type StopLossSimulation = z.infer<typeof stopLossSimulationSchema>

export const rrSimulationSchema = z.object({
  source: simSourceSchema, includedTrades: z.number().int().nonnegative(), excludedTrades: simAuditSchema,
  scenarios: arrayOrEmpty(z.object({
    id: z.string(), targetR: z.number().nullable(), label: z.string(), winRate: z.number(), profit: z.number(), profitFactor: z.number().nullable(),
    profitFactorNote: z.string().optional(), averageDrawdownPercent: z.number(), equityCurve: arrayOrEmpty(simEquityPointSchema),
  })),
  bestScenario: z.object({ id: z.string(), criterion: z.string() }), metadata: simMetadataSchema,
})
export type RrSimulation = z.infer<typeof rrSimulationSchema>

export interface MonteCarloRequest {
  simulationCount: number
  tradesPerSimulation: number
  startBalance: number
  averageGain: number
  averageLoss: number
  winRatePercent: number
  seed?: number
}
export const monteCarloSchema = z.object({
  seed: z.number().int().safe(), paths: arrayOrEmpty(z.object({ simulationIndex: z.number().int().nonnegative(), balances: arrayOrEmpty(z.number()) })),
  summary: z.object({
    averageEndingBalance: z.number(), maxEndingBalance: z.number(), minEndingBalance: z.number(), averageProfitFactor: z.number().nullable(),
    averageProfitFactorNote: z.string().optional(), maxConsecutiveWins: z.number().int().nonnegative(), maxConsecutiveLosses: z.number().int().nonnegative(),
    totalWins: z.number().int().nonnegative(), totalLosses: z.number().int().nonnegative(),
  }),
  inputs: z.object({ simulationCount: z.number().int(), tradesPerSimulation: z.number().int(), startBalance: z.number(), averageGain: z.number(), averageLoss: z.number(), winRatePercent: z.number() }),
})
export type MonteCarloSimulation = z.infer<typeof monteCarloSchema>

async function parseJson<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetchApi(path, init)
  return schema.parse(await response.json())
}

function sourceQuery(sourceType: AnalyticsSourceType, sourceId: string): URLSearchParams {
  return new URLSearchParams({ sourceType, sourceId })
}

export async function fetchAnalyticsSources(signal?: AbortSignal): Promise<AnalyticsSource[]> {
  const schema = z.object({ items: arrayOrEmpty(analyticsSourceSchema) })
  return (await parseJson('/api/v1/analytics/sources', schema, { signal })).items
}

export async function fetchAnalyticsPerformance(sourceType: AnalyticsSourceType, sourceId: string, breakevenThreshold = 0, timezone = 'UTC', signal?: AbortSignal): Promise<AnalyticsPerformance> {
  const query = sourceQuery(sourceType, sourceId)
  query.set('breakevenThreshold', String(breakevenThreshold))
  query.set('timezone', timezone)
  return parseJson(`/api/v1/analytics/performance?${query}`, analyticsPerformanceSchema, { signal })
}

export async function fetchAnalyticsDrawdown(sourceType: AnalyticsSourceType, sourceId: string, signal?: AbortSignal): Promise<AnalyticsDrawdown> {
  return parseJson(`/api/v1/analytics/drawdown?${sourceQuery(sourceType, sourceId)}`, analyticsDrawdownSchema, { signal })
}

export async function fetchAnalyticsEdge(sourceType: AnalyticsSourceType, sourceId: string, signal?: AbortSignal): Promise<AnalyticsEdge> {
  return parseJson(`/api/v1/analytics/edge?${sourceQuery(sourceType, sourceId)}`, analyticsEdgeSchema, { signal })
}

export async function fetchAnalyticsExecution(sourceType: AnalyticsSourceType, sourceId: string, signal?: AbortSignal): Promise<AnalyticsExecution> {
  return parseJson(`/api/v1/analytics/execution-discipline?${sourceQuery(sourceType, sourceId)}`, analyticsExecutionSchema, { signal })
}

export async function runStopLossSimulation(sourceType: AnalyticsSourceType, sourceId: string, reductionsPercent: number[], signal?: AbortSignal): Promise<StopLossSimulation> {
  return parseJson('/api/v1/analytics/simulations/stop-loss', stopLossSimulationSchema, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ sourceType, sourceId, reductionsPercent }),
  })
}

export async function runRrSimulation(sourceType: AnalyticsSourceType, sourceId: string, targetsR: number[], signal?: AbortSignal): Promise<RrSimulation> {
  return parseJson('/api/v1/analytics/simulations/risk-reward', rrSimulationSchema, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ sourceType, sourceId, targetsR, includeCurrentModel: true }),
  })
}

export async function runMonteCarloSimulation(request: MonteCarloRequest, signal?: AbortSignal): Promise<MonteCarloSimulation> {
  return parseJson('/api/v1/analytics/simulations/monte-carlo', monteCarloSchema, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify(request),
  })
}
