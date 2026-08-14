import type {
  AutoscaleInfo,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  Logical,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import type { TradeConnection } from './chart-adapter'
import { finiteMinMax } from './number-range'

export const POSITION_VISUAL_INK = '#000000'
export const TRADE_CONNECTION_STROKE = POSITION_VISUAL_INK
export const TRADE_CONNECTION_DASH = [4, 4] as const

export const POSITION_VISUAL_COLORS = {
  profitFill: 'rgba(8, 153, 129, 0.22)',
  riskFill: 'rgba(242, 54, 69, 0.18)',
  trailingLine: POSITION_VISUAL_INK,
  actualTargetLine: POSITION_VISUAL_INK,
  exitLine: POSITION_VISUAL_INK,
  label: POSITION_VISUAL_INK,
} as const

export interface PositionRangeZone {
  role: 'takeProfit' | 'stopLoss'
  entryPrice: number
  legPrice: number
  fill: string
}

export interface ProtectionSegment {
  role: 'stopLoss' | 'takeProfit'
  startTime: number
  endTime: number
  price: number
}

interface ConnectionPoint {
  x: number
  y: number
}

interface PositionBounds {
  left: number
  right: number
  top: number
  bottom: number
}

function positionRiskReward(connection: TradeConnection): number | null {
  if (connection.initialStop === null || connection.initialStop === undefined
    || connection.initialTakeProfit === null || connection.initialTakeProfit === undefined) return null
  const risk = Math.abs(connection.entryPrice - connection.initialStop)
  const reward = Math.abs(connection.initialTakeProfit - connection.entryPrice)
  return risk > 0 && Number.isFinite(risk) && Number.isFinite(reward) ? reward / risk : null
}

export function positionRangeZones(connection: TradeConnection): PositionRangeZone[] {
  const zones: PositionRangeZone[] = []
  if (connection.initialTakeProfit !== null && connection.initialTakeProfit !== undefined && Number.isFinite(connection.initialTakeProfit)) {
    zones.push({ role: 'takeProfit', entryPrice: connection.entryPrice, legPrice: connection.initialTakeProfit, fill: POSITION_VISUAL_COLORS.profitFill })
  }
  if (connection.initialStop !== null && connection.initialStop !== undefined && Number.isFinite(connection.initialStop)) {
    zones.push({ role: 'stopLoss', entryPrice: connection.entryPrice, legPrice: connection.initialStop, fill: POSITION_VISUAL_COLORS.riskFill })
  }
  return zones
}

export function protectionSegments(connection: TradeConnection): ProtectionSegment[] {
  const adjustments = (connection.protectionAdjustments ?? [])
    .filter((adjustment) => Number.isFinite(adjustment.time)
      && Number.isFinite(adjustment.price)
      && adjustment.time >= connection.entryTime
      && adjustment.time <= connection.exitTime)
    .sort((left, right) => left.time - right.time)

  return adjustments.map((adjustment, index) => {
    const next = adjustments.slice(index + 1).find((candidate) => candidate.role === adjustment.role)
    return { role: adjustment.role, startTime: adjustment.time, endTime: next?.time ?? connection.exitTime, price: adjustment.price }
  })
}

class PositionZonesPaneView implements IPrimitivePaneView {
  private readonly primitive: TradeConnectionsPrimitive

  constructor(primitive: TradeConnectionsPrimitive) { this.primitive = primitive }
  zOrder(): 'bottom' { return 'bottom' }
  renderer(): IPrimitivePaneRenderer { return new PositionZonesRenderer(this.primitive) }
}

class PositionOverlaysPaneView implements IPrimitivePaneView {
  private readonly primitive: TradeConnectionsPrimitive

  constructor(primitive: TradeConnectionsPrimitive) { this.primitive = primitive }
  zOrder(): 'top' { return 'top' }
  renderer(): IPrimitivePaneRenderer { return new PositionOverlaysRenderer(this.primitive) }
}

class PositionZonesRenderer implements IPrimitivePaneRenderer {
  private readonly primitive: TradeConnectionsPrimitive

  constructor(primitive: TradeConnectionsPrimitive) { this.primitive = primitive }

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    if (this.primitive.connections.length === 0) return
    target.useBitmapCoordinateSpace((scope) => {
      const { context, horizontalPixelRatio: hx, verticalPixelRatio: vy, bitmapSize } = scope
      context.save()
      for (const connection of this.primitive.visibleConnections()) {
        const bounds = this.primitive.horizontalBounds(connection)
        if (!bounds || bounds.right < 0 || bounds.left * hx > bitmapSize.width) continue
        for (const zone of positionRangeZones(connection)) {
          const entryY = this.primitive.coordinate(zone.entryPrice)
          const legY = this.primitive.coordinate(zone.legPrice)
          if (entryY === null || legY === null) continue
          const top = Math.min(entryY, legY)
          const height = Math.max(1, Math.abs(entryY - legY) * vy)
          context.fillStyle = zone.fill
          context.fillRect(bounds.left * hx, top * vy, Math.max(hx, (bounds.right - bounds.left) * hx), height)
        }
      }
      context.restore()
    })
  }
}

class PositionOverlaysRenderer implements IPrimitivePaneRenderer {
  private readonly primitive: TradeConnectionsPrimitive

  constructor(primitive: TradeConnectionsPrimitive) { this.primitive = primitive }

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    if (this.primitive.connections.length === 0) return
    target.useBitmapCoordinateSpace((scope) => {
      const { context, horizontalPixelRatio: hx, verticalPixelRatio: vy, bitmapSize } = scope
      context.save()
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.font = `${12 * hx}px "Roboto Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
      context.textBaseline = 'bottom'

      for (const connection of this.primitive.visibleConnections()) {
        const entry = this.primitive.point(connection.entryTime, connection.entryPrice)
        const exit = this.primitive.point(connection.exitTime, connection.exitPrice)
        const bounds = this.primitive.positionBounds(connection)
        if (!entry || !exit) continue
        const entryX = entry.x * hx
        const exitX = exit.x * hx
        if ((entryX < 0 && exitX < 0) || (entryX > bitmapSize.width && exitX > bitmapSize.width)) continue

        if (bounds) {
          const entryY = this.primitive.coordinate(connection.entryPrice)
          const targetY = connection.initialTakeProfit === null || connection.initialTakeProfit === undefined
            ? null
            : this.primitive.coordinate(connection.initialTakeProfit)

          for (const segment of protectionSegments(connection)) {
            const start = this.primitive.point(segment.startTime, connection.entryPrice)
            const end = this.primitive.point(segment.endTime, connection.entryPrice)
            const coordinate = this.primitive.coordinate(segment.price)
            if (!start || !end || coordinate === null) continue
            const y = Math.max(bounds.top, Math.min(bounds.bottom, coordinate))
            const color = segment.role === 'stopLoss' ? POSITION_VISUAL_COLORS.trailingLine : POSITION_VISUAL_COLORS.actualTargetLine
            context.strokeStyle = color
            context.lineWidth = Math.max(1.25 * hx, 1)
            context.setLineDash(segment.role === 'stopLoss' ? [2 * hx, 2 * hx] : [])
            context.beginPath()
            context.moveTo(start.x * hx, y * vy)
            context.lineTo(end.x * hx, y * vy)
            context.stroke()
            if (Math.abs(end.x - start.x) >= 48) {
              context.fillStyle = color
              context.textAlign = 'left'
              context.fillText(segment.role === 'stopLoss' ? 'TRAIL' : 'TP ACT', (start.x + 4) * hx, (y - 2) * vy)
            }
          }

          const exitY = Math.max(bounds.top, Math.min(bounds.bottom, exit.y))
          const actualLineStart = Math.max(bounds.left, bounds.right - 34)
          context.strokeStyle = POSITION_VISUAL_COLORS.exitLine
          context.lineWidth = Math.max(1.5 * hx, 1)
          context.setLineDash([])
          context.beginPath()
          context.moveTo(actualLineStart * hx, exitY * vy)
          context.lineTo(bounds.right * hx, exitY * vy)
          context.stroke()
          if (bounds.right - bounds.left >= 72) {
            context.fillStyle = POSITION_VISUAL_COLORS.exitLine
            context.textAlign = 'right'
            const exitLabel = connection.exitReason === 'stopLoss' ? 'SL EXIT' : connection.exitReason === 'takeProfit' ? 'TP EXIT' : 'EXIT'
            context.fillText(exitLabel, (bounds.right - 3) * hx, (exitY - 2) * vy)
          }

          this.drawPositionSummary(context, hx, vy, bounds, connection, entryY, targetY)
        }

        // Draw last so the execution path always sits above the position
        // zones and every fitted protection mark.
        context.strokeStyle = TRADE_CONNECTION_STROKE
        context.lineWidth = Math.max(1.25, Math.min(hx, vy))
        context.setLineDash(TRADE_CONNECTION_DASH.map((length) => length * hx))
        context.beginPath()
        context.moveTo(entryX, entry.y * vy)
        context.lineTo(exitX, exit.y * vy)
        context.stroke()
      }
      context.restore()
    })
  }

  private drawPositionSummary(
    context: CanvasRenderingContext2D,
    hx: number,
    vy: number,
    bounds: PositionBounds,
    connection: TradeConnection,
    entryY: number | null,
    targetY: number | null,
  ): void {
    const left = (bounds.left + 7) * hx
    context.setLineDash([])
    context.textAlign = 'left'
    context.fillStyle = POSITION_VISUAL_INK
    if (entryY !== null) context.fillText(connection.side === 'short' ? 'SHORT' : 'LONG', left, (entryY - 5) * vy)

    const ratio = positionRiskReward(connection)
    if (ratio !== null && entryY !== null && targetY !== null && Math.abs(entryY - targetY) >= 22) {
      context.textAlign = 'left'
      context.fillStyle = POSITION_VISUAL_COLORS.label
      context.fillText(`R:R ${ratio.toFixed(2)}`, left, ((entryY + targetY) / 2 + 5) * vy)
    }
  }
}

export class TradeConnectionsPrimitive implements ISeriesPrimitive<Time> {
  connections: readonly TradeConnection[] = []
  private attachedParams: SeriesAttachedParameter<Time> | null = null
  private visibleConnectionCache: readonly TradeConnection[] = []
  private visibleConnectionCacheKey = ''
  private readonly zonePaneView = new PositionZonesPaneView(this)
  private readonly overlayPaneView = new PositionOverlaysPaneView(this)

  attached(params: SeriesAttachedParameter<Time>): void { this.attachedParams = params }
  detached(): void { this.attachedParams = null }
  paneViews(): readonly IPrimitivePaneView[] { return [this.zonePaneView, this.overlayPaneView] }

  autoscaleInfo(startTimePoint: Logical, endTimePoint: Logical): AutoscaleInfo | null {
    const timeScale = this.attachedParams?.chart.timeScale()
    if (!timeScale) return null
    const prices: number[] = []
    for (const connection of this.connections) {
      const entryIndex = timeScale.timeToIndex(connection.entryTime as UTCTimestamp, true)
      const exitIndex = timeScale.timeToIndex(connection.exitTime as UTCTimestamp, true)
      if (entryIndex === null || exitIndex === null) continue
      const left = Math.min(Number(entryIndex), Number(exitIndex))
      const right = Math.max(Number(entryIndex), Number(exitIndex))
      if (right < Number(startTimePoint) || left > Number(endTimePoint)) continue
      prices.push(connection.entryPrice)
      if (connection.initialStop !== null && connection.initialStop !== undefined) prices.push(connection.initialStop)
      if (connection.initialTakeProfit !== null && connection.initialTakeProfit !== undefined) prices.push(connection.initialTakeProfit)
    }
    const finitePrices = prices.filter(Number.isFinite)
    if (finitePrices.length < 2) return null
    const range = finiteMinMax(finitePrices)
    if (!range) return null
    return {
      priceRange: { minValue: range.min, maxValue: range.max },
      margins: { above: 12, below: 12 },
    }
  }

  setConnections(connections: readonly TradeConnection[]): void {
    this.connections = connections
      .filter((connection) => (
        Number.isFinite(connection.entryTime)
        && Number.isFinite(connection.entryPrice)
        && Number.isFinite(connection.exitTime)
        && Number.isFinite(connection.exitPrice)
      ))
      .map((connection) => ({
        ...connection,
        protectionAdjustments: connection.protectionAdjustments?.filter((adjustment) => (
          Number.isFinite(adjustment.time) && Number.isFinite(adjustment.price)
        )),
      }))
    this.visibleConnectionCache = []
    this.visibleConnectionCacheKey = ''
    this.attachedParams?.requestUpdate()
  }

  visibleConnections(): readonly TradeConnection[] {
    const timeScale = this.attachedParams?.chart.timeScale()
    const range = timeScale && typeof timeScale.getVisibleRange === 'function'
      ? timeScale.getVisibleRange()
      : null
    const from = typeof range?.from === 'number' ? range.from : null
    const to = typeof range?.to === 'number' ? range.to : null
    if (from === null || to === null || !Number.isFinite(from) || !Number.isFinite(to)) return this.connections
    const key = `${from}:${to}`
    if (key === this.visibleConnectionCacheKey) return this.visibleConnectionCache
    this.visibleConnectionCacheKey = key
    this.visibleConnectionCache = this.connections.filter((connection) => (
      Math.max(connection.entryTime, connection.exitTime) >= from
      && Math.min(connection.entryTime, connection.exitTime) <= to
    ))
    return this.visibleConnectionCache
  }

  point(time: number, price: number): ConnectionPoint | null {
    const params = this.attachedParams
    if (!params) return null
    const x = params.chart.timeScale().timeToCoordinate(time as UTCTimestamp)
    const y = params.series.priceToCoordinate(price)
    return x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y) ? null : { x, y }
  }

  coordinate(price: number): number | null {
    const coordinate = this.attachedParams?.series.priceToCoordinate(price)
    return coordinate === null || coordinate === undefined || !Number.isFinite(coordinate) ? null : coordinate
  }

  horizontalBounds(connection: TradeConnection): { left: number; right: number } | null {
    const entry = this.point(connection.entryTime, connection.entryPrice)
    const exit = this.point(connection.exitTime, connection.exitPrice)
    if (!entry || !exit) return null
    const left = Math.min(entry.x, exit.x)
    const right = Math.max(entry.x, exit.x)
    if (right - left >= 4) return { left, right }
    const spacing = this.attachedParams?.chart.timeScale().options().barSpacing ?? 7
    const visibleWidth = Math.max(4, Number.isFinite(spacing) ? spacing : 7)
    const center = (left + right) / 2
    return { left: center - visibleWidth / 2, right: center + visibleWidth / 2 }
  }

  positionBounds(connection: TradeConnection): PositionBounds | null {
    const horizontal = this.horizontalBounds(connection)
    if (!horizontal) return null
    const prices = [connection.entryPrice, connection.initialStop, connection.initialTakeProfit]
      .filter((price): price is number => price !== null && price !== undefined && Number.isFinite(price))
    if (prices.length < 2) return null
    const coordinates = prices
      .map((price) => this.coordinate(price))
      .filter((coordinate): coordinate is number => coordinate !== null)
    if (coordinates.length < 2) return null
    const range = finiteMinMax(coordinates)
    return range ? { ...horizontal, top: range.min, bottom: range.max } : null
  }
}
