import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TradeHistoryTable, type TradeHistoryTableRecord } from './TradeHistoryTable'

const trades: TradeHistoryTableRecord[] = [
  {
    id: 'trade-1',
    symbol: 'NQ',
    side: 'long',
    qty: 1,
    entryTime: 1_705_276_800,
    exitTime: 1_705_280_400,
    realizedCents: 100_000,
    mfeTicks: 16,
    maeTicks: 4,
    rMultiple: 2,
  },
  {
    id: 'trade-2',
    symbol: 'ES',
    side: 'short',
    qty: 2,
    entryTime: 1_705_280_400,
    exitTime: 1_705_282_200,
    realizedCents: -250_000,
    mfeTicks: 3,
    maeTicks: 9,
    rMultiple: null,
  },
]

afterEach(cleanup)

describe('TradeHistoryTable', () => {
  it('keeps every trade in the same semantic columns and shows newest first', () => {
    render(<TradeHistoryTable headingId="trade-history-heading" trades={trades} timezone={{ kind: 'preset', id: 'UTC' }} />)

    const table = screen.getByRole('table', { name: 'Trade history' })
    expect(table).toHaveClass('table-fixed')
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'STT',
      'Trade',
      'Time',
      'MFE/MAE',
      'P&L / R',
    ])

    const rows = within(table).getAllByRole('row')
    expect(within(rows[1]).getByText('1')).toBeVisible()
    expect(within(rows[1]).getByText('SHORT')).toBeVisible()
    expect(within(rows[1]).getByText('2 ES')).toBeVisible()
    expect(within(rows[1]).getByText('-$2,500.00')).toBeVisible()
    expect(within(rows[1]).getByText('R —')).toBeVisible()
    expect(within(rows[2]).getByText('LONG')).toBeVisible()
    expect(within(rows[2]).getByText('+$1,000.00')).toBeVisible()
    expect(within(rows[2]).getByText('R 2.00')).toBeVisible()
    expect(within(rows[2]).getByText('Jan 15, 2024')).toBeVisible()
  })

  it('opens the selected trade without forcing horizontal scrolling', () => {
    const onTradeClick = vi.fn()
    render(<TradeHistoryTable headingId="clickable-trade-history" trades={trades} onTradeClick={onTradeClick} />)

    const table = screen.getByRole('table', { name: 'Trade history' })
    expect(table).not.toHaveClass('min-w-[30rem]')
    fireEvent.click(screen.getByRole('button', { name: 'Open review for ES trade 1' }))
    expect(onTradeClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'trade-2' }))
  })

  it('formats entry and exit times in the selected workspace timezone', () => {
    render(<TradeHistoryTable headingId="timezone-trade-history-heading" trades={[trades[0]]} timezone={{ kind: 'offset', minutes: 420 }} />)

    expect(screen.getByText('07:00–08:00')).toBeVisible()
  })

  it('uses the same stable table section for an empty history', () => {
    render(<TradeHistoryTable headingId="empty-trade-history-heading" trades={[]} />)

    expect(screen.getByRole('heading', { name: 'TRADE HISTORY' })).toBeVisible()
    expect(screen.getByText('0 closed')).toBeVisible()
    expect(screen.getByText('No closed trades yet.')).toBeVisible()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
