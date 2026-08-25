import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useReviewStore, type ReviewDocument, type ReviewTagGroup } from '../../store/review-store'
import { TagAnalyticsTab } from './TagAnalyticsTab'

const groups: ReviewTagGroup[] = [
  { id: 'setup', name: 'Setup', tags: [{ id: 'breakout', name: 'Breakout', color: 'blue' }, { id: 'trend', name: 'Trend', color: 'green' }] },
  { id: 'execution', name: 'Execution', tags: [{ id: 'clean', name: 'Clean entry', color: 'green' }] },
]

const documents: Record<string, ReviewDocument> = {
  'evaluation:eval-1:trade-1': {
    note: '', screenshots: [], tagAssignments: { setup: 'breakout', execution: 'clean' },
    trade: { id: 'trade-1', sourceId: 'eval-1', sourceType: 'evaluation', symbol: 'NQ', side: 'long', exitTs: 1, realizedCents: 12500, rMultiple: 1.25 }, updatedAt: 1,
  },
  'evaluation:eval-1:trade-2': {
    note: '', screenshots: [], tagAssignments: { setup: 'breakout', execution: 'clean' },
    trade: { id: 'trade-2', sourceId: 'eval-1', sourceType: 'evaluation', symbol: 'NQ', side: 'short', exitTs: 2, realizedCents: -5000, rMultiple: -0.5 }, updatedAt: 1,
  },
}

afterEach(() => {
  cleanup()
  useReviewStore.setState({ documents: {}, tagGroups: [] })
})

describe('TagAnalyticsTab', () => {
  it('renders one performance table per group with all requested metrics', () => {
    useReviewStore.setState({ documents, tagGroups: groups })
    render(<TagAnalyticsTab sourceType="evaluation" sourceId="eval-1" />)

    const setup = screen.getByRole('table', { name: 'Setup tag performance' })
    const execution = screen.getByRole('table', { name: 'Execution tag performance' })
    expect(within(setup).getByText('Breakout')).toBeVisible()
    expect(within(setup).getByText('Trend')).toBeVisible()
    expect(within(execution).getByText('Clean entry')).toBeVisible()
    for (const table of [setup, execution]) {
      expect(within(table).getByRole('columnheader', { name: 'Trades' })).toBeVisible()
      expect(within(table).getByRole('columnheader', { name: 'Win rate' })).toBeVisible()
      expect(within(table).getByRole('columnheader', { name: 'Average R' })).toBeVisible()
      expect(within(table).getByRole('columnheader', { name: 'Net P&L' })).toBeVisible()
    }
    expect(within(setup).getByText('2', { selector: 'td' })).toBeVisible()
    expect(within(setup).getAllByText('—')).toHaveLength(3)
  })
})
