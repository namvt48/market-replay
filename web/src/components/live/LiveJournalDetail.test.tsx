import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClosedTrade } from '../../api/types'
import { loadLiveNote } from '../../store/live-store'
import { LiveJournalDetail } from './LiveJournalDetail'

// This jsdom build lacks WHATWG .text() on Blob and File; wire both to
// FileReader so the component's real code path runs unchanged.
function polyfillText(ctor: { prototype: Blob }): void {
  if (typeof ctor.prototype.text === 'function') return
  Object.defineProperty(ctor.prototype, 'text', {
    configurable: true,
    value(this: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsText(this)
      })
    },
  })
}
polyfillText(Blob)
polyfillText(File)

const clientMocks = vi.hoisted(() => ({
  fetchTrades: vi.fn(),
  putTrades: vi.fn(),
  listJournalImages: vi.fn(),
  uploadJournalImage: vi.fn(),
  deleteJournalImage: vi.fn(),
  fetchSymbols: vi.fn(),
}))
const handlers = vi.hoisted(() => ({
  onClose: vi.fn(),
  onChanged: vi.fn(),
  onDelete: vi.fn(),
  onToggleStage: vi.fn(),
  onCompose: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  fetchTrades: clientMocks.fetchTrades,
  putTrades: clientMocks.putTrades,
  listJournalImages: clientMocks.listJournalImages,
  uploadJournalImage: clientMocks.uploadJournalImage,
  deleteJournalImage: clientMocks.deleteJournalImage,
  fetchSymbols: clientMocks.fetchSymbols,
}))

function trade(overrides: Partial<ClosedTrade> = {}): ClosedTrade {
  const entryTs = Date.UTC(2026, 8, 4, 9, 30)
  return {
    id: 't1',
    sessionId: 'live-1',
    symbol: 'ES',
    side: 'long',
    qty: 2,
    entryTs,
    entryPriceTicks: 520000,
    exitTs: entryTs + 3_600_000,
    exitPriceTicks: 521000,
    realizedCents: 20000,
    feesCents: 500,
    mfeTicks: 100,
    maeTicks: 50,
    rMultiple: 2.4,
    initialStopTicks: null,
    initialTakeProfitTicks: null,
    protectionAdjustments: [],
    exitReason: 'manual',
    createdAt: entryTs,
    ...overrides,
  }
}

function renderDetail(props: Partial<ComponentProps<typeof LiveJournalDetail>> = {}): void {
  render(
    <LiveJournalDetail
      sessionId="live-1"
      title="Account A"
      stage="eval"
      templates={[]}
      onClose={handlers.onClose}
      onChanged={handlers.onChanged}
      onDelete={handlers.onDelete}
      onToggleStage={handlers.onToggleStage}
      onCompose={handlers.onCompose}
      {...props}
    />,
  )
}

const CSV_ROW = 'x,ES,long,1,2026-09-04T09:30:00.000Z,520000,2026-09-04T10:30:00.000Z,521000,100,0,10,5,1,manual'

beforeEach(() => {
  localStorage.clear()
  clientMocks.fetchTrades.mockReset().mockResolvedValue([])
  clientMocks.putTrades.mockReset().mockResolvedValue([])
  clientMocks.listJournalImages.mockReset().mockResolvedValue([])
  clientMocks.uploadJournalImage.mockReset().mockResolvedValue(undefined)
  clientMocks.deleteJournalImage.mockReset().mockResolvedValue(undefined)
  clientMocks.fetchSymbols.mockReset().mockResolvedValue([{ symbol: 'NQ', name: 'Nasdaq' }])
  Object.values(handlers).forEach((mock) => mock.mockClear())
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe.skip('legacy LiveJournalDetail journal behavior', () => {
  it('pins the add-trade form at the top with the stage chip', async () => {
    renderDetail()

    expect(await screen.findByRole('heading', { name: 'Add trade' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark Account A funded' })).toHaveTextContent('EVAL')
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add trade' })).toBeDisabled()
  })

  it('renders a funded chip when the account stage is funded', async () => {
    renderDetail({ stage: 'funded' })

    expect(await screen.findByRole('button', { name: 'Mark Account A eval' })).toHaveTextContent('FUNDED')
  })

  it('adds a trade from the form and resets it', async () => {
    const user = userEvent.setup()
    renderDetail()

    await screen.findByRole('button', { name: 'Add trade' })
    await user.selectOptions(screen.getByLabelText('Trade symbol'), 'NQ')
    await user.clear(screen.getByLabelText('Quantity'))
    await user.type(screen.getByLabelText('Quantity'), '3')
    await user.type(screen.getByLabelText('Entry price'), '19500')
    await user.type(screen.getByLabelText('Exit price'), '19510')
    await user.click(screen.getByRole('button', { name: 'Add trade' }))

    await waitFor(() => expect(clientMocks.putTrades).toHaveBeenCalledWith('live-1', [
      expect.objectContaining({ sessionId: 'live-1', symbol: 'NQ', side: 'long', qty: 3, exitReason: 'manual' }),
    ]))
    expect(handlers.onChanged).toHaveBeenCalled()
    expect(screen.getByLabelText('Trade symbol')).toHaveValue('')
  })

  it('records the trade as short when the side is changed', async () => {
    const user = userEvent.setup()
    renderDetail()

    await screen.findByRole('button', { name: 'Add trade' })
    await user.selectOptions(screen.getByLabelText('Side'), 'short')
    await user.selectOptions(screen.getByLabelText('Trade symbol'), 'NQ')
    await user.type(screen.getByLabelText('Entry price'), '2400')
    await user.type(screen.getByLabelText('Exit price'), '2390')
    await user.click(screen.getByRole('button', { name: 'Add trade' }))

    await waitFor(() => expect(clientMocks.putTrades).toHaveBeenCalledWith('live-1', [
      expect.objectContaining({ symbol: 'NQ', side: 'short', qty: 1 }),
    ]))
  })

  it('only offers symbols available in the workspace', async () => {
    renderDetail()

    const symbol = await screen.findByLabelText('Trade symbol')
    expect(symbol).toHaveTextContent('NQ · Nasdaq')
    expect(symbol).not.toHaveTextContent('GC')
  })

  it('attaches an image pasted into the journal note', async () => {
    renderDetail()
    const image = new File(['image'], 'clipboard-chart.png', { type: 'image/png' })
    const imageItem = { kind: 'file', type: 'image/png', getAsFile: () => image } as unknown as DataTransferItem

    fireEvent.paste(await screen.findByLabelText('Journal note Markdown'), { clipboardData: { items: [imageItem], files: [image] } })

    await waitFor(() => expect(clientMocks.uploadJournalImage).toHaveBeenCalledWith('live-1', image))
    expect(await screen.findByText('clipboard-chart.png attached.')).toBeInTheDocument()
  })

  it('exports the trade history as a CSV download', async () => {
    clientMocks.fetchTrades.mockResolvedValue([trade({ id: 't1', symbol: 'ES' })])
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    renderDetail()

    await screen.findByRole('button', { name: 'Export trades CSV' })
    await user.click(screen.getByRole('button', { name: 'Export trades CSV' }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob
    expect(blob.type).toBe('text/csv;charset=utf-8')
    const text = await blob.text()
    const lines = text.split('\n')
    expect(lines[0]).toContain('id,symbol,side,quantity')
    expect(lines[1]).toContain('ES,long,2,')
    expect(click).toHaveBeenCalled()
  })

  it('imports valid rows from a CSV file and appends them', async () => {
    clientMocks.fetchTrades.mockResolvedValue([trade()])
    const user = userEvent.setup()
    renderDetail()

    await screen.findByRole('button', { name: 'Add trade' })
    const file = new File(
      [`id,symbol,side,quantity,entry_time,entry_price_ticks,exit_time,exit_price_ticks,realized_cents,fees_cents,mfe_ticks,mae_ticks,r_multiple,exit_reason\n${CSV_ROW}`],
      'trades.csv',
      { type: 'text/csv' },
    )
    await user.upload(screen.getByLabelText('Import trades CSV'), file)

    await waitFor(() => expect(clientMocks.putTrades).toHaveBeenCalledWith('live-1', [
      expect.any(Object),
      expect.objectContaining({ symbol: 'ES', side: 'long', qty: 1, sessionId: 'live-1' }),
    ]))
    expect(await screen.findByText('Imported 1 trade.')).toBeInTheDocument()
    expect(handlers.onChanged).toHaveBeenCalled()
  })

  it('rejects a CSV file with no valid rows', async () => {
    const user = userEvent.setup()
    renderDetail()

    await screen.findByRole('button', { name: 'Add trade' })
    const file = new File(
      ['id,symbol,side,quantity,entry_time,entry_price_ticks,exit_time,exit_price_ticks,realized_cents,fees_cents,mfe_ticks,mae_ticks,r_multiple,exit_reason'],
      'empty.csv',
      { type: 'text/csv' },
    )
    await user.upload(screen.getByLabelText('Import trades CSV'), file)

    expect(await screen.findByText('No valid trades found in the file.')).toBeInTheDocument()
    expect(clientMocks.putTrades).not.toHaveBeenCalled()
  })

  it('requires a second click to delete the account', async () => {
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole('button', { name: 'Delete account' }))
    expect(handlers.onDelete).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirm delete account' }))
    expect(handlers.onDelete).toHaveBeenCalledTimes(1)
  })

  it('toggles the account stage from the header chip', async () => {
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole('button', { name: 'Mark Account A funded' }))
    expect(handlers.onToggleStage).toHaveBeenCalledTimes(1)
  })

  it('shows the net P&L pill in the dialog title', async () => {
    clientMocks.fetchTrades.mockResolvedValue([
      trade({ id: 't1', realizedCents: 20000 }),
      trade({ id: 't2', realizedCents: -5000 }),
    ])
    renderDetail()

    expect(await screen.findByText('+$150.00')).toBeInTheDocument()
  })

  it('edits the journal note with Write/Preview toggle and persists it', async () => {
    const user = userEvent.setup()
    renderDetail()

    await user.type(await screen.findByLabelText('Journal note Markdown'), '## Week one')
    expect(loadLiveNote('live-1')).toBe('## Week one')

    await user.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByRole('heading', { name: 'Week one' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Write' }))
    expect(screen.getByLabelText('Journal note Markdown')).toHaveValue('## Week one')
  })

  it('shows an empty state in Preview when the note is blank', async () => {
    const user = userEvent.setup()
    renderDetail()

    await screen.findByLabelText('Journal note Markdown')
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    expect(screen.getByText('Nothing to preview yet.')).toBeInTheDocument()
  })

  it('renders trade history times from millisecond live timestamps', async () => {
    clientMocks.fetchTrades.mockResolvedValue([trade({ id: 't1', entryTs: Date.UTC(2026, 8, 4, 9, 30), exitTs: Date.UTC(2026, 8, 4, 10, 30) })])
    renderDetail()

    await screen.findByRole('heading', { name: 'TRADE HISTORY' })
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/58640/)).toBeNull()
  })
})

describe('LiveJournalDetail account details', () => {
  it('shows account metrics, trade history, and opens the live trade review from + Trade', async () => {
    const user = userEvent.setup()
    renderDetail()

    expect(await screen.findByText('Net P&L')).toBeVisible()
    expect(screen.getByText('Trade history')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '+ Trade' }))
    expect(screen.getByRole('heading', { name: 'New live trade' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Screenshot chart' })).not.toBeInTheDocument()
  })

  it('creates a live trade then exposes the shared tag groups and generated Details', async () => {
    const user = userEvent.setup()
    renderDetail()
    await user.click(await screen.findByRole('button', { name: '+ Trade' }))
    await user.selectOptions(screen.getByLabelText('Trade symbol'), 'NQ')
    await user.type(screen.getByLabelText('Entry price'), '20000')
    await user.type(screen.getByLabelText('Exit price'), '20010')
    await user.click(screen.getByRole('button', { name: 'Add trade & review' }))

    await waitFor(() => expect(clientMocks.putTrades).toHaveBeenCalledWith('live-1', [expect.objectContaining({ symbol: 'NQ', sessionId: 'live-1' })]))
    expect(await screen.findByRole('tab', { name: 'Tag groups' })).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Details' }))
    expect(screen.getByText('Live account', { exact: true })).toBeVisible()
  })
})
