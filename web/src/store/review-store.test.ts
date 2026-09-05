import { beforeEach, describe, expect, it } from 'vitest'
import { useReviewStore } from './review-store'

const trade = { id: 'trade-1', sourceId: 'session-1', sourceType: 'session' as const, symbol: 'NQ', side: 'long' as const, exitTs: 1, realizedCents: 0, rMultiple: null }

beforeEach(() => {
  useReviewStore.setState({ documents: {}, tagGroups: [] })
})

describe('review tag groups', () => {
  it('allows several tags in one group and reorders groups', () => {
    const setupId = useReviewStore.getState().addTagGroup('Setup')
    const executionId = useReviewStore.getState().addTagGroup('Execution')
    const first = useReviewStore.getState().addTag(setupId, 'Breakout')
    const second = useReviewStore.getState().addTag(setupId, 'Trend')

    useReviewStore.getState().assignTag('session:session-1:trade-1', trade, setupId, first)
    useReviewStore.getState().assignTag('session:session-1:trade-1', trade, setupId, second)
    useReviewStore.getState().moveTagGroup(executionId, setupId)

    expect(useReviewStore.getState().documents['session:session-1:trade-1']?.tagAssignments[setupId]).toEqual([first, second])
    expect(useReviewStore.getState().tagGroups.map((group) => group.id)).toEqual([executionId, setupId])
  })
})
