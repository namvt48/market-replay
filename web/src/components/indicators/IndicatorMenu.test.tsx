import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IndicatorDescriptor } from '../../api/types'
import { IndicatorMenu } from './IndicatorMenu'

const descriptors: IndicatorDescriptor[] = [
  { id: 'day-separator', name: 'Day Separator', version: 1, meta: { onMainPanel: true }, inputs: [{ kind: 'bool', key: 'show', label: 'Show', default: true, group: 'Day Separator' }] },
  { id: 'killzones', name: 'Killzones', version: 1, meta: { onMainPanel: true }, inputs: [{ kind: 'session', key: 'asia', label: 'Asia', default: '2000-0000', group: 'Sessions' }] },
  { id: 'fractals', name: 'Fractals', version: 1, meta: { onMainPanel: true }, inputs: [{ kind: 'int', key: 'length', label: 'Length', default: 3, group: 'Fractals' }] },
  { id: 'ipda-ranges', name: 'IPDA Ranges', version: 1, meta: { onMainPanel: true }, inputs: [{ kind: 'bool', key: 'show20', label: 'Show 20', default: true, group: 'IPDA Ranges' }] },
]

const mocks = vi.hoisted(() => ({
  addIndicator: vi.fn(),
  retry: vi.fn(),
  snapshot: { indicators: [], indicatorLoading: false, indicatorError: null },
}))

vi.mock('../../replay/replay-engine', () => ({ replayEngine: { addIndicator: mocks.addIndicator } }))
vi.mock('../../replay/use-replay', () => ({ useReplaySelector: (select: (snapshot: typeof mocks.snapshot) => unknown) => select(mocks.snapshot) }))
vi.mock('./use-indicator-catalog', () => ({
  retryIndicatorCatalog: mocks.retry,
  useIndicatorCatalog: () => ({ status: 'ready', descriptors, error: null }),
}))

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('IndicatorMenu', () => {
  it('filters the server catalog by indicator family and adds the chosen study', async () => {
    const user = userEvent.setup()
    render(<IndicatorMenu />)

    await user.click(screen.getByRole('button', { name: 'Indicators' }))
    const search = screen.getByRole('searchbox', { name: 'Search indicators' })
    expect(search).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Indicator library' })).toBeVisible()

    await user.type(search, 'sessions')
    expect(screen.getByRole('button', { name: /Day Separator/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Killzones/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /IPDA Ranges/ })).not.toBeInTheDocument()

    await user.clear(search)
    await user.click(screen.getByRole('button', { name: /Fractals/ }))
    expect(mocks.addIndicator).toHaveBeenCalledWith(descriptors[2])
    expect(screen.queryByRole('dialog', { name: 'Indicator library' })).not.toBeInTheDocument()
  })
})
