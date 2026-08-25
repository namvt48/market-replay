// Shared domain types mirroring the Go server's JSON shapes exactly
// (internal/model on the backend). Field names are camelCase to match
// the server's `json:"..."` tags verbatim — no translation layer needed.

export type Timeframe = `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'M'}`

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

export type EconImportance = 'none' | 'low' | 'medium' | 'high'

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
  name: string
  symbol: string
  tf: Timeframe
  startTs: number
  cursorTs: number
  equityCents: number
  status: 'active' | 'paused' | 'stopped'
  kind: 'replay' | 'eval'
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
  initialStopTicks: number | null
  initialTakeProfitTicks: number | null
  protectionAdjustments: Array<{
    role: 'stopLoss' | 'takeProfit'
    ts: number
    priceTicks: number
  }>
  exitReason: 'manual' | 'stopLoss' | 'takeProfit'
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

export interface PersistedDrawingTemplate {
  id: string
  toolType: string
  name: string
  appearance: unknown
  createdAt: number
  updatedAt: number
}

/** The envelope GET /api/v1/workspace-snapshots/{ownerType}/{ownerId} returns: server-owned concurrency metadata alongside the opaque, verbatim frontend snapshot. */
export interface WorkspaceSnapshotEnvelope {
  revision: number
  capturedAt: number
  snapshot: unknown
}

/** PUT's response: the persisted revision/capturedAt, whichever request actually won the optimistic-concurrency rank check. */
export interface WorkspaceSnapshotAck {
  revision: number
  capturedAt: number
  /** true when this write was rejected as stale — revision/capturedAt then describe the untouched, currently-persisted snapshot instead. */
  conflict: boolean
}

export type IndicatorInputKind = 'session' | 'time' | 'str' | 'float' | 'int' | 'bool' | 'color'

export interface IndicatorColor {
  r: number
  g: number
  b: number
  a: number
}

export type IndicatorInputValue = string | number | boolean | IndicatorColor

export interface IndicatorInputDescriptor {
  kind: IndicatorInputKind
  key: string
  label: string
  group?: string
  tooltip?: string
  default: IndicatorInputValue
  min?: number
  max?: number
  step?: number
  options?: string[]
}

export interface IndicatorDescriptor {
  id: string
  name: string
  version: number
  meta: {
    onMainPanel: boolean
    format?: string
  }
  inputs: IndicatorInputDescriptor[]
}

export interface IndicatorDrawIntent {
  id: number
  kind: 'ray' | 'rectangle' | 'vline' | 'marker'
  label?: string
  t0: number
  y0: number
  t1?: number
  y1?: number
  style: Record<string, unknown>
}

export interface IndicatorPlotPoint {
  key: string
  time: number
  value: number
}

export interface IndicatorRunResult {
  draws: IndicatorDrawIntent[]
  plots: IndicatorPlotPoint[]
}

export interface ActiveIndicator {
  id: string
  scriptId: string
  name: string
  visible: boolean
  inputs: Record<string, IndicatorInputValue>
}
