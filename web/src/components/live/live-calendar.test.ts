import { describe, expect, it } from 'vitest'
import { mergeLiveCalendars, type LiveCalendarReport } from './live-calendar'

function report(
  id: string,
  initialBalance: number,
  totalPnl: number,
  calendar: LiveCalendarReport['calendar'],
  actualRr: Array<{ closedAt: string; rr: number }> = [],
): LiveCalendarReport {
  return {
    source: { id },
    overview: { accountBalance: initialBalance + totalPnl, totalPnl },
    riskReward: {
      series: {
        actual: actualRr.map((point) => ({ tradeIndex: 0, tradeId: 'trade', closedAt: point.closedAt, rr: point.rr })),
        ideal: [],
        missed: [],
      },
    },
    calendar,
  }
}

describe('mergeLiveCalendars', () => {
  it('sums trades, wins, losses, breakeven, pnl and risk-reward across accounts on the same date', () => {
    const first = report('live-1', 10000, 100, [
      { date: '2026-01-05', trades: 2, wins: 1, losses: 1, breakeven: 0, pnl: 50, pnlPercent: 0.5, endingBalance: 10100 },
    ], [{ closedAt: '2026-01-05T10:00:00Z', rr: 1.5 }, { closedAt: '2026-01-05T18:00:00Z', rr: 0.25 }])
    const second = report('live-2', 10000, 300, [
      { date: '2026-01-05', trades: 1, wins: 1, losses: 0, breakeven: 0, pnl: 30, pnlPercent: 0.3, endingBalance: 10300 },
    ], [{ closedAt: '2026-01-05T14:00:00Z', rr: 0.5 }])

    const { entries, initialDate } = mergeLiveCalendars([first, second])

    expect(entries).toEqual([
      { date: '2026-01-05', trades: 3, wins: 2, losses: 1, breakeven: 0, pnl: 80, pnlPercent: 0.4, riskReward: 2.25 },
    ])
    expect(initialDate).toBe('2026-01-05')
  })

  it('recomputes pnlPercent against the combined starting balance', () => {
    const first = report('live-1', 25000, -500, [
      { date: '2026-01-05', trades: 1, wins: 0, losses: 1, breakeven: 0, pnl: -50, pnlPercent: -0.2, endingBalance: 24500 },
    ])
    const second = report('live-2', 5000, 0, [
      { date: '2026-01-06', trades: 1, wins: 1, losses: 0, breakeven: 0, pnl: 25, pnlPercent: 0.5, endingBalance: 5000 },
    ], [{ closedAt: '2026-01-06T14:00:00Z', rr: 0.5 }])

    const { entries } = mergeLiveCalendars([first, second])

    // Combined starting balance is $30,000: -50/30000 and 25/30000.
    expect(entries[0]).toMatchObject({ date: '2026-01-05', pnl: -50, pnlPercent: -0.17, riskReward: null })
    expect(entries[1]).toMatchObject({ date: '2026-01-06', pnl: 25, pnlPercent: 0.08, riskReward: 0.5 })
  })

  it('sorts distinct dates chronologically and anchors the cursor on the newest', () => {
    const first = report('live-1', 10000, 100, [
      { date: '2026-01-05', trades: 1, wins: 1, losses: 0, breakeven: 0, pnl: 25, pnlPercent: 0.25, endingBalance: 10100 },
    ])
    const second = report('live-2', 10000, 200, [
      { date: '2026-01-04', trades: 2, wins: 0, losses: 2, breakeven: 0, pnl: -40, pnlPercent: -0.4, endingBalance: 10200 },
    ])

    const { entries, initialDate } = mergeLiveCalendars([first, second])

    expect(entries.map((entry) => entry.date)).toEqual(['2026-01-04', '2026-01-05'])
    expect(initialDate).toBe('2026-01-05')
  })

  it('ignores risk-reward points that fall outside any calendar day', () => {
    const first = report('live-1', 10000, 100, [
      { date: '2026-01-05', trades: 1, wins: 1, losses: 0, breakeven: 0, pnl: 25, pnlPercent: 0.25, endingBalance: 10100 },
    ], [{ closedAt: '2026-01-06T10:00:00Z', rr: 3 }])

    const { entries } = mergeLiveCalendars([first])

    expect(entries[0]).toMatchObject({ date: '2026-01-05', riskReward: null })
    expect(entries).toHaveLength(1)
  })

  it('returns an empty portfolio anchored on today when there are no reports', () => {
    const { entries, initialDate } = mergeLiveCalendars([])

    expect(entries).toEqual([])
    expect(initialDate).toBe(new Date().toISOString().slice(0, 10))
  })
})