import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import type { EconomicEventMarker } from './chart-adapter'

const MARKER_RADIUS = 9
const MARKER_GAP = 5
const MARKER_LANES = 3
const CLUSTER_DISTANCE = MARKER_RADIUS * 2 + MARKER_GAP
const IMPORTANCE_RANK = { none: 0, low: 1, medium: 2, high: 3 } as const

export interface EconomicEventMarkerLayout {
  marker: EconomicEventMarker
  x: number
  y: number
  lane: number
  count: number
}

interface PositionedMarker {
  marker: EconomicEventMarker
  x: number
}

function markerCode(marker: EconomicEventMarker): string {
  const source = marker.country.trim() || marker.currency?.trim() || '•'
  return source.slice(0, 2).toUpperCase()
}

export function economicMarkerUsesUsFlag(marker: EconomicEventMarker): boolean {
  return marker.country.trim().toUpperCase() === 'US' || marker.currency?.trim().toUpperCase() === 'USD'
}

function drawUsFlag(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  const width = radius * 1.35
  const height = radius * 0.9
  const left = x - width / 2
  const top = y - height / 2
  const stripeHeight = height / 7

  context.save()
  context.beginPath()
  context.arc(x, y, radius * 0.72, 0, Math.PI * 2)
  context.clip()
  context.fillStyle = '#ffffff'
  context.fillRect(left, top, width, height)
  context.fillStyle = '#d64b55'
  for (let stripe = 0; stripe < 7; stripe += 2) context.fillRect(left, top + stripe * stripeHeight, width, stripeHeight)
  context.fillStyle = '#315b9a'
  context.fillRect(left, top, width * 0.46, stripeHeight * 4)
  context.fillStyle = '#ffffff'
  context.beginPath()
  context.arc(left + width * 0.23, top + stripeHeight * 2, Math.max(0.65, radius * 0.07), 0, Math.PI * 2)
  context.fill()
  context.restore()
}

function markerStroke(marker: EconomicEventMarker): string {
  if (marker.state === 'past') return '#434651'
  if (marker.state === 'next') return '#d1d4dc'
  if (marker.importance === 'high') return '#ff5563'
  if (marker.importance === 'medium') return '#5b8cff'
  return '#898c96'
}

/**
 * Assigns close releases to compact vertical lanes. The timestamp remains
 * horizontally truthful while simultaneous events stay individually visible.
 */
export function layoutEconomicEventMarkers(
  markers: readonly EconomicEventMarker[],
  coordinate: (timestamp: number) => number | null,
  width: number,
  height: number,
  logicalSpan = 220,
): EconomicEventMarkerLayout[] {
  const positioned = markers
    .map((marker) => ({ marker, x: coordinate(marker.time) }))
    .filter((item): item is { marker: EconomicEventMarker; x: number } => (
      item.x !== null && Number.isFinite(item.x) && item.x >= -MARKER_RADIUS && item.x <= width + MARKER_RADIUS
    ))
    .sort((left, right) => left.x - right.x || left.marker.time - right.marker.time)
  const clusterCapacity = logicalSpan <= 60 ? 1 : logicalSpan <= 120 ? 2 : logicalSpan <= 180 ? 3 : Number.POSITIVE_INFINITY
  const clusters: PositionedMarker[][] = []
  for (const item of positioned) {
    const cluster = clusters.at(-1)
    const previous = cluster?.at(-1)
    if (cluster && previous && item.x - previous.x < CLUSTER_DISTANCE && cluster.length < clusterCapacity) cluster.push(item)
    else clusters.push([item])
  }
  const lastXByLane = Array.from({ length: MARKER_LANES }, () => Number.NEGATIVE_INFINITY)

  return clusters.map((cluster, index) => {
    const representative = cluster.reduce((best, item) => (
      IMPORTANCE_RANK[item.marker.importance] > IMPORTANCE_RANK[best.marker.importance] ? item : best
    ))
    const x = cluster.reduce((sum, item) => sum + item.x, 0) / cluster.length
    const state: EconomicEventMarker['state'] = cluster.some((item) => item.marker.state === 'next')
      ? 'next'
      : cluster.some((item) => item.marker.state === 'scheduled') ? 'scheduled' : 'past'
    const marker: EconomicEventMarker = { ...representative.marker, state }
    const freeLane = lastXByLane.findIndex((lastX) => x - lastX >= MARKER_RADIUS * 2 + MARKER_GAP)
    const lane = freeLane >= 0 ? freeLane : index % MARKER_LANES
    lastXByLane[lane] = x
    return { marker, count: cluster.length, x, lane, y: height - MARKER_RADIUS - 5 - lane * (MARKER_RADIUS * 2 + 3) }
  })
}

class EconomicEventMarkersPaneView implements IPrimitivePaneView {
  private readonly primitive: EconomicEventMarkersPrimitive

  constructor(primitive: EconomicEventMarkersPrimitive) { this.primitive = primitive }
  zOrder(): 'top' { return 'top' }
  renderer(): IPrimitivePaneRenderer { return new EconomicEventMarkersRenderer(this.primitive) }
}

class EconomicEventMarkersRenderer implements IPrimitivePaneRenderer {
  private readonly primitive: EconomicEventMarkersPrimitive

  constructor(primitive: EconomicEventMarkersPrimitive) { this.primitive = primitive }

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    if (this.primitive.markers.length === 0) return
    target.useBitmapCoordinateSpace((scope) => {
      const { context, horizontalPixelRatio: hx, verticalPixelRatio: vy, bitmapSize } = scope
      const width = bitmapSize.width / hx
      const height = bitmapSize.height / vy
      const layout = layoutEconomicEventMarkers(
        this.primitive.markers,
        (timestamp) => this.primitive.coordinate(timestamp),
        width,
        height,
        this.primitive.logicalSpan(),
      )

      context.save()
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.font = `700 ${7 * vy}px "Roboto Variable", -apple-system, sans-serif`

      for (const item of layout) {
        const x = item.x * hx
        const y = item.y * vy
        const radius = MARKER_RADIUS * Math.min(hx, vy)
        const isNext = item.marker.state === 'next'

        if (isNext) {
          context.strokeStyle = '#2962ff'
          context.lineWidth = Math.max(1.5, 1.5 * Math.min(hx, vy))
          context.beginPath()
          context.arc(x, y, radius + 3 * Math.min(hx, vy), 0, Math.PI * 2)
          context.stroke()

          context.fillStyle = '#2962ff'
          context.beginPath()
          context.moveTo(x, y - radius - 8 * vy)
          context.lineTo(x - 3 * hx, y - radius - 3 * vy)
          context.lineTo(x + 3 * hx, y - radius - 3 * vy)
          context.closePath()
          context.fill()
        }

        context.globalAlpha = item.marker.state === 'past' ? 0.58 : 1
        context.fillStyle = isNext ? '#2962ff' : '#1e222d'
        context.strokeStyle = markerStroke(item.marker)
        context.lineWidth = Math.max(1, Math.min(hx, vy))
        context.beginPath()
        context.arc(x, y, radius, 0, Math.PI * 2)
        context.fill()
        context.stroke()

        if (economicMarkerUsesUsFlag(item.marker)) {
          context.globalAlpha = item.marker.state === 'past' ? 0.68 : 1
          drawUsFlag(context, x, y, radius)
        } else {
          context.fillStyle = isNext ? '#ffffff' : item.marker.state === 'past' ? '#a3a6af' : '#d1d4dc'
          context.fillText(markerCode(item.marker), x, y + 0.5 * vy)
        }

        if (item.marker.importance === 'high') {
          context.globalAlpha = 1
          context.fillStyle = '#ff5563'
          context.beginPath()
          context.arc(x + radius * 0.72, y - radius * 0.72, 2.25 * Math.min(hx, vy), 0, Math.PI * 2)
          context.fill()
        }

        if (item.count > 1) {
          const badgeX = x - radius * 0.72
          const badgeY = y + radius * 0.72
          const badgeRadius = 4.4 * Math.min(hx, vy)
          context.globalAlpha = 1
          context.fillStyle = '#131722'
          context.strokeStyle = '#d1d4dc'
          context.lineWidth = Math.max(1, Math.min(hx, vy))
          context.beginPath()
          context.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2)
          context.fill()
          context.stroke()
          context.fillStyle = '#ffffff'
          context.font = `700 ${6 * vy}px "JetBrains Mono Variable", monospace`
          context.fillText(String(item.count), badgeX, badgeY + 0.25 * vy)
          context.font = `700 ${7 * vy}px "Roboto Variable", -apple-system, sans-serif`
        }
      }
      context.restore()
    })
  }
}

export class EconomicEventMarkersPrimitive implements ISeriesPrimitive<Time> {
  markers: readonly EconomicEventMarker[] = []
  private attachedParams: SeriesAttachedParameter<Time> | null = null
  private readonly paneView = new EconomicEventMarkersPaneView(this)

  attached(params: SeriesAttachedParameter<Time>): void { this.attachedParams = params }
  detached(): void { this.attachedParams = null }
  paneViews(): readonly IPrimitivePaneView[] { return [this.paneView] }

  setMarkers(markers: readonly EconomicEventMarker[]): void {
    this.markers = markers.filter((marker) => (
      marker.id.length > 0
      && Number.isFinite(marker.time)
      && marker.time > 0
      && marker.title.length > 0
    ))
    this.attachedParams?.requestUpdate()
  }

  coordinate(timestamp: number): number | null {
    return this.attachedParams?.chart.timeScale().timeToCoordinate(timestamp as UTCTimestamp) ?? null
  }

  logicalSpan(): number {
    const range = this.attachedParams?.chart.timeScale().getVisibleLogicalRange()
    return range && Number.isFinite(range.from) && Number.isFinite(range.to) && range.to > range.from
      ? range.to - range.from
      : 220
  }
}
