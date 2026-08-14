import { z } from 'zod'
import { fetchWorkspaceSnapshot, putWorkspaceSnapshot } from '../api/client'
import type { ActiveIndicator } from '../api/types'
import { chartWorkspaceStateSchema } from '../chart-workspace/layout-storage'
import type { ChartWorkspaceState } from '../chart-workspace/types'
import type { FillEngineState } from '../fill-engine/types'
import { withTimeout } from '../store/preference-sync'
import { timeframeSchema } from './timeframe'
import type { ChartViewportSync } from './chart-adapter'
import type { SerializedDrawing } from 'lightweight-charts-drawing'

export type SnapshotStepTimeframe = '1m' | '3m' | '5m' | '10m' | '15m' | '30m' | '1h' | '4h'

const STORAGE_KEY = 'market-replay:session-workspace-snapshots:v1'
const MAX_SNAPSHOTS = 20

export type SessionSnapshotOwner =
  | { kind: 'replay'; id: string }
  | { kind: 'eval'; id: string }

export interface SessionWorkspaceSnapshot {
  version: 1
  owner: SessionSnapshotOwner
  reason: 'trade-close' | 'explicit-exit'
  capturedAt: number
  cursorTs: number
  symbol: string
  layout: ChartWorkspaceState
  viewports: Record<string, ChartViewportSync>
  drawings: Record<string, SerializedDrawing[]>
  fills: Record<string, FillEngineState>
  indicators: ActiveIndicator[]
  preferences: {
    speed: number
    stepTimeframe: SnapshotStepTimeframe
    qty: number
    drawingMode: 'analysis' | 'replay'
    keepDrawing: boolean
    drawingsLocked: boolean
    drawingsHidden: boolean
    indicatorsHidden: boolean
  }
}

interface SnapshotStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface ChartWorkspaceSnapshotBridge {
  capture(): ChartWorkspaceState
  restore(state: ChartWorkspaceState): void
}

const finiteNumber = z.number().finite()
const ownerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('replay'), id: z.string().min(1) }),
  z.object({ kind: z.literal('eval'), id: z.string().min(1) }),
])
const protectionAdjustmentSchema = z.object({
  role: z.enum(['stopLoss', 'takeProfit']),
  ts: finiteNumber,
  priceTicks: z.number().int(),
})
const fillSchema = z.object({
  config: z.object({
    symbol: z.string().min(1),
    tickValueCents: finiteNumber,
    commissionPerSideCents: finiteNumber,
    slippageTicks: finiteNumber,
    maxContracts: z.number().int().positive(),
    startingEquityCents: finiteNumber,
  }),
  position: z.object({
    qty: z.number().int(),
    avgPriceTicks: z.number().int(),
    entryTs: finiteNumber,
    mfeTicks: finiteNumber,
    maeTicks: finiteNumber,
    initialRiskTicks: finiteNumber.nullable(),
    initialStopTicks: z.number().int().nullable(),
    initialTakeProfitTicks: z.number().int().nullable(),
    protectionAdjustments: z.array(protectionAdjustmentSchema),
  }).nullable(),
  orders: z.array(z.object({
    id: z.string(),
    side: z.enum(['buy', 'sell']),
    type: z.enum(['market', 'limit', 'stop']),
    role: z.enum(['entry', 'stopLoss', 'takeProfit']),
    qty: z.number().int().positive(),
    priceTicks: z.number().int().nullable(),
    createdAtTs: finiteNumber,
    ocoGroup: z.string().nullable(),
    active: z.boolean(),
    parentId: z.string().nullable(),
  })),
  trades: z.array(z.object({
    id: z.string(),
    symbol: z.string(),
    side: z.enum(['long', 'short']),
    qty: z.number().int().positive(),
    entryTs: finiteNumber,
    entryPriceTicks: z.number().int(),
    exitTs: finiteNumber,
    exitPriceTicks: z.number().int(),
    realizedCents: finiteNumber,
    feesCents: finiteNumber,
    mfeTicks: finiteNumber,
    maeTicks: finiteNumber,
    rMultiple: finiteNumber.nullable(),
    initialStopTicks: z.number().int().nullable(),
    initialTakeProfitTicks: z.number().int().nullable(),
    protectionAdjustments: z.array(protectionAdjustmentSchema),
    exitReason: z.enum(['manual', 'stopLoss', 'takeProfit']),
  })),
  realizedCents: finiteNumber,
  unrealizedCents: finiteNumber,
  equityCents: finiteNumber,
  lastTs: finiteNumber,
  sequence: z.number().int().nonnegative(),
})
const indicatorInputSchema = z.union([
  z.string(),
  finiteNumber,
  z.boolean(),
  z.object({ r: z.number().int(), g: z.number().int(), b: z.number().int(), a: finiteNumber }),
])
const indicatorSchema = z.object({
  id: z.string(),
  scriptId: z.string(),
  name: z.string(),
  visible: z.boolean(),
  inputs: z.record(z.string(), indicatorInputSchema),
})
const drawingSchema = z.custom<SerializedDrawing>((value) => {
  if (!value || typeof value !== 'object') return false
  const drawing = value as Record<string, unknown>
  return typeof drawing.id === 'string'
    && drawing.id.length > 0
    && typeof drawing.type === 'string'
    && Array.isArray(drawing.anchors)
    && Boolean(drawing.style && typeof drawing.style === 'object')
    && Boolean(drawing.options && typeof drawing.options === 'object')
})
const viewportSchema = z.object({
  time: z.object({ from: finiteNumber, to: finiteNumber }),
  logicalSpan: finiteNumber.optional(),
})
const snapshotSchema = z.object({
  version: z.literal(1),
  owner: ownerSchema,
  reason: z.enum(['trade-close', 'explicit-exit']),
  capturedAt: finiteNumber,
  cursorTs: finiteNumber.nonnegative(),
  symbol: z.string().min(1),
  layout: chartWorkspaceStateSchema,
  viewports: z.record(z.string(), viewportSchema),
  drawings: z.record(z.string(), z.array(drawingSchema)),
  fills: z.record(z.string(), fillSchema),
  indicators: z.array(indicatorSchema),
  preferences: z.object({
    speed: finiteNumber.positive(),
    stepTimeframe: timeframeSchema.refine((value): value is SnapshotStepTimeframe => ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '4h'].includes(value)),
    qty: z.number().int().positive(),
    drawingMode: z.enum(['analysis', 'replay']),
    keepDrawing: z.boolean(),
    drawingsLocked: z.boolean(),
    drawingsHidden: z.boolean(),
    indicatorsHidden: z.boolean(),
  }),
})
const envelopeSchema = z.object({
  version: z.literal(1),
  snapshots: z.record(z.string(), snapshotSchema),
})

let workspaceBridge: ChartWorkspaceSnapshotBridge | null = null

function browserStorage(): SnapshotStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function ownerKey(owner: SessionSnapshotOwner): string {
  return `${owner.kind}:${owner.id}`
}

function readEnvelope(storage: SnapshotStorage): z.infer<typeof envelopeSchema> {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return { version: 1, snapshots: {} }
    const parsed = envelopeSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : { version: 1, snapshots: {} }
  } catch {
    return { version: 1, snapshots: {} }
  }
}

export function saveSessionWorkspaceSnapshot(snapshot: SessionWorkspaceSnapshot, storage: SnapshotStorage | null = browserStorage()): boolean {
  if (!storage) return false
  const parsed = snapshotSchema.safeParse(snapshot)
  if (!parsed.success) return false
  const envelope = readEnvelope(storage)
  const snapshots = { ...envelope.snapshots, [ownerKey(parsed.data.owner)]: parsed.data }
  const retained = Object.fromEntries(
    Object.entries(snapshots)
      .sort(([, left], [, right]) => right.capturedAt - left.capturedAt)
      .slice(0, MAX_SNAPSHOTS),
  )
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, snapshots: retained }))
    return true
  } catch {
    return false
  }
}

export function loadSessionWorkspaceSnapshot(owner: SessionSnapshotOwner, storage: SnapshotStorage | null = browserStorage()): SessionWorkspaceSnapshot | null {
  if (!storage) return null
  const snapshot = readEnvelope(storage).snapshots[ownerKey(owner)]
  return snapshot ? structuredClone(snapshot) as SessionWorkspaceSnapshot : null
}

export function registerChartWorkspaceSnapshotBridge(bridge: ChartWorkspaceSnapshotBridge): () => void {
  workspaceBridge = bridge
  return () => {
    if (workspaceBridge === bridge) workspaceBridge = null
  }
}

export function captureChartWorkspaceState(): ChartWorkspaceState | null {
  return workspaceBridge ? structuredClone(workspaceBridge.capture()) : null
}

export function restoreChartWorkspaceState(state: ChartWorkspaceState): boolean {
  if (!workspaceBridge) return false
  workspaceBridge.restore(structuredClone(state))
  return true
}

const FETCH_TIMEOUT_MS = 1_200

function reasonPriority(reason: SessionWorkspaceSnapshot['reason']): number {
  return reason === 'explicit-exit' ? 1 : 0
}

/**
 * Ranks two snapshots the same way the backend's optimistic-concurrency
 * rule does (storage/sqlite/workspace_snapshots.go's
 * compareWorkspaceSnapshotRank): by capturedAt, then by reason priority
 * (explicit-exit outranks trade-close) as a tiebreak at an identical
 * timestamp. Positive means a should win over b.
 */
export function compareSnapshotRank(a: Pick<SessionWorkspaceSnapshot, 'reason' | 'capturedAt'>, b: Pick<SessionWorkspaceSnapshot, 'reason' | 'capturedAt'>): number {
  if (a.capturedAt !== b.capturedAt) return a.capturedAt - b.capturedAt
  return reasonPriority(a.reason) - reasonPriority(b.reason)
}

export interface RemoteWorkspaceSnapshot {
  snapshot: SessionWorkspaceSnapshot
  revision: number
  capturedAt: number
}

/**
 * Fetches the backend's durable snapshot for owner. Bounded and never
 * throws — a slow or unreachable backend, or a payload that fails
 * validation, all fall back to null so the caller keeps its local
 * snapshot, mirroring hydratePreferences/hydrateDrawingTemplates.
 */
export async function fetchRemoteWorkspaceSnapshot(owner: SessionSnapshotOwner): Promise<RemoteWorkspaceSnapshot | null> {
  try {
    const envelope = await withTimeout(fetchWorkspaceSnapshot(owner.kind, owner.id), FETCH_TIMEOUT_MS, 'workspace snapshot fetch timed out')
    if (!envelope) return null
    const parsed = snapshotSchema.safeParse(envelope.snapshot)
    if (!parsed.success) return null
    return { snapshot: parsed.data, revision: envelope.revision, capturedAt: envelope.capturedAt }
  } catch {
    return null
  }
}

/**
 * Fire-and-forget mirror of a local snapshot save to the backend — the
 * local write (saveSessionWorkspaceSnapshot) is already the source of
 * truth for this browser by the time this is called.
 */
export function syncWorkspaceSnapshot(snapshot: SessionWorkspaceSnapshot): void {
  void putWorkspaceSnapshot(snapshot.owner.kind, snapshot.owner.id, snapshot).catch(() => undefined)
}
