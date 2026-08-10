import { formatChartTime, type ChartTimezone } from '../../replay/chart-timezone'
import { useHoverBar, type HoverBarStore } from '../../replay/hover-bar-store'

interface OhlcLegendProps {
  store: HoverBarStore
  precision: number
  timezone: ChartTimezone
}

export function OhlcLegend({ store, precision, timezone }: OhlcLegendProps) {
  const bar = useHoverBar(store)
  if (!bar) return <div className="h-7" aria-label="OHLC unavailable" />
  const change = bar.close - bar.open
  const percent = bar.open === 0 ? null : change / bar.open * 100
  const sign = change >= 0 ? '+' : ''
  const timestamp = formatChartTime(bar.time, timezone)
  return (
    <div className={`pointer-events-none flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-ui-meta tabular-nums ${bar.hovered ? 'text-ink' : 'text-dim'}`} aria-label={`OHLC for ${timestamp}`}>
      {bar.hovered ? <time className="text-dim" dateTime={new Date(bar.time * 1000).toISOString()}>{timestamp}</time> : null}
      <span className="text-muted">O <b className="font-normal text-inherit">{bar.open.toFixed(precision)}</b></span>
      <span className="text-muted">H <b className="font-normal text-inherit">{bar.high.toFixed(precision)}</b></span>
      <span className="text-muted">L <b className="font-normal text-inherit">{bar.low.toFixed(precision)}</b></span>
      <span className="text-muted">C <b className="font-normal text-inherit">{bar.close.toFixed(precision)}</b></span>
      <span className={change > 0 ? 'text-profit-bright' : change < 0 ? 'text-loss-bright' : 'text-muted'}>{sign}{change.toFixed(precision)} ({percent === null ? '—' : `${sign}${percent.toFixed(2)}%`})</span>
      {!bar.hovered ? <span className="font-sans text-ui-meta text-dim">latest</span> : null}
    </div>
  )
}
