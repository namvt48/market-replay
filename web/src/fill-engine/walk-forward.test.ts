import { describe, expect, it } from 'vitest'
import { analyzeWalkForward } from './walk-forward'

describe('analyzeWalkForward', () => {
  it('uses a chronological 80/20 split and exposes sensitivity metadata', () => {
    const result = analyzeWalkForward({ r: [1, 1, 1, 1, 2], exitTs: [1, 2, 3, 4, 5] }, { windows: 2 })
    expect(result.inSample).toEqual({ trades: 4, expectancyR: 1 })
    expect(result.outOfSample).toEqual({ trades: 1, expectancyR: 2 })
    expect(result.retentionRatio).toBe(2)
    expect(result.parameterSensitivity.points).toHaveLength(49)
    expect(result.parameterSensitivity.proxy).toBe(true)
  })
})
