import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import type { ReplaySelectionState } from './chart-adapter'

interface ReplaySelectionVisual {
  timestamp: number
  label: string
  selecting: boolean
  lineVisible: boolean
}

class ReplaySelectionPaneView implements IPrimitivePaneView {
  private readonly primitive: ReplaySelectionPrimitive

  constructor(primitive: ReplaySelectionPrimitive) { this.primitive = primitive }
  zOrder(): 'top' { return 'top' }
  renderer(): IPrimitivePaneRenderer { return new ReplaySelectionRenderer(this.primitive) }
}

class ReplaySelectionRenderer implements IPrimitivePaneRenderer {
  private readonly primitive: ReplaySelectionPrimitive

  constructor(primitive: ReplaySelectionPrimitive) { this.primitive = primitive }

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    const visual = this.primitive.visual()
    if (!visual) return
    target.useBitmapCoordinateSpace((scope) => {
      const { context, horizontalPixelRatio, verticalPixelRatio, bitmapSize } = scope
      const coordinate = this.primitive.coordinate(visual.timestamp)
      if (coordinate === null) return
      const x = Math.round(coordinate * horizontalPixelRatio) + 0.5
      context.save()

      if (visual.selecting) {
        context.fillStyle = 'rgba(19, 23, 34, 0.58)'
        context.fillRect(x, 0, Math.max(0, bitmapSize.width - x), bitmapSize.height)
      }

      if (visual.lineVisible) {
        context.strokeStyle = '#2962ff'
        context.lineWidth = Math.max(1, horizontalPixelRatio)
        context.setLineDash([])
        context.beginPath()
        context.moveTo(x, 0)
        context.lineTo(x, bitmapSize.height)
        context.stroke()
      }

      const markerSize = 5 * horizontalPixelRatio
      context.fillStyle = '#2962ff'
      context.beginPath()
      context.moveTo(x, bitmapSize.height - markerSize * 1.8)
      context.lineTo(x - markerSize, bitmapSize.height)
      context.lineTo(x + markerSize, bitmapSize.height)
      context.closePath()
      context.fill()

      if (visual.selecting && visual.label) {
        const fontSize = 10 * verticalPixelRatio
        const paddingX = 7 * horizontalPixelRatio
        const height = 22 * verticalPixelRatio
        context.font = `600 ${fontSize}px "JetBrains Mono Variable", monospace`
        context.textBaseline = 'middle'
        const width = context.measureText(visual.label).width + paddingX * 2
        const left = Math.max(3 * horizontalPixelRatio, Math.min(bitmapSize.width - width - 3 * horizontalPixelRatio, x - width / 2))
        const top = bitmapSize.height - height
        context.fillStyle = '#2962ff'
        context.fillRect(left, top, width, height)
        context.fillStyle = '#ffffff'
        context.fillText(visual.label, left + paddingX, top + height / 2)
      }
      context.restore()
    })
  }
}

export class ReplaySelectionPrimitive implements ISeriesPrimitive<Time> {
  private attachedParams: SeriesAttachedParameter<Time> | null = null
  private readonly paneView = new ReplaySelectionPaneView(this)
  private state: ReplaySelectionState = { mode: 'inactive' }
  private preview: { timestamp: number; label: string } | null = null

  attached(params: SeriesAttachedParameter<Time>): void { this.attachedParams = params }
  detached(): void { this.attachedParams = null }
  paneViews(): readonly IPrimitivePaneView[] { return [this.paneView] }

  setState(state: ReplaySelectionState): void {
    this.state = state
    if (state.mode !== 'selecting') this.preview = null
    this.attachedParams?.requestUpdate()
  }

  setPreview(timestamp: number, label: string): void {
    if (this.state.mode !== 'selecting') return
    this.preview = { timestamp, label }
    this.attachedParams?.requestUpdate()
  }

  visual(): ReplaySelectionVisual | null {
    if (this.state.mode === 'inactive') return null
    if (this.state.mode === 'active') return { timestamp: this.state.timestamp, label: '', selecting: false, lineVisible: false }
    return this.preview ? { ...this.preview, selecting: true, lineVisible: true } : null
  }

  coordinate(timestamp: number): number | null {
    return this.attachedParams?.chart.timeScale().timeToCoordinate(timestamp as UTCTimestamp) ?? null
  }
}
