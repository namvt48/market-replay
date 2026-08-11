import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import type { TradeConnection } from './chart-adapter'

export const TRADE_CONNECTION_STROKE = 'rgba(163, 166, 175, 0.38)'
export const TRADE_CONNECTION_DASH = [4, 4] as const

interface ConnectionPoint {
  x: number
  y: number
}

class TradeConnectionsPaneView implements IPrimitivePaneView {
  private readonly primitive: TradeConnectionsPrimitive

  constructor(primitive: TradeConnectionsPrimitive) { this.primitive = primitive }
  zOrder(): 'bottom' { return 'bottom' }
  renderer(): IPrimitivePaneRenderer { return new TradeConnectionsRenderer(this.primitive) }
}

class TradeConnectionsRenderer implements IPrimitivePaneRenderer {
  private readonly primitive: TradeConnectionsPrimitive

  constructor(primitive: TradeConnectionsPrimitive) { this.primitive = primitive }

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    if (this.primitive.connections.length === 0) return
    target.useBitmapCoordinateSpace((scope) => {
      const { context, horizontalPixelRatio: hx, verticalPixelRatio: vy, bitmapSize } = scope
      context.save()
      context.strokeStyle = TRADE_CONNECTION_STROKE
      context.lineWidth = Math.max(1, Math.min(hx, vy))
      context.lineCap = 'round'
      context.setLineDash(TRADE_CONNECTION_DASH.map((length) => length * hx))
      context.beginPath()

      for (const connection of this.primitive.connections) {
        const entry = this.primitive.point(connection.entryTime, connection.entryPrice)
        const exit = this.primitive.point(connection.exitTime, connection.exitPrice)
        if (!entry || !exit) continue
        const entryX = entry.x * hx
        const exitX = exit.x * hx
        if ((entryX < 0 && exitX < 0) || (entryX > bitmapSize.width && exitX > bitmapSize.width)) continue
        context.moveTo(entryX, entry.y * vy)
        context.lineTo(exitX, exit.y * vy)
      }

      context.stroke()
      context.restore()
    })
  }
}

export class TradeConnectionsPrimitive implements ISeriesPrimitive<Time> {
  connections: readonly TradeConnection[] = []
  private attachedParams: SeriesAttachedParameter<Time> | null = null
  private readonly paneView = new TradeConnectionsPaneView(this)

  attached(params: SeriesAttachedParameter<Time>): void { this.attachedParams = params }
  detached(): void { this.attachedParams = null }
  paneViews(): readonly IPrimitivePaneView[] { return [this.paneView] }

  setConnections(connections: readonly TradeConnection[]): void {
    this.connections = connections.filter((connection) => (
      Number.isFinite(connection.entryTime)
      && Number.isFinite(connection.entryPrice)
      && Number.isFinite(connection.exitTime)
      && Number.isFinite(connection.exitPrice)
    ))
    this.attachedParams?.requestUpdate()
  }

  point(time: number, price: number): ConnectionPoint | null {
    const params = this.attachedParams
    if (!params) return null
    const x = params.chart.timeScale().timeToCoordinate(time as UTCTimestamp)
    const y = params.series.priceToCoordinate(price)
    return x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y) ? null : { x, y }
  }
}
