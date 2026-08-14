export interface NumberRange {
  min: number
  max: number
}

export function finiteMinMax(values: Iterable<number>): NumberRange | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  return min === Number.POSITIVE_INFINITY ? null : { min, max }
}
