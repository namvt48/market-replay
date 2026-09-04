import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AnalyticsApi = typeof import('../../api/analytics')
type ClientApi = typeof import('../../api/client')

const mocks = vi.hoisted(() => ({
  fetchAnalyticsSources: vi.fn<AnalyticsApi['fetchAnalyticsSources']>(),
  fetchSessions: vi.fn<ClientApi['fetchSessions']>(),
  createSession: vi.fn<ClientApi['createSession']>(),
}))

vi.mock('../../api/analytics', () => ({
  fetchAnalyticsSources: (...args: Parameters<AnalyticsApi['fetchAnalyticsSources']>) => mocks.fetchAnalyticsSources(...args),
}))

vi.mock('../../api/client', () => ({
  fetchSessions: (...args: Parameters<ClientApi['fetchSessions']>) => mocks.fetchSessions(...args),
  createSession: (...args: Parameters<ClientApi['createSession']>) => mocks.createSession(...args),
}))

import { LivePanel } from './LivePanel'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

afterEach(cleanup)

describe('LivePanel', () => {
  it('shows the two header buttons and an empty state', async () => {
    mocks.fetchAnalyticsSources.mockResolvedValue([])
    mocks.fetchSessions.mockResolvedValue([])
    render(<LivePanel />)

    expect(await screen.findByRole('button', { name: /create live journal/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /create stats template/i })).toBeTruthy()
    expect(screen.getByText(/no live journals/i)).toBeTruthy()
  })

  it('creates a live session from the draft row', async () => {
    const user = userEvent.setup()
    mocks.fetchAnalyticsSources.mockResolvedValue([])
    mocks.fetchSessions.mockResolvedValue([])
    mocks.createSession.mockResolvedValue('live-1')
    render(<LivePanel />)

    await user.click(await screen.findByRole('button', { name: /create live journal/i }))
    await user.type(screen.getByLabelText('Journal name'), 'July journal')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(mocks.createSession).toHaveBeenCalledWith(
      'LIVE', '1d', expect.any(Number),
      expect.objectContaining({ kind: 'live', initialBalanceCents: 1000000, name: 'July journal' }),
    )
  })
})