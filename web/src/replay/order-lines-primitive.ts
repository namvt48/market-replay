import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import type { OrderLine } from './chart-adapter'

export type OrderPrimitiveAction =
  | { type: 'confirm' | 'discard' | 'toggle-stop-loss' | 'toggle-take-profit' }
  | { type: 'cancel' | 'edit' | 'quantity'; orderId: string; x: number; y: number }

interface HitRegion {
  x: number
  y: number
  width: number
  height: number
  action: OrderPrimitiveAction
}

export interface DraftOrderRangePair {
  role: 'takeProfit' | 'stopLoss'
  entryPrice: number
  legPrice: number
  fill: string
}

const RANGE_FILL: Record<DraftOrderRangePair['role'], string> = {
  takeProfit: 'rgba(8, 153, 129, 0.10)',
  stopLoss: 'rgba(255, 152, 0, 0.09)',
}

export function draftOrderRangePairs(lines: OrderLine[]): DraftOrderRangePair[] {
  const entry = lines.find((line) => line.stage === 'draft' && line.role === 'entry')
  if (!entry) return []
  return lines
    .filter((line): line is OrderLine & { role: DraftOrderRangePair['role'] } => line.stage === 'draft' && (line.role === 'takeProfit' || line.role === 'stopLoss'))
    .map((line) => ({ role: line.role, entryPrice: entry.price, legPrice: line.price, fill: RANGE_FILL[line.role] }))
}

class OrderLinesPaneView implements IPrimitivePaneView {
  private readonly primitive: OrderLinesPrimitive
  constructor(primitive: OrderLinesPrimitive) { this.primitive = primitive }
  zOrder(): 'top' { return 'top' }
  renderer(): IPrimitivePaneRenderer { return new OrderLinesRenderer(this.primitive) }
}

class OrderLinesRenderer implements IPrimitivePaneRenderer {
  private readonly primitive: OrderLinesPrimitive
  constructor(primitive: OrderLinesPrimitive) { this.primitive = primitive }

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    target.useBitmapCoordinateSpace((scope) => {
      const { context, horizontalPixelRatio: hx, verticalPixelRatio: vy, bitmapSize } = scope
      const width = bitmapSize.width / hx
      this.primitive.clearHitRegions()
      context.save()
      context.font = `${12 * hx}px "Roboto Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
      context.textBaseline = 'middle'

      for (const range of draftOrderRangePairs(this.primitive.lines)) {
        const entryY = this.primitive.coordinate(range.entryPrice)
        const legY = this.primitive.coordinate(range.legPrice)
        if (entryY === null || legY === null) continue
        const top = Math.min(entryY, legY)
        const height = Math.abs(entryY - legY)
        context.fillStyle = range.fill
        context.fillRect(0, top * vy, bitmapSize.width, Math.max(1, height * vy))
      }

      const draftCoordinates = this.primitive.lines
        .filter((line) => line.stage === 'draft')
        .map((line) => this.primitive.coordinate(line.price))
        .filter((value): value is number => value !== null)
      const connectorX = Math.max(170, width - 108)
      if (draftCoordinates.length > 1) {
        context.strokeStyle = '#2962ff'
        context.lineWidth = hx
        context.setLineDash([])
        context.beginPath()
        context.moveTo(connectorX * hx, Math.min(...draftCoordinates) * vy)
        context.lineTo(connectorX * hx, Math.max(...draftCoordinates) * vy)
        context.stroke()
      }

      for (const line of this.primitive.lines) {
        const coordinate = this.primitive.coordinate(line.price)
        if (coordinate === null) continue
        const y = coordinate
        const bitmapY = Math.round(y * vy) + 0.5
        const ticketWidth = Math.min(164, Math.max(118, width * 0.3))
        const ticketRight = Math.max(ticketWidth + 10, width - 118)
        const ticketX = ticketRight - ticketWidth
        const height = 22

        context.strokeStyle = line.color
        context.lineWidth = hx
        context.setLineDash(line.stage === 'position' ? [] : [4 * hx, 3 * hx])
        context.beginPath()
        context.moveTo(ticketX * hx, bitmapY)
        context.lineTo(bitmapSize.width, bitmapY)
        context.stroke()
        context.setLineDash([])

        if (line.stage === 'draft') {
          context.beginPath()
          context.arc(connectorX * hx, bitmapY, 3.5 * hx, 0, Math.PI * 2)
          context.fillStyle = '#2962ff'
          context.fill()
        }

        context.beginPath()
        context.roundRect(ticketX * hx, (y - height / 2) * vy, ticketWidth * hx, height * vy, 3 * hx)
        context.fillStyle = line.stage === 'position' ? line.color : '#131722'
        context.fill()
        context.strokeStyle = line.color
        context.lineWidth = hx
        context.stroke()

        const qtyWidth = 40
        context.strokeStyle = line.stage === 'position' ? '#ffffff55' : `${line.color}99`
        context.beginPath()
        context.moveTo((ticketX + qtyWidth) * hx, (y - height / 2) * vy)
        context.lineTo((ticketX + qtyWidth) * hx, (y + height / 2) * vy)
        context.stroke()
        context.textAlign = 'center'
        context.fillStyle = line.stage === 'position' ? '#ffffff' : line.color
        context.fillText(`◀ ${line.qty}`, (ticketX + qtyWidth / 2) * hx, bitmapY)
        context.fillStyle = line.stage === 'position' ? '#ffffff' : '#d1d4dc'
        context.fillText(line.label, (ticketX + qtyWidth + (ticketWidth - qtyWidth - 22) / 2) * hx, bitmapY)
        context.fillStyle = line.stage === 'position' ? '#ffffff' : line.color
        context.fillText('×', (ticketRight - 11) * hx, bitmapY)

        this.primitive.addHitRegion({ x: ticketX, y: y - height / 2, width: qtyWidth, height, action: { type: 'quantity', orderId: line.id, x: ticketX, y: y + height / 2 } })
        this.primitive.addHitRegion({ x: ticketRight - 22, y: y - height / 2, width: 22, height, action: { type: 'cancel', orderId: line.id, x: ticketRight - 22, y } })
        this.primitive.addHitRegion({ x: ticketX + qtyWidth, y: y - height / 2, width: ticketWidth - qtyWidth - 22, height, action: { type: 'edit', orderId: line.id, x: ticketX, y } })

        const priceWidth = Math.max(70, context.measureText(line.priceLabel).width / hx + 12)
        const priceX = width - priceWidth
        context.fillStyle = line.stage === 'position' ? '#131722' : line.color
        context.fillRect(priceX * hx, (y - height / 2) * vy, priceWidth * hx, height * vy)
        context.fillStyle = '#ffffff'
        context.fillText(line.priceLabel, (priceX + priceWidth / 2) * hx, bitmapY)

        if (line.showControls && line.role === 'entry') {
          const controls = [
            { label: 'Discard', type: 'discard' as const, width: 58, active: true, color: '#d1d4dc' },
            { label: 'Confirm', type: 'confirm' as const, width: 60, active: true, color: '#2962ff' },
            { label: 'TP', type: 'toggle-take-profit' as const, width: 34, active: line.protectionEnabled?.takeProfit ?? false, color: '#089981' },
            { label: 'SL', type: 'toggle-stop-loss' as const, width: 34, active: line.protectionEnabled?.stopLoss ?? false, color: '#ff9800' },
          ]
          const total = controls.reduce((sum, control) => sum + control.width + 4, 0)
          let controlX = width < 520 ? Math.max(6, (width - total) / 2) : Math.max(6, ticketX - total - 6)
          const controlY = width < 520 ? y - 34 : y - 10
          for (const control of controls) {
            context.beginPath()
            context.roundRect(controlX * hx, controlY * vy, control.width * hx, 20 * vy, 3 * hx)
            context.fillStyle = control.type === 'confirm' ? control.color : control.active ? '#2a2e39' : '#131722'
            context.fill()
            context.strokeStyle = control.color
            context.stroke()
            context.fillStyle = control.type === 'confirm' ? '#ffffff' : control.color
            context.fillText(control.label, (controlX + control.width / 2) * hx, (controlY + 10) * vy)
            this.primitive.addHitRegion({ x: controlX, y: controlY, width: control.width, height: 20, action: { type: control.type } })
            controlX += control.width + 4
          }
        }
      }
      context.restore()
    })
  }
}

export class OrderLinesPrimitive implements ISeriesPrimitive<Time> {
  lines: OrderLine[] = []
  private attachedParams: SeriesAttachedParameter<Time> | null = null
  private readonly paneView = new OrderLinesPaneView(this)
  private hitRegions: HitRegion[] = []

  attached(params: SeriesAttachedParameter<Time>): void { this.attachedParams = params }
  detached(): void { this.attachedParams = null }
  paneViews(): readonly IPrimitivePaneView[] { return [this.paneView] }

  setLines(lines: OrderLine[]): void {
    this.lines = lines
    this.attachedParams?.requestUpdate()
  }

  clearHitRegions(): void { this.hitRegions = [] }
  addHitRegion(region: HitRegion): void { this.hitRegions.push(region) }

  actionAt(x: number, y: number): OrderPrimitiveAction | null {
    const region = [...this.hitRegions].reverse().find((item) => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height)
    return region?.action ?? null
  }

  coordinate(price: number): number | null {
    return this.attachedParams?.series.priceToCoordinate(price) ?? null
  }

  priceAt(y: number): number | null {
    return this.attachedParams?.series.coordinateToPrice(y) ?? null
  }

  nearestEditable(y: number): OrderLine | null {
    let best: { line: OrderLine; distance: number } | null = null
    for (const line of this.lines) {
      if (!line.editable) continue
      const coordinate = this.coordinate(line.price)
      if (coordinate === null) continue
      const distance = Math.abs(coordinate - y)
      if (distance <= 8 && (!best || distance < best.distance)) best = { line, distance }
    }
    return best?.line ?? null
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const action = this.actionAt(x, y)
    if (action) {
      const draggable = action.type === 'edit' || action.type === 'toggle-take-profit' || action.type === 'toggle-stop-loss'
      return { externalId: action.type, zOrder: 'top', cursorStyle: draggable ? 'ns-resize' : 'pointer', distance: 0, itemType: 'primitive' }
    }
    const line = this.nearestEditable(y)
    return line ? { externalId: line.id, zOrder: 'top', cursorStyle: 'ns-resize', distance: 0, itemType: 'primitive' } : null
  }
}
