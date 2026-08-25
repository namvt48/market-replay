import { describe, expect, it } from 'vitest'
import type { AnalyticsPerformance } from '../../api/analytics'
import { groupEvalEquityCurve } from './eval-analytics-period'

const points: AnalyticsPerformance['equityCurve'] = [
  { tradeIndex: 0, tradeId: null, closedAt: null, cumulativePnl: 0, balance: 50_000 },
  { tradeIndex: 1, tradeId: 't1', closedAt: '2025-03-01T14:02:00Z', cumulativePnl: 100, balance: 50_100 },
  { tradeIndex: 2, tradeId: 't2', closedAt: '2025-03-01T14:10:00Z', cumulativePnl: 200, balance: 50_200 },
  { tradeIndex: 3, tradeId: 't3', closedAt: '2025-03-01T14:16:00Z', cumulativePnl: 150, balance: 50_150 },
  { tradeIndex: 4, tradeId: 't4', closedAt: '2025-03-01T15:05:00Z', cumulativePnl: 250, balance: 50_250 },
  { tradeIndex: 5, tradeId: 't5', closedAt: '2025-03-02T14:02:00Z', cumulativePnl: 300, balance: 50_300 },
]

describe('groupEvalEquityCurve', () => {
  it('keeps the last equity point in each selected evaluation period', () => {
    expect(groupEvalEquityCurve(points, 'all', 'UTC')).toHaveLength(6)
    expect(groupEvalEquityCurve(points, 'day', 'UTC').map((point) => point.tradeId)).toEqual([null, 't4', 't5'])
    expect(groupEvalEquityCurve(points, 'hour', 'UTC').map((point) => point.tradeId)).toEqual([null, 't3', 't4', 't5'])
    expect(groupEvalEquityCurve(points, '15m', 'UTC').map((point) => point.tradeId)).toEqual([null, 't2', 't3', 't4', 't5'])
  })
})
