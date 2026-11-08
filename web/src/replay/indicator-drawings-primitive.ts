import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  Logical,
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
  if (style.lineStyle === 'dashed') return [5 * ratio, 4 * ratio]
  if (style.lineStyle === 'dotted') return [2 * ratio, 3 * ratio]
  const legacy = finite(style.linestyle, 0)
  if (legacy === 1) return [5 * ratio, 4 * ratio]
  if (legacy === 2) return [2 * ratio, 3 * ratio]
  return []
}
function drawScreenText(
  context: CanvasRenderingContext2D,
  draw: IndicatorDrawIntent,
  bitmapSize: { width: number; height: number },
  horizontalPixelRatio: number,
  verticalPixelRatio: number,
): void {
  if (!draw.label) return
  const style = draw.style
  const anchor = typeof style.screenAnchor === 'string' ? style.screenAnchor : 'top-left'
  const [vertical, horizontal] = anchor.split('-')
  const x = horizontal === 'right' ? bitmapSize.width - 12 * horizontalPixelRatio
    : horizontal === 'center' ? bitmapSize.width / 2 : 12 * horizontalPixelRatio
  const y = vertical === 'bottom' ? bitmapSize.height - 12 * verticalPixelRatio
    : vertical === 'middle' ? bitmapSize.height / 2 : 12 * verticalPixelRatio
  const anchorX = x + finite(style.screenOffsetX, 0) * horizontalPixelRatio
  const anchorY = y + finite(style.screenOffsetY, 0) * verticalPixelRatio
  const fontSize = Math.max(1, finite(style.fontSize, 12)) * verticalPixelRatio
  const lineHeight = Math.max(fontSize, finite(style.lineHeight, fontSize / verticalPixelRatio * 1.2) * verticalPixelRatio)
  const paddingX = Math.max(0, finite(style.padding, 4)) * horizontalPixelRatio
  const paddingY = Math.max(0, finite(style.padding, 4)) * verticalPixelRatio
  const lines = draw.label.split('\n')
  context.font = `500 ${fontSize}px "Roboto Variable", -apple-system, sans-serif`
  const measuredWidth = Math.max(...lines.map((line) => context.measureText(line).width))
  const width = Math.max(measuredWidth, Math.max(0, finite(style.screenWidth, 0)) * horizontalPixelRatio)
  const height = Math.max(lines.length * lineHeight, Math.max(0, finite(style.screenHeight, 0)) * verticalPixelRatio)
  const textAlign = style.textAlign === 'center' || style.textAlign === 'right' ? style.textAlign : 'left'
  const left = textAlign === 'right' ? anchorX - width - paddingX
    : textAlign === 'center' ? anchorX - width / 2 - paddingX : anchorX - paddingX
  const top = vertical === 'bottom' ? anchorY - height - paddingY * 2
    : vertical === 'middle' ? anchorY - height / 2 - paddingY : anchorY - paddingY
  if (style.backgroundColor !== undefined) {
    context.fillStyle = color(style.backgroundColor, 'transparent')
    context.fillRect(left, top, width + paddingX * 2, height + paddingY * 2)
  }
  const borderWidth = Math.max(0, finite(style.borderWidth, 0)) * Math.min(horizontalPixelRatio, verticalPixelRatio)
  if (style.borderColor !== undefined && borderWidth > 0) {
    context.strokeStyle = color(style.borderColor, '#898c96')
    context.lineWidth = borderWidth
    context.strokeRect(left, top, width + paddingX * 2, height + paddingY * 2)
  }
  context.fillStyle = color(style.textColor, '#202124')
  context.textAlign = textAlign
  context.textBaseline = 'top'
  lines.forEach((line, index) => context.fillText(line, anchorX, top + paddingY + index * lineHeight))
}


class IndicatorDrawingsPaneView implements IPrimitivePaneView {
  private readonly primitive: IndicatorDrawingsPrimitive
  private readonly screenOnly: boolean
  constructor(primitive: IndicatorDrawingsPrimitive, screenOnly: boolean) {
    this.primitive = primitive
    this.screenOnly = screenOnly
  }
  zOrder(): 'bottom' | 'top' { return this.screenOnly ? 'top' : 'bottom' }
  renderer(): IPrimitivePaneRenderer { return new IndicatorDrawingsRenderer(this.primitive, this.screenOnly) }
}

class IndicatorDrawingsRenderer implements IPrimitivePaneRenderer {
  private readonly primitive: IndicatorDrawingsPrimitive
  private readonly screenOnly: boolean
  constructor(primitive: IndicatorDrawingsPrimitive, screenOnly: boolean) {
    this.primitive = primitive
    this.screenOnly = screenOnly
  }


  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    if (this.primitive.draws.length === 0) return
    target.useBitmapCoordinateSpace((scope) => {
      const { context, horizontalPixelRatio: hx, verticalPixelRatio: vy, bitmapSize } = scope
      context.save()
      for (const draw of this.primitive.visibleDraws()) {
        const isScreenText = draw.kind === 'screenText'
        if (isScreenText !== this.screenOnly) continue
        if (isScreenText) {
          drawScreenText(context, draw, bitmapSize, hx, vy)
          continue
        }
        const x0 = this.primitive.timeCoordinate(draw.t0, draw.xOffset0 ?? 0)
        if (x0 === null) continue
        const style = draw.style
        const stroke = color(style.linecolor ?? style.color, '#898c96')
        const width = Math.max(0, finite(style.lineWidth ?? style.linewidth, 1)) * Math.min(hx, vy)

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
        if (draw.kind === 'rectangle' && style.display === 'background') {
          const extended = style.extendRight === true
          const rawX1 = extended
            ? bitmapSize.width / hx
            : this.primitive.timeCoordinate(draw.t1 ?? draw.t0, draw.xOffset1 ?? 0)
          if (rawX1 === null) continue
          const left = Math.min(x0, rawX1) * hx
          const rectWidth = Math.max(Math.abs(rawX1 - x0) * hx, hx)
          context.fillStyle = color(style.fillColor ?? style.backgroundColor, 'rgba(137, 140, 150, 0.14)')
          context.fillRect(left, 0, rectWidth, bitmapSize.height)
          if (draw.label) {
            context.font = `500 ${Math.max(1, finite(style.fontSize, 11)) * vy}px "Roboto Variable", -apple-system, sans-serif`
            context.textAlign = 'center'
            context.textBaseline = 'top'
            context.fillStyle = color(style.textColor ?? style.color, stroke)
            context.fillText(draw.label, left + rectWidth / 2, 4 * vy)
          }
          continue
        }

        const y0 = this.primitive.priceCoordinate(draw.y0)
        if (y0 === null) continue

        if (draw.kind === 'marker') {
          const x = x0 * hx
          const y = y0 * vy
          const position = style.position
          const marker = draw.label || (typeof style.char === 'string' ? style.char : '•')
          const pointsDown = position === 'below' || (position !== 'above' && marker.includes('⮟'))
          const markerY = position === 'center' ? y : pointsDown ? y + 4 * vy : y - 4 * vy
          context.setLineDash([])
          context.font = `600 ${Math.max(1, finite(style.fontSize, 13)) * vy}px "Roboto Variable", -apple-system, sans-serif`
          context.textAlign = style.textAlign === 'left' || style.textAlign === 'right' ? style.textAlign : 'center'
          context.textBaseline = pointsDown ? 'top' : 'bottom'
          context.fillStyle = color(style.textColor ?? style.color, stroke)
          context.fillText(marker, x, markerY)
          continue
        }

        if (draw.kind === 'rectangle') {
          const y1 = this.primitive.priceCoordinate(draw.y1 ?? draw.y0)
          if (y1 === null) continue
          const extended = style.extendRight === true
          const rawX1 = extended ? bitmapSize.width / hx : this.primitive.timeCoordinate(draw.t1 ?? draw.t0, draw.xOffset1 ?? 0)
          if (rawX1 === null) continue
          const left = Math.min(x0, rawX1) * hx
          const top = Math.min(y0, y1) * vy
          const rectWidth = Math.max(Math.abs(rawX1 - x0) * hx, hx)
          const rectHeight = Math.max(Math.abs(y1 - y0) * vy, vy)
          const background = color(style.fillColor ?? style.backgroundColor, 'rgba(137, 140, 150, 0.14)')
          context.fillStyle = background
          context.fillRect(left, top, rectWidth, rectHeight)
          if (width > 0) {
            context.strokeStyle = color(style.borderColor ?? style.linecolor ?? style.color, stroke)
            context.lineWidth = Math.max(0, finite(style.borderWidth, width / Math.min(hx, vy))) * Math.min(hx, vy)
            context.strokeRect(left, top, rectWidth, rectHeight)
          }
          continue
        }

        if (draw.kind === 'line') {
          const x1 = this.primitive.timeCoordinate(draw.t1 ?? draw.t0, draw.xOffset1 ?? 0)
          const y1 = this.primitive.priceCoordinate(draw.y1 ?? draw.y0)
          if (x1 === null || y1 === null) continue
          context.strokeStyle = stroke
          context.lineWidth = width
          context.setLineDash(lineDash(style, hx))
          context.beginPath()
          context.moveTo(x0 * hx, y0 * vy)
          context.lineTo(x1 * hx, y1 * vy)
          context.stroke()
          const label = draw.label ?? (typeof style.text === 'string' ? style.text : undefined)
          if (label && style.showLabel !== false) {
            context.setLineDash([])
            context.font = `500 ${Math.max(1, finite(style.fontSize, 11)) * vy}px "Roboto Variable", -apple-system, sans-serif`
            context.textAlign = style.textAlign === 'center' || style.textAlign === 'right' ? style.textAlign : 'left'
            context.textBaseline = 'bottom'
            context.fillStyle = color(style.textColor ?? style.textcolor ?? style.linecolor, stroke)
            context.fillText(label, x1 * hx + 3 * hx, y1 * vy - 3 * vy)
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
          const fontSize = Math.max(1, finite(style.fontSize, 11)) * vy
          const labelAtRight = style.labelPosition === 'right'
          context.setLineDash([])
          context.font = `500 ${fontSize}px "Roboto Variable", -apple-system, sans-serif`
          context.textAlign = labelAtRight
            ? 'right'
            : style.textAlign === 'left' || style.textAlign === 'center' || style.textAlign === 'right'
              ? style.textAlign
              : 'left'
          context.textBaseline = 'bottom'
          context.fillStyle = color(style.textColor ?? style.textcolor ?? style.linecolor, stroke)
          const labelX = labelAtRight
            ? Math.max(0, bitmapSize.width - 5 * hx)
            : Math.max(3 * hx, Math.min(bitmapSize.width - 120 * hx, x + 5 * hx))
          context.fillText(draw.label, labelX, y - 3 * vy)
        }
      }
      context.restore()
    })
  }
}

interface VisibleDrawCache {
  source: readonly IndicatorDrawIntent[]
  from: number
  to: number
  visible: readonly IndicatorDrawIntent[]
}

export class IndicatorDrawingsPrimitive implements ISeriesPrimitive<Time> {
  draws: readonly IndicatorDrawIntent[] = []
  private visibleDrawCache: VisibleDrawCache | null = null

  visibleDraws(): readonly IndicatorDrawIntent[] {
    const range = this.attachedParams?.chart.timeScale().getVisibleRange()
    if (!range || typeof range.from !== 'number' || typeof range.to !== 'number') return this.draws
    const from = range.from
    const to = range.to
    const cached = this.visibleDrawCache
    if (cached?.source === this.draws && cached.from === from && cached.to === to) return cached.visible
    const visible = this.draws.filter((draw) => {
      if (draw.kind === 'screenText') return true
      if (draw.kind === 'vline' || draw.kind === 'marker') return draw.t0 >= from && draw.t0 <= to
      if (draw.kind === 'ray') return draw.t0 <= to
      const extended = draw.style.extendRight === true
      const end = extended ? to : draw.t1 ?? draw.t0
      return Math.max(draw.t0, end) >= from && Math.min(draw.t0, end) <= to
    })
    this.visibleDrawCache = { source: this.draws, from, to, visible }
    return visible
  }
  private attachedParams: SeriesAttachedParameter<Time> | null = null
  private readonly chartPaneView = new IndicatorDrawingsPaneView(this, false)
  private readonly screenPaneView = new IndicatorDrawingsPaneView(this, true)
  private readonly chartPaneViews: readonly IPrimitivePaneView[] = [this.chartPaneView]
  private readonly chartAndScreenPaneViews: readonly IPrimitivePaneView[] = [this.chartPaneView, this.screenPaneView]

  attached(params: SeriesAttachedParameter<Time>): void { this.attachedParams = params }
  detached(): void { this.attachedParams = null }
  paneViews(): readonly IPrimitivePaneView[] {
    return this.draws.some((draw) => draw.kind === 'screenText')
      ? this.chartAndScreenPaneViews
      : this.chartPaneViews
  }

  setDraws(draws: readonly IndicatorDrawIntent[]): void {
    this.draws = draws.filter((draw) => Number.isFinite(draw.t0) && (draw.kind === 'vline' || Number.isFinite(draw.y0)))
    this.visibleDrawCache = null
    this.attachedParams?.requestUpdate()
  }

  // Historical session rays may start before the chart's loaded bars; snap
  // those anchors to the nearest available logical bar instead of hiding them.

  timeCoordinate(timestamp: number, offset = 0): number | null {
    const timeScale = this.attachedParams?.chart.timeScale()
    if (!timeScale) return null
    if (offset !== 0) {
      const index = timeScale.timeToIndex(timestamp as UTCTimestamp, true)
      return index === null ? null : timeScale.logicalToCoordinate((Number(index) + offset) as Logical)
    }
    const exact = timeScale.timeToCoordinate(timestamp as UTCTimestamp)
    if (exact !== null) return exact
    const nearest = timeScale.timeToIndex(timestamp as UTCTimestamp, true)
    return nearest === null ? null : timeScale.logicalToCoordinate(Number(nearest) as Logical)
  }

  priceCoordinate(price: number): number | null {
    return this.attachedParams?.series.priceToCoordinate(price) ?? null
  }
}
