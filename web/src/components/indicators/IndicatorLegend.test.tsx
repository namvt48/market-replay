import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndicatorLegend } from './IndicatorLegend'

const mocks = vi.hoisted(() => ({
  snapshot: {
    indicators: [{ id: 'gb69-cbmor', scriptId: 'gb69-cbmor', name: 'GB69 CBMOR', visible: true, inputs: { show_lines: true } }],
    indicatorLoading: false,
  },
  setIndicatorVisibility: vi.fn(), removeIndicator: vi.fn(), updateIndicatorInputs: vi.fn(), refreshIndicator: vi.fn(),
}))

vi.mock('../../replay/use-replay', () => ({ useReplaySelector: (select: (snapshot: typeof mocks.snapshot) => unknown) => select(mocks.snapshot) }))
vi.mock('../../replay/replay-engine', () => ({ replayEngine: mocks }))
vi.mock('./use-indicator-catalog', () => ({
  useIndicatorCatalog: () => ({
    status: 'ready', error: null, descriptors: [{
      id: 'gb69-cbmor', name: 'GB69 CBMOR', version: 1, meta: { onMainPanel: true },
      inputs: [{ kind: 'bool', key: 'show_lines', label: 'Show lines', default: true, group: 'Display' }],
    }],
  }),
}))

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('IndicatorLegend', () => {
  it('offers the chart-level visibility, settings, remove and more actions', async () => {
    const user = userEvent.setup()
    render(<IndicatorLegend />)

    await user.click(screen.getByRole('button', { name: 'Hide GB69 CBMOR' }))
    expect(mocks.setIndicatorVisibility).toHaveBeenCalledWith('gb69-cbmor', false)

    await user.click(screen.getByRole('button', { name: 'Settings for GB69 CBMOR' }))
    expect(screen.getByRole('dialog', { name: 'GB69 CBMOR settings' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(mocks.updateIndicatorInputs).toHaveBeenCalledWith('gb69-cbmor', { show_lines: true })

    await user.click(screen.getByRole('button', { name: 'More actions for GB69 CBMOR' }))
    await user.click(screen.getByRole('menuitem', { name: 'Recalculate' }))
    expect(mocks.refreshIndicator).toHaveBeenCalledWith('gb69-cbmor')

    await user.click(screen.getByRole('button', { name: 'Remove GB69 CBMOR' }))
    expect(mocks.removeIndicator).toHaveBeenCalledWith('gb69-cbmor')
  })
})
