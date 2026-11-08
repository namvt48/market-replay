import type { Time } from 'lightweight-charts'
import type { ChartAppearanceSettings } from './chart-settings'
import type { RustChartLayout } from './rust-chart-painter'

export interface RustIndicatorSeries {
  paneIndex: number
  color: string
  lineWidth: number
  data: readonly { time: Time; value?: number; close?: number }[]
}

export interface RustIndicatorRange {
  min: number
  max: number
}

export interface RustIndicatorScale {
  toScale(value: number): number | null
  fromScale(value: number): number | null
  formatScale(value: number): string
}

interface IndicatorPanePainterInput {
  context: CanvasRenderingContext2D
  layout: RustChartLayout
  series: readonly RustIndicatorSeries[]
  timeToX(timestamp: number): number | null
  appearance: Pick<ChartAppearanceSettings, 'textColor' | 'horizontalGridColor' | 'showGrid'>
  manualRanges?: ReadonlyMap<number, RustIndicatorRange>
  invertedPanes?: ReadonlySet<number>
  scales?: ReadonlyMap<number, RustIndicatorScale>
}
const IDENTITY_SCALE: RustIndicatorScale = {
  toScale: (value) => value,
  fromScale: (value) => value,
  formatScale: (value) => value.toFixed(2),
}
export type RustIndicatorScaleMode = 0 | 1 | 2

function toLogScale(value: number): number {
  const magnitude = Math.abs(value)
  if (magnitude < 1e-15) return 0
  const scaled = Math.log10(magnitude + 0.0001) + 4
  return value < 0 ? -scaled : scaled
}

function fromLogScale(value: number): number {
  const magnitude = Math.abs(value)
  if (magnitude < 1e-15) return 0
  const unscaled = 10 ** (magnitude - 4) - 0.0001
  return value < 0 ? -unscaled : unscaled
}

const LOGARITHMIC_SCALE: RustIndicatorScale = {
  toScale: toLogScale,
  fromScale: fromLogScale,
  formatScale: (value) => fromLogScale(value).toPrecision(4),
}

export function createRustIndicatorScale(mode: RustIndicatorScaleMode, base: number | null): RustIndicatorScale {
  if (mode === 1) return LOGARITHMIC_SCALE
  if (mode === 2 && base !== null && base !== 0) {
    return {
      toScale: (value) => {
        const percentage = 100 * (value - base) / base
        return base < 0 ? -percentage : percentage
      },
      fromScale: (value) => base + ((base < 0 ? -value : value) / 100) * base,
      formatScale: (value) => `${value.toFixed(2)}%`,
    }
  }
  return IDENTITY_SCALE
}

function timestamp(time: Time): number {
  if (typeof time === 'number') return time
  if (typeof time === 'string') return Math.floor(Date.parse(time) / 1000)
  return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000)
}

function datumValue(datum: RustIndicatorSeries['data'][number]): number | null {
  const value = datum.value ?? datum.close
  return value !== undefined && Number.isFinite(value) ? value : null
}

export function rustIndicatorPaneRange(
  paneIndex: number,
  series: readonly RustIndicatorSeries[],
  timeToX: IndicatorPanePainterInput['timeToX'],
  plotWidth: number,
  toScale: RustIndicatorScale['toScale'] = (value) => value,
): RustIndicatorRange | null {
  let min = Infinity
  let max = -Infinity
  for (const item of series) {
    if (item.paneIndex !== paneIndex) continue
    for (const datum of item.data) {
      const value = datumValue(datum)
      const pointTime = value === null ? null : timestamp(datum.time)
      const x = pointTime === null || !Number.isFinite(pointTime) ? null : timeToX(pointTime)
      const scaled = value === null ? null : toScale(value)
      if (scaled === null || !Number.isFinite(scaled) || x === null || !Number.isFinite(x) || x < 0 || x > plotWidth) continue
      min = Math.min(min, scaled)
      max = Math.max(max, scaled)
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  const span = max - min
  const padding = span > 0 ? span * 0.08 : Math.max(Math.abs(max) * 0.02, 1)
  return { min: min - padding, max: max + padding }
}

function drawPaneGrid(
  context: CanvasRenderingContext2D,
  pane: RustChartLayout['indicatorPanes'][number],
  plotWidth: number,
  color: string,
  showGrid: boolean,
): void {
  context.strokeStyle = color
  context.lineWidth = 1
  context.beginPath()
  if (showGrid) {
    for (let tick = 0; tick <= 4; tick += 1) {
      const y = pane.top + pane.height * tick / 4
      context.moveTo(0, Math.floor(y) + 0.5)
      context.lineTo(plotWidth, Math.floor(y) + 0.5)
    }
  }
  context.moveTo(0, Math.floor(pane.top) + 0.5)
  context.lineTo(plotWidth, Math.floor(pane.top) + 0.5)
  context.stroke()
}

function drawPaneSeries(
  context: CanvasRenderingContext2D,
  paneIndex: number,
  pane: RustChartLayout['indicatorPanes'][number],
  range: RustIndicatorRange,
  series: readonly RustIndicatorSeries[],
  timeToX: IndicatorPanePainterInput['timeToX'],
  plotWidth: number,
  inverted: boolean,
  scale: RustIndicatorScale,
): void {
  for (const item of series) {
    if (item.paneIndex !== paneIndex) continue
    context.strokeStyle = item.color
    context.lineWidth = item.lineWidth
    context.beginPath()
    let started = false
    for (const datum of item.data) {
      const value = datumValue(datum)
      const pointTime = value === null ? null : timestamp(datum.time)
      const x = pointTime === null || !Number.isFinite(pointTime) ? null : timeToX(pointTime)
      const scaled = value === null ? null : scale.toScale(value)
      if (scaled === null || !Number.isFinite(scaled) || x === null || !Number.isFinite(x) || x < 0 || x > plotWidth) {
        started = false
        continue
      }
      const fraction = inverted ? (scaled - range.min) / (range.max - range.min)
        : (range.max - scaled) / (range.max - range.min)
      const y = pane.top + fraction * pane.height
      if (started) context.lineTo(x, y)
      else context.moveTo(x, y)
      started = true
    }
    if (started) context.stroke()
  }
}

function drawPaneAxis(
  context: CanvasRenderingContext2D,
  pane: RustChartLayout['indicatorPanes'][number],
  range: RustIndicatorRange,
  layout: RustChartLayout,
  textColor: string,
  inverted: boolean,
  scale: RustIndicatorScale,
): void {
  context.fillStyle = textColor
  context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
  context.textAlign = 'left'
  context.textBaseline = 'middle'
  for (let tick = 0; tick <= 4; tick += 1) {
    const fraction = tick / 4
    const scaled = inverted
      ? range.min + (range.max - range.min) * fraction
      : range.max - (range.max - range.min) * fraction
    const y = pane.top + pane.height * fraction
    context.fillText(scale.formatScale(scaled), layout.plotWidth + 8, y)
  }
}

function transformManualRange(
  range: RustIndicatorRange,
  scale: RustIndicatorScale,
): RustIndicatorRange | null {
  const min = scale.toScale(range.min)
  const max = scale.toScale(range.max)
  return min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max) || max <= min
    ? null : { min, max }
}

export function paintRustIndicatorPanes(input: IndicatorPanePainterInput): ReadonlyMap<number, RustIndicatorRange> {
  const { context, layout, series, timeToX, appearance } = input
  const ranges = new Map<number, RustIndicatorRange>()
  for (const pane of layout.indicatorPanes) {
    const inverted = input.invertedPanes?.has(pane.index) ?? false
    const scale = input.scales?.get(pane.index) ?? IDENTITY_SCALE
    const manual = input.manualRanges?.get(pane.index)
    const range = manual
      ? transformManualRange(manual, scale)
      : rustIndicatorPaneRange(pane.index, series, timeToX, layout.plotWidth, scale.toScale)
    if (!range) continue
    ranges.set(pane.index, range)
    context.save()
    context.beginPath()
    context.rect(0, pane.top, layout.plotWidth, pane.height)
    context.clip()
    drawPaneGrid(context, pane, layout.plotWidth, appearance.horizontalGridColor, appearance.showGrid)
    drawPaneSeries(context, pane.index, pane, range, series, timeToX, layout.plotWidth, inverted, scale)
    context.restore()
    drawPaneAxis(context, pane, range, layout, appearance.textColor, inverted, scale)
  }
  return ranges
}
