import { z } from 'zod'
import type { ActiveIndicator, ClosedTrade, ReplaySession } from '../api/types'
import type { EngineTrade, FillEngineState } from '../fill-engine/types'

const orderSchema = z.object({
  id: z.string(),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit', 'stop']),
  role: z.enum(['entry', 'stopLoss', 'takeProfit']),
  qty: z.number().int().positive(),
  priceTicks: z.number().int().nullable(),
  createdAtTs: z.number(),
  ocoGroup: z.string().nullable(),
  active: z.boolean().default(true),
  parentId: z.string().nullable().default(null),
})

const positionSchema = z.object({
  qty: z.number().int(),
  avgPriceTicks: z.number().int(),
  entryTs: z.number(),
  mfeTicks: z.number(),
  maeTicks: z.number(),
  initialRiskTicks: z.number().nullable(),
  initialStopTicks: z.number().int().nullable().default(null),
  initialTakeProfitTicks: z.number().int().nullable().default(null),
  protectionAdjustments: z.array(z.object({
    role: z.enum(['stopLoss', 'takeProfit']), ts: z.number(), priceTicks: z.number().int(),
  })).default([]),
}).nullable()

const indicatorColorSchema = z.object({
  r: z.number().int().min(0).max(255), g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255), a: z.number().min(0).max(1),
})
const indicatorInputValueSchema = z.union([z.string(), z.number(), z.boolean(), indicatorColorSchema])
const activeIndicatorSchema = z.object({
  id: z.string(), scriptId: z.string(), name: z.string(), visible: z.boolean(),
  inputs: z.record(z.string(), indicatorInputValueSchema),
})

const runtimeSchema = z.object({
  version: z.literal(1),
  fill: z.object({
    position: positionSchema,
    orders: z.array(orderSchema),
    realizedCents: z.number(),
    unrealizedCents: z.number(),
    equityCents: z.number(),
    lastTs: z.number(),
    sequence: z.number().int().nonnegative(),
  }),
  indicators: z.array(activeIndicatorSchema).optional(),
})

/** Stable, compact display id. The canonical UUID remains the API identity. */
export function shortReplaySessionHash(sessionId: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < sessionId.length; index += 1) {
    hash ^= sessionId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6)
}

export function serializeReplayRuntime(fill: FillEngineState, indicators: ActiveIndicator[] = []): Record<string, unknown> {
  return {
    version: 1,
    fill: {
      position: fill.position,
      orders: fill.orders,
      realizedCents: fill.realizedCents,
      unrealizedCents: fill.unrealizedCents,
      equityCents: fill.equityCents,
      lastTs: fill.lastTs,
      sequence: fill.sequence,
    },
    indicators,
  }
}

export function restoreReplayIndicators(session: ReplaySession): ActiveIndicator[] {
  const parsed = runtimeSchema.safeParse(session.config)
  return parsed.success ? parsed.data.indicators ?? [] : []
}

function toEngineTrade(trade: ClosedTrade): EngineTrade {
  return {
    id: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    qty: trade.qty,
    entryTs: trade.entryTs,
    entryPriceTicks: trade.entryPriceTicks,
    exitTs: trade.exitTs,
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
  }
}

export function restoreReplayRuntime(base: FillEngineState, session: ReplaySession, trades: ClosedTrade[]): FillEngineState {
  const parsed = runtimeSchema.safeParse(session.config)
  const journal = trades.map(toEngineTrade)
  if (!parsed.success) {
    const realizedCents = journal.reduce((sum, trade) => sum + trade.realizedCents, 0)
    return {
      ...base,
      trades: journal,
      realizedCents,
      equityCents: session.equityCents || base.config.startingEquityCents + realizedCents,
      sequence: Math.max(base.sequence, journal.length * 2),
    }
  }
  return { ...base, ...parsed.data.fill, trades: journal }
}
