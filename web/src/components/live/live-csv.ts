import type { ClosedTrade } from '../../api/types'

/** A closed trade serialized to CSV. sessionId/createdAt are deliberately
 * omitted — the caller injects them at write time, mirroring the
 * buildTradeFromForm() pattern in live-trade-form.ts. */
export type LiveCsvRow = Omit<ClosedTrade, 'sessionId' | 'createdAt'>

const HEADER = [
  'id', 'symbol', 'side', 'quantity', 'entry_time', 'entry_price_ticks', 'exit_time',
  'exit_price_ticks', 'realized_cents', 'fees_cents', 'mfe_ticks', 'mae_ticks',
  'r_multiple', 'exit_reason',
]

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * Serializes live-journal trades to CSV. Prices travel as raw ticks so an
 * export/import round trip is exact — no dollar conversion drift. Timestamps
 * are ISO-8601 UTC. Live trades store entryTs/exitTs in milliseconds
 * (Date.now()), unlike replay-engine trades which use seconds.
 */
export function liveTradesToCsv(trades: ClosedTrade[]): string {
  const rows = trades.map((trade) => [
    trade.id,
    trade.symbol,
    trade.side,
    trade.qty,
    new Date(trade.entryTs).toISOString(),
    trade.entryPriceTicks,
    new Date(trade.exitTs).toISOString(),
    trade.exitPriceTicks,
    trade.realizedCents,
    trade.feesCents,
    trade.mfeTicks,
    trade.maeTicks,
    trade.rMultiple ?? '',
    trade.exitReason,
  ].map(csvCell).join(','))
  return [HEADER.join(','), ...rows].join('\n')
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      cells.push(cell)
      cell = ''
    } else {
      cell += ch
    }
  }
  cells.push(cell)
  return cells
}

function parseNumber(value: string): number | null {
  const text = value.trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

function isHeaderLine(cells: string[]): boolean {
  return cells[0] === HEADER[0] && cells[1] === HEADER[1]
}

function rowToTrade(cells: string[]): LiveCsvRow | null {
  const [id, symbol, side, qtyCell, entryTime, entryTicksCell, exitTime, exitTicksCell, realizedCell, feesCell, mfeCell, maeCell, rCell, reasonCell] = cells
  const name = symbol?.trim()
  if (!name) return null
  if (side !== 'long' && side !== 'short') return null
  const qty = parseNumber(qtyCell ?? '')
  if (qty === null || qty < 1) return null
  const entryPriceTicks = parseNumber(entryTicksCell ?? '')
  const exitPriceTicks = parseNumber(exitTicksCell ?? '')
  if (entryPriceTicks === null || exitPriceTicks === null) return null
  const entryTs = Date.parse(entryTime ?? '')
  const exitTs = Date.parse(exitTime ?? '')
  if (!Number.isFinite(entryTs) || !Number.isFinite(exitTs)) return null
  const exitReason = reasonCell === 'stopLoss' || reasonCell === 'takeProfit' ? reasonCell : 'manual'
  return {
    id: id?.trim() ? id.trim() : `live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    symbol: name.toUpperCase(),
    side,
    qty,
    entryTs,
    entryPriceTicks,
    exitTs,
    exitPriceTicks,
    realizedCents: parseNumber(realizedCell ?? '') ?? 0,
    feesCents: parseNumber(feesCell ?? '') ?? 0,
    mfeTicks: parseNumber(mfeCell ?? '') ?? 0,
    maeTicks: parseNumber(maeCell ?? '') ?? 0,
    rMultiple: parseNumber(rCell ?? ''),
    initialStopTicks: null,
    initialTakeProfitTicks: null,
    protectionAdjustments: [],
    exitReason,
  }
}

/**
 * Parses live-journal CSV back into trades. The header line and any line that
 * fails validation (empty/unknown symbol, non long/short side, missing prices
 * or timestamps, quantity < 1) are skipped rather than rejected. Missing
 * optional numeric fields (realized/fees/mfe/mae/r_multiple) default to 0 or
 * null. A missing id gets a fresh client-generated one.
 */
export function parseLiveTradesCsv(text: string): LiveCsvRow[] {
  const rows: LiveCsvRow[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const cells = parseCsvLine(line)
    if (isHeaderLine(cells)) continue
    const trade = rowToTrade(cells)
    if (trade) rows.push(trade)
  }
  return rows
}