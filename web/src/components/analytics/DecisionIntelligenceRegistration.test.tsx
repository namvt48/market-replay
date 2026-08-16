import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsScreen } from './AnalyticsScreen'
import { edgeFixture, executionFixture, performanceFixture } from './analytics-fixtures'

function response(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
beforeEach(() => {
  window.history.replaceState({}, '', '/?analytics=source-1&sourceType=session')
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/edge')) return response(edgeFixture)
    if (url.includes('/execution-discipline')) return response(executionFixture)
    return response(performanceFixture)
  }))
})

describe('Decision Intelligence registration', () => {
  it('loads both decision tabs from their backend endpoints', async () => {
    const user = userEvent.setup()
    render(<AnalyticsScreen />)
    await user.click(screen.getByRole('tab', { name: 'Edge' }))
    expect(await screen.findByRole('heading', { name: /Edge verdict/ })).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Execution & Discipline' }))
    expect(await screen.findByRole('heading', { name: /Execution & discipline/ })).toBeVisible()
  })
})
