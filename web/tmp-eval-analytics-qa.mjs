import { chromium } from 'playwright'

const startTs = 1705276800
const config = {
  firm: 'TopStep 50K (EOD trail)', accountSize: 50000, profitTarget: 3000, verificationProfitTarget: 0,
  maxDailyLoss: 1000, maxTotalLoss: 2000, drawdownType: 'trailing', trailingLocksAtStart: true,
  trailingLockAtTarget: false, lockMargin: 0, trailingEod: true, maxPositionSize: 5,
  minTradingDays: 0, consistencyRulePct: 50, consistencyMode: 'of-profit-target',
  dailyLossBase: 'day-start-equity', dayResetHour: 17,
  payout: {
    profitSplit: 90, eligibilityMode: 'winning-days', minWinningDays: 5, minDailyProfit: 150,
    eligibilityConsistencyPct: 40, minFundedDays: 0, maxPayoutPct: 50, maxPayoutAmount: 5000,
    minPayoutAmount: 0, maxPayouts: 0, safetyNet: 'none', safetyNetMargin: 0,
    requireProfitableSinceLastPayout: true,
  },
}
const runtime = {
  startBalance: 50000, peakEquity: 50500, eodPeak: 50500, lastEquity: 47938.70,
  dayKey: 19740, dayStartEquity: 48200, dayStartBalance: 48200, outcome: 'failed', failReason: 'total',
  failedAt: startTs + 17 * 86400, passedAt: null, payoutsTaken: 0, lastPayoutAt: null,
  profitSinceLastPayout: 0, fundedStartTs: 0, winningDays: 0, bestDaySincePayout: 0,
  payoutWindowDailyProfits: {},
}
const trades = Array.from({ length: 32 }, (_, index) => ({
  id: `t${index + 1}`, symbol: index % 2 === 0 ? 'NQ' : 'ES', side: index % 3 === 0 ? 'long' : 'short',
  qty: index % 5 + 1, entryTime: startTs + index * 45000, exitTime: startTs + index * 45000 + 3600,
  realizedCents: index < 5 ? 35000 : -8275,
}))
const account = {
  version: 2, phase: 'failed', accountId: 'eval-topstep', sessionId: 'source-1', config,
  instrument: null, sessionTimezone: 'America/New_York', startDate: '2024-01-15', startTs,
  attemptStartedAt: startTs, lastCursorTs: startTs + 17 * 86400 + 13 * 3600, runtime,
  baselineRealizedCents: 0, baselineEquityCents: 0, lastEvalBalance: 47938.70, lastEvalEquity: 47938.70,
  lastTradeIds: trades.map((trade) => trade.id), trades, payoutHistory: [],
}
const curveValues = [0, -210, -580, 380, 390, 160, 20, -310, -370, -850, -970, 450, -440, -720, -880, -1120, -1450, -1720, -2061.30]
const performance = {
  source: { id: 'source-1', type: 'evaluation', title: config.firm, subtitle: 'Jan 15–Feb 01, 2024 · 32 closed trades', status: 'stopped', initialBalance: 50000 },
  overview: { totalPnl: -2061.30, pnlPercent: -4.12, accountBalance: 47938.70, winRate: 15.63, totalTrades: 32, longTrades: 11, shortTrades: 21, breakevenTrades: 0 },
  equityCurve: curveValues.map((value, index) => ({ tradeIndex: index, tradeId: index === 0 ? null : `t${index}`, closedAt: index === 0 ? null : new Date((startTs + index * 86400) * 1000).toISOString(), cumulativePnl: value, balance: 50000 + value })),
  riskReward: { averageRr: -.2, maxRr: 1.5, idealAverageRr: .8, maxIdealRr: 2.2, couldHaveProfitOrBreakeven: 2, couldHaveMaxIdealRr: 2.2, series: { actual: [], ideal: [], missed: [] }, excludedTrades: 0, missingMarketDataTrades: 0 },
  expectancy: { value: -64.42, averageWin: 350, averageLoss: -141.16, profitFactor: .46 },
  winners: { total: 5, bestWinPercent: .7, averageWinPercent: .5, averageDurationSeconds: 3600, maxConsecutive: 2, averageConsecutive: 1.2 },
  losers: { total: 27, worstLossPercent: -.5, averageLossPercent: -.28, averageDurationSeconds: 2100, maxConsecutive: 7, averageConsecutive: 3.4 },
  bySide: { buy: { trades: 11, tradePercent: 34.38, wins: 2, winRate: 18.18 }, sell: { trades: 21, tradePercent: 65.62, wins: 3, winRate: 14.29 } },
  bySession: [], byTime: { pnl: [], rr: [], profitPercent: [], winRate: [] }, byDay: [], byMonth: [], calendar: [],
  frequency: { byWeekday: [], byWeek: [], byMonth: [], averageTradesPerDay: 0, averageTradesPerWeek: 0, averageTradesPerMonth: 0 },
}

const browser = await chromium.launch({ headless: true })
for (const width of [375, 768, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: width === 375 ? 812 : 900 }, deviceScaleFactor: 1 })
  await page.addInitScript((savedAccount) => localStorage.setItem('replay:eval:accounts', JSON.stringify([savedAccount])), account)
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/analytics/performance')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(performance) })
    if (url.includes('/preferences')) return route.fulfill({ contentType: 'application/json', body: '{}' })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) })
  })
  await page.goto('http://127.0.0.1:4173/?analytics=source-1&sourceType=evaluation')
  await page.getByRole('heading', { name: 'Challenge objectives' }).waitFor()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  const missingRules = await page.getByText('The exact rule snapshot is unavailable').count()
  console.log(JSON.stringify({ width, overflow, missingRules }))
  await page.screenshot({ path: `/tmp/eval-analytics-${width}.png`, fullPage: true })
  await page.close()
}
await browser.close()
