import { z } from 'zod'
import { decodeBarFrame, type BarFrame } from './binary-frame'
import type { CalendarEntry, ChartBarTicks, ClosedTrade, EconMeta, EconWeek, EconWeekQuery, IndicatorDescriptor, IndicatorRunResult, IndicatorInputValue, PersistedDrawing, ReplaySession, SymbolMeta, Timeframe } from './types'
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
  id: z.string(), symbol: z.string(), tf: timeframeSchema,
  startTs: z.number(), cursorTs: z.number(), equityCents: z.number(),
  status: z.enum(['active', 'paused', 'stopped']),
  config: z.record(z.string(), z.unknown()).nullable(), createdAt: z.number(), updatedAt: z.number(),
})
const tradeSchema = z.object({
  id: z.string(), sessionId: z.string(), symbol: z.string(), side: z.enum(['long', 'short']),
  qty: z.number().int(), entryTs: z.number(), entryPriceTicks: z.number(), exitTs: z.number(),
  exitPriceTicks: z.number(), realizedCents: z.number(), feesCents: z.number(),
  mfeTicks: z.number(), maeTicks: z.number(), rMultiple: z.number().nullable(), createdAt: z.number(),
})
const drawingSchema = z.object({
  id: z.string(), bucket: z.string(), symbol: z.string(), anchorTs: z.number(),
  createdAtCursor: z.number(), createdTf: timeframeSchema,
  payload: z.string(), deleted: z.boolean(), updatedAt: z.number(),
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
const indicatorColorSchema = z.object({
  r: z.number().int().min(0).max(255), g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255), a: z.number().min(0).max(1),
})
const indicatorInputValueSchema = z.union([z.string(), z.number(), z.boolean(), indicatorColorSchema])
const indicatorInputSchema = z.object({
  kind: z.enum(['session', 'time', 'str', 'float', 'int', 'bool', 'color']),
  key: z.string(), label: z.string(), group: z.string().optional(), tooltip: z.string().optional(),
  default: indicatorInputValueSchema, min: z.number().optional(), max: z.number().optional(),
  step: z.number().optional(), options: z.array(z.string()).optional(),
})
const indicatorDescriptorSchema = z.object({
  id: z.string(), name: z.string(), version: z.number().int(),
  meta: z.object({ onMainPanel: z.boolean(), format: z.string().optional() }),
  inputs: z.array(indicatorInputSchema),
})
const indicatorDrawSchema = z.object({
  id: z.number().int(), kind: z.enum(['ray', 'rectangle', 'vline', 'marker']), label: z.string().optional(),
  t0: z.number(), y0: z.number(), t1: z.number().optional(), y1: z.number().optional(),
  style: z.record(z.string(), z.unknown()),
})
const indicatorPlotSchema = z.object({ key: z.string(), time: z.number(), value: z.number() })
const indicatorRunSchema = z.object({ draws: z.array(indicatorDrawSchema), plots: z.array(indicatorPlotSchema) })

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
): Promise<ChartBarTicks[]> {
  const query = new URLSearchParams({
    symbol, tf, at: String(at), before: String(before), after: String(after), to: String(to), session: marketSession,
  })
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
  const response = await checkedFetch('/api/v1/indicators', { signal })
  return z.array(indicatorDescriptorSchema).parse(await response.json()) as IndicatorDescriptor[]
}

export async function runIndicator(
  symbol: string,
  tf: Timeframe,
  script: string,
  at: number,
  inputs: Record<string, IndicatorInputValue>,
  signal?: AbortSignal,
): Promise<IndicatorRunResult> {
  const query = new URLSearchParams({ symbol, tf, script, at: String(at), before: '1500', after: '0', to: String(at) })
  const response = await checkedFetch(`/api/v1/indicators/run?${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs }), signal,
  })
  return indicatorRunSchema.parse(await response.json()) as IndicatorRunResult
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

export async function createSession(symbol: string, tf: Timeframe, startTs: number): Promise<string> {
  const response = await checkedFetch('/api/v1/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, tf, startTs, config: {} }),
  })
  return z.object({ id: z.string() }).parse(await response.json()).id
}

export async function fetchSessions(): Promise<ReplaySession[]> {
  const response = await checkedFetch('/api/v1/sessions')
  return z.array(sessionSchema).parse(await response.json()) as ReplaySession[]
}

export async function patchSession(id: string, patch: Partial<Pick<ReplaySession, 'cursorTs' | 'equityCents' | 'status' | 'config'>>): Promise<void> {
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
