import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useReviewStore } from '../../store/review-store'
import { useUiStore } from '../../store/ui-store'
import { ReviewPanel } from './ReviewPanel'

const capture = vi.hoisted(() => vi.fn(async () => 'data:image/jpeg;base64,chart'))
const popout = vi.hoisted(() => ({ open: vi.fn() }))
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
vi.mock('../chart/chart-popout', () => ({ openWorkspacePopout: popout.open }))
vi.mock('../chart/ChartPopoutWindow', () => ({ ChartPopoutWindow: ({ children }: { children: ReactNode }) => <div data-testid="detached-review">{children}</div> }))

beforeEach(() => {
  localStorage.clear()
  capture.mockClear()
  popout.open.mockReset()
  popout.open.mockReturnValue({ window: { focus: vi.fn() }, root: document.createElement('div') })
  useReviewStore.setState({ documents: {}, tagGroups: [] })
  useUiStore.setState({ sidebarOpen: true, sidebarTab: 'review', reviewSource: reviewSource.source })
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
    const editor = screen.getByRole('textbox', { name: 'Trade review Markdown' })
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

    await user.click(screen.getByRole('tab', { name: 'Details' }))
    expect(screen.getByText('Take profit', { exact: true })).toBeVisible()
    expect(screen.getByText('Net P/L')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Detach Review window' }))
    expect(popout.open).toHaveBeenCalledWith('trade-review', 'Trade Review', { width: 720, height: 900 })
    expect(screen.getByTestId('detached-review')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Return Review to sidebar' })).toBeVisible()
    expect(screen.getByRole('heading', { name: /CME_MINI:NQ1, buy/i })).toBeVisible()
  })
})
