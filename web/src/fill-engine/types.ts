export interface Bar1m {
  ts: number // epoch seconds
  openTicks: number
  highTicks: number
  lowTicks: number
  closeTicks: number
  volume: number
}

export type OrderSide = 'buy' | 'sell'
export type OrderType = 'market' | 'limit' | 'stop'
export type OrderRole = 'entry' | 'stopLoss' | 'takeProfit'

export interface TradingConfig {
  symbol: string
  tickValueCents: number
  commissionPerSideCents: number
  slippageTicks: number
  maxContracts: number
  startingEquityCents: number
}

export interface WorkingOrder {
  id: string
  side: OrderSide
  type: OrderType
  role: OrderRole
  qty: number
  priceTicks: number | null
  createdAtTs: number
  ocoGroup: string | null
  /** Contingent TP/SL orders stay dormant until their parent entry fills. */
  active: boolean
  parentId: string | null
}

export interface Position {
  qty: number // positive long, negative short
  avgPriceTicks: number
  entryTs: number
  mfeTicks: number
  maeTicks: number
  initialRiskTicks: number | null
}

export interface EngineTrade {
  id: string
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
}

export interface FillEngineState {
  config: TradingConfig
  position: Position | null
  orders: WorkingOrder[]
  trades: EngineTrade[]
  realizedCents: number
  unrealizedCents: number
  equityCents: number
  lastTs: number
  sequence: number
}

export interface PlaceOrderInput {
  side: OrderSide
  type: OrderType
  qty: number
  priceTicks?: number
  role?: OrderRole
  ocoGroup?: string
  active?: boolean
  parentId?: string
}

export interface PlaceEntryBracketInput {
  side: OrderSide
  type: OrderType
  qty: number
  priceTicks: number
  stopLossTicks?: number
  takeProfitTicks?: number
}
