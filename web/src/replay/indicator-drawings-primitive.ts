import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import type { IndicatorDrawIntent } from '../api/types'

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function color(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value !== 'object' || value === null) return fallback
  const item = value as Record<string, unknown>
  const r = Math.round(Math.max(0, Math.min(255, finite(item.r, 128))))
  const g = Math.round(Math.max(0, Math.min(255, finite(item.g, 128))))
  const b = Math.round(Math.max(0, Math.min(255, finite(item.b, 128))))
  const a = Math.max(0, Math.min(1, finite(item.a, 1)))
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function lineDash(style: Record<string, unknown>, ratio: number): number[] {
  const code = finite(style.linestyle, 0)
  if (code === 1) return [5 * ratio, 4 * ratio]
  if (code === 2) return [2 * ratio, 3 * ratio]
  return []
}

class IndicatorDrawingsPaneView implements IPrimitivePaneView {
  private readonly primitive: IndicatorDrawingsPrimitive
  constructor(primitive: IndicatorDrawingsPrimitive) { this.primitive = primitive }
  zOrder(): 'bottom' { return 'bottom' }
  renderer(): IPrimitivePaneRenderer { return new IndicatorDrawingsRenderer(this.primitive) }
}

class IndicatorDrawingsRenderer implements IPrimitivePaneRenderer {
  private readonly primitive: IndicatorDrawingsPrimitive
  constructor(primitive: IndicatorDrawingsPrimitive) { this.primitive = primitive }

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    if (this.primitive.draws.length === 0) return
    target.useBitmapCoordinateSpace((scope) => {
      const { context, horizontalPixelRatio: hx, verticalPixelRatio: vy, bitmapSize } = scope
      context.save()
      for (const draw of this.primitive.draws) {
        const x0 = this.primitive.timeCoordinate(draw.t0)
        if (x0 === null) continue
        const style = draw.style
        const stroke = color(style.linecolor ?? style.color, '#898c96')
        const width = Math.max(1, finite(style.linewidth, 1)) * Math.min(hx, vy)

        if (draw.kind === 'vline') {
          const x = Math.round(x0 * hx) + 0.5
          if (x < 0 || x > bitmapSize.width) continue
          context.strokeStyle = stroke
          context.lineWidth = width
          context.setLineDash(lineDash(style, vy))
          context.beginPath()
          context.moveTo(x, 0)
          context.lineTo(x, bitmapSize.height)
          context.stroke()
          continue
        }

        const y0 = this.primitive.priceCoordinate(draw.y0)
        if (y0 === null) continue

        if (draw.kind === 'marker') {
          const x = x0 * hx
          const y = y0 * vy
          const pointsDown = draw.label?.includes('⮟') === true
          const markerY = pointsDown ? y + 4 * vy : y - 4 * vy
          context.setLineDash([])
          context.font = `600 ${13 * vy}px "Roboto Variable", -apple-system, sans-serif`
          context.textAlign = 'center'
          context.textBaseline = pointsDown ? 'top' : 'bottom'
          context.fillStyle = stroke
          context.fillText(draw.label || '•', x, markerY)
          continue
        }

        if (draw.kind === 'rectangle') {
          const y1 = this.primitive.priceCoordinate(draw.y1 ?? draw.y0)
          if (y1 === null) continue
          const extended = style.extendRight === true
          const rawX1 = extended ? bitmapSize.width / hx : this.primitive.timeCoordinate(draw.t1 ?? draw.t0)
          if (rawX1 === null) continue
          const left = Math.min(x0, rawX1) * hx
          const top = Math.min(y0, y1) * vy
          const rectWidth = Math.max(Math.abs(rawX1 - x0) * hx, hx)
          const rectHeight = Math.max(Math.abs(y1 - y0) * vy, vy)
          context.fillStyle = color(style.backgroundColor, 'rgba(137, 140, 150, 0.14)')
          context.fillRect(left, top, rectWidth, rectHeight)
          if (width > 0 && finite(style.linewidth, 1) > 0) {
            context.strokeStyle = stroke
            context.lineWidth = width
            context.strokeRect(left, top, rectWidth, rectHeight)
          }
          continue
        }

        const x = Math.max(0, x0 * hx)
        const y = Math.round(y0 * vy) + 0.5
        context.strokeStyle = stroke
        context.lineWidth = width
        context.setLineDash(lineDash(style, hx))
        context.beginPath()
        context.moveTo(x, y)
        context.lineTo(bitmapSize.width, y)
        context.stroke()
        if (draw.label && style.showLabel !== false) {
          const fontSize = 11 * vy
          context.setLineDash([])
          context.font = `500 ${fontSize}px "Roboto Variable", -apple-system, sans-serif`
          context.textAlign = 'left'
          context.textBaseline = 'bottom'
          context.fillStyle = color(style.textcolor ?? style.linecolor, stroke)
          const labelX = Math.max(3 * hx, Math.min(bitmapSize.width - 120 * hx, x + 5 * hx))
          context.fillText(draw.label, labelX, y - 3 * vy)
        }
      }
      context.restore()
    })
  }
}

export class IndicatorDrawingsPrimitive implements ISeriesPrimitive<Time> {
  draws: readonly IndicatorDrawIntent[] = []
  private attachedParams: SeriesAttachedParameter<Time> | null = null
  private readonly paneView = new IndicatorDrawingsPaneView(this)

  attached(params: SeriesAttachedParameter<Time>): void { this.attachedParams = params }
  detached(): void { this.attachedParams = null }
  paneViews(): readonly IPrimitivePaneView[] { return [this.paneView] }

  setDraws(draws: readonly IndicatorDrawIntent[]): void {
    this.draws = draws.filter((draw) => Number.isFinite(draw.t0) && (draw.kind === 'vline' || Number.isFinite(draw.y0)))
    this.attachedParams?.requestUpdate()
  }

  timeCoordinate(timestamp: number): number | null {
    return this.attachedParams?.chart.timeScale().timeToCoordinate(timestamp as UTCTimestamp) ?? null
  }

  priceCoordinate(price: number): number | null {
    return this.attachedParams?.series.priceToCoordinate(price) ?? null
  }
}
