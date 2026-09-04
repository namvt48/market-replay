import type { AnalyticsPerformance } from '../../api/analytics'
import type { LiveStatMetric } from '../../store/live-store'

function dollars(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export function resolveMetric(report: AnalyticsPerformance, metric: LiveStatMetric): string {
  switch (metric) {
    case 'totalPnl': return dollars(report.overview.totalPnl)
    case 'winRate': return `${report.overview.winRate.toFixed(1)}%`
    case 'totalTrades': return String(report.overview.totalTrades)
    case 'profitFactor': {
      const pf = report.expectancy.profitFactor
      return pf == null ? '—' : `${pf.toFixed(2)}×`
    }
    case 'averageRr': return `${report.riskReward.averageRr.toFixed(2)}×`
    case 'averageWin': return dollars(report.expectancy.averageWin)
    case 'averageLoss': return dollars(report.expectancy.averageLoss)
  }
}