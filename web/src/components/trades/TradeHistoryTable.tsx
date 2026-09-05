import { useMemo, type ReactElement } from 'react'
import { chartTimezoneDisplayTimestamp, chartTimezoneIntlContext, DEFAULT_CHART_TIMEZONE, type ChartTimezone } from '../../replay/chart-timezone'

const tradeMoney = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export interface TradeHistoryTableRecord {
  id: string
  symbol: string
  side: 'long' | 'short' | null
  qty: number
  entryTime?: number
  exitTime?: number
  realizedCents: number
  mfeTicks: number
  maeTicks: number
  rMultiple: number | null
}

interface TradeHistoryTableProps {
  trades: readonly TradeHistoryTableRecord[]
  loading?: boolean
  headingId: string
  timezone?: ChartTimezone
  /** Lets a table inside a padded detail panel align with the dialog edges. */
  fullBleed?: boolean
  onTradeClick?: (trade: TradeHistoryTableRecord) => void
}

interface TradeTimeLabel {
  primary: string
  secondary: string
  accessible: string
  dateTime?: string
}

interface TradeTimeFormatters {
  date: Intl.DateTimeFormat
  clock: Intl.DateTimeFormat
  dayKey: Intl.DateTimeFormat
  timezone: ChartTimezone
}

function formatTradeTime(entryTime: number | undefined, exitTime: number | undefined, formatters: TradeTimeFormatters): TradeTimeLabel {
  if (entryTime === undefined && exitTime === undefined) {
    return { primary: '—', secondary: '—', accessible: 'Entry and exit time unavailable' }
  }

  const entry = entryTime === undefined ? null : new Date(chartTimezoneDisplayTimestamp(entryTime, formatters.timezone) * 1000)
  const exit = exitTime === undefined ? null : new Date(chartTimezoneDisplayTimestamp(exitTime, formatters.timezone) * 1000)
  if (!entry) {
    const exitLabel = exit ? `${formatters.date.format(exit)} ${formatters.clock.format(exit)}` : '—'
    return {
      primary: '—',
      secondary: `→ ${exitLabel}`,
      accessible: `Entry and exit time: — to ${exitLabel}`,
      dateTime: exit?.toISOString(),
    }
  }
  if (!exit) {
    const entryLabel = `${formatters.date.format(entry)} ${formatters.clock.format(entry)}`
    return {
      primary: formatters.date.format(entry),
      secondary: `${formatters.clock.format(entry)} → —`,
      accessible: `Entry and exit time: ${entryLabel} to —`,
    }
  }

  const sameDay = formatters.dayKey.format(entry) === formatters.dayKey.format(exit)
  const entryLabel = `${formatters.date.format(entry)} ${formatters.clock.format(entry)}`
  const exitLabel = `${formatters.date.format(exit)} ${formatters.clock.format(exit)}`
  return sameDay
    ? {
        primary: formatters.date.format(entry),
        secondary: `${formatters.clock.format(entry)}–${formatters.clock.format(exit)}`,
        accessible: `Entry and exit time: ${formatters.date.format(entry)}, ${formatters.clock.format(entry)} to ${formatters.clock.format(exit)}`,
        dateTime: exit.toISOString(),
      }
    : {
        primary: entryLabel,
        secondary: `→ ${exitLabel}`,
        accessible: `Entry and exit time: ${entryLabel} to ${exitLabel}`,
        dateTime: exit.toISOString(),
      }
}

function pnlLabel(realizedCents: number): string {
  const value = tradeMoney.format(realizedCents / 100)
  return realizedCents > 0 ? `+${value}` : value
}

function sideLabel(side: TradeHistoryTableRecord['side']): string {
  return side?.toUpperCase() ?? '—'
}

export function TradeHistoryTable({ trades, loading = false, headingId, timezone = DEFAULT_CHART_TIMEZONE, fullBleed = false, onTradeClick }: TradeHistoryTableProps): ReactElement {
  const recentTrades = trades.toReversed()
  const formatters = useMemo<TradeTimeFormatters>(() => {
    const context = chartTimezoneIntlContext(timezone)
    const options = { timeZone: context.timeZone }
    return {
      timezone,
      date: new Intl.DateTimeFormat('en-US', { ...options, year: 'numeric', month: 'short', day: 'numeric' }),
      clock: new Intl.DateTimeFormat('en-US', { ...options, hour: '2-digit', minute: '2-digit', hour12: false }),
      dayKey: new Intl.DateTimeFormat('en-US', { ...options, year: 'numeric', month: '2-digit', day: '2-digit' }),
    }
  }, [timezone])

  return (
    <section className={`${fullBleed ? '-mx-4 mt-5 sm:-mx-5' : ''} border-t border-line`} aria-labelledby={headingId}>
      <div className="flex min-h-11 items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h4 id={headingId} className="shrink-0 text-ui-meta font-semibold tracking-[0.04em] text-muted">TRADE HISTORY</h4>
          <span className="truncate font-mono text-ui-meta tabular-nums text-dim">{loading ? 'Loading…' : `${trades.length} closed`}</span>
        </div>
      </div>

      {recentTrades.length > 0 ? (
        <div className="overflow-hidden border-t border-line" role="region" aria-label="Trade history" tabIndex={0}>
          <table className="w-full table-fixed border-collapse text-left" aria-label="Trade history">
            <colgroup>
              <col className="w-[7%]" />
              <col className="w-[20%]" />
              <col className="w-[29%]" />
              <col className="w-[18%]" />
              <col className="w-[26%]" />
            </colgroup>
            <thead className="bg-surface-2/45 text-ui-meta text-dim">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">STT</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Trade</th>
                <th scope="col" className="px-1 py-1.5 font-medium">Time</th>
                <th scope="col" className="px-1 py-1.5 text-right font-medium">MFE/MAE</th>
                <th scope="col" className="py-1.5 pl-1 pr-3 text-right font-medium">P&amp;L / R</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line font-mono text-ui-meta tabular-nums">
              {recentTrades.map((trade, index) => {
                const time = formatTradeTime(trade.entryTime, trade.exitTime, formatters)
                const favorable = Math.abs(trade.mfeTicks)
                const adverse = Math.abs(trade.maeTicks)
                return (
                  <tr key={trade.id} onClick={() => onTradeClick?.(trade)} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && onTradeClick) { event.preventDefault(); onTradeClick(trade) } }} tabIndex={onTradeClick ? 0 : undefined} role={onTradeClick ? 'button' : undefined} aria-label={onTradeClick ? `Open review for ${trade.symbol} trade ${index + 1}` : undefined} className={`align-top ${onTradeClick ? 'cursor-pointer outline-none hover:bg-surface-2/60 focus-visible:bg-surface-2/60' : 'hover:bg-surface-2/35'}`}>
                    <td className="px-2 py-2 text-dim">{index + 1}</td>
                    <td className="px-2 py-2">
                      <span className={`block font-semibold ${trade.side === 'long' ? 'text-profit-bright' : trade.side === 'short' ? 'text-loss-bright' : 'text-muted'}`}>{sideLabel(trade.side)}</span>
                      <span className="mt-0.5 block truncate text-ink" title={`${trade.qty} ${trade.symbol}`}>{trade.qty} {trade.symbol}</span>
                    </td>
                    <td className="px-1 py-2">
                      <time className="block text-ink" dateTime={time.dateTime} aria-label={time.accessible}>
                        <span className="block truncate" title={time.primary}>{time.primary}</span>
                        <span className="mt-0.5 block truncate text-dim" title={time.secondary}>{time.secondary}</span>
                      </time>
                    </td>
                    <td className="px-1 py-2 text-right text-muted" aria-label={`Maximum favorable excursion: ${favorable} ticks. Maximum adverse excursion: ${adverse} ticks.`}>
                      <span className="block whitespace-nowrap">+{favorable}t</span>
                      <span className="mt-0.5 block whitespace-nowrap">−{adverse}t</span>
                    </td>
                    <td className="py-2 pl-1 pr-3 text-right">
                      <span className={`block truncate font-semibold ${trade.realizedCents >= 0 ? 'text-profit-bright' : 'text-loss-bright'}`} title={pnlLabel(trade.realizedCents)}>{pnlLabel(trade.realizedCents)}</span>
                      <span className="mt-0.5 block whitespace-nowrap text-dim">R {trade.rMultiple === null ? '—' : trade.rMultiple.toFixed(2)}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : loading ? (
        <p className="border-t border-line px-3 py-4 text-center text-ui-body text-dim">Loading trade history…</p>
      ) : (
        <p className="border-t border-line px-3 py-4 text-center text-ui-body text-dim">No closed trades yet.</p>
      )}
    </section>
  )
}
