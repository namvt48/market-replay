import { describe, expect, it, vi } from 'vitest'
import type { TradeConnection } from './chart-adapter'
import {
  POSITION_VISUAL_INK,
  POSITION_VISUAL_COLORS,
  TRADE_CONNECTION_DASH,
  TRADE_CONNECTION_STROKE,
  TradeConnectionsPrimitive,
  positionRangeZones,
  protectionSegments,
} from './trade-connections-primitive'

const entry = { entryTime: 60, entryPrice: 100 }

describe('TradeConnectionsPrimitive', () => {
  it('keeps one quiet dashed connector per partial exit from the same entry', () => {
    const primitive = new TradeConnectionsPrimitive()
    const connections: TradeConnection[] = [
      { ...entry, exitTime: 120, exitPrice: 101 },
      { ...entry, exitTime: 180, exitPrice: 103 },
      { ...entry, exitTime: Number.NaN, exitPrice: 104 },
    ]

    primitive.setConnections(connections)

    expect(primitive.connections).toEqual(connections.slice(0, 2))
    expect(TRADE_CONNECTION_STROKE).toBe(POSITION_VISUAL_INK)
    expect(TRADE_CONNECTION_DASH).toEqual([4, 4])
    expect(primitive.paneViews().map((view) => view.zOrder?.())).toEqual(['bottom', 'top'])
  })

  it('uses black ink for every remaining position label and execution line', () => {
    expect(POSITION_VISUAL_INK).toBe('#000000')
    expect({
      trailingLine: POSITION_VISUAL_COLORS.trailingLine,
      actualTargetLine: POSITION_VISUAL_COLORS.actualTargetLine,
      exitLine: POSITION_VISUAL_COLORS.exitLine,
      label: POSITION_VISUAL_COLORS.label,
    }).toEqual({
      trailingLine: POSITION_VISUAL_INK,
      actualTargetLine: POSITION_VISUAL_INK,
      exitLine: POSITION_VISUAL_INK,
      label: POSITION_VISUAL_INK,
    })
  })

  it('keeps original TP/SL zones while turning later protection edits into fitted segments', () => {
    const connection: TradeConnection = {
      ...entry,
      exitTime: 300,
      exitPrice: 106,
      side: 'long',
      initialStop: 95,
      initialTakeProfit: 110,
      exitReason: 'manual',
      protectionAdjustments: [
        { role: 'stopLoss', time: 120, price: 98 },
        { role: 'takeProfit', time: 180, price: 108 },
        { role: 'stopLoss', time: 240, price: 101 },
      ],
    }

    expect(positionRangeZones(connection)).toEqual([
      { role: 'takeProfit', entryPrice: 100, legPrice: 110, fill: POSITION_VISUAL_COLORS.profitFill },
      { role: 'stopLoss', entryPrice: 100, legPrice: 95, fill: POSITION_VISUAL_COLORS.riskFill },
    ])
    expect(protectionSegments(connection)).toEqual([
      { role: 'stopLoss', startTime: 120, endTime: 240, price: 98 },
      { role: 'takeProfit', startTime: 180, endTime: 300, price: 108 },
      { role: 'stopLoss', startTime: 240, endTime: 300, price: 101 },
    ])
  })

  it('renders position zones without initial stop, entry, or target lines and labels', () => {
    const primitive = new TradeConnectionsPrimitive()
    const fillRect = vi.fn()
    const strokeRect = vi.fn()
    const moveTo = vi.fn()
    const lineTo = vi.fn()
    const labels: string[] = []
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect,
      strokeRect,
      setLineDash: vi.fn(),
      beginPath: vi.fn(),
      moveTo,
      lineTo,
      stroke: vi.fn(),
      fillText: vi.fn((label: string) => labels.push(label)),
    }
    const target = {
      useBitmapCoordinateSpace: (draw: (scope: unknown) => void) => draw({
        context,
        horizontalPixelRatio: 1,
        verticalPixelRatio: 1,
        bitmapSize: { width: 800, height: 400 },
      }),
    }

    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: (time: number) => time }) },
      series: { priceToCoordinate: (price: number) => 500 - price * 3 },
      requestUpdate: vi.fn(),
    } as never)
    primitive.setConnections([
      {
        ...entry,
        exitTime: 300,
        exitPrice: 106,
        side: 'long',
        initialStop: 95,
        initialTakeProfit: 110,
      },
      {
        entryTime: 360,
        entryPrice: 100,
        exitTime: 600,
        exitPrice: 94,
        side: 'short',
        initialStop: 105,
        initialTakeProfit: 90,
      },
    ])

    for (const view of primitive.paneViews()) view.renderer()?.draw(target as never)

    expect(fillRect).toHaveBeenCalledTimes(4)
    expect(strokeRect).not.toHaveBeenCalled()
    expect(moveTo).toHaveBeenCalledTimes(4)
    const verticalSegments = moveTo.mock.calls.filter((start, index) => {
      const end = lineTo.mock.calls[index]
      return end !== undefined && start[0] === end[0] && start[1] !== end[1]
    })
    expect(verticalSegments).toEqual([])
    expect(labels).toEqual(expect.arrayContaining([
      'LONG',
      'SHORT',
      'R:R 2.00',
    ]))
    expect(labels).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/^(Entry|Target|Stop) /),
    ]))
  })

  it('expands chart autoscale to keep a visible closed position TP and SL on-screen', () => {
    const primitive = new TradeConnectionsPrimitive()
    primitive.attached({
      chart: {
        timeScale: () => ({
          timeToIndex: (time: number) => time / 60,
        }),
      },
      series: { priceToCoordinate: (price: number) => price },
      requestUpdate: vi.fn(),
    } as never)
    primitive.setConnections([{
      ...entry,
      exitTime: 300,
      exitPrice: 106,
      side: 'long',
      initialStop: 40,
      initialTakeProfit: 160,
    }])

    expect(primitive.autoscaleInfo?.(0 as never, 5 as never)).toEqual({
      priceRange: { minValue: 40, maxValue: 160 },
      margins: { above: 12, below: 12 },
    })
  })

  it('culls off-screen trades before converting time and price coordinates', () => {
    const primitive = new TradeConnectionsPrimitive()
    const timeToCoordinate = vi.fn((time: number) => time - 1_000)
    primitive.attached({
      chart: {
        timeScale: () => ({
          getVisibleRange: () => ({ from: 1_000, to: 2_000 }),
          timeToCoordinate,
          options: () => ({ barSpacing: 7 }),
        }),
      },
      series: { priceToCoordinate: (price: number) => price },
      requestUpdate: vi.fn(),
    } as never)
    primitive.setConnections([
      ...Array.from({ length: 2_000 }, (_, index) => ({
        entryTime: -3_000 + index,
        entryPrice: 100,
        exitTime: -2_999 + index,
        exitPrice: 101,
      })),
      { entryTime: 1_200, entryPrice: 100, exitTime: 1_300, exitPrice: 101 },
      ...Array.from({ length: 2_000 }, (_, index) => ({
        entryTime: 3_000 + index,
        entryPrice: 100,
        exitTime: 3_001 + index,
        exitPrice: 101,
      })),
    ])
    const context = {
      save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
    }
    const target = {
      useBitmapCoordinateSpace: (draw: (scope: unknown) => void) => draw({
        context,
        horizontalPixelRatio: 1,
        verticalPixelRatio: 1,
        bitmapSize: { width: 1_000, height: 500 },
      }),
    }

    for (const view of primitive.paneViews()) view.renderer()?.draw(target as never)

    expect(timeToCoordinate.mock.calls.length).toBeLessThanOrEqual(12)
  })
})
