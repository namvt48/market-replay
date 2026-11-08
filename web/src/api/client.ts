import { localIndicatorCatalog, runLocalIndicator } from '../replay/local-indicator-engine'
import { z } from 'zod'
import { decodeBarFrame, type BarFrame } from './binary-frame'
import type { CalendarEntry, ChartBarTicks, ClosedTrade, EconMeta, EconWeek, EconWeekQuery, IndicatorDescriptor, IndicatorRunResult, IndicatorInputValue, PersistedDrawing, PersistedDrawingTemplate, ReplaySession, SymbolMeta, Timeframe, WorkspaceSnapshotAck, WorkspaceSnapshotEnvelope } from './types'
import { timeframeSchema } from '../replay/timeframe'
import type { MarketSession } from '../replay/market-session'

const rangeSchema = z.object({ from: z.number(), to: z.number() })
const symbolSchema = z.object({
  symbol: z.string(), name: z.string(), kind: z.string(), tickSize: z.number().positive(),
  pointValue: z.number().positive(), currency: z.string(), priceDecimals: z.number().int().nonnegative(),
  sessionTz: z.string(), rollRule: z.string(), commissionPerSide: z.number().nonnegative(),
  defaultSlippageTicks: z.number().int().nonnegative(), ranges: z.record(z.string(), rangeSchema),
})
const sessionSchema = z.object({
  id: z.string(), name: z.string().default(''), symbol: z.string(), tf: timeframeSchema,
  startTs: z.number(), cursorTs: z.number(), equityCents: z.number(),
  status: z.enum(['active', 'paused', 'stopped']),
  kind: z.enum(['replay', 'eval', 'live']),
  config: z.record(z.string(), z.unknown()).nullable(), createdAt: z.number(), updatedAt: z.number(),
  deletedAt: z.number().optional(),
})
const tradeSchema = z.object({
  id: z.string(), sessionId: z.string(), symbol: z.string(), side: z.enum(['long', 'short']),
  qty: z.number().int(), entryTs: z.number(), entryPriceTicks: z.number(), exitTs: z.number(),
  exitPriceTicks: z.number(), realizedCents: z.number(), feesCents: z.number(),
  mfeTicks: z.number(), maeTicks: z.number(), rMultiple: z.number().nullable(), createdAt: z.number(),
  initialStopTicks: z.number().int().nullable().default(null),
  initialTakeProfitTicks: z.number().int().nullable().default(null),
  protectionAdjustments: z.array(z.object({
    role: z.enum(['stopLoss', 'takeProfit']), ts: z.number(), priceTicks: z.number().int(),
  })).default([]),
  exitReason: z.enum(['manual', 'stopLoss', 'takeProfit']).default('manual'),
})
const drawingSchema = z.object({
  id: z.string(), bucket: z.string(), symbol: z.string(), anchorTs: z.number(),
  createdAtCursor: z.number(), createdTf: timeframeSchema,
  payload: z.string(), deleted: z.boolean(), updatedAt: z.number(),
})
// appearance is opaque here (z.unknown()), same treatment as drawingSchema's
// payload — the drawing-templates domain module does the strict parse.
const drawingTemplateSchema = z.object({
  id: z.string(), toolType: z.string(), name: z.string(),
  appearance: z.unknown(), createdAt: z.number(), updatedAt: z.number(),
})
const chartBarSchema = z.object({
  time: z.number(), openTicks: z.number(), highTicks: z.number(), lowTicks: z.number(),
  closeTicks: z.number(), volume: z.number(),
})
const econImportanceSchema = z.enum(['none', 'low', 'medium', 'high'])
const econMetaSchema = z.object({
  available: z.boolean(), count: z.number().int().nonnegative(), firstTs: z.number().int(),
  lastTs: z.number().int(), countries: z.array(z.string()),
})
const econEventViewFields = {
  id: z.string(), ts: z.number().int().positive(), country: z.string(), currency: z.string().optional(),
  title: z.string(), importance: econImportanceSchema, forecast: z.string().optional(), previous: z.string().optional(),
}
const econEventViewSchema = z.discriminatedUnion('released', [
  z.object({ ...econEventViewFields, released: z.literal(false), actual: z.never().optional() }),
  z.object({ ...econEventViewFields, released: z.literal(true), actual: z.string().optional() }),
])
const econWeekSchema = z.object({
  weekStart: z.number().int(), weekEnd: z.number().int(), timeZone: z.string(),
  cursorTs: z.number().int(), events: z.array(econEventViewSchema),
})
const TRANSIENT_GET_RETRY_DELAYS_MS = [150, 450, 900] as const

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError')
}

function waitForRetry(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, delayMs)
    const handleAbort = (): void => {
      window.clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

function isAbortFailure(error: unknown, signal?: AbortSignal | null): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError')
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

async function checkedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const retryDelays = method === 'GET' ? TRANSIENT_GET_RETRY_DELAYS_MS : []
  for (let attempt = 0; ; attempt += 1) {
    let response: Response
    try {
      response = await fetch(input, init)
    } catch (error) {
      if (isAbortFailure(error, init?.signal) || attempt >= retryDelays.length) throw error
      await waitForRetry(retryDelays[attempt], init?.signal)
      continue
    }
    if (response.ok) return response
    if (isTransientStatus(response.status) && attempt < retryDelays.length) {
      await waitForRetry(retryDelays[attempt], init?.signal)
      continue
    }
    const detail = await response.text().catch(() => '')
    throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Shared validated API transport for domain clients that keep their own Zod schemas. */
export async function fetchApi(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return checkedFetch(input, init)
}

export async function fetchSymbols(): Promise<SymbolMeta[]> {
  const response = await checkedFetch('/api/v1/symbols')
  return z.array(symbolSchema).parse(await response.json()) as SymbolMeta[]
}

export async function fetchBarsAt(symbol: string, tf: Timeframe, at: number, before = 1500, after = 5000, signal?: AbortSignal): Promise<BarFrame> {
  const query = new URLSearchParams({ symbol, tf, at: String(at), before: String(before), after: String(after) })
  const response = await checkedFetch(`/api/v1/bars/at?${query}`, { signal })
  return decodeBarFrame(await response.arrayBuffer())
}

export async function fetchChartBarsAt(
  symbol: string,
  tf: Timeframe,
  at: number,
  before: number,
  after: number,
  to: number,
  signal?: AbortSignal,
  marketSession: MarketSession = 'eth',
  indicatorWindow = false,
): Promise<ChartBarTicks[]> {
  const query = new URLSearchParams({
    symbol, tf, at: String(at), before: String(before), after: String(after), to: String(to), session: marketSession,
  })
  if (indicatorWindow) query.set('indicatorWindow', '1')
  const response = await checkedFetch(`/api/v1/chart-bars/at?${query}`, { signal })
  return z.array(chartBarSchema).parse(await response.json()) as ChartBarTicks[]
}

export async function fetchCalendar(symbol: string, tf: Timeframe, from: number, to: number): Promise<CalendarEntry[]> {
  const query = new URLSearchParams({ symbol, tf, from: String(from), to: String(to) })
  const response = await checkedFetch(`/api/v1/calendar?${query}`)
  const schema = z.array(z.object({ date: z.string(), firstTs: z.number(), lastTs: z.number(), bars: z.number().int() }))
  return schema.parse(await response.json())
}

export async function fetchEconMeta(signal?: AbortSignal): Promise<EconMeta> {
  const response = await checkedFetch('/api/v1/econ/meta', { signal })
  return econMetaSchema.parse(await response.json()) as EconMeta
}

export async function fetchEconWeek(query: EconWeekQuery, signal?: AbortSignal): Promise<EconWeek> {
  const params = new URLSearchParams({
    at: String(query.at), cursorTs: String(query.cursorTs), tz: query.timeZone,
  })
  if (query.minImportance) params.set('minImportance', query.minImportance)
  for (const country of query.countries ?? []) params.append('country', country)
  const response = await checkedFetch(`/api/v1/econ/week?${params}`, { signal })
  return econWeekSchema.parse(await response.json()) as EconWeek
}

export async function fetchIndicators(signal?: AbortSignal): Promise<IndicatorDescriptor[]> {
  return localIndicatorCatalog(signal)
}
const indicatorBarsInFlight = new Map<AbortSignal | undefined, Map<string, Promise<ChartBarTicks[]>>>()

function fetchIndicatorBarsAt(symbol: string, tf: Timeframe, at: number, signal?: AbortSignal): Promise<ChartBarTicks[]> {
  let cursors = indicatorBarsInFlight.get(signal)
  if (!cursors) {
    cursors = new Map()
    indicatorBarsInFlight.set(signal, cursors)
  }
  const key = JSON.stringify([symbol, tf, at])
  const cached = cursors.get(key)
  if (cached) return cached
  const pending = fetchChartBarsAt(symbol, tf, at, 1500, 0, at, signal, 'eth', true).finally(() => {
    if (cursors?.get(key) === pending) cursors.delete(key)
    if (cursors?.size === 0) indicatorBarsInFlight.delete(signal)
  })
  cursors.set(key, pending)
  return pending
}


let indicatorSymbols: Promise<SymbolMeta[]> | undefined
export async function runIndicator(
  symbol: string,
  tf: Timeframe,
  script: string,
  at: number,
  inputs: Record<string, IndicatorInputValue>,
  signal?: AbortSignal,
): Promise<IndicatorRunResult> {
  if (signal?.aborted) throw abortError()
  indicatorSymbols ??= fetchSymbols().catch((error: unknown) => {
    indicatorSymbols = undefined
    throw error
  })
  const symbols = await indicatorSymbols
  if (signal?.aborted) throw abortError()
  const meta = symbols.find((item) => item.symbol === symbol)
  if (!meta) throw new Error(`Unknown symbol: ${symbol}`)
  const bars = await fetchIndicatorBarsAt(symbol, tf, at, signal)
  if (signal?.aborted) throw abortError()
  const dailyBars = script === 'ipda-ranges' || script === 'im-duy'
    ? await fetchChartBarsAt(symbol, '1d', at, 62, 0, at, signal)
    : []
  return runLocalIndicator(symbol, tf, script, bars.filter((bar) => bar.time <= at), inputs, meta.tickSize, meta.sessionTz, dailyBars, meta.kind === 'future', signal)
}

export async function fetchWatchlist(): Promise<string[]> {
  const response = await checkedFetch('/api/v1/watchlist')
  return z.array(z.string()).parse(await response.json())
}

export async function putWatchlist(symbols: string[]): Promise<string[]> {
  const response = await checkedFetch('/api/v1/watchlist', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(symbols),
  })
  return z.array(z.string()).parse(await response.json())
}

export async function createSession(
  symbol: string, tf: Timeframe, startTs: number,
  opts?: { kind?: 'replay' | 'eval' | 'live'; initialBalanceCents?: number; name?: string },
): Promise<string> {
  const response = await checkedFetch('/api/v1/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, tf, startTs, config: {}, kind: opts?.kind, initialBalanceCents: opts?.initialBalanceCents, name: opts?.name }),
  })
  return z.object({ id: z.string() }).parse(await response.json()).id
}

export async function fetchSessions(): Promise<ReplaySession[]> {
  const response = await checkedFetch('/api/v1/sessions')
  return z.array(sessionSchema).parse(await response.json()) as ReplaySession[]
}

export async function fetchDeletedSessions(): Promise<ReplaySession[]> {
  const response = await checkedFetch('/api/v1/sessions-deleted')
  return z.array(sessionSchema).parse(await response.json()) as ReplaySession[]
}

export async function restoreSession(id: string): Promise<void> {
  await checkedFetch(`/api/v1/sessions/${encodeURIComponent(id)}/restore`, { method: 'POST' })
}

export async function permanentlyDeleteSession(id: string): Promise<void> {
  await checkedFetch(`/api/v1/sessions/${encodeURIComponent(id)}/permanent`, { method: 'DELETE' })
}

export async function patchSession(id: string, patch: Partial<Pick<ReplaySession, 'name' | 'cursorTs' | 'equityCents' | 'status' | 'config'>>): Promise<void> {
  await checkedFetch(`/api/v1/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  })
}

export async function deleteSession(id: string): Promise<void> {
  await checkedFetch(`/api/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function deleteEmptySessions(): Promise<number> {
  const response = await checkedFetch('/api/v1/sessions?empty=true', { method: 'DELETE' })
  return z.object({ deleted: z.number().int().nonnegative() }).parse(await response.json()).deleted
}

export async function fetchTrades(sessionId: string): Promise<ClosedTrade[]> {
  const response = await checkedFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/trades`)
  return z.array(tradeSchema).parse(await response.json()) as ClosedTrade[]
}

/**
 * Replaces a session's stored journal with `trades` verbatim.
 *
 * Deliberately a whole-journal write rather than a per-trade append: a
 * replay rewind shortens the journal, which an append-only endpoint cannot
 * express — it left rows behind for trades the engine had discarded, so the
 * panel and the database drifted apart permanently. Being idempotent also
 * means the caller needs no "already sent" bookkeeping.
 */
export async function putTrades(sessionId: string, trades: ClosedTrade[]): Promise<ClosedTrade[]> {
  const response = await checkedFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/trades`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trades),
  })
  return z.array(tradeSchema).parse(await response.json()) as ClosedTrade[]
}

const journalImageMetaSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  mime: z.string(),
  size: z.number(),
  caption: z.string(),
  createdAt: z.string(),
})

export interface JournalImageMeta {
  id: string
  sessionId: string
  mime: string
  size: number
  caption: string
  createdAt: string
}

export async function uploadJournalImage(sessionId: string, file: File): Promise<string> {
  const form = new FormData()
  form.append('image', file, file.name)
  const response = await checkedFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/images`, {
    method: 'POST',
    body: form,
  })
  return z.object({ id: z.string() }).parse(await response.json()).id
}

export async function listJournalImages(sessionId: string): Promise<JournalImageMeta[]> {
  const response = await checkedFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/images`)
  return z.array(journalImageMetaSchema).parse(await response.json()) as JournalImageMeta[]
}

export async function deleteJournalImage(id: string): Promise<void> {
  await checkedFetch(`/api/v1/images/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function fetchDrawings(bucket: string, symbol: string, timeframes: Timeframe[], cursorTs?: number): Promise<PersistedDrawing[]> {
  const query = new URLSearchParams({ bucket, symbol })
  for (const tf of timeframes) query.append('createdTf', tf)
  if (cursorTs !== undefined) query.set('cursorTs', String(cursorTs))
  const response = await checkedFetch(`/api/v1/drawings?${query}`)
  return z.array(drawingSchema).parse(await response.json()) as PersistedDrawing[]
}

export async function upsertDrawings(drawings: PersistedDrawing[]): Promise<void> {
  await checkedFetch('/api/v1/drawings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(drawings),
  })
}

export async function fetchDrawingTemplates(): Promise<PersistedDrawingTemplate[]> {
  const response = await checkedFetch('/api/v1/drawing-templates')
  return z.array(drawingTemplateSchema).parse(await response.json()) as PersistedDrawingTemplate[]
}

export async function putDrawingTemplate(template: PersistedDrawingTemplate): Promise<void> {
  await checkedFetch(`/api/v1/drawing-templates/${encodeURIComponent(template.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(template),
  })
}

export async function deleteDrawingTemplateRemote(id: string): Promise<void> {
  await checkedFetch(`/api/v1/drawing-templates/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

function workspaceSnapshotUrl(ownerType: string, ownerId: string): string {
  return `/api/v1/workspace-snapshots/${encodeURIComponent(ownerType)}/${encodeURIComponent(ownerId)}`
}

/** Gzips body via CompressionStream when the runtime supports it; null means "send uncompressed" (older browsers, or a test environment without it). */
async function gzipEncode(body: string): Promise<ArrayBuffer | null> {
  if (typeof CompressionStream === 'undefined') return null
  const stream = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))
  return await new Response(stream).arrayBuffer()
}

/**
 * A 404 here means "no snapshot saved yet for this owner" — an expected,
 * common outcome (first-ever activation), not a failure — so this
 * bypasses checkedFetch's throw-on-any-non-ok behavior and returns null
 * instead.
 */
export async function fetchWorkspaceSnapshot(ownerType: string, ownerId: string): Promise<WorkspaceSnapshotEnvelope | null> {
  const response = await fetch(workspaceSnapshotUrl(ownerType, ownerId))
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return await response.json() as WorkspaceSnapshotEnvelope
}

/**
 * A 409 here means the write was rejected as stale (an older trade-close
 * arriving after a newer explicit-exit) — a meaningful, expected outcome
 * the caller reconciles against, not a transport failure — so, like
 * fetchWorkspaceSnapshot's 404, this bypasses checkedFetch's throw-on-any-
 * non-ok behavior for that one status.
 */
export async function putWorkspaceSnapshot(ownerType: string, ownerId: string, snapshot: unknown): Promise<WorkspaceSnapshotAck> {
  const body = JSON.stringify(snapshot)
  const encoded = await gzipEncode(body)
  const response = await fetch(workspaceSnapshotUrl(ownerType, ownerId), {
    method: 'PUT',
    headers: encoded ? { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } : { 'Content-Type': 'application/json' },
    body: encoded ?? body,
  })
  if (response.status !== 200 && response.status !== 409) {
    const detail = await response.text().catch(() => '')
    throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`)
  }
  const ack = await response.json() as { revision: number; capturedAt: number }
  return { ...ack, conflict: response.status === 409 }
}

export async function deleteWorkspaceSnapshotRemote(ownerType: string, ownerId: string): Promise<void> {
  await checkedFetch(workspaceSnapshotUrl(ownerType, ownerId), { method: 'DELETE' })
}
