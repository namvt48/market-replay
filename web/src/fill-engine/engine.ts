import type {
  Bar1m,
  EngineTrade,
  FillEngineState,
  PlaceEntryBracketInput,
  PlaceOrderInput,
  Position,
  TradingConfig,
  WorkingOrder,
} from './types'

export function createFillEngine(config: TradingConfig): FillEngineState {
  return {
    config,
    position: null,
    orders: [],
    trades: [],
    realizedCents: 0,
    unrealizedCents: 0,
    equityCents: config.startingEquityCents,
    lastTs: 0,
    sequence: 0,
  }
}

export function placeOrder(state: FillEngineState, input: PlaceOrderInput): FillEngineState {
  if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > state.config.maxContracts) {
    throw new Error(`Quantity must be between 1 and ${state.config.maxContracts}`)
  }
  if (input.type !== 'market' && !Number.isInteger(input.priceTicks)) {
    throw new Error(`${input.type} orders require a price in ticks`)
  }
  if ((input.role ?? 'entry') === 'entry') {
    const signedQty = (side: PlaceOrderInput['side'], qty: number): number => side === 'buy' ? qty : -qty
    const workingExposure = state.orders.reduce((sum, order) => (
      order.active && order.role === 'entry' ? sum + signedQty(order.side, order.qty) : sum
    ), 0)
    const projectedQty = (state.position?.qty ?? 0) + workingExposure + signedQty(input.side, input.qty)
    if (Math.abs(projectedQty) > state.config.maxContracts) {
      throw new Error(`Position size cannot exceed ${state.config.maxContracts} contracts`)
    }
  }
  const sequence = state.sequence + 1
  const order: WorkingOrder = {
    id: `order-${sequence}`,
    side: input.side,
    type: input.type,
    role: input.role ?? 'entry',
    qty: input.qty,
    priceTicks: input.priceTicks ?? null,
    createdAtTs: state.lastTs,
    ocoGroup: input.ocoGroup ?? null,
    active: input.active ?? true,
    parentId: input.parentId ?? null,
  }
  return { ...state, sequence, orders: [...state.orders, order] }
}

export function cancelOrder(state: FillEngineState, orderId: string): FillEngineState {
  return { ...state, orders: state.orders.filter((order) => order.id !== orderId && order.parentId !== orderId) }
}

export function cancelAllOrders(state: FillEngineState): FillEngineState {
  return state.orders.length === 0 ? state : { ...state, orders: [] }
}

export function amendOrder(state: FillEngineState, orderId: string, priceTicks: number): FillEngineState {
  if (!Number.isInteger(priceTicks)) throw new Error('Order price must be an integer tick value')
  let found = false
  const orders = state.orders.map((order) => {
    if (order.id !== orderId) return order
    if (order.type === 'market') throw new Error('Market orders cannot be amended')
    found = true
    return { ...order, priceTicks }
  })
  if (!found) throw new Error(`Order ${orderId} was not found`)
  return { ...state, orders }
}

export function flattenPosition(state: FillEngineState): FillEngineState {
  if (!state.position) return state
  return placeOrder(state, {
    side: state.position.qty > 0 ? 'sell' : 'buy',
    type: 'market',
    qty: Math.abs(state.position.qty),
  })
}

export function reversePosition(state: FillEngineState): FillEngineState {
  if (!state.position) return state
  return placeOrder(state, {
    side: state.position.qty > 0 ? 'sell' : 'buy',
    type: 'market',
    qty: Math.min(Math.abs(state.position.qty) * 2, state.config.maxContracts),
  })
}

function triggerPrice(order: WorkingOrder, bar: Bar1m, slippage: number): number | null {
  if (order.type === 'market') {
    if (bar.ts <= order.createdAtTs) return null
    return bar.openTicks + (order.side === 'buy' ? slippage : -slippage)
  }
  const price = order.priceTicks
  if (price === null) return null
  if (order.type === 'limit') {
    if (order.side === 'buy' && bar.lowTicks <= price) return Math.min(price, bar.openTicks)
    if (order.side === 'sell' && bar.highTicks >= price) return Math.max(price, bar.openTicks)
    return null
  }
  if (order.side === 'buy' && bar.highTicks >= price) return Math.max(price, bar.openTicks) + slippage
  if (order.side === 'sell' && bar.lowTicks <= price) return Math.min(price, bar.openTicks) - slippage
  return null
}

function updateExcursion(position: Position, bar: Bar1m): Position {
  const long = position.qty > 0
  const favorable = long ? bar.highTicks - position.avgPriceTicks : position.avgPriceTicks - bar.lowTicks
  const adverse = long ? position.avgPriceTicks - bar.lowTicks : bar.highTicks - position.avgPriceTicks
  return { ...position, mfeTicks: Math.max(position.mfeTicks, favorable), maeTicks: Math.max(position.maeTicks, adverse) }
}

function applyFill(state: FillEngineState, order: WorkingOrder, fillTicks: number, bar: Bar1m): FillEngineState {
  const delta = order.side === 'buy' ? order.qty : -order.qty
  const current = state.position
  const feePerSide = state.config.commissionPerSideCents
  let ordersWithoutFill = state.orders.filter((item) => item.id !== order.id && (!order.ocoGroup || item.ocoGroup !== order.ocoGroup))
  if (order.role === 'entry') {
    ordersWithoutFill = ordersWithoutFill.map((item) => item.parentId === order.id ? { ...item, active: true, parentId: null } : item)
  }

  if (!current || Math.sign(current.qty) === Math.sign(delta)) {
    const oldQty = current ? Math.abs(current.qty) : 0
    const newQty = oldQty + Math.abs(delta)
    if (newQty > state.config.maxContracts) {
      return { ...state, orders: ordersWithoutFill }
    }
    const avgPriceTicks = Math.round(((current?.avgPriceTicks ?? 0) * oldQty + fillTicks * Math.abs(delta)) / newQty)
    const contingentStop = state.orders.find((item) => item.parentId === order.id && item.role === 'stopLoss')
    const position: Position = {
      qty: (current?.qty ?? 0) + delta,
      avgPriceTicks,
      entryTs: current?.entryTs ?? bar.ts,
      mfeTicks: current?.mfeTicks ?? 0,
      maeTicks: current?.maeTicks ?? 0,
      initialRiskTicks: current?.initialRiskTicks ?? (contingentStop?.priceTicks === null || contingentStop?.priceTicks === undefined
        ? null
        : Math.abs(fillTicks - contingentStop.priceTicks) || null),
    }
    return { ...state, position, orders: ordersWithoutFill }
  }

  const closeQty = Math.min(Math.abs(current.qty), Math.abs(delta))
  const direction = current.qty > 0 ? 1 : -1
  const feesCents = feePerSide * closeQty * 2
  const realizedCents = (fillTicks - current.avgPriceTicks) * direction * state.config.tickValueCents * closeQty - feesCents
  const sequence = state.sequence + 1
  const trade: EngineTrade = {
    id: `trade-${sequence}`,
    symbol: state.config.symbol,
    side: current.qty > 0 ? 'long' : 'short',
    qty: closeQty,
    entryTs: current.entryTs,
    entryPriceTicks: current.avgPriceTicks,
    exitTs: bar.ts,
    exitPriceTicks: fillTicks,
    realizedCents,
    feesCents,
    mfeTicks: current.mfeTicks,
    maeTicks: current.maeTicks,
    rMultiple: current.initialRiskTicks ? realizedCents / (current.initialRiskTicks * state.config.tickValueCents * closeQty) : null,
  }
  const remainder = current.qty + delta
  const position: Position | null = remainder === 0 ? null : {
    qty: remainder,
    avgPriceTicks: Math.sign(remainder) === Math.sign(current.qty) ? current.avgPriceTicks : fillTicks,
    entryTs: Math.sign(remainder) === Math.sign(current.qty) ? current.entryTs : bar.ts,
    mfeTicks: 0, maeTicks: 0, initialRiskTicks: null,
  }
  if (!position || Math.sign(position.qty) !== Math.sign(current.qty)) {
    ordersWithoutFill = ordersWithoutFill.filter((item) => item.role === 'entry')
  }
  return {
    ...state,
    sequence,
    position,
    orders: ordersWithoutFill,
    trades: [...state.trades, trade],
    realizedCents: state.realizedCents + realizedCents,
  }
}

// Stop losses fill before anything else within a bar; ties break on id.
// Order ids are ASCII (`order-<n>`), for which a plain relational compare
// yields the same ordering as localeCompare — and does so without entering
// ICU collation, which showed up as the dominant per-bar cost when replaying
// thousands of bars (step-back replays the whole session).
function compareFillPriority(a: WorkingOrder, b: WorkingOrder): number {
  if (a.role === b.role) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  if (a.role === 'stopLoss') return -1
  if (b.role === 'stopLoss') return 1
  return 0
}

export function stepFillEngine(state: FillEngineState, bar: Bar1m): FillEngineState {
  let next: FillEngineState = { ...state, lastTs: bar.ts }
  if (next.position) next = { ...next, position: updateExcursion(next.position, bar) }

  // The overwhelmingly common case during replay is no working orders at
  // all; copying and sorting an empty (or single-element) array for every
  // one of those bars is pure overhead.
  const candidates = next.orders.length > 1 ? [...next.orders].sort(compareFillPriority) : next.orders
  for (const order of candidates) {
    if (!order.active) continue
    if (!next.orders.some((item) => item.id === order.id)) continue
    const price = triggerPrice(order, bar, next.config.slippageTicks)
    if (price !== null) next = applyFill(next, order, price, bar)
  }

  const unrealizedCents = next.position
    ? (bar.closeTicks - next.position.avgPriceTicks) * Math.sign(next.position.qty) * next.config.tickValueCents * Math.abs(next.position.qty)
    : 0
  return {
    ...next,
    unrealizedCents,
    equityCents: next.config.startingEquityCents + next.realizedCents + unrealizedCents,
  }
}

export function placeBracket(
  state: FillEngineState,
  stopTicks: number,
  targetTicks: number,
): FillEngineState {
  if (!state.position) throw new Error('A position is required before placing a bracket')
  const side = state.position.qty > 0 ? 'sell' : 'buy'
  const qty = Math.abs(state.position.qty)
  const group = `bracket-${state.sequence + 1}`
  const risk = Math.abs(state.position.avgPriceTicks - stopTicks)
  let next: FillEngineState = { ...state, position: { ...state.position, initialRiskTicks: risk || null } }
  next = placeOrder(next, { side, type: 'stop', role: 'stopLoss', qty, priceTicks: stopTicks, ocoGroup: group })
  return placeOrder(next, { side, type: 'limit', role: 'takeProfit', qty, priceTicks: targetTicks, ocoGroup: group })
}

export function placeEntryBracket(state: FillEngineState, input: PlaceEntryBracketInput): FillEngineState {
  const entryInput: PlaceOrderInput = {
    ...input,
    priceTicks: input.type === 'market' ? undefined : input.priceTicks,
  }
  if (input.stopLossTicks === undefined && input.takeProfitTicks === undefined) {
    return placeOrder(state, entryInput)
  }
  const isBuy = input.side === 'buy'
  if (input.stopLossTicks !== undefined && (isBuy ? input.stopLossTicks >= input.priceTicks : input.stopLossTicks <= input.priceTicks)) {
    throw new Error(`Stop loss must be ${isBuy ? 'below' : 'above'} the entry price`)
  }
  if (input.takeProfitTicks !== undefined && (isBuy ? input.takeProfitTicks <= input.priceTicks : input.takeProfitTicks >= input.priceTicks)) {
    throw new Error(`Take profit must be ${isBuy ? 'above' : 'below'} the entry price`)
  }

  const withEntry = placeOrder(state, entryInput)
  const entry = withEntry.orders.at(-1)
  if (!entry) return withEntry
  const exitSide = isBuy ? 'sell' : 'buy'
  const ocoGroup = `bracket-${entry.id}`
  let next = withEntry
  if (input.stopLossTicks !== undefined) {
    next = placeOrder(next, {
      side: exitSide, type: 'stop', role: 'stopLoss', qty: input.qty,
      priceTicks: input.stopLossTicks, ocoGroup, active: false, parentId: entry.id,
    })
  }
  if (input.takeProfitTicks !== undefined) {
    next = placeOrder(next, {
      side: exitSide, type: 'limit', role: 'takeProfit', qty: input.qty,
      priceTicks: input.takeProfitTicks, ocoGroup, active: false, parentId: entry.id,
    })
  }
  return next
}
