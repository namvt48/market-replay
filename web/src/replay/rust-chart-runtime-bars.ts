import type { DisplayBar } from './chart-adapter'
import { stamp, type RuntimeDatum } from './rust-chart-runtime-types'
interface RuntimeBarDatum {
  time: RuntimeDatum['time']
  value?: number
  open?: number
  high?: number
  low?: number
  close?: number
}

export interface RuntimeBarSeries {
  kind: string
  values: readonly RuntimeBarDatum[]
}

export function isSpacer(item: RuntimeBarSeries): boolean {
  return item.kind === 'spacer' || (item.kind === 'line' && item.values.length > 0 &&
    item.values.every((datum) => datum.value === undefined && datum.open === undefined &&
      datum.high === undefined && datum.low === undefined && datum.close === undefined))
}

export function volumeAt(time: number, histogram: RuntimeBarSeries | undefined, cursor: { index: number }): number {
  if (!histogram) return 0
  while (cursor.index < histogram.values.length && stamp(histogram.values[cursor.index].time) < time) cursor.index += 1
  const datum = histogram.values[cursor.index]
  if (!datum || stamp(datum.time) !== time) return 0
  const value = Number(datum.value ?? 0)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function normalizedBar(datum: RuntimeDatum, volume: number): DisplayBar | null {
  const close = Number(datum.close ?? datum.value)
  const open = Number(datum.open ?? close)
  const high = Number(datum.high ?? Math.max(open, close))
  const low = Number(datum.low ?? Math.min(open, close))
  if (![open, high, low, close].every(Number.isFinite)) return null
  return { time: stamp(datum.time), open, high, low, close, volume }
}

export function barMatches(datum: RuntimeDatum, volume: number, cached: DisplayBar): boolean {
  const close = Number(datum.close ?? datum.value)
  const open = Number(datum.open ?? close)
  const high = Number(datum.high ?? Math.max(open, close))
  const low = Number(datum.low ?? Math.min(open, close))
  return cached.time === stamp(datum.time) && cached.open === open && cached.high === high &&
    cached.low === low && cached.close === close && cached.volume === volume
}
