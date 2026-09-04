import { describe, expect, it } from 'vitest'
import { resolveMetric } from './live-template'
import type { LiveStatMetric } from '../../store/live-store'

const report = {
  overview: { totalPnl: 1234.5, winRate: 0.55, totalTrades: 40 },
  expectancy: { averageWin: 75, averageLoss: -40, profitFactor: 1.9 },
  riskReward: { averageRr: 1.4 },
}

describe('resolveMetric', () => {
  it.each([
    ['totalPnl', '$1,234.50'],
    ['winRate', '55.0%'],
    ['totalTrades', '40'],
    ['profitFactor', '1.90×'],
    ['averageRr', '1.40×'],
    ['averageWin', '$75.00'],
    ['averageLoss', '-$40.00'],
  ] as const)('%s formats correctly', (metric, expected) => {
    expect(resolveMetric(report as never, metric as LiveStatMetric)).toBe(expected)
  })

  it('renders a placeholder when profit factor is null', () => {
    expect(resolveMetric({ ...report, expectancy: { ...report.expectancy, profitFactor: null } } as never, 'profitFactor' as LiveStatMetric)).toBe('—')
  })
})