import { describe, expect, it } from 'vitest'
import { finiteMinMax } from './number-range'

describe('finiteMinMax', () => {
  it('finds a range across arrays too large for function-argument spread', () => {
    const values = Array.from({ length: 100_000 }, (_, index) => index - 50_000)
    values.push(Number.NaN, Number.POSITIVE_INFINITY)

    expect(finiteMinMax(values)).toEqual({ min: -50_000, max: 49_999 })
  })

  it('returns null when no finite value exists', () => {
    expect(finiteMinMax([Number.NaN, Number.NEGATIVE_INFINITY])).toBeNull()
  })
})
