import type {
  Logical,
  LogicalRange,
  MouseEventParams,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts'

export interface RuntimeMarker {
  time: Time
  position?: string
  shape?: string
  color?: string
  text?: string
  price?: number
  high?: number
  low?: number
}

export interface RuntimeSeriesOptions {
  visible?: boolean
  color?: string
  lineWidth?: number
  priceScaleId?: string
  priceLineVisible?: boolean
  lastValueVisible?: boolean
  upColor?: string
  downColor?: string
  wickUpColor?: string
  wickDownColor?: string
  borderUpColor?: string
  borderDownColor?: string
  [key: string]: unknown
}

export interface RuntimeDatum {
  time: Time
  value?: number
  open?: number
  high?: number
  low?: number
  close?: number
  color?: string
  [key: string]: unknown
}

export type Handler<T> = (value: T) => void
export type SeriesKind = 'candle' | 'line' | 'histogram' | 'spacer'
export interface RuntimePriceLine { price: number; options: Record<string, unknown> }
export interface RuntimePrimitive {
  attached?(params: SeriesAttachedParameter<Time, SeriesType>): void
  detached?(): void
  paneViews?(): readonly {
    zOrder?(): string
    renderer(): { draw(target: unknown, utils?: unknown): void; drawBackground?(target: unknown, utils?: unknown): void } | null
  }[]
  priceAxisViews?(): readonly unknown[]
  autoscaleInfo?(startTimePoint: number, endTimePoint: number): {
    priceRange: { minValue: number; maxValue: number }
    margins?: { above: number; below: number }
  } | null
}

export type NumericLogicalRange = { from: number; to: number }
export type RuntimePriceScaleApi = {
  width(): number
  options(): object
  applyOptions(next: Record<string, unknown>): void
  setVisibleRange(range: { from: number; to: number }): void
  getVisibleRange(): { from: number; to: number } | null
  setAutoScale(on: boolean): void
}
export type RuntimePriceFormatter = {
  format(price: number): string
  formatTickmarks(prices: readonly number[]): string[]
}
export type RuntimeAttachedParams = SeriesAttachedParameter<Time, SeriesType>
export type RuntimeMouseEvent = MouseEventParams<Time>

export function toLogicalRange(range: NumericLogicalRange | null): LogicalRange | null {
  return range === null ? null : { from: range.from as Logical, to: range.to as Logical }
}

export const asTime = (value: number): Time => value as Time

export function stamp(time: Time): number {
  if (typeof time === 'number') return time
  if (typeof time === 'string') return Math.floor(Date.parse(time) / 1000)
  return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000)
}

export function numberOption(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
