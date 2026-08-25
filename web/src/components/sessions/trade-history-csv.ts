import type { ReplaySession } from '../../api/types'
import type { EngineTrade } from '../../fill-engine/types'
import { replaySessionDisplayName } from '../../sources/source-name'

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function tradeHistoryCsv(session: ReplaySession, trades: EngineTrade[]): string {
  const header = [
    'session_id', 'session_name', 'symbol', 'side', 'quantity', 'entry_time', 'entry_price_ticks', 'exit_time',
    'exit_price_ticks', 'realized_cents', 'fees_cents', 'mfe_ticks', 'mae_ticks', 'r_multiple',
  ]
  const rows = trades.map((trade) => [
    session.id,
    replaySessionDisplayName(session),
    trade.symbol,
    trade.side,
    trade.qty,
    new Date(trade.entryTs * 1_000).toISOString(),
    trade.entryPriceTicks,
    new Date(trade.exitTs * 1_000).toISOString(),
    trade.exitPriceTicks,
    trade.realizedCents,
    trade.feesCents,
    trade.mfeTicks,
    trade.maeTicks,
    trade.rMultiple ?? '',
  ].map(csvCell).join(','))
  return [header.join(','), ...rows].join('\n')
}
