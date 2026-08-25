import { describe, expect, it } from 'vitest'
import type { AnalyticsPerformance } from '../../api/analytics'
import { performanceFixture } from './analytics-fixtures'
import { toAnalyticsReportView } from './analytics-view-model'

describe('analytics calendar view model', () => {
  it('groups daily risk reward in the report timezone', () => {
    const report: AnalyticsPerformance = {
      ...performanceFixture,
      calendar: [
        { date: '2025-02-28', trades: 1, wins: 1, losses: 0, breakeven: 0, pnl: 500, pnlPercent: 0.5, endingBalance: 100_500 },
        { date: '2025-03-01', trades: 1, wins: 0, losses: 1, breakeven: 0, pnl: -250, pnlPercent: -0.25, endingBalance: 100_250 },
      ],
      riskReward: {
        ...performanceFixture.riskReward,
        series: {
          ...performanceFixture.riskReward.series,
          actual: [{ tradeIndex: 1, tradeId: 't1', closedAt: '2025-03-01T01:00:00Z', rr: 1.75 }],
        },
      },
    }

    const view = toAnalyticsReportView(report, 'America/New_York')

    expect(view.calendarInitialDate).toBe('2025-03-01')
    expect(view.calendarEntries).toEqual([
      expect.objectContaining({ date: '2025-02-28', riskReward: 1.75 }),
      expect.objectContaining({ date: '2025-03-01', riskReward: null }),
    ])
  })
})
