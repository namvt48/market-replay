import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import type { IDrawing } from 'lightweight-charts-drawing'
import { colorWithOpacity, getDrawingAppearance, type DrawingWorkbenchOptions } from './drawing-appearance'

interface LabelBounds {
  left: number
  right: number
  top: number
  bottom: number
}

export interface DrawingPriceLevel {
  price: number
  color: string
}

const DRAWINGS_WITHOUT_PRICE_LABELS = new Set([
  'vertical-line',
  'fib-time-zone',
  'fib-time-extension',
  'date-range',
  'text-annotation',
  'callout',
  'brush',
  'highlighter',
  'arrow-marker',
  'arrow-mark-up',
  'arrow-mark-down',
  'path',
  'polyline',
  'curve',
  'double-curve',
  'anchored-text',
  'note',
  'flag-mark',
  'pin',
  'comment',
  'signpost',
  'table',
])

function uniqueLevels(levels: readonly DrawingPriceLevel[]): DrawingPriceLevel[] {
  const seen = new Set<number>()
  return levels.filter((level) => {
    if (!Number.isFinite(level.price) || seen.has(level.price)) return false
    seen.add(level.price)
    return true
  })
}

/** Prices represented by a drawing, ready to mirror onto the series' right price scale. */
export function drawingPriceLevels(drawing: IDrawing): DrawingPriceLevel[] {
  if (drawing.options.visible === false || DRAWINGS_WITHOUT_PRICE_LABELS.has(drawing.type)) return []
  const appearance = getDrawingAppearance(drawing)
  if (drawing.type === 'fib-retracement' && drawing.anchors.length >= 2) {
    const [first, second] = drawing.anchors
    const priceRange = second.price - first.price
    const options = drawing.options as DrawingWorkbenchOptions & { reverseDirection?: boolean }
    return uniqueLevels(appearance.fibonacciLevels
      .filter((level) => level.visible)
      .map((level) => ({
        price: options.reverseDirection
          ? second.price - priceRange * level.value
          : first.price + priceRange * level.value,
        color: level.color,
      })))
  }
  return uniqueLevels(drawing.anchors.map((anchor) => ({ price: anchor.price, color: appearance.strokeColor })))
}

/** Picks the higher-contrast foreground for an opaque hex axis-label background. */
export function priceAxisTextColor(background: string): '#000000' | '#ffffff' {
  const color = background.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(color)) return '#ffffff'
  const linear = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  const whiteContrast = 1.05 / (luminance + 0.05)
  const blackContrast = (luminance + 0.05) / 0.05
  return blackContrast > whiteContrast ? '#000000' : '#ffffff'
}

class DrawingPriceAxisView implements ISeriesPrimitiveAxisView {
  private readonly primitive: DrawingLabelsPrimitive
  private readonly level: DrawingPriceLevel

  constructor(primitive: DrawingLabelsPrimitive, level: DrawingPriceLevel) {
    this.primitive = primitive
    this.level = level
  }

  coordinate(): number { return this.primitive.priceCoordinate(this.level.price) ?? -1_000_000 }
  text(): string { return this.primitive.formatPrice(this.level.price) }
  textColor(): string { return priceAxisTextColor(this.level.color) }
  backColor(): string { return this.level.color }
  visible(): boolean { return this.primitive.priceCoordinate(this.level.price) !== null }
  tickVisible(): boolean { return true }
}

class DrawingLabelsPaneView implements IPrimitivePaneView {
  private readonly primitive: DrawingLabelsPrimitive

  constructor(primitive: DrawingLabelsPrimitive) { this.primitive = primitive }
  zOrder(): 'top' { return 'top' }
  renderer(): IPrimitivePaneRenderer { return new DrawingLabelsRenderer(this.primitive) }
}

class DrawingLabelsRenderer implements IPrimitivePaneRenderer {
  private readonly primitive: DrawingLabelsPrimitive

  constructor(primitive: DrawingLabelsPrimitive) { this.primitive = primitive }

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    target.useBitmapCoordinateSpace((scope) => {
      const { context, horizontalPixelRatio, verticalPixelRatio, bitmapSize } = scope
      for (const drawing of this.primitive.drawings()) {
        const appearance = getDrawingAppearance(drawing)
        const text = appearance.text.trim()
        if (!text || drawing.options.visible === false || (drawing.type === 'fib-retracement' && !appearance.fibonacciTextVisible)) continue
        const bounds = this.primitive.bounds(drawing)
        if (!bounds) continue

        const ratio = horizontalPixelRatio
        const fontSize = appearance.fontSize * verticalPixelRatio
        const fontStyle = appearance.italic ? 'italic ' : ''
        const fontWeight = appearance.bold ? '700 ' : '400 '
        const lines = text.split('\n').slice(0, 8)
        const lineHeight = fontSize * 1.28
        const padding = 6 * ratio

        context.save()
        context.font = `${fontStyle}${fontWeight}${fontSize}px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif`
        context.textBaseline = 'middle'
        const textWidth = Math.max(...lines.map((line) => context.measureText(line).width), 1)
        const boxWidth = textWidth + padding * 2
        const boxHeight = lines.length * lineHeight + padding * 2

        const requestedX = appearance.horizontalAlign === 'left'
          ? bounds.left * ratio
          : appearance.horizontalAlign === 'right'
            ? bounds.right * ratio - boxWidth
            : ((bounds.left + bounds.right) / 2) * ratio - boxWidth / 2
        const requestedY = appearance.verticalAlign === 'top'
          ? bounds.top * verticalPixelRatio - boxHeight - 8 * verticalPixelRatio
          : appearance.verticalAlign === 'bottom'
            ? bounds.bottom * verticalPixelRatio + 8 * verticalPixelRatio
            : ((bounds.top + bounds.bottom) / 2) * verticalPixelRatio - boxHeight / 2
        const boxX = Math.max(4 * ratio, Math.min(bitmapSize.width - boxWidth - 4 * ratio, requestedX))
        const boxY = Math.max(4 * verticalPixelRatio, Math.min(bitmapSize.height - boxHeight - 4 * verticalPixelRatio, requestedY))

        if (appearance.backgroundOpacity > 0) {
          context.fillStyle = colorWithOpacity(appearance.backgroundColor, appearance.backgroundOpacity)
          context.beginPath()
          context.roundRect(boxX, boxY, boxWidth, boxHeight, 4 * ratio)
          context.fill()
        }

        context.fillStyle = colorWithOpacity(appearance.textColor, appearance.textOpacity)
        context.textAlign = appearance.horizontalAlign
        const textX = appearance.horizontalAlign === 'left'
          ? boxX + padding
          : appearance.horizontalAlign === 'right'
            ? boxX + boxWidth - padding
            : boxX + boxWidth / 2
        lines.forEach((line, index) => {
          const textY = boxY + padding + lineHeight * (index + 0.5)
          context.fillText(line, textX, textY)
        })
        context.restore()
      }
    })
  }
}

export class DrawingLabelsPrimitive implements ISeriesPrimitive<Time> {
  private attachedParams: SeriesAttachedParameter<Time> | null = null
  private readonly paneView = new DrawingLabelsPaneView(this)
  private readonly getDrawings: () => IDrawing[]
  private readonly priceFormatter: (price: number) => string
  private priceAxisViewCache: readonly ISeriesPrimitiveAxisView[] = []
  private priceAxisSignature = ''

  constructor(getDrawings: () => IDrawing[], priceFormatter: (price: number) => string = String) {
    this.getDrawings = getDrawings
    this.priceFormatter = priceFormatter
  }

  attached(params: SeriesAttachedParameter<Time>): void {
    this.attachedParams = params
    this.rebuildPriceAxisViews()
  }
  detached(): void {
    this.attachedParams = null
    this.priceAxisViewCache = []
    this.priceAxisSignature = ''
  }
  paneViews(): readonly IPrimitivePaneView[] { return [this.paneView] }
  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] { return this.priceAxisViewCache }
  drawings(): IDrawing[] { return this.getDrawings() }
  requestUpdate(): void {
    this.rebuildPriceAxisViews()
    this.attachedParams?.requestUpdate()
  }
  formatPrice(price: number): string { return this.priceFormatter(price) }
  priceCoordinate(price: number): number | null {
    const coordinate = this.attachedParams?.series.priceToCoordinate(price) ?? null
    return coordinate !== null && Number.isFinite(coordinate) ? coordinate : null
  }

  private rebuildPriceAxisViews(): void {
    const levels = this.getDrawings()
      .filter((drawing) => drawing.id !== '__drawing-preview__' && (drawing.state === 'selected' || drawing.state === 'editing'))
      .flatMap((drawing) => drawingPriceLevels(drawing).map((level) => ({ drawingId: drawing.id, ...level })))
    const signature = levels.map((level) => `${level.drawingId}:${level.price}:${level.color}`).join('|')
    if (signature === this.priceAxisSignature) return
    this.priceAxisSignature = signature
    this.priceAxisViewCache = levels.map(({ price, color }) => new DrawingPriceAxisView(this, { price, color }))
  }

  bounds(drawing: IDrawing): LabelBounds | null {
    const params = this.attachedParams
    if (!params || drawing.anchors.length === 0) return null
    const points = drawing.anchors.flatMap((anchor) => {
      const x = params.chart.timeScale().timeToCoordinate(anchor.time)
      const y = params.series.priceToCoordinate(anchor.price)
      return x === null || y === null ? [] : [{ x, y }]
    })
    if (points.length === 0) return null
    return {
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
      top: Math.min(...points.map((point) => point.y)),
      bottom: Math.max(...points.map((point) => point.y)),
    }
  }
}
