import { describe, expect, it } from 'vitest'
import { tradesToEngineInput } from './analytics-adapter'

describe('tradesToEngineInput', () => {
  it('normalizes optional analytics fields without mutating source data', () => {
    const source = [{ id: 't1', symbol: 'ES', side: 'short' as const, qty: 1.4, entryTs: 1, entryPriceTicks: 100, exitTs: 2, exitPriceTicks: 90, realizedCents: 1250, exitReason: 'unknown' }]
    const result = tradesToEngineInput(source)
    expect(result[0]).toMatchObject({ qty: 1, feesCents: 0, mfeTicks: 0, maeTicks: 0, rMultiple: null, initialStopTicks: null, exitReason: 'manual' })
    expect(source[0]?.qty).toBe(1.4)
  })
})
