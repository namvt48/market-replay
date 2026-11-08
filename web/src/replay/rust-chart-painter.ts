import type { SymbolMeta } from '../api/types'
import type { ChartAppearanceSettings } from './chart-settings'
import { formatChartTime, type ChartTimezone } from './chart-timezone'

const GEOMETRY_STRIDE = 10
const X = 1
const OPEN_Y = 2
const HIGH_Y = 3
const LOW_Y = 4
const CLOSE_Y = 5
const VOLUME_TOP = 6
const VOLUME_BOTTOM = 7
const UP = 8
const MIN_PRICE_PANE_HEIGHT = 64

export interface RustChartIndicatorPaneSize {
  index: number
  height: number
}

export interface RustChartIndicatorPaneLayout extends RustChartIndicatorPaneSize {
  top: number
}

export interface RustChartPainterInput {
  context: CanvasRenderingContext2D
  canvas: HTMLCanvasElement
  geometry: Float64Array
  engine: {
    visibleRange(): { from: number; to: number } | null
    priceRange(): { min: number; max: number }
    priceScaleMode(): 'normal' | 'logarithmic' | 'percentage'
    logicalToTime(logical: number): number | null
    xToTime(x: number): number | null
    priceToY(price: number): number | null
    priceToScaleValue(price: number): number | null
    yToPrice(y: number): number | null
  }
  appearance: ChartAppearanceSettings
  symbol: Pick<SymbolMeta, 'priceDecimals'>
  timezone: ChartTimezone
  secondsVisible?: boolean
  volumeHeight?: number
  indicatorPaneSizes?: readonly RustChartIndicatorPaneSize[]
}

export interface RustChartLayout {
  width: number
  height: number
  plotWidth: number
  plotHeight: number
  priceHeight: number
  volumeHeight: number
  priceAxisWidth: number
  timeAxisHeight: number
  indicatorPanes: RustChartIndicatorPaneLayout[]
}

interface PaintLayout extends RustChartLayout {
  barWidth: number
  topPriceY: number
  bottomPriceY: number
  logicalFrom: number
  logicalSpan: number
}

export function measureRustChartLayout(
  canvas: HTMLCanvasElement,
  showVolume: boolean,
  volumeHeight?: number,
  indicatorPaneSizes: readonly RustChartIndicatorPaneSize[] = [],
): RustChartLayout | null {
  const width = canvas.clientWidth || canvas.width
  const height = canvas.clientHeight || canvas.height
  if (!(width > 0) || !(height > 0)) return null

  const priceAxisWidth = Math.min(76, Math.max(54, width * 0.12))
  const timeAxisHeight = Math.min(28, Math.max(22, height * 0.08))
  const plotWidth = width - priceAxisWidth
  const plotHeight = height - timeAxisHeight
  if (!(plotWidth > 0) || !(plotHeight > 0)) return null

  const measuredVolumeHeight = showVolume
    ? Math.min(plotHeight * 0.45, Math.max(32, volumeHeight ?? 120))
    : 0
  let requestedIndicatorHeight = 0
  for (const pane of indicatorPaneSizes) {
    if (Number.isInteger(pane.index) && pane.index > 0 && Number.isFinite(pane.height) && pane.height > 0) {
      requestedIndicatorHeight += pane.height
    }
  }
  const availableIndicatorHeight = Math.max(0, plotHeight - measuredVolumeHeight - MIN_PRICE_PANE_HEIGHT)
  const indicatorScale = requestedIndicatorHeight > availableIndicatorHeight && requestedIndicatorHeight > 0
    ? availableIndicatorHeight / requestedIndicatorHeight
    : 1
  const indicatorPanes: RustChartIndicatorPaneLayout[] = []
  let indicatorTop = plotHeight - requestedIndicatorHeight * indicatorScale
  for (const pane of indicatorPaneSizes) {
    if (!Number.isInteger(pane.index) || pane.index <= 0 || !Number.isFinite(pane.height) || pane.height <= 0) continue
    const paneHeight = pane.height * indicatorScale
    indicatorPanes.push({ index: pane.index, top: indicatorTop, height: paneHeight })
    indicatorTop += paneHeight
  }

  return {
    width,
    height,
    plotWidth,
    plotHeight,
    priceHeight: Math.max(0, plotHeight - measuredVolumeHeight - requestedIndicatorHeight * indicatorScale),
    volumeHeight: measuredVolumeHeight,
    priceAxisWidth,
    timeAxisHeight,
    indicatorPanes,
  }
}

function createPaintLayout(input: RustChartPainterInput): PaintLayout | null {
  const { canvas, engine, appearance } = input
  const dimensions = measureRustChartLayout(canvas, appearance.showVolume, input.volumeHeight, input.indicatorPaneSizes)
  if (!dimensions) return null
  const { width, plotWidth, priceHeight } = dimensions
  const { height, plotHeight, volumeHeight, priceAxisWidth, timeAxisHeight } = dimensions
  const visible = engine.visibleRange()
  const logicalSpan = visible && visible.to > visible.from ? visible.to - visible.from : 0
  const range = engine.priceRange()
  const minY = engine.priceToY(range.min)
  const maxY = engine.priceToY(range.max)
  const topPriceY = Math.max(0, Math.min(minY ?? 0, maxY ?? priceHeight))
  const bottomPriceY = Math.min(priceHeight, Math.max(minY ?? priceHeight, maxY ?? 0))

  return {
    width,
    height,
    plotWidth,
    plotHeight,
    priceHeight,
    volumeHeight,
    priceAxisWidth,
    timeAxisHeight,
    indicatorPanes: dimensions.indicatorPanes,
    barWidth: logicalSpan > 0 ? Math.max(1, Math.min(12, plotWidth / logicalSpan * 0.72)) : 1,
    topPriceY,
    bottomPriceY,
    logicalFrom: visible?.from ?? 0,
    logicalSpan,
  }
}


function drawGrid(
  context: CanvasRenderingContext2D,
  layout: PaintLayout,
  appearance: ChartAppearanceSettings,
): void {
  if (!appearance.showGrid) return
  context.lineWidth = 1
  context.strokeStyle = appearance.horizontalGridColor
  context.beginPath()
  for (let tick = 0; tick <= 5; tick += 1) {
    const y = layout.topPriceY + (layout.bottomPriceY - layout.topPriceY) * tick / 5
    context.moveTo(0, Math.floor(y) + 0.5)
    context.lineTo(layout.plotWidth, Math.floor(y) + 0.5)
  }
  context.stroke()

  context.strokeStyle = appearance.verticalGridColor
  context.beginPath()
  for (let tick = 0; tick <= 6; tick += 1) {
    const x = layout.plotWidth * tick / 6
    context.moveTo(Math.floor(x) + 0.5, 0)
    context.lineTo(Math.floor(x) + 0.5, layout.plotHeight)
  }
  context.stroke()
}

function isFiniteBarGeometry(geometry: Float64Array, offset: number): boolean {
  return Number.isFinite(geometry[offset + X]) &&
    Number.isFinite(geometry[offset + OPEN_Y]) &&
    Number.isFinite(geometry[offset + HIGH_Y]) &&
    Number.isFinite(geometry[offset + LOW_Y]) &&
    Number.isFinite(geometry[offset + CLOSE_Y])
}

function drawCandleWicks(
  context: CanvasRenderingContext2D,
  geometry: Float64Array,
  layout: PaintLayout,
  appearance: ChartAppearanceSettings,
  isUp: boolean,
): void {
  context.strokeStyle = isUp ? appearance.wickUpColor : appearance.wickDownColor
  context.lineWidth = 1
  context.beginPath()
  for (let offset = 0; offset + GEOMETRY_STRIDE <= geometry.length; offset += GEOMETRY_STRIDE) {
    if (!isFiniteBarGeometry(geometry, offset) || (geometry[offset + UP] !== 0) !== isUp) continue
    const x = geometry[offset + X]
    if (x < 0 || x >= layout.plotWidth) continue
    context.moveTo(Math.round(x) + 0.5, geometry[offset + HIGH_Y])
    context.lineTo(Math.round(x) + 0.5, geometry[offset + LOW_Y])
  }
  context.stroke()
}

function drawCandleBodies(
  context: CanvasRenderingContext2D,
  geometry: Float64Array,
  layout: PaintLayout,
  appearance: ChartAppearanceSettings,
  isUp: boolean,
): void {
  context.fillStyle = isUp ? appearance.upColor : appearance.downColor
  context.beginPath()
  for (let offset = 0; offset + GEOMETRY_STRIDE <= geometry.length; offset += GEOMETRY_STRIDE) {
    if (!isFiniteBarGeometry(geometry, offset) || (geometry[offset + UP] !== 0) !== isUp) continue
    const x = geometry[offset + X]
    if (x < 0 || x >= layout.plotWidth) continue
    const openY = geometry[offset + OPEN_Y]
    const closeY = geometry[offset + CLOSE_Y]
    context.rect(
      x - layout.barWidth / 2,
      Math.min(openY, closeY),
      layout.barWidth,
      Math.max(1, Math.abs(closeY - openY)),
    )
  }
  context.fill()
  if (!appearance.borderVisible) return
  context.strokeStyle = isUp ? appearance.borderUpColor : appearance.borderDownColor
  context.stroke()
}

function drawCandlesForDirection(
  context: CanvasRenderingContext2D,
  geometry: Float64Array,
  layout: PaintLayout,
  appearance: ChartAppearanceSettings,
  isUp: boolean,
): void {
  drawCandleWicks(context, geometry, layout, appearance, isUp)
  drawCandleBodies(context, geometry, layout, appearance, isUp)
}

function drawCandles(
  context: CanvasRenderingContext2D,
  geometry: Float64Array,
  layout: PaintLayout,
  appearance: ChartAppearanceSettings,
): void {
  drawCandlesForDirection(context, geometry, layout, appearance, true)
  drawCandlesForDirection(context, geometry, layout, appearance, false)
}

function drawLine(
  context: CanvasRenderingContext2D,
  geometry: Float64Array,
  layout: PaintLayout,
  color: string,
): void {
  context.strokeStyle = color
  context.lineWidth = 2
  context.beginPath()
  let hasPoint = false
  for (let offset = 0; offset + GEOMETRY_STRIDE <= geometry.length; offset += GEOMETRY_STRIDE) {
    const x = geometry[offset + X]
    const y = geometry[offset + CLOSE_Y]
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= layout.plotWidth) {
      hasPoint = false
      continue
    }
    if (hasPoint) context.lineTo(x, y)
    else context.moveTo(x, y)
    hasPoint = true
  }
  context.stroke()
}

function drawVolumeForDirection(
  context: CanvasRenderingContext2D,
  geometry: Float64Array,
  layout: PaintLayout,
  appearance: ChartAppearanceSettings,
  isUp: boolean,
): void {
  context.fillStyle = isUp ? appearance.upColor : appearance.downColor
  context.beginPath()
  for (let offset = 0; offset + GEOMETRY_STRIDE <= geometry.length; offset += GEOMETRY_STRIDE) {
    const x = geometry[offset + X]
    const volumeTop = geometry[offset + VOLUME_TOP]
    const volumeBottom = geometry[offset + VOLUME_BOTTOM]
    if (!Number.isFinite(x) || !Number.isFinite(volumeTop) || !Number.isFinite(volumeBottom)) continue
    if ((geometry[offset + UP] !== 0) !== isUp || x < 0 || x >= layout.plotWidth) continue
    const top = layout.priceHeight + Math.min(volumeTop, volumeBottom)
    const bottom = layout.priceHeight + Math.max(volumeTop, volumeBottom)
    context.rect(x - layout.barWidth / 2, top, layout.barWidth, Math.max(1, bottom - top))
  }
  context.fill()
}

function drawVolume(
  context: CanvasRenderingContext2D,
  geometry: Float64Array,
  layout: PaintLayout,
  appearance: ChartAppearanceSettings,
): void {
  if (!appearance.showVolume || layout.volumeHeight <= 0) return
  context.globalAlpha = 0.55
  drawVolumeForDirection(context, geometry, layout, appearance, true)
  drawVolumeForDirection(context, geometry, layout, appearance, false)
  context.globalAlpha = 1
}

function drawPriceAxis(
  context: CanvasRenderingContext2D,
  layout: PaintLayout,
  engine: RustChartPainterInput['engine'],
  symbol: RustChartPainterInput['symbol'],
  textColor: string,
): void {
  const span = layout.bottomPriceY - layout.topPriceY
  if (!(span > 0)) return
  context.fillStyle = textColor
  context.textAlign = 'left'
  for (let tick = 0; tick <= 5; tick += 1) {
    const y = layout.topPriceY + span * tick / 5
    const price = engine.yToPrice(y)
    if (price !== null && Number.isFinite(price)) {
      const percentage = engine.priceScaleMode() === 'percentage'
        ? engine.priceToScaleValue(price)
        : null
      const label = percentage === null
        ? price.toFixed(symbol.priceDecimals)
        : `${percentage.toFixed(2)}%`
      context.fillText(label, layout.plotWidth + 8, y)
    }
  }
}

function drawTimeAxis(
  context: CanvasRenderingContext2D,
  layout: PaintLayout,
  engine: RustChartPainterInput['engine'],
  timezone: ChartTimezone,
  secondsVisible: boolean,
): void {
  if (!(layout.logicalSpan > 0)) return
  context.textAlign = 'center'
  for (let tick = 0; tick <= 6; tick += 1) {
    const x = layout.plotWidth * tick / 6
    const timestamp = engine.xToTime(x) ??
      engine.logicalToTime(layout.logicalFrom + layout.logicalSpan * tick / 6)
    if (timestamp !== null && Number.isFinite(timestamp)) {
      context.fillText(formatChartTime(timestamp, timezone, false, secondsVisible), x, layout.plotHeight + layout.timeAxisHeight / 2)
    }
  }
}

function drawAxes(
  context: CanvasRenderingContext2D,
  layout: PaintLayout,
  input: RustChartPainterInput,
): void {
  context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
  context.fillStyle = input.appearance.textColor
  context.textBaseline = 'middle'
  drawPriceAxis(context, layout, input.engine, input.symbol, input.appearance.textColor)
  drawTimeAxis(context, layout, input.engine, input.timezone, input.secondsVisible ?? false)
  context.strokeStyle = '#434651'
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(layout.plotWidth + 0.5, 0)
  context.lineTo(layout.plotWidth + 0.5, layout.height)
  context.moveTo(0, layout.plotHeight + 0.5)
  context.lineTo(layout.width, layout.plotHeight + 0.5)
  context.stroke()
}

export function paintRustChart(input: RustChartPainterInput): void {
  const layout = createPaintLayout(input)
  if (!layout) return
  const { context, canvas, geometry, appearance } = input
  const horizontalPixelRatio = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1
  const verticalPixelRatio = canvas.clientHeight > 0 ? canvas.height / canvas.clientHeight : 1

  context.save()
  try {
    context.setTransform(horizontalPixelRatio, 0, 0, verticalPixelRatio, 0, 0)
    context.fillStyle = appearance.backgroundColor
    context.fillRect(0, 0, layout.width, layout.height)
    context.save()
    context.beginPath()
    context.rect(0, 0, layout.plotWidth, layout.plotHeight)
    context.clip()
    drawGrid(context, layout, appearance)
    if (appearance.chartType === 'candles') drawCandles(context, geometry, layout, appearance)
    else drawLine(context, geometry, layout, appearance.upColor)
    drawVolume(context, geometry, layout, appearance)
    context.restore()
    drawAxes(context, layout, input)
  } finally {
    context.restore()
  }
}
