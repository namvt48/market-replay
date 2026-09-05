import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReviewStore } from '../../store/review-store'
import { useUiStore } from '../../store/ui-store'
import { ReviewPanel } from './ReviewPanel'

vi.mock('../../chart-workspace/use-chart-workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../chart-workspace/use-chart-workspace')>()
  return { ...actual, useChartWorkspace: () => ({ state: { timezone: { kind: 'preset', id: 'ET' } } }) }
})

const capture = vi.hoisted(() => vi.fn(async () => 'data:image/jpeg;base64,chart'))
const reviewSource = vi.hoisted(() => ({
  source: { id: 'session-1', type: 'session' as const, title: 'NQ · 1m · #ABC123' },
  status: 'success' as const,
  error: null,
  trades: [{
    id: 'trade-1', sourceId: 'session-1', sourceType: 'session' as const, symbol: 'CME_MINI:NQ1', side: 'long' as const,
    qty: 2, entryTs: 1_718_700_000, exitTs: 1_718_700_300, entryPriceTicks: 39_000, exitPriceTicks: 39_020,
    realizedCents: 223_000, feesCents: 800, mfeTicks: 30, maeTicks: 8, rMultiple: 2.2,
    initialStopTicks: 38_990, initialTakeProfitTicks: 39_030, protectionAdjustments: [], exitReason: 'takeProfit' as const,
  }],
}))

vi.mock('../../review/capture-chart', () => ({ captureActiveChart: capture }))
vi.mock('../../review/use-review-trades', () => ({ useReviewTrades: () => reviewSource }))
vi.mock('../../replay/use-replay', () => ({ useReplaySelector: (selector: (snapshot: { symbols: never[] }) => unknown) => selector({ symbols: [] }) }))

beforeEach(() => {
  localStorage.clear()
  capture.mockClear()
  useReviewStore.setState({ documents: {}, tagGroups: [] })
  useUiStore.setState({ sidebarOpen: false, sidebarTab: 'sessions', reviewOpen: true, reviewSource: reviewSource.source })
})

afterEach(() => cleanup())

describe('ReviewPanel', () => {
  it('shows calendar activity as a compact list of trading days', async () => {
    const user = userEvent.setup()
    render(<ReviewPanel />)

    await user.click(screen.getByRole('button', { name: 'Calendar' }))

    expect(screen.getByRole('list', { name: 'Trade days in June 2024' })).toBeVisible()
    expect(screen.getByRole('button', { name: /June 18, 2024, 1 closed trade/ })).toBeVisible()
    expect(screen.queryByText('Mon')).not.toBeInTheDocument()
  })

  it('supports Markdown notes, chart screenshots, details, and tag creation for a real trade record', async () => {
    const user = userEvent.setup()
    render(<ReviewPanel />)

    await user.click(screen.getByRole('button', { name: /CME_MINI:NQ1, buy/i }))
    const editor = screen.getByRole('textbox', { name: 'Trade review Markdown' }) as HTMLTextAreaElement
    await user.type(editor, '# Trade thesis')
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByRole('heading', { name: 'Trade thesis' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Screenshot chart' }))
    expect(await screen.findByRole('img', { name: /Chart captured/ })).toBeVisible()
    expect(capture).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Tag group' }))
    await user.type(screen.getByRole('textbox', { name: 'Tag group name' }), 'Confidence')
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    await user.click(screen.getByRole('button', { name: 'Add tag' }))
    const tagInput = screen.getByRole('textbox', { name: 'Select tag for Confidence' })
    await user.type(tagInput, 'High Confidence{Enter}')
    expect(screen.getByRole('button', { name: 'Change Confidence tag: High Confidence' })).toBeVisible()
    await user.type(screen.getByRole('textbox', { name: 'Select tag for Confidence' }), 'Patient{Enter}')
    expect(screen.getByRole('button', { name: 'Change Confidence tag: High Confidence, Patient' })).toBeVisible()

    await user.click(screen.getByRole('tab', { name: 'Details' }))
    expect(screen.getByText('Take profit', { exact: true })).toBeVisible()
    expect(screen.getByText('Net P/L')).toBeVisible()

    expect(screen.queryByRole('button', { name: /Detach Review|Return Review/ })).not.toBeInTheDocument()
  })

  it('inserts a pasted image at the note cursor and renders it inline in Preview', async () => {
    const user = userEvent.setup()
    render(<ReviewPanel />)
    await user.click(screen.getByRole('button', { name: /CME_MINI:NQ1, buy/i }))
    const image = new File(['image'], 'clipboard-chart.png', { type: 'image/png' })
    const imageItem = { kind: 'file', type: 'image/png', getAsFile: () => image } as unknown as DataTransferItem
    const editor = screen.getByRole('textbox', { name: 'Trade review Markdown' })
    await user.type(editor, 'abc xyz')
    const range = document.createRange()
    range.setStart(editor.firstChild ?? editor, 4)
    range.collapse(true)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    fireEvent.paste(editor, { clipboardData: { items: [imageItem], files: [image] } })

    const writeImage = await screen.findByRole('img', { name: 'Pasted image 1' })
    expect(editor).toHaveTextContent('abc xyz')
    await user.dblClick(writeImage)
    expect(screen.getByRole('dialog', { name: 'Image preview' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close image preview' }))
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    const previewImage = await screen.findByRole('img', { name: 'Pasted image 1' })
    expect(previewImage).toHaveAttribute('src', expect.stringMatching(/^data:image\/png;base64,/))
    await user.dblClick(previewImage)
    expect(screen.getByRole('dialog', { name: 'Image preview' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close image preview' }))
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).not.toBeInTheDocument()
  })

  it('only enables Template when the note is empty', async () => {
    const user = userEvent.setup()
    render(<ReviewPanel />)
    await user.click(screen.getByRole('button', { name: /CME_MINI:NQ1, buy/i }))
    const template = screen.getByRole('button', { name: 'Template' })
    expect(template).toBeEnabled()

    await user.type(screen.getByRole('textbox', { name: 'Trade review Markdown' }), 'A review already exists.')
    expect(template).toBeDisabled()
  })

  it('collapses and restores the active tag/details metadata panel', async () => {
    const user = userEvent.setup()
    render(<ReviewPanel />)
    await user.click(screen.getByRole('button', { name: /CME_MINI:NQ1, buy/i }))

    const hide = screen.getByRole('button', { name: 'Hide trade metadata' })
    await user.click(hide)
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show trade metadata' })).toHaveAttribute('aria-expanded', 'false')

    await user.click(screen.getByRole('button', { name: 'Show trade metadata' }))
    expect(screen.getByRole('tabpanel')).toBeVisible()
  })
})
