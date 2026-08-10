// Shared domain types mirroring the Go server's JSON shapes exactly
// (internal/model on the backend). Field names are camelCase to match
// the server's `json:"..."` tags verbatim — no translation layer needed.

export type Timeframe = `${number}${'m' | 'h' | 'd' | 'w' | 'M'}`

export interface SymbolRange {
  from: number
  to: number
}

export interface SymbolMeta {
  symbol: string
  name: string
  kind: string
  tickSize: number
  pointValue: number
  currency: string
  priceDecimals: number
  sessionTz: string
  rollRule: string
  commissionPerSide: number
  defaultSlippageTicks: number
  ranges: Partial<Record<Timeframe, SymbolRange>>
}

export interface CalendarEntry {
  date: string
  firstTs: number
  lastTs: number
  bars: number
}

export type EconImportance = 'low' | 'medium' | 'high'

/** Spoiler-safe economic event returned by /api/v1/econ/week. */
export interface EconEventView {
  id: string
  ts: number
  country: string
  currency?: string
  title: string
  importance: EconImportance
  forecast?: string
  previous?: string
  released: boolean
  actual?: string
}

export interface EconMeta {
  available: boolean
  count: number
  firstTs: number
  lastTs: number
  countries: string[]
}

export interface EconWeek {
  weekStart: number
  weekEnd: number
  timeZone: string
  cursorTs: number
  events: EconEventView[]
}

export interface EconWeekQuery {
  at: number
  cursorTs: number
  timeZone: string
  minImportance?: EconImportance
  countries?: string[]
}

/** JSON shape returned by the display-timeframe chart history endpoint. */
export interface ChartBarTicks {
  time: number
  openTicks: number
  highTicks: number
  lowTicks: number
  closeTicks: number
  volume: number
}

export interface ReplaySession {
  id: string
  symbol: string
  tf: Timeframe
  startTs: number
  cursorTs: number
  equityCents: number
  status: 'active' | 'paused' | 'stopped'
  config: Record<string, unknown> | null
  createdAt: number
  updatedAt: number
}

export interface ClosedTrade {
  id: string
  sessionId: string
  symbol: string
  side: 'long' | 'short'
  qty: number
  entryTs: number
  entryPriceTicks: number
  exitTs: number
  exitPriceTicks: number
  realizedCents: number
  feesCents: number
  mfeTicks: number
  maeTicks: number
  rMultiple: number | null
  createdAt: number
}

export interface PersistedDrawing {
  id: string
  bucket: string
  symbol: string
  anchorTs: number
  createdAtCursor: number
  createdTf: Timeframe
  payload: string
  deleted: boolean
  updatedAt: number
}
