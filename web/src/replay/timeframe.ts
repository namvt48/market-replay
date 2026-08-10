import { z } from 'zod'
import type { Timeframe } from '../api/types'

export type TimeframeUnit = 'm' | 'h' | 'd' | 'w' | 'M'

export interface ParsedTimeframe {
  value: Timeframe
  multiplier: number
  unit: TimeframeUnit
  seconds: number
  isSessionDaily: boolean
}

const TIMEFRAME_PATTERN = /^(\d+)(m|M|h|H|d|D|w|W)$/

export function parseTimeframe(input: string): ParsedTimeframe | null {
  const match = TIMEFRAME_PATTERN.exec(input.trim())
  if (!match) return null
  const multiplier = Number(match[1])
  const rawUnit = match[2]
  const unit = (rawUnit === 'M' ? 'M' : rawUnit.toLowerCase()) as TimeframeUnit
  if (!Number.isInteger(multiplier) || multiplier < 1) return null
  if (unit === 'm' && multiplier > 1440) return null
  if (unit === 'h' && multiplier > 12) return null
  if (unit === 'd' && multiplier !== 1) return null
  if (unit === 'w' && multiplier > 52) return null
  if (unit === 'M' && multiplier > 12) return null
  if (unit === 'm' && multiplier % 60 === 0 && multiplier <= 720) {
    const hours = multiplier / 60
    return { value: `${hours}h`, multiplier: hours, unit: 'h', seconds: multiplier * 60, isSessionDaily: false }
  }
  return {
    value: `${multiplier}${unit}`,
    multiplier,
    unit,
    seconds: multiplier * (unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : unit === 'w' ? 604800 : 2_592_000),
    isSessionDaily: unit === 'd',
  }
}

export function normalizeTimeframe(input: string): Timeframe | null {
  return parseTimeframe(input)?.value ?? null
}

export function timeframeSeconds(timeframe: Timeframe): number {
  const parsed = parseTimeframe(timeframe)
  if (!parsed) throw new Error(`Unsupported timeframe: ${timeframe}`)
  return parsed.seconds
}

export function compareTimeframes(first: Timeframe, second: Timeframe): number {
  const durationDifference = timeframeSeconds(first) - timeframeSeconds(second)
  return durationDifference || first.localeCompare(second, undefined, { numeric: true })
}

export function sortTimeframes(timeframes: readonly Timeframe[]): Timeframe[] {
  return [...timeframes].sort(compareTimeframes)
}

export const timeframeSchema = z.string().transform((input, context): Timeframe => {
  const normalized = normalizeTimeframe(input)
  if (!normalized) {
    context.addIssue({ code: 'custom', message: 'Use 1–1440m, 1–12h, 1d, 1–52w, or 1–12M' })
    return z.NEVER
  }
  return normalized
})
