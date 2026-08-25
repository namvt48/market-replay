import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import type { IDrawing } from 'lightweight-charts-drawing'
import { colorWithOpacity, getDrawingAppearance, LINE_TOOL_TYPES, type DrawingWorkbenchOptions } from './drawing-appearance'

// Every line tool renders its own text inline, directly on the line with a
// stroke gap (see the vendor's pane renderers) instead of this floating box —
// skip them here or the same text draws twice.
const DRAWINGS_WITH_INLINE_TEXT = new Set<string>([
  ...LINE_TOOL_TYPES,
  'rectangle',
  'text-annotation',
  'anchored-text',
  'note',
  'price-note',
  'callout',
  'comment',
])
import { finiteMinMax } from './number-range'

interface LabelBounds {
  left: number
  right: number
  top: number
  bottom: number
}

interface PanePoint {
  x: number
  y: number
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
  'price-note',
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
  const workbench = (drawing.options as DrawingWorkbenchOptions).workbench
  if (DRAWINGS_WITH_INLINE_TEXT.has(drawing.type) && workbench?.showPriceLabels === false) return []
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
      const paneWidth = bitmapSize.width / horizontalPixelRatio
      const paneHeight = bitmapSize.height / verticalPixelRatio
      for (const drawing of this.primitive.drawings()) {
        if (drawing.options.visible === false) continue
        const appearance = getDrawingAppearance(drawing)
        const anchorPoints = this.primitive.anchorPoints(drawing)
        const primaryLine = this.primaryLine(drawing, anchorPoints, appearance.extendLeft, appearance.extendRight, paneWidth, paneHeight)
        if (primaryLine && (appearance.lineStartStyle === 'arrow' || appearance.lineEndStyle === 'arrow' || appearance.showMiddlePoint)) {
          const { start, end } = primaryLine
          const startIsVisuallyFirst = start.x < end.x || (start.x === end.x && start.y <= end.y)
          const visualStart = startIsVisuallyFirst ? start : end
          const visualEnd = startIsVisuallyFirst ? end : start
          const drawArrow = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
            const angle = Math.atan2(to.y - from.y, to.x - from.x)
            const size = 9 * horizontalPixelRatio
            const x = to.x * horizontalPixelRatio
            const y = to.y * verticalPixelRatio
            context.beginPath()
            context.moveTo(x, y)
            context.lineTo(x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6))
            context.moveTo(x, y)
            context.lineTo(x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6))
            context.stroke()
          }

          context.save()
          context.strokeStyle = drawing.style.lineColor
          context.lineWidth = Math.max(1, drawing.style.lineWidth * horizontalPixelRatio)
          context.lineCap = 'round'
          context.setLineDash([])
          if (appearance.lineStartStyle === 'arrow') drawArrow(visualEnd, visualStart)
          if (appearance.lineEndStyle === 'arrow') drawArrow(visualStart, visualEnd)
          if (appearance.showMiddlePoint) {
            const x = ((start.x + end.x) / 2) * horizontalPixelRatio
            const y = ((start.y + end.y) / 2) * verticalPixelRatio
            context.beginPath()
            context.arc(x, y, 4 * horizontalPixelRatio, 0, Math.PI * 2)
            context.fillStyle = '#131722'
            context.fill()
            context.stroke()
          }
          context.restore()
        }
        const text = appearance.text.trim()
        if (!text || DRAWINGS_WITH_INLINE_TEXT.has(drawing.type) || (drawing.type === 'fib-retracement' && !appearance.fibonacciTextVisible)) continue
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
        const textRange = finiteMinMax(lines.map((line) => context.measureText(line).width))
        const textWidth = Math.max(textRange?.max ?? 0, 1)
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
        // Keep the label attached to the drawing while the chart pans. The
        // canvas clips coordinates outside the pane naturally; clamping here
        // makes a departing label appear stuck to the chart edge.
        const boxX = requestedX
        const boxY = requestedY

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

  private primaryLine(
    drawing: IDrawing,
    anchorPoints: readonly PanePoint[],
    extendLeft: boolean,
    extendRight: boolean,
    paneWidth: number,
    paneHeight: number,
  ): { start: PanePoint; end: PanePoint } | null {
    if (!DRAWINGS_WITH_INLINE_TEXT.has(drawing.type) || anchorPoints.length === 0) return null
    if (anchorPoints.length >= 2) return { start: anchorPoints[0], end: anchorPoints[1] }

    const anchor = anchorPoints[0]
    if (drawing.type === 'horizontal-line' || drawing.type === 'cross-line') {
      return { start: { x: 0, y: anchor.y }, end: { x: paneWidth, y: anchor.y } }
    }
    if (drawing.type === 'vertical-line') {
      return { start: { x: anchor.x, y: 0 }, end: { x: anchor.x, y: paneHeight } }
    }
    if (drawing.type === 'horizontal-ray') {
      if (extendLeft && extendRight) return { start: { x: 0, y: anchor.y }, end: { x: paneWidth, y: anchor.y } }
      if (extendLeft) return { start: { x: 0, y: anchor.y }, end: anchor }
      return { start: anchor, end: { x: paneWidth, y: anchor.y } }
    }
    return null
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

  anchorPoints(drawing: IDrawing): Array<{ x: number; y: number }> {
    const params = this.attachedParams
    if (!params) return []
    return drawing.anchors.flatMap((anchor) => {
      const x = params.chart.timeScale().timeToCoordinate(anchor.time)
      const y = params.series.priceToCoordinate(anchor.price)
      return x === null || y === null ? [] : [{ x, y }]
    })
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
    const points = this.anchorPoints(drawing)
    if (points.length === 0) return null
    const xRange = finiteMinMax(points.map((point) => point.x))
    const yRange = finiteMinMax(points.map((point) => point.y))
    if (!xRange || !yRange) return null
    return {
      left: xRange.min,
      right: xRange.max,
      top: yRange.min,
      bottom: yRange.max,
    }
  }
}
