import type { Time } from 'lightweight-charts'
import type { ChartAppearanceSettings } from './chart-settings'
import type { RustChartEngine } from './rust-chart-engine'
import type { RustChartIndicatorPaneSize, RustChartLayout } from './rust-chart-painter'
import type { RustIndicatorRange, RustIndicatorScale, RustIndicatorSeries } from './rust-chart-indicator-painter'
import { paintRustIndicatorPanes } from './rust-chart-indicator-painter'

interface PaintDatum {
  time: Time
  value?: number
  open?: number
  high?: number
  low?: number
  close?: number
}

interface PaintMarker {
  time: Time
  position?: string
  shape?: string
  color?: string
  text?: string
  price?: number
}

interface PaintSeries {
  kind: string
  paneIndex: number
  opts: { visible?: boolean; color?: string; lineWidth?: number; priceFormat?: { precision?: number }; [key: string]: unknown }
  values: readonly PaintDatum[]
  markers: readonly PaintMarker[]
  priceToCoordinate(price: number): number | null
}

interface PaintPrimitive {
  paneViews?(): readonly {
    zOrder?(): string
    renderer(): { draw(target: unknown, utils?: unknown): void; drawBackground?(target: unknown, utils?: unknown): void } | null
  }[]
  priceAxisViews?(): readonly unknown[]
}

interface PaintPriceLine { price: number; options: Record<string, unknown> }

interface RustRuntimePaintHost {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  engine: RustChartEngine
  getEngineSource(): PaintSeries | null
  getChartType(): 'candles' | 'line'
  series: Iterable<PaintSeries>
  primitives: Iterable<{ primitive: PaintPrimitive; series: PaintSeries }>
  priceLines: Iterable<PaintPriceLine>
  getAppearance(): ChartAppearanceSettings
  getOptions(): { crosshair?: boolean; localization?: { priceFormatter?: (price: number) => string } }
  getCrosshair(): { x: number; y: number } | null
  getLayout(): RustChartLayout | null
  getIndicatorPaneSizes(): RustChartIndicatorPaneSize[]
  getSecondaryIndicatorSeries(): RustIndicatorSeries[]
  getIndicatorManualRanges(): ReadonlyMap<number, RustIndicatorRange>
  getIndicatorScaleOptions(paneIndex: number): { invertScale: boolean }
  getIndicatorScale(paneIndex: number): RustIndicatorScale
  isSpacer(series: PaintSeries): boolean
  numberOption(value: unknown, fallback: number): number
  stamp(time: Time): number
}

export function createRustRuntimePainter(host: RustRuntimePaintHost) {
  function drawPrimitiveTarget(): unknown {
    const layout = host.getLayout()
    if (!layout) return null
    const { canvas, context } = host
    const dprX = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1
    const dprY = canvas.clientHeight > 0 ? canvas.height / canvas.clientHeight : 1
    const clipMedia = () => {
      context.beginPath()
      context.rect(0, 0, layout.plotWidth, layout.priceHeight)
      context.clip()
    }
    const clipBitmap = () => {
      context.beginPath()
      context.rect(0, 0, layout.plotWidth * dprX, layout.priceHeight * dprY)
      context.clip()
    }
    return {
      useBitmapCoordinateSpace: (callback: (scope: unknown) => void) => {
        context.save()
        context.setTransform(1, 0, 0, 1, 0, 0)
        clipBitmap()
        try {
          callback({ context, horizontalPixelRatio: dprX, verticalPixelRatio: dprY,
            bitmapSize: { width: Math.round(layout.plotWidth * dprX), height: Math.round(layout.priceHeight * dprY) } })
        } finally { context.restore() }
      },
      useMediaCoordinateSpace: (callback: (scope: unknown) => void) => {
        context.save()
        context.setTransform(dprX, 0, 0, dprY, 0, 0)
        clipMedia()
        try {
          callback({ context, horizontalPixelRatio: dprX, verticalPixelRatio: dprY,
            mediaSize: { width: layout.plotWidth, height: layout.priceHeight } })
        } finally { context.restore() }
      },
    }
  }

  function drawIndicatorSeries(): void {
    const layout = host.getLayout()
    if (!layout) return
    for (const item of host.series) {
      if (item.kind !== 'line' || item.opts.visible === false || item.paneIndex !== 0 || host.isSpacer(item)) continue
      if (item === host.getEngineSource() && host.getChartType() === 'line') continue
      host.context.save()
      host.context.beginPath()
      host.context.rect(0, 0, layout.plotWidth, layout.priceHeight)
      host.context.clip()
      host.context.strokeStyle = String(item.opts.color ?? '#2962ff')
      host.context.lineWidth = host.numberOption(item.opts.lineWidth, 1)
      host.context.beginPath()
      let started = false
      for (const datum of item.values) {
        const value = datum.value ?? datum.close
        if (value === undefined) continue
        const x = host.engine.timeToX(host.stamp(datum.time)), y = host.engine.priceToY(value)
        if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue
        if (started) host.context.lineTo(x, y)
        else { host.context.moveTo(x, y); started = true }
      }
      if (started) host.context.stroke()
      host.context.restore()
    }
  }


  function drawSecondaryIndicatorSeries(paneSizes: readonly RustChartIndicatorPaneSize[]): void {
    if (paneSizes.length === 0) return
    const layout = host.getLayout()
    if (!layout || layout.indicatorPanes.length === 0) return
    const invertedPanes = new Set<number>()
    const scales = new Map<number, RustIndicatorScale>()
    for (const pane of layout.indicatorPanes) {
      if (host.getIndicatorScaleOptions(pane.index).invertScale) invertedPanes.add(pane.index)
      scales.set(pane.index, host.getIndicatorScale(pane.index))
    }
    paintRustIndicatorPanes({
      context: host.context,
      layout,
      series: host.getSecondaryIndicatorSeries(),
      timeToX: (timestamp) => host.engine.timeToX(timestamp),
      appearance: host.getAppearance(),
      manualRanges: host.getIndicatorManualRanges(),
      invertedPanes,
      scales,
    })
  }

  function drawPriceLines(): void {
    const layout = host.getLayout()
    if (!layout) return
    for (const line of host.priceLines) {
      const y = host.engine.priceToY(line.price)
      if (y === null || !Number.isFinite(y)) continue
      const { context } = host
      const color = String(line.options.color ?? '#787b86')
      context.save()
      context.strokeStyle = color
      context.lineWidth = host.numberOption(line.options.lineWidth, 1)
      const style = line.options.lineStyle
      context.setLineDash(style === 2 ? [6, 4] : style === 1 ? [2, 2] : [])
      context.beginPath()
      context.moveTo(0, y + 0.5)
      context.lineTo(layout.plotWidth, y + 0.5)
      context.stroke()
      if (line.options.axisLabelVisible !== false) {
        context.fillStyle = color
        context.font = '11px sans-serif'
        context.textAlign = 'right'
        context.fillText(String(line.options.title ?? line.price), host.canvas.clientWidth - 4, y - 3)
      }
      context.restore()
    }
  }

  function drawPrimitiveAxisViews(): void {
    const { canvas, context } = host
    for (const { primitive, series } of host.primitives) {
      if (series.opts.visible === false) continue
      for (const candidate of primitive.priceAxisViews?.() ?? []) {
        const axis = candidate as { coordinate?: () => number; text?: () => string; textColor?: () => string; backColor?: () => string; visible?: () => boolean }
        const y = axis.coordinate?.()
        if (axis.visible?.() === false || y === undefined || !Number.isFinite(y)) continue
        const text = axis.text?.() ?? ''
        if (!text) continue
        context.save()
        context.font = '11px sans-serif'
        const width = context.measureText(text).width + 10
        const x = canvas.clientWidth - width
        context.fillStyle = axis.backColor?.() ?? '#2962ff'
        context.fillRect(x, y - 9, width, 18)
        context.fillStyle = axis.textColor?.() ?? '#fff'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(text, x + width / 2, y)
        context.restore()
      }
    }
  }
  function zRank(order: string | undefined): number {
    return order === 'bottom' ? 0 : order === 'top' ? 2 : 1
  }

  function drawPrimitives(): void {
    const target = drawPrimitiveTarget()
    if (!target) return
    const views = [...host.primitives]
      .filter(({ series }) => series.opts.visible !== false)
      .flatMap(({ primitive }) => primitive.paneViews?.() ?? [])
      .sort((left, right) => zRank(left.zOrder?.()) - zRank(right.zOrder?.()))
    for (const view of views) {
      const renderer = view.renderer()
      if (!renderer) continue
      renderer.drawBackground?.(target, undefined)
      renderer.draw(target, undefined)
    }
    drawPrimitiveAxisViews()
  }

  function drawSeriesMarkers(): void {
    const layout = host.getLayout()
    if (!layout) return
    const { context } = host
    context.save()
    context.beginPath()
    context.rect(0, 0, layout.plotWidth, layout.priceHeight)
    context.clip()
    for (const item of host.series) {
      if (item.opts.visible === false) continue
      for (const marker of item.markers) {
        const time = host.stamp(marker.time)
        const x = host.engine.timeToX(time)
        let low = 0
        let high = item.values.length
        while (low < high) {
          const middle = (low + high) >>> 1
          if (host.stamp(item.values[middle].time) < time) low = middle + 1
          else high = middle
        }
        const datum = item.values[low] && host.stamp(item.values[low].time) === time ? item.values[low] : undefined
        const markerPrice = marker.price ?? (marker.position === 'belowBar'
          ? datum?.low ?? datum?.close
          : marker.position === 'inBar' ? datum?.close : datum?.high ?? datum?.close)
        if (markerPrice === undefined) continue
        const y = item.priceToCoordinate(markerPrice)
        if (x == null || y == null) continue
        const color = String(marker.color ?? '#2962ff')
        context.save()
        context.fillStyle = color
        context.strokeStyle = color
        const radius = 4
        context.beginPath()
        if (marker.shape === 'square') context.rect(x - radius, y - radius, radius * 2, radius * 2)
        else if (marker.shape === 'arrowUp' || marker.shape === 'arrowDown') {
          const direction = marker.shape === 'arrowUp' ? -1 : 1
          context.moveTo(x, y + direction * radius)
          context.lineTo(x - radius, y - direction * radius)
          context.lineTo(x + radius, y - direction * radius)
          context.closePath()
        } else context.arc(x, y, radius, 0, Math.PI * 2)
        context.fill()
        if (typeof marker.text === 'string' && marker.text) {
          context.font = '11px sans-serif'
          context.textAlign = 'center'
          context.fillText(marker.text, x, y + (marker.position === 'belowBar' ? 16 : -10))
        }
        context.restore()
      }
    }
    context.restore()
  }

  function drawCrosshair(): void {
    const layout = host.getLayout()
    const crosshair = host.getCrosshair()
    const options = host.getOptions()
    if (!crosshair || options.crosshair === false || !layout) return
    const { context } = host
    context.save()
    context.strokeStyle = '#787b8688'
    context.lineWidth = 1
    context.setLineDash([4, 4])
    context.beginPath()
    context.moveTo(Math.round(crosshair.x) + 0.5, 0)
    context.lineTo(Math.round(crosshair.x) + 0.5, layout.priceHeight)
    context.moveTo(0, Math.round(crosshair.y) + 0.5)
    context.lineTo(layout.plotWidth, Math.round(crosshair.y) + 0.5)
    context.stroke()
    const price = host.engine.yToPrice(crosshair.y)
    if (price !== null && Number.isFinite(price)) {
      context.setLineDash([])
      context.fillStyle = '#787b86'
      context.fillRect(layout.plotWidth, crosshair.y - 9, layout.priceAxisWidth, 18)
      context.fillStyle = '#fff'
      context.font = '11px sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(options.localization?.priceFormatter?.(price) ?? price.toFixed(2), layout.plotWidth + layout.priceAxisWidth / 2, crosshair.y)
    }
    context.restore()
  }

  return {
    drawPrimitiveTarget,
    drawPrimitives,
    drawIndicatorSeries,
    drawSecondaryIndicatorSeries,
    drawPriceLines,
    drawPrimitiveAxisViews,
    drawSeriesMarkers,
    drawCrosshair,
  }
}
