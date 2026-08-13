import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BarFrame } from '../api/binary-frame'
import type { ClosedTrade, IndicatorRunResult, ReplaySession, SymbolMeta } from '../api/types'
import type { ChartAdapter, ChartCrosshairSync, ChartViewportSync, OrderLine, OrderLineAction, ReplaySelectionState, TradeMarker, ViewportDemand } from './chart-adapter'
import { aggregateRange } from './aggregate'
import { DEFAULT_CHART_PANE_SETTINGS } from './chart-settings-store'
import { HoverBarStore } from './hover-bar-store'
import { ReplayEngine } from './replay-engine'
import { EVAL_PRESETS } from '../eval/rules'
import { getEvalState, loadEvalAccounts, useEvalStore } from '../store/eval-store'
import type { ViewportDataClient } from './viewport-data'

const engineMocks = vi.hoisted(() => ({
  stepCalls: vi.fn(),
  fetchSymbols: vi.fn(),
  fetchBarsAt: vi.fn(),
  fetchCalendar: vi.fn(),
  fetchTrades: vi.fn().mockResolvedValue([]),
  putTrades: vi.fn().mockResolvedValue([]),
  fetchDrawings: vi.fn().mockResolvedValue([]),
  createSession: vi.fn().mockResolvedValue('session-1'),
  patchSession: vi.fn().mockResolvedValue(undefined),
  runIndicator: vi.fn().mockResolvedValue({ draws: [], plots: [] }),
}))
const apiData = vi.hoisted(() => ({
  symbol: { symbol: 'NQ', name: 'Nasdaq', kind: 'future', tickSize: 0.25, pointValue: 20, currency: 'USD', priceDecimals: 2, sessionTz: 'America/New_York', rollRule: '', commissionPerSide: 0, defaultSlippageTicks: 0, ranges: { '1m': { from: 0, to: 300 } } } as SymbolMeta,
  frame: { count: 5, tickNum: 1, tickDen: 4, ts: new Uint32Array([0, 60, 120, 180, 240]), open: new Int32Array([400, 401, 402, 403, 404]), high: new Int32Array([404, 405, 406, 407, 408]), low: new Int32Array([396, 397, 398, 399, 400]), close: new Int32Array([402, 403, 404, 405, 406]), volume: new Uint32Array([10, 10, 10, 10, 10]) } as BarFrame,
}))
const displayBars = Array.from({ length: 5 }, (_, index) => ({
  time: index * 60,
  open: (400 + index) * 0.25,
  high: (404 + index) * 0.25,
  low: (396 + index) * 0.25,
  close: (402 + index) * 0.25,
  volume: 10,
}))

vi.mock('../api/client', () => ({
  fetchSymbols: engineMocks.fetchSymbols, fetchBarsAt: engineMocks.fetchBarsAt,
  fetchCalendar: engineMocks.fetchCalendar,
  fetchSessions: vi.fn().mockResolvedValue([]), fetchTrades: engineMocks.fetchTrades,
  createSession: engineMocks.createSession, fetchDrawings: engineMocks.fetchDrawings,
  patchSession: engineMocks.patchSession, upsertDrawings: vi.fn().mockResolvedValue(undefined), putTrades: engineMocks.putTrades,
  runIndicator: engineMocks.runIndicator,
}))

vi.mock('../fill-engine/engine', async (importOriginal) => {
  const original = await importOriginal<typeof import('../fill-engine/engine')>()
  return {
    ...original,
    stepFillEngine: (state: Parameters<typeof original.stepFillEngine>[0], bar: Parameters<typeof original.stepFillEngine>[1]): ReturnType<typeof original.stepFillEngine> => {
      engineMocks.stepCalls()
      return original.stepFillEngine(state, bar)
    },
  }
})

function adapter(drawings: object[] = []) {
  const init = vi.fn().mockResolvedValue(undefined)
  const setSymbol = vi.fn()
  const pushBars = vi.fn()
  const setHistory = vi.fn()
  const loadDrawings = vi.fn()
  const setTradeMarkers = vi.fn()
  const setEconomicEventMarkers = vi.fn()
  const setIndicators = vi.fn()
  const setTradeConnections = vi.fn()
  const setOrderLines = vi.fn()
  const setDrawingTool = vi.fn()
  const focusTime = vi.fn()
  const visibleRange = vi.fn().mockReturnValue({ from: 0, to: 0 })
  let drawingChanged = (_drawingId?: string): void => undefined
  let viewportDemand = (_demand: ViewportDemand): void => undefined
  let crosshairSync = (_state: ChartCrosshairSync | null): void => undefined
  let viewportSync = (_state: ChartViewportSync): void => undefined
  let replayBarSelect = (_timestamp: number): void => undefined
  let chartOrder = (_side: 'buy' | 'sell', _type: 'limit' | 'stop', _price: number): void => undefined
  let orderAction = (_action: OrderLineAction): void => undefined
  let orderMove = (_id: string, _price: number): void => undefined
  let orderDragStart = (_id: string): void => undefined
  const setReplaySelection = vi.fn()
  const value = {
    init, setSymbol, setHistory, pushBar: vi.fn(), pushBars, truncateTo: vi.fn(), setSpacerTimes: vi.fn(), syncContainerSize: vi.fn(),
    applyAppearance: vi.fn(), setDisplayTimezone: vi.fn(), onHoveredBar: vi.fn(), onViewportDemand: vi.fn((handler: typeof viewportDemand) => { viewportDemand = handler }),
    onCrosshairSync: vi.fn((handler: typeof crosshairSync) => { crosshairSync = handler }), setCrosshairSync: vi.fn(),
    onViewportSync: vi.fn((handler: typeof viewportSync) => { viewportSync = handler }), setViewportSync: vi.fn(),
    setReplaySelection, onReplayBarSelect: vi.fn((handler: typeof replayBarSelect) => { replayBarSelect = handler }), setTradeMarkers, setEconomicEventMarkers, setIndicators, setTradeConnections, setOrderLines,
    onOrderLineMove: vi.fn((handler: typeof orderMove) => { orderMove = handler }),
    onOrderLineDragStart: vi.fn((handler: typeof orderDragStart) => { orderDragStart = handler }),
    onOrderLineAction: vi.fn((handler: typeof orderAction) => { orderAction = handler }),
    onChartOrder: vi.fn((handler: typeof chartOrder) => { chartOrder = handler }), drawingTools: vi.fn().mockReturnValue([]), setDrawingTool, deselectDrawing: vi.fn(),
    deleteSelectedDrawing: vi.fn(), deleteAllDrawings: vi.fn(), updateSelectedDrawing: vi.fn(), setNextDrawingAppearance: vi.fn(),
    copySelectedDrawing: vi.fn().mockReturnValue(null), pasteDrawing: vi.fn(), undoDrawing: vi.fn().mockReturnValue(false), redoDrawing: vi.fn().mockReturnValue(false),
    nudgeSelectedDrawing: vi.fn().mockReturnValue(false), toggleDrawingsVisibility: vi.fn(), setDrawingsHidden: vi.fn(), setAllDrawingsLocked: vi.fn(), setKeepDrawing: vi.fn(), drawingCount: vi.fn().mockReturnValue(drawings.length),
    getDrawings: vi.fn().mockReturnValue(drawings), loadDrawings, onDrawingsChanged: vi.fn((handler: (drawingId?: string) => void) => { drawingChanged = handler }), onDrawingSelection: vi.fn(),
    onDrawingEditRequest: vi.fn(), onDrawingToolChanged: vi.fn(), beginAreaZoom: vi.fn(), resetAreaZoom: vi.fn(), areaZoomState: vi.fn().mockReturnValue({ selecting: false, zoomed: false }), onAreaZoomChanged: vi.fn(), visibleRange, destroy: vi.fn(),
    focusTime, panView: vi.fn(), zoomView: vi.fn(), toggleInvertScale: vi.fn(), togglePriceScaleMode: vi.fn(), takeSnapshot: vi.fn(), resetView: vi.fn(),
  }
  return {
    value: value as ChartAdapter, init, setSymbol, setHistory, pushBars, loadDrawings, setTradeMarkers, setTradeConnections, setIndicators, setOrderLines, setDrawingTool, setReplaySelection, focusTime, visibleRange,
    fireDrawingChanged: (drawingId?: string) => drawingChanged(drawingId),
    fireViewportDemand: (demand: ViewportDemand) => viewportDemand(demand),
    fireCrosshairSync: (state: ChartCrosshairSync | null) => crosshairSync(state),
    fireViewportSync: (state: ChartViewportSync) => viewportSync(state),
    fireReplayBarSelect: (timestamp: number) => replayBarSelect(timestamp),
    fireChartOrder: (side: 'buy' | 'sell', type: 'limit' | 'stop', price: number) => chartOrder(side, type, price),
    fireOrderAction: (action: OrderLineAction) => orderAction(action),
    fireOrderMove: (id: string, price: number) => orderMove(id, price),
    fireOrderDragStart: (id: string) => orderDragStart(id),
  }
}

beforeEach(() => {
  localStorage.clear()
  getEvalState().abandon()
  engineMocks.fetchSymbols.mockReset()
  engineMocks.fetchSymbols.mockResolvedValue([apiData.symbol])
  engineMocks.fetchDrawings.mockReset()
  engineMocks.fetchDrawings.mockResolvedValue([])
  engineMocks.createSession.mockClear()
  engineMocks.patchSession.mockClear()
  engineMocks.putTrades.mockClear()
  engineMocks.fetchTrades.mockReset()
  engineMocks.fetchTrades.mockResolvedValue([])
  engineMocks.fetchBarsAt.mockReset()
  engineMocks.fetchBarsAt.mockResolvedValue(apiData.frame)
  engineMocks.fetchCalendar.mockReset()
  engineMocks.fetchCalendar.mockResolvedValue([{ date: '1970-01-01', firstTs: 0, lastTs: 240, bars: 5 }])
  engineMocks.runIndicator.mockReset()
  engineMocks.runIndicator.mockResolvedValue({ draws: [], plots: [] })
})

describe('ReplayEngine multi-view invariant', () => {
  it('runs an added indicator against every registered chart view', async () => {
    const engine = new ReplayEngine()
    const first = adapter()
    const second = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), first.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    await engine.registerChartView('pane-b', document.createElement('div'), second.value, '5m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    await engine.seek(120)
    engineMocks.runIndicator.mockClear()
    first.setIndicators.mockClear()
    second.setIndicators.mockClear()

    engine.addIndicator({
      id: 'gb69-cbmor', name: 'GB69 CBMOR', version: 1, meta: { onMainPanel: true },
      inputs: [{ kind: 'bool', key: 'show_lines', label: 'Show lines', default: true }],
    })

    await vi.waitFor(() => expect(engineMocks.runIndicator).toHaveBeenCalledTimes(2))
    expect(engineMocks.runIndicator).toHaveBeenCalledWith('NQ', '1m', 'gb69-cbmor', 120, { show_lines: true }, expect.any(AbortSignal))
    expect(engineMocks.runIndicator).toHaveBeenCalledWith('NQ', '5m', 'gb69-cbmor', 120, { show_lines: true }, expect.any(AbortSignal))
    await vi.waitFor(() => expect(first.setIndicators).toHaveBeenLastCalledWith([expect.objectContaining({ indicatorId: 'gb69-cbmor' })]))
    expect(second.setIndicators).toHaveBeenLastCalledWith([expect.objectContaining({ indicatorId: 'gb69-cbmor' })])
    engine.destroy()
  })

  it('clears stale indicator output before rendering the next replay cursor', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    await engine.seek(120)
    engineMocks.runIndicator.mockResolvedValueOnce({
      draws: [{ id: 1, kind: 'ray', label: 'old', t0: 60, y0: 100, style: {} }],
      plots: [],
    })

    engine.addIndicator({
      id: 'cursor-study', name: 'Cursor Study', version: 1, meta: { onMainPanel: true }, inputs: [],
    })
    await vi.waitFor(() => expect(view.setIndicators).toHaveBeenLastCalledWith([
      expect.objectContaining({ indicatorId: 'cursor-study', draws: [expect.objectContaining({ label: 'old' })] }),
    ]))

    let resolveRun: (result: IndicatorRunResult) => void = () => undefined
    engineMocks.runIndicator.mockImplementationOnce(() => new Promise<IndicatorRunResult>((resolve) => { resolveRun = resolve }))
    view.setIndicators.mockClear()

    engine.stepForward()

    await vi.waitFor(() => expect(view.setIndicators).toHaveBeenCalledWith([]))
    expect(view.setIndicators).toHaveBeenCalledTimes(1)
    resolveRun({ draws: [{ id: 2, kind: 'marker', label: 'new', t0: 180, y0: 101, style: {} }], plots: [] })
    await vi.waitFor(() => expect(view.setIndicators).toHaveBeenLastCalledWith([
      expect.objectContaining({ indicatorId: 'cursor-study', draws: [expect.objectContaining({ label: 'new' })] }),
    ]))
    engine.destroy()
  })

  it('surfaces why trading shortcuts cannot place orders before bar replay is active', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    expect(engine.getSnapshot().replayMode).toBe('inactive')

    engine.placeMarket('buy')
    expect(engine.getSnapshot().error).toBe('Start bar replay before placing orders')

    engine.placePendingAtLast('sell', 'limit')
    expect(engine.getSnapshot().error).toBe('Start bar replay before placing orders')
    engine.destroy()
  })

  it('steps the canonical 1-minute replay source by the selected interval', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    engine.beginReplaySelection()
    view.fireReplayBarSelect(0)
    await vi.waitFor(() => expect(engine.getSnapshot().replayMode).toBe('active'))

    expect(engine.getSnapshot()).toMatchObject({ speed: 1, stepTimeframe: '1m', cursorTs: 0 })
    engine.setSpeed(16)
    engine.setStepTimeframe('3m')
    engine.stepForward()
    expect(engine.getSnapshot()).toMatchObject({ speed: 16, stepTimeframe: '3m', cursorTs: 180 })

    engine.stepBack()
    expect(engine.getSnapshot().cursorTs).toBe(0)
    engine.destroy()
  })

  it('keeps drawing-tool ownership on a pane activated before its adapter finishes registering', async () => {
    const engine = new ReplayEngine()
    const first = adapter()
    const intended = adapter()

    engine.activateChartView('pane-b')
    await engine.registerChartView('pane-a', document.createElement('div'), first.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    await engine.registerChartView('pane-b', document.createElement('div'), intended.value, '5m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    first.setDrawingTool.mockClear()
    intended.setDrawingTool.mockClear()

    engine.setDrawingTool('rectangle')

    expect(intended.setDrawingTool).toHaveBeenCalledWith('rectangle')
    expect(first.setDrawingTool).not.toHaveBeenCalled()
    engine.destroy()
  })

  it('rebuilds every pane and restores trading overlays when the shared ETH/RTH session changes', async () => {
    const engine = new ReplayEngine()
    const first = adapter()
    const second = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), first.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    await engine.registerChartView('pane-b', document.createElement('div'), second.value, '5m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    first.setHistory.mockClear()
    second.setHistory.mockClear()
    first.setOrderLines.mockClear()
    second.setOrderLines.mockClear()
    first.setTradeMarkers.mockClear()
    second.setTradeMarkers.mockClear()

    engine.setMarketSession('rth')

    expect(first.setHistory).toHaveBeenLastCalledWith([], { preserveViewport: false, resetView: true })
    expect(second.setHistory).toHaveBeenLastCalledWith([], { preserveViewport: false, resetView: true })
    expect(first.setOrderLines).toHaveBeenCalledOnce()
    expect(second.setOrderLines).toHaveBeenCalledOnce()
    expect(first.setTradeMarkers).toHaveBeenCalledOnce()
    expect(second.setTradeMarkers).toHaveBeenCalledOnce()
    engine.destroy()
  })

  it('boots an evaluation at its selected instrument/time with forward-only replay navigation', async () => {
    getEvalState().startEvaluation(EVAL_PRESETS[0], 'NQ', '1970-01-01', 120, 'America/New_York')
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())

    expect(engine.getSnapshot()).toMatchObject({ symbol: expect.objectContaining({ symbol: 'NQ' }), cursorTs: 120, replayMode: 'active', replayStartTs: 120 })
    engine.stepForward()
    expect(engine.getSnapshot().cursorTs).toBe(180)
    engine.stepBack()
    expect(engine.getSnapshot().cursorTs).toBe(180)
    await engine.seek(60)
    expect(engine.getSnapshot().cursorTs).toBe(180)
    await engine.seek(240)
    expect(engine.getSnapshot().cursorTs).toBe(240)
    engine.beginReplaySelection()
    expect(engine.getSnapshot().replayMode).toBe('active')
    view.fireReplayBarSelect(60)
    expect(engine.getSnapshot()).toMatchObject({ cursorTs: 240, replayMode: 'active', replayStartTs: 120 })
    engine.exitReplay()
    expect(engine.getSnapshot()).toMatchObject({ replayMode: 'active', replayStartTs: 120 })
    engine.destroy()
  })

  it('applies the evaluation contract limit to quantity and open exposure', async () => {
    getEvalState().startEvaluation(EVAL_PRESETS[2], 'NQ', '1970-01-01', 120, 'America/New_York')
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())

    engine.setQty(100)
    expect(engine.getSnapshot().qty).toBe(6)
    expect(engine.getSnapshot().fill?.config.maxContracts).toBe(6)
    engine.placeMarket('buy')
    view.fireOrderAction({ type: 'confirm' })
    engine.stepForward()
    expect(engine.getSnapshot().fill?.position?.qty).toBe(6)

    engine.placeMarket('buy')
    view.fireOrderAction({ type: 'confirm' })
    expect(engine.getSnapshot().error).toBe('Position size cannot exceed 6 contracts')
    expect(engine.getSnapshot().fill?.orders).toEqual([])

    engine.setQty(1)
    engine.placeMarket('sell')
    view.fireOrderAction({ type: 'confirm' })
    expect(engine.getSnapshot().fill?.orders).toHaveLength(1)
    engine.destroy()
  })

  it('blocks evaluation rewinds and re-anchors accounting only on forward reposition', async () => {
    getEvalState().startEvaluation(EVAL_PRESETS[0], 'NQ', '1970-01-01', 120, 'America/New_York')
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    engine.stepForward()
    expect(getEvalState().needsFillRebase).toBe(false)

    engine.stepBack()
    expect(engine.getSnapshot().cursorTs).toBe(180)
    expect(getEvalState().needsFillRebase).toBe(false)

    await engine.seek(240)
    expect(getEvalState().needsFillRebase).toBe(true)
    const snapshot = engine.getSnapshot()
    if (!snapshot.fill) throw new Error('expected fill state at the replay cursor')
    getEvalState().tick({ cursorTs: snapshot.cursorTs, fill: snapshot.fill })
    expect(getEvalState()).toMatchObject({ phase: 'running', needsFillRebase: false, lastCursorTs: snapshot.cursorTs })
    engine.destroy()
  })

  it('projects saved eval trades onto the chart when the replayed fill has none', async () => {
    getEvalState().startEvaluation(EVAL_PRESETS[0], 'NQ', '1970-01-01', 120, 'America/New_York')
    useEvalStore.setState({
      trades: [{
        id: 'eval-trade-1',
        symbol: 'NQ',
        side: 'long',
        qty: 1,
        entryTime: 120,
        entryPriceTicks: 400,
        exitTime: 180,
        exitPriceTicks: 408,
        realizedCents: 4000,
        mfeTicks: 8,
        maeTicks: 0,
      }],
    })
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())

    const lastMarkers = view.setTradeMarkers.mock.calls.at(-1)?.[0] as TradeMarker[] | undefined
    expect(lastMarkers).toEqual([
      { time: 120, price: 100, text: '+1 @ 100.00', color: '#089981', shape: 'arrowUp' },
      { time: 180, price: 102, text: '-1 @ 102.00', color: '#089981', shape: 'circle' },
    ])
    expect(view.setTradeConnections).toHaveBeenLastCalledWith([
      { entryTime: 120, entryPrice: 100, exitTime: 180, exitPrice: 102 },
    ])
    engine.destroy()
  })

  it('moves from bar selection to an active replay marker and can exit cleanly', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    view.setReplaySelection.mockClear()
    expect(engine.getSnapshot()).toMatchObject({ sessionId: null, sessionStatus: null })
    expect(engineMocks.createSession).not.toHaveBeenCalled()
    engine.placeMarket('buy')
    expect(engine.getSnapshot().fill?.orders).toHaveLength(0)

    engine.beginReplaySelection({ createSession: true })
    expect(engine.getSnapshot().replayMode).toBe('selecting')
    expect(view.setReplaySelection).toHaveBeenLastCalledWith({ mode: 'selecting' } satisfies ReplaySelectionState)

    view.fireReplayBarSelect(120)
    await vi.waitFor(() => expect(engine.getSnapshot().replayMode).toBe('active'))
    expect(engine.getSnapshot()).toMatchObject({ cursorTs: 120, replayStartTs: 120, sessionId: 'session-1', sessionStatus: 'active' })
    expect(engineMocks.createSession).toHaveBeenCalledOnce()
    engine.placeMarket('buy')
    view.fireOrderAction({ type: 'confirm' })
    engine.stepForward()
    engine.flatten()
    engine.stepForward()
    expect(engine.getSnapshot().fill?.trades).toHaveLength(1)
    engine.placeMarket('buy')
    expect(engine.getSnapshot().fill?.orders).toHaveLength(0)
    expect(view.setOrderLines).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'ticket-entry', kind: 'market', stage: 'draft' }),
    ])
    expect(view.setReplaySelection).toHaveBeenLastCalledWith({ mode: 'active', timestamp: 120 } satisfies ReplaySelectionState)

    await engine.pauseReplaySession()

    expect(engine.getSnapshot()).toMatchObject({
      cursorTs: 240,
      replayMode: 'inactive',
      replayStartTs: null,
      sessionId: null,
      sessionStatus: null,
    })
    expect(engine.getSnapshot().fill?.orders).toEqual([])
    expect(engine.getSnapshot().fill?.trades).toEqual([])
    expect(view.setReplaySelection).toHaveBeenLastCalledWith({ mode: 'inactive' } satisfies ReplaySelectionState)
    expect(engineMocks.patchSession).toHaveBeenCalledWith('session-1', expect.objectContaining({
      status: 'paused',
      config: expect.objectContaining({ fill: expect.objectContaining({ orders: [] }) }),
    }))
    expect(engineMocks.putTrades).toHaveBeenCalledWith('session-1', [expect.objectContaining({
      sessionId: 'session-1',
      entryTs: 180,
      exitTs: 240,
    })])
    expect(view.setTradeMarkers).toHaveBeenLastCalledWith([])
    expect(view.setTradeConnections).toHaveBeenLastCalledWith([])
    engine.destroy()
  })

  it('saves evaluation data, cancels its orders, and returns the chart to latest on exit', async () => {
    getEvalState().startEvaluation(EVAL_PRESETS[0], 'NQ', '1970-01-01', 120, 'America/New_York')
    const accountId = getEvalState().accountId
    useEvalStore.setState({
      trades: [{ id: 'eval-trade', symbol: 'NQ', side: 'long', qty: 1, entryTime: 120, exitTime: 180, entryPriceTicks: 400, exitPriceTicks: 404, realizedCents: 500 }],
      lastCursorTs: 180,
    })
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    engine.placeMarket('buy')
    view.fireOrderAction({ type: 'confirm' })
    expect(engine.getSnapshot().fill?.orders).toHaveLength(1)

    await engine.exitEvaluation()

    expect(getEvalState().phase).toBe('idle')
    expect(engine.getSnapshot()).toMatchObject({ cursorTs: 240, replayMode: 'inactive', playing: false })
    expect(engine.getSnapshot().fill?.orders).toEqual([])
    expect(engine.getSnapshot().fill?.trades).toEqual([])
    expect(loadEvalAccounts().find((account) => account.accountId === accountId)?.trades).toEqual([
      expect.objectContaining({ id: 'eval-trade', entryTime: 120, exitTime: 180 }),
    ])
    expect(view.setTradeMarkers).toHaveBeenLastCalledWith([])
    expect(view.setTradeConnections).toHaveBeenLastCalledWith([])
    engine.destroy()
  })

  it('keeps ordinary replay temporary while still allowing paper trades', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())

    engine.beginReplaySelection()
    view.fireReplayBarSelect(120)
    await vi.waitFor(() => expect(engine.getSnapshot().replayMode).toBe('active'))

    expect(engine.getSnapshot()).toMatchObject({ sessionId: null, sessionStatus: null })
    expect(engineMocks.createSession).not.toHaveBeenCalled()
    engine.placeMarket('buy')
    view.fireOrderAction({ type: 'confirm' })
    expect(engine.getSnapshot().fill?.orders).toHaveLength(1)
    engine.exitReplay()
    await vi.waitFor(() => expect(engine.getSnapshot()).toMatchObject({ replayMode: 'inactive', cursorTs: 240 }))
    expect(engine.getSnapshot().fill?.orders).toEqual([])
    expect(engineMocks.patchSession).not.toHaveBeenCalled()
    engine.destroy()
  })

  it('opens a market order in the original compact inline ticket', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    engine.beginReplaySelection()
    view.fireReplayBarSelect(120)
    await vi.waitFor(() => expect(engine.getSnapshot().replayMode).toBe('active'))

    engine.placeMarket('buy')

    expect(engine.getSnapshot().fill?.orders).toEqual([])
    expect(view.setOrderLines).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: 'ticket-entry',
        role: 'entry',
        stage: 'draft',
        kind: 'market',
        label: 'Buy Market',
        showControls: true,
        protectionEnabled: { stopLoss: false, takeProfit: false },
      }),
    ])

    view.fireOrderAction({ type: 'quantity', qty: 2 })
    view.fireOrderAction({ type: 'toggle-take-profit' })
    view.fireOrderAction({ type: 'toggle-stop-loss' })
    view.fireOrderMove('ticket-take-profit', 110)
    view.fireOrderMove('ticket-stop-loss', 95)
    view.fireOrderAction({ type: 'confirm' })

    expect(engine.getSnapshot().fill?.orders.map((order) => ({ role: order.role, type: order.type, qty: order.qty, active: order.active }))).toEqual([
      { role: 'entry', type: 'market', qty: 2, active: true },
      { role: 'stopLoss', type: 'stop', qty: 2, active: false },
      { role: 'takeProfit', type: 'limit', qty: 2, active: false },
    ])
    const confirmedLines = (view.setOrderLines.mock.calls.at(-1)?.[0] ?? []) as OrderLine[]
    expect(confirmedLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'stopLoss', editable: true }),
      expect.objectContaining({ role: 'takeProfit', editable: true }),
    ]))
    expect(confirmedLines.some((line) => line.kind === 'market')).toBe(false)

    engine.stepForward()
    expect(engine.getSnapshot().fill?.position?.qty).toBe(2)
    expect(engine.getSnapshot().fill?.orders.every((order) => order.active)).toBe(true)
    engine.destroy()
  })

  it('restores a saved journal and focuses the most recent trade without moving its checkpoint', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    const session: ReplaySession = {
      id: 'saved-session', symbol: 'NQ', tf: '1m', startTs: 0, cursorTs: 240,
      equityCents: 1_000_000, status: 'paused', config: {}, createdAt: 0, updatedAt: 240,
    }
    const trade: ClosedTrade = {
      id: 'trade-1', sessionId: session.id, symbol: 'NQ', side: 'long', qty: 1,
      entryTs: 60, entryPriceTicks: 400, exitTs: 120, exitPriceTicks: 404,
      realizedCents: 500, feesCents: 0, mfeTicks: 8, maeTicks: 2, rMultiple: 2, createdAt: 120,
    }
    engineMocks.fetchTrades.mockResolvedValueOnce([trade])

    await engine.resumeSession(session)

    expect(engine.getSnapshot()).toMatchObject({ cursorTs: 240, sessionId: session.id, sessionStatus: 'active' })
    expect(engine.getSnapshot().fill?.trades).toHaveLength(1)
    expect(view.focusTime).toHaveBeenCalledWith(120)
    engine.destroy()
  })

  it('renders filled executions as signed contracts at their grouped fill prices', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    const session: ReplaySession = {
      id: 'signed-marker-session', symbol: 'NQ', tf: '1m', startTs: 0, cursorTs: 240,
      equityCents: 1_000_000, status: 'paused', config: {}, createdAt: 0, updatedAt: 240,
    }
    const trade: ClosedTrade = {
      id: 'trade-short', sessionId: session.id, symbol: 'NQ', side: 'short', qty: 5,
      entryTs: 60, entryPriceTicks: 115_104, exitTs: 120, exitPriceTicks: 114_349,
      realizedCents: 18_875_000, feesCents: 0, mfeTicks: 755, maeTicks: 0, rMultiple: 2, createdAt: 120,
    }
    const longTrade: ClosedTrade = {
      id: 'trade-long', sessionId: session.id, symbol: 'NQ', side: 'long', qty: 2,
      entryTs: 120, entryPriceTicks: 112_000, exitTs: 180, exitPriceTicks: 112_400,
      realizedCents: 20_000, feesCents: 0, mfeTicks: 400, maeTicks: 0, rMultiple: 2, createdAt: 180,
    }
    engineMocks.fetchTrades.mockResolvedValueOnce([trade, longTrade])

    await engine.resumeSession(session)

    expect(view.setTradeMarkers).toHaveBeenLastCalledWith([
      { time: 60, price: 28_776, text: '-5 @ 28,776.00', color: '#f23645', shape: 'arrowDown' },
      { time: 120, price: 28_587.25, text: '+5 @ 28,587.25', color: '#f23645', shape: 'circle' },
      { time: 120, price: 28_000, text: '+2 @ 28,000.00', color: '#089981', shape: 'arrowUp' },
      { time: 180, price: 28_100, text: '-2 @ 28,100.00', color: '#089981', shape: 'circle' },
    ])
    expect(view.setTradeConnections).toHaveBeenLastCalledWith([
      { entryTime: 60, entryPrice: 28_776, exitTime: 120, exitPrice: 28_587.25 },
      { entryTime: 120, entryPrice: 28_000, exitTime: 180, exitPrice: 28_100 },
    ])
    engine.destroy()
  })

  it('opens a journal without trades on the nearest timestamp in the data calendar', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    const session: ReplaySession = {
      id: 'empty-session', symbol: 'NQ', tf: '1m', startTs: 150, cursorTs: 300,
      equityCents: 1_000_000, status: 'paused', config: {}, createdAt: 150, updatedAt: 300,
    }
    engineMocks.fetchCalendar.mockResolvedValueOnce([
      { date: '1970-01-01', firstTs: 0, lastTs: 120, bars: 3 },
      { date: '1970-01-02', firstTs: 240, lastTs: 240, bars: 1 },
    ])

    await engine.resumeSession(session)

    expect(engine.getSnapshot()).toMatchObject({ cursorTs: 240, sessionId: session.id, sessionStatus: 'active' })
    expect(view.focusTime).toHaveBeenCalledWith(240)
    expect(engineMocks.fetchCalendar).toHaveBeenCalledWith('NQ', '1m', 0, 300)
    engine.destroy()
  })

  it('opens an evaluation without trades on the next available data timestamp', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    getEvalState().createEvaluation(EVAL_PRESETS[0], 'NQ', '1970-01-01', 150, 'America/New_York')
    getEvalState().activateEvaluation()
    engineMocks.fetchCalendar.mockResolvedValueOnce([
      { date: '1970-01-01', firstTs: 0, lastTs: 120, bars: 3 },
      { date: '1970-01-02', firstTs: 240, lastTs: 240, bars: 1 },
    ])

    await engine.syncEvaluationSession()

    expect(engine.getSnapshot()).toMatchObject({ cursorTs: 240, replayMode: 'active', replayStartTs: 150 })
    expect(view.focusTime).toHaveBeenCalledWith(240)
    engine.destroy()
  })

  it('resumes an evaluation at the locked start date from its last exit cursor', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    getEvalState().createEvaluation(EVAL_PRESETS[0], 'NQ', '1970-01-01', 60, 'America/New_York')
    getEvalState().activateEvaluation()
    useEvalStore.setState({ lastCursorTs: 180 })

    await engine.syncEvaluationSession()

    expect(engine.getSnapshot()).toMatchObject({ cursorTs: 180, replayMode: 'active', replayStartTs: 60 })
    engine.stepBack()
    expect(engine.getSnapshot().cursorTs).toBe(180)
    engine.stepForward()
    expect(engine.getSnapshot().cursorTs).toBe(240)
    engine.destroy()
  })

  // Regression: step-back used to call rebuildSimulation(), which built a
  // fresh engine and replayed bars without the user's orders — orders are
  // not derivable from bars. One press of the back button therefore emptied
  // the journal, the position and the equity, while the stored journal kept
  // them, and the two never agreed again.
  it('keeps trades that closed before the bar it steps back to', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    engine.beginReplaySelection({ createSession: true })
    view.fireReplayBarSelect(0)
    await vi.waitFor(() => expect(engine.getSnapshot().replayMode).toBe('active'))

    engine.placeMarket('buy')
    view.fireOrderAction({ type: 'confirm' })
    engine.stepForward()
    expect(engine.getSnapshot().fill?.position).not.toBeNull()
    engine.flatten()
    engine.stepForward()
    expect(engine.getSnapshot().fill?.trades).toHaveLength(1)
    const equityAtExit = engine.getSnapshot().fill?.equityCents

    engine.stepForward()
    expect(engine.getSnapshot().fill?.trades).toHaveLength(1)

    // Back onto the exit bar: the trade is still in the past, so it stays.
    engine.stepBack()
    const afterBack = engine.getSnapshot()
    expect(afterBack.fill?.trades).toHaveLength(1)
    expect(afterBack.stats.trades).toBe(1)
    expect(afterBack.fill?.equityCents).toBe(equityAtExit)
    expect(afterBack.error).toBeNull()
    engine.destroy()
  })

  it('unwinds the journal and tells the backend when it steps back past the exit', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    // Persisting a journal needs a session, so this selection opts in.
    engine.beginReplaySelection({ createSession: true })
    view.fireReplayBarSelect(0)
    await vi.waitFor(() => expect(engine.getSnapshot().replayMode).toBe('active'))

    engine.placeMarket('buy')
    view.fireOrderAction({ type: 'confirm' })
    engine.stepForward()
    engine.flatten()
    engine.stepForward()
    expect(engine.getSnapshot().fill?.trades).toHaveLength(1)
    await vi.waitFor(() => expect(engineMocks.putTrades).toHaveBeenCalledWith('session-1', expect.arrayContaining([expect.objectContaining({ realizedCents: expect.any(Number) })])), { timeout: 3_000 })

    // Rewind to before the fill: the trade has not happened yet, so both the
    // panel and the stored journal must drop it.
    engine.stepBack()
    engine.stepBack()
    expect(engine.getSnapshot().fill?.trades).toHaveLength(0)
    expect(engine.getSnapshot().fill?.position).toBeNull()
    await vi.waitFor(() => expect(engineMocks.putTrades).toHaveBeenLastCalledWith('session-1', []), { timeout: 3_000 })
    engine.destroy()
  })

  it('keeps a chart order as a draft until confirm and creates a contingent bracket', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    engine.beginReplaySelection({ createSession: true })
    view.fireReplayBarSelect(120)
    await vi.waitFor(() => expect(engine.getSnapshot().replayMode).toBe('active'))

    view.fireChartOrder('buy', 'limit', 100)
    expect(engine.getSnapshot().fill?.orders).toEqual([])
    expect(view.setOrderLines).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'ticket-entry', stage: 'draft', label: 'Buy Limit', showControls: true }),
    ]))

    view.fireOrderAction({ type: 'quantity', qty: 2 })
    view.fireOrderAction({ type: 'toggle-take-profit' })
    view.fireOrderAction({ type: 'toggle-stop-loss' })
    view.fireOrderMove('ticket-take-profit', 110)
    view.fireOrderAction({ type: 'confirm' })

    expect(engine.getSnapshot().fill?.orders.map((order) => ({ role: order.role, qty: order.qty, active: order.active }))).toEqual([
      { role: 'entry', qty: 2, active: true },
      { role: 'stopLoss', qty: 2, active: false },
      { role: 'takeProfit', qty: 2, active: false },
    ])
    expect(view.setOrderLines).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ stage: 'working', label: 'Buy Limit' }),
      expect.objectContaining({ stage: 'working', label: 'Take Profit' }),
      expect.objectContaining({ stage: 'working', label: 'Stop Loss' }),
    ]))

    engine.stepForward()
    expect(engine.getSnapshot().fill?.position?.qty).toBe(2)
    expect(engine.getSnapshot().fill?.orders.every((order) => order.active)).toBe(true)
    expect(view.setOrderLines).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'position', stage: 'position', qty: 2, label: expect.stringContaining('USD') }),
      expect.objectContaining({ stage: 'working', label: 'Take Profit' }),
      expect.objectContaining({ stage: 'working', label: 'Stop Loss' }),
    ]))
    engine.destroy()
  })

  it('clears an invalid order notification after 20 seconds', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    engine.beginReplaySelection({ createSession: true })
    view.fireReplayBarSelect(120)
    await vi.waitFor(() => expect(engine.getSnapshot().replayMode).toBe('active'))

    view.fireChartOrder('buy', 'limit', 100)
    view.fireOrderAction({ type: 'toggle-stop-loss' })
    view.fireOrderMove('ticket-stop-loss', 101)
    vi.useFakeTimers()
    try {
      view.fireOrderAction({ type: 'confirm' })
      expect(engine.getSnapshot().error).toBe('Stop loss must be below the entry price')

      vi.advanceTimersByTime(19_999)
      expect(engine.getSnapshot().error).toBe('Stop loss must be below the entry price')
      vi.advanceTimersByTime(1)
      expect(engine.getSnapshot().error).toBeNull()
    } finally {
      engine.destroy()
      vi.useRealTimers()
    }
  })

  it('preserves the manual chart viewport when replay is stepped backward', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    engine.stepForward()
    view.setHistory.mockClear()

    engine.stepBack()

    expect(view.setHistory).toHaveBeenLastCalledWith(expect.any(Array), { preserveViewport: true, resetView: false })
    engine.destroy()
  })

  it('starts replay on the first real raw bar inside a selected display candle', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1d', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    const fetchedFrame: BarFrame = {
      count: 3,
      tickNum: 1,
      tickDen: 4,
      ts: new Uint32Array([900, 1_020, 1_080]),
      open: new Int32Array([400, 401, 402]),
      high: new Int32Array([404, 405, 406]),
      low: new Int32Array([396, 397, 398]),
      close: new Int32Array([402, 403, 404]),
      volume: new Uint32Array([10, 10, 10]),
    }
    engineMocks.fetchBarsAt.mockResolvedValueOnce(fetchedFrame)

    engine.beginReplaySelection({ createSession: true })
    view.fireReplayBarSelect(1_000)

    await vi.waitFor(() => expect(engine.getSnapshot().replayMode).toBe('active'))
    expect(engine.getSnapshot()).toMatchObject({ cursorTs: 1_020, replayStartTs: 1_020 })
    expect(engineMocks.createSession).toHaveBeenLastCalledWith('NQ', '1d', 1_020)
    engine.destroy()
  })

  it('hydrates a sparse large-timeframe startup with one bounded display page', async () => {
    const load = vi.fn<ViewportDataClient['load']>().mockResolvedValue({ bars: displayBars, hasMore: false })
    const engine = new ReplayEngine({ load })
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1d', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())

    expect(load).toHaveBeenCalledWith(expect.objectContaining({
      visibleTimeframe: '1d', pageBars: 240, direction: 'before', maxTs: 0,
    }), expect.any(AbortSignal))
    const history = view.setHistory.mock.calls.at(-1)?.[0] as Array<{ time: number }>
    expect(history).toEqual([expect.objectContaining({ time: 0 })])
    engine.destroy()
  })

  it('changes one pane symbol without rebuilding sibling panes or the replay stream', async () => {
    const es: SymbolMeta = { ...apiData.symbol, symbol: 'ES', name: 'E-mini S&P' }
    engineMocks.fetchSymbols.mockResolvedValueOnce([apiData.symbol, es])
    const load = vi.fn<ViewportDataClient['load']>().mockResolvedValue({ bars: displayBars, hasMore: false })
    const engine = new ReplayEngine({ load })
    const first = adapter()
    const sibling = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), first.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    await engine.registerChartView('pane-b', document.createElement('div'), sibling.value, '5m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    first.setHistory.mockClear()
    sibling.setHistory.mockClear()

    await engine.setChartViewSymbol('pane-a', 'ES')

    expect(first.setSymbol).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ES' }))
    expect(first.setHistory).toHaveBeenCalledOnce()
    expect(sibling.setSymbol).not.toHaveBeenCalled()
    expect(sibling.setHistory).not.toHaveBeenCalled()
    expect(engine.getSnapshot().symbol?.symbol).toBe('NQ')
    engine.destroy()
  })

  it('rewinds and advances an alternate-symbol pane on the shared replay cursor', async () => {
    const es: SymbolMeta = { ...apiData.symbol, symbol: 'ES', name: 'E-mini S&P' }
    engineMocks.fetchSymbols.mockResolvedValueOnce([apiData.symbol, es])
    const load = vi.fn<ViewportDataClient['load']>().mockResolvedValue({ bars: displayBars, hasMore: false })
    const engine = new ReplayEngine({ load })
    const esView = adapter()
    const nqView = adapter()
    await engine.registerChartView('pane-es', document.createElement('div'), esView.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    await engine.registerChartView('pane-nq', document.createElement('div'), nqView.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    await engine.seek(240)
    await engine.setChartViewSymbol('pane-es', 'ES')
    esView.setHistory.mockClear()
    esView.pushBars.mockClear()

    await engine.seek(120)

    const rewoundHistory = esView.setHistory.mock.calls.at(-1)?.[0] as Array<{ time: number }> | undefined
    expect(rewoundHistory?.every((bar) => bar.time <= 120)).toBe(true)
    engine.stepForward()
    expect(esView.pushBars.mock.calls.at(-1)?.[0]).toEqual([expect.objectContaining({ time: 180 })])
    engine.destroy()
  })

  it('routes evaluation trading to the active alternate-symbol pane', async () => {
    const es: SymbolMeta = { ...apiData.symbol, symbol: 'ES', name: 'E-mini S&P' }
    engineMocks.fetchSymbols.mockResolvedValueOnce([apiData.symbol, es])
    getEvalState().startEvaluation(EVAL_PRESETS[0], 'NQ', '1970-01-01', 0, 'America/New_York')
    const load = vi.fn<ViewportDataClient['load']>().mockResolvedValue({ bars: displayBars, hasMore: false })
    const engine = new ReplayEngine({ load })
    const nqView = adapter()
    const esView = adapter()
    await engine.registerChartView('pane-nq', document.createElement('div'), nqView.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    await engine.registerChartView('pane-es', document.createElement('div'), esView.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    expect(engine.getSnapshot().symbols.map((symbol) => symbol.symbol)).toContain('ES')
    await engine.setChartViewSymbol('pane-es', 'ES')
    expect(esView.setSymbol).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: 'ES' }))
    engine.activateChartView('pane-es')
    expect(engine.getSnapshot().activeSymbol?.symbol).toBe('ES')
    expect(engine.getSnapshot().fill?.config.symbol).toBe('ES')

    engine.placeMarket('buy')
    esView.fireOrderAction({ type: 'confirm' })
    engine.stepForward()

    expect(engine.getSnapshot().fill?.config.symbol).toBe('ES')
    expect(engine.getSnapshot().fill?.position?.qty).toBe(1)

    engine.activateChartView('pane-nq')
    expect(engine.getSnapshot().fill?.config.symbol).toBe('NQ')
    expect(engine.getSnapshot().fill?.position).toBeNull()
    engine.placeMarket('buy')
    nqView.fireOrderAction({ type: 'confirm' })
    engine.stepForward()
    expect(engine.getSnapshot().fill?.position?.qty).toBe(1)

    engine.activateChartView('pane-es')
    expect(engine.getSnapshot().fill?.config.symbol).toBe('ES')
    expect(engine.getSnapshot().fill?.position?.qty).toBe(1)
    expect(engine.getSnapshot().evalFill).not.toBeNull()
    engine.destroy()
  })

  it('routes ordinary replay trading to the active alternate-symbol pane', async () => {
    const ym: SymbolMeta = { ...apiData.symbol, symbol: 'YM', name: 'Mini Dow' }
    engineMocks.fetchSymbols.mockResolvedValueOnce([apiData.symbol, ym])
    const load = vi.fn<ViewportDataClient['load']>().mockResolvedValue({ bars: displayBars, hasMore: false })
    const engine = new ReplayEngine({ load })
    const nqView = adapter()
    const ymView = adapter()
    await engine.registerChartView('pane-nq', document.createElement('div'), nqView.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore(), 'NQ')
    await engine.registerChartView('pane-ym', document.createElement('div'), ymView.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore(), 'YM')
    engine.activateChartView('pane-ym')
    engine.beginReplaySelection()
    ymView.fireReplayBarSelect(120)
    await vi.waitFor(() => expect(engine.getSnapshot().replayMode).toBe('active'))
    nqView.setOrderLines.mockClear()
    ymView.setOrderLines.mockClear()

    engine.placeMarket('buy')

    expect(engine.getSnapshot().activeSymbol?.symbol).toBe('YM')
    expect(engine.getSnapshot().fill?.config.symbol).toBe('YM')
    expect(nqView.setOrderLines).toHaveBeenLastCalledWith([])
    expect(ymView.setOrderLines).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'ticket-entry', kind: 'market', stage: 'draft', label: 'Buy Market' }),
    ])
    expect(engine.getSnapshot().fill?.orders).toEqual([])

    ymView.fireOrderAction({ type: 'confirm' })
    expect(engine.getSnapshot().fill?.orders).toEqual([
      expect.objectContaining({ role: 'entry', type: 'market', active: true, priceTicks: null }),
    ])

    engine.stepForward()
    expect(engine.getSnapshot().fill?.position?.qty).toBe(1)
    engine.stepBack()
    expect(engine.getSnapshot().fill?.position).toBeNull()
    expect(engine.getSnapshot().fill?.orders).toHaveLength(1)
    engine.stepForward()
    expect(engine.getSnapshot().fill?.position?.qty).toBe(1)
    engine.activateChartView('pane-nq')
    expect(engine.getSnapshot().fill?.config.symbol).toBe('NQ')
    expect(engine.getSnapshot().fill?.position).toBeNull()
    engine.activateChartView('pane-ym')
    expect(engine.getSnapshot().fill?.config.symbol).toBe('YM')
    expect(engine.getSnapshot().fill?.position?.qty).toBe(1)
    engine.destroy()
  })

  it('coalesces rapid timeframe requests to the latest value without rebuilding the chart shell', async () => {
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    view.init.mockClear()
    view.setHistory.mockClear()
    engineMocks.fetchDrawings.mockClear()

    engine.requestChartViewTimeframe('pane-a', '5m')
    engine.requestChartViewTimeframe('pane-a', '15m')
    engine.requestChartViewTimeframe('pane-a', '1h')

    await vi.waitFor(() => expect(view.setHistory).toHaveBeenCalledTimes(1))
    expect(view.init).not.toHaveBeenCalled()
    expect(engine.getSnapshot().timeframe).toBe('1h')
    expect(engineMocks.fetchDrawings).not.toHaveBeenCalled()
    engine.destroy()
  })

  it('aborts an in-flight timeframe page so an older response cannot overwrite the latest TF', async () => {
    const pending: Array<{
      timeframe: string
      signal: AbortSignal
      resolve: (page: { bars: typeof displayBars; hasMore: boolean }) => void
    }> = []
    const load = vi.fn<ViewportDataClient['load']>().mockResolvedValue({ bars: displayBars, hasMore: false })
    const engine = new ReplayEngine({ load })
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    view.setHistory.mockClear()
    load.mockClear()
    load.mockImplementation((request, signal) => new Promise((resolve) => {
      pending.push({ timeframe: request.visibleTimeframe, signal, resolve })
    }))

    const first = engine.setChartViewTimeframe('pane-a', '5m')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    const second = engine.setChartViewTimeframe('pane-a', '15m')
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    expect(pending[0]?.signal.aborted).toBe(true)
    pending[1]?.resolve({ bars: displayBars, hasMore: false })
    await second
    pending[0]?.resolve({ bars: displayBars, hasMore: false })
    await first

    expect(engine.getSnapshot().timeframe).toBe('15m')
    expect(view.setHistory).toHaveBeenCalledTimes(1)
    engine.destroy()
  })

  it('steps the fill engine once per raw bar while broadcasting to four panes', async () => {
    const engine = new ReplayEngine()
    const adapters = [adapter(), adapter(), adapter(), adapter()]
    for (let index = 0; index < adapters.length; index += 1) {
      await engine.registerChartView(`pane-${index + 1}`, document.createElement('div'), adapters[index].value, `${index + 1}m`, DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    }
    const before = engineMocks.stepCalls.mock.calls.length
    adapters.forEach(({ setTradeMarkers, setOrderLines }) => { setTradeMarkers.mockClear(); setOrderLines.mockClear() })
    engine.stepForward()
    expect(engineMocks.stepCalls.mock.calls.length - before).toBe(1)
    expect(adapters.every(({ pushBars }) => pushBars.mock.calls.length === 1)).toBe(true)
    expect(adapters.every(({ setTradeMarkers, setOrderLines }) => setTradeMarkers.mock.calls.length === 0 && setOrderLines.mock.calls.length === 0)).toBe(true)
    expect(engine.getSnapshot().cursorTs).toBe(60)
    engine.destroy()
  })

  it('wires crosshair and epoch viewport synchronization between registered panes', async () => {
    const engine = new ReplayEngine()
    const source = adapter()
    const target = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), source.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    await engine.registerChartView('pane-b', document.createElement('div'), target.value, '5m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    const viewport = { time: { from: 0, to: 240 } }

    source.fireCrosshairSync({ time: 120, price: 101.25 })
    source.fireViewportSync(viewport)

    expect(target.value.setCrosshairSync).toHaveBeenCalledWith({ time: 0, price: 101.25 })
    expect(target.value.setViewportSync).toHaveBeenCalledWith(viewport)
    expect(source.value.setCrosshairSync).not.toHaveBeenCalled()
    engine.destroy()
  })

  it('gates crosshair and date-range broadcasts independently at the view handlers', async () => {
    const engine = new ReplayEngine()
    const source = adapter()
    const target = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), source.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    await engine.registerChartView('pane-b', document.createElement('div'), target.value, '5m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    const crosshair = { time: 120, price: 101.25 }
    const viewport = { time: { from: 0, to: 240 } }

    engine.setSyncFlags({ crosshair: false, dateRange: false, lockZoom: false })
    source.fireCrosshairSync(crosshair)
    source.fireViewportSync(viewport)
    expect(target.value.setCrosshairSync).not.toHaveBeenCalled()
    expect(target.value.setViewportSync).not.toHaveBeenCalled()

    engine.setSyncFlags({ crosshair: true, dateRange: false, lockZoom: false })
    source.fireCrosshairSync(crosshair)
    source.fireViewportSync(viewport)
    expect(target.value.setCrosshairSync).toHaveBeenCalledOnce()
    expect(target.value.setViewportSync).not.toHaveBeenCalled()

    engine.setSyncFlags({ crosshair: false, dateRange: true, lockZoom: false })
    source.fireCrosshairSync(crosshair)
    source.fireViewportSync(viewport)
    expect(target.value.setCrosshairSync).toHaveBeenCalledOnce()
    expect(target.value.setViewportSync).toHaveBeenCalledOnce()
    expect(target.value.setViewportSync).toHaveBeenLastCalledWith(viewport)

    const lockedViewport = { ...viewport, logicalSpan: 24 }
    engine.setSyncFlags({ crosshair: false, dateRange: true, lockZoom: true })
    source.fireViewportSync(lockedViewport)
    expect(target.value.setViewportSync).toHaveBeenLastCalledWith(lockedViewport)
    engine.destroy()
  })

  it('aligns sibling charts immediately when date-range sync is enabled', async () => {
    const engine = new ReplayEngine()
    const source = adapter()
    const target = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), source.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    await engine.registerChartView('pane-b', document.createElement('div'), target.value, '5m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    source.visibleRange.mockReturnValue({ from: 120, to: 7_320 })

    engine.setSyncFlags({ crosshair: false, dateRange: false, lockZoom: false })
    engine.setSyncFlags({ crosshair: false, dateRange: true, lockZoom: false })

    expect(target.value.setViewportSync).toHaveBeenCalledOnce()
    expect(target.value.setViewportSync).toHaveBeenCalledWith({ time: { from: 120, to: 7_320 } })
    expect(source.value.setViewportSync).not.toHaveBeenCalled()
    engine.destroy()
  })

  it('projects one symbol-level drawing document to every pane across timeframes', async () => {
    const drawing = { id: 'shared-1', type: 'trend-line', anchors: [{ time: 60, price: 100 }], style: {}, options: {} }
    const engine = new ReplayEngine()
    const first = adapter([drawing])
    const second = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), first.value, '5m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    await engine.registerChartView('pane-b', document.createElement('div'), second.value, '15m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    second.loadDrawings.mockClear()
    first.fireDrawingChanged('shared-1')
    expect(second.loadDrawings).toHaveBeenCalledWith([drawing])
    engine.destroy()
  })

  it('restores the in-memory drawing document when a layout remounts a chart', async () => {
    const drawing = { id: 'layout-drawing', type: 'trend-line', anchors: [{ time: 60, price: 100 }], style: {}, options: {} }
    const engine = new ReplayEngine()
    const original = adapter([drawing])
    await engine.registerChartView('pane-a', document.createElement('div'), original.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    original.fireDrawingChanged('layout-drawing')
    const fetchCountBeforeRemount = engineMocks.fetchDrawings.mock.calls.length

    engine.unregisterChartView('pane-a', original.value)
    const restored = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), restored.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())

    expect(restored.loadDrawings).toHaveBeenLastCalledWith([drawing])
    expect(engineMocks.fetchDrawings).toHaveBeenCalledTimes(fetchCountBeforeRemount)
    engine.destroy()
  })

  it('never projects bars beyond the replay cursor across seek, rewind, and restored views', async () => {
    const engine = new ReplayEngine()
    const first = adapter()
    const second = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), first.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    await engine.registerChartView('pane-b', document.createElement('div'), second.value, '5m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())

    const expectHistoriesWithinCursor = (): void => {
      const cursor = engine.getSnapshot().cursorTs
      for (const view of [first, second]) {
        const history = view.setHistory.mock.calls.at(-1)?.[0] as Array<{ time: number }> | undefined
        expect(history?.every((bar) => bar.time <= cursor)).toBe(true)
      }
    }

    expectHistoriesWithinCursor()
    engine.stepForward()
    expect(first.pushBars.mock.calls.at(-1)?.[0].every((bar: { time: number }) => bar.time <= engine.getSnapshot().cursorTs)).toBe(true)
    await engine.seek(180)
    expectHistoriesWithinCursor()
    engine.stepBack()
    expectHistoriesWithinCursor()

    const restored = adapter()
    await engine.registerChartView('pane-restored', document.createElement('div'), restored.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    const restoredHistory = restored.setHistory.mock.calls.at(-1)?.[0] as Array<{ time: number }>
    expect(restoredHistory.every((bar) => bar.time <= engine.getSnapshot().cursorTs)).toBe(true)
    engine.destroy()
  })

  it('filters drawings created after the cursor while in replay mode', async () => {
    const known = { id: 'known', bucket: 'global:NQ', symbol: 'NQ', anchorTs: 0, createdAtCursor: 0, createdTf: '1m', payload: JSON.stringify({ id: 'known', type: 'trend-line', anchors: [], style: {}, options: {} }), deleted: false, updatedAt: 0 }
    const future = { ...known, id: 'future', createdAtCursor: 120, payload: JSON.stringify({ id: 'future', type: 'trend-line', anchors: [], style: {}, options: {} }) }
    engineMocks.fetchDrawings.mockImplementation(async (bucket: string) => bucket.startsWith('global:') ? [known, future] : [])
    const engine = new ReplayEngine()
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())

    expect(view.loadDrawings.mock.calls.at(-1)?.[0].map((drawing: { id: string }) => drawing.id)).toEqual(['known'])
    engine.destroy()
  })

  it('loads a requested viewport page through the BE-ready client without revealing future bars', async () => {
    const load = vi.fn<ViewportDataClient['load']>().mockResolvedValue({ bars: displayBars, hasMore: false })
    const engine = new ReplayEngine({ load })
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    load.mockClear()
    await engine.seek(180)
    view.setHistory.mockClear()

    view.fireViewportDemand({ direction: 'after', anchorTs: 60 })
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(view.setHistory).toHaveBeenCalled())

    const history = view.setHistory.mock.calls.at(-1)?.[0] as Array<{ time: number }>
    expect(history.every((bar) => bar.time <= 180)).toBe(true)
    expect(view.setHistory.mock.calls.at(-1)?.[1]).toEqual({ preserveViewport: true })
    engine.destroy()
  })

  it('does not request after the current forming weekly bucket while idle', async () => {
    const load = vi.fn<ViewportDataClient['load']>().mockResolvedValue({ bars: displayBars, hasMore: false })
    const engine = new ReplayEngine({ load })
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1w', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    load.mockClear()
    const lastBar = engine.getSnapshot().lastBar
    if (!lastBar) throw new Error('expected replay cursor bar')
    const currentBucket = aggregateRange([lastBar], '1w', apiData.symbol, apiData.symbol.tickSize)[0]?.time ?? 0

    view.fireViewportDemand({ direction: 'after', anchorTs: currentBucket })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(load).not.toHaveBeenCalled()
    engine.destroy()
  })

  it('aborts a stale viewport request when pan direction changes', async () => {
    const pending: Array<{ direction: ViewportDemand['direction']; signal: AbortSignal; resolve: (page: { bars: typeof displayBars; hasMore: boolean }) => void }> = []
    const load = vi.fn<ViewportDataClient['load']>().mockResolvedValue({ bars: displayBars, hasMore: false })
    const engine = new ReplayEngine({ load })
    const view = adapter()
    await engine.registerChartView('pane-a', document.createElement('div'), view.value, '1m', DEFAULT_CHART_PANE_SETTINGS, new HoverBarStore())
    load.mockClear()
    load.mockImplementation((request, signal) => new Promise((resolve) => {
      pending.push({ direction: request.direction, signal, resolve })
    }))
    await engine.seek(180)
    view.setHistory.mockClear()

    view.fireViewportDemand({ direction: 'before', anchorTs: 60 })
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    view.fireViewportDemand({ direction: 'after', anchorTs: 60 })
    await vi.waitFor(() => expect(pending).toHaveLength(2))

    expect(pending[0]?.signal.aborted).toBe(true)
    pending[1]?.resolve({ bars: displayBars, hasMore: false })
    await vi.waitFor(() => expect(view.setHistory).toHaveBeenCalledTimes(1))
    pending[0]?.resolve({ bars: displayBars, hasMore: false })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.setHistory).toHaveBeenCalledTimes(1)
    engine.destroy()
  })
})
