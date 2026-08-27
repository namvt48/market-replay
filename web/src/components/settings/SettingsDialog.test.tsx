import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SymbolMeta } from '../../api/types'
import { useWorkspaceSettingsStore } from '../../store/workspace-settings-store'
import { SettingsDialog } from './SettingsDialog'

const nq: SymbolMeta = {
  symbol: 'NQ', name: 'E-mini Nasdaq-100', kind: 'future', tickSize: 0.25, pointValue: 20,
  currency: 'USD', priceDecimals: 2, sessionTz: 'America/New_York', rollRule: '',
  commissionPerSide: 2.09, defaultSlippageTicks: 1, ranges: {},
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    useWorkspaceSettingsStore.setState({ executionCosts: {}, journalTemplates: [] })
  })
  afterEach(cleanup)

  it('saves execution costs and exposes all workspace settings sections', async () => {
    const user = userEvent.setup()
    const onTimezoneChange = vi.fn()
    render(<SettingsDialog symbols={[nq]} timezone={{ kind: 'preset', id: 'ET' }} onTimezoneChange={onTimezoneChange} syncFlags={{ crosshair: true, dateRange: true, lockZoom: false }} onSyncFlagsChange={vi.fn()} onClose={() => undefined} />)

    expect(screen.getByRole('dialog', { name: 'Workspace settings' })).toBeVisible()
    await user.clear(screen.getByLabelText('NQ spread in ticks'))
    await user.type(screen.getByLabelText('NQ spread in ticks'), '1.5')
    await user.click(screen.getByRole('button', { name: 'Save costs' }))
    expect(useWorkspaceSettingsStore.getState().executionCosts.NQ).toEqual({ spreadTicks: 1.5, commissionPerSide: 2.09 })

    await user.click(screen.getByRole('button', { name: /Journal tags/ }))
    expect(screen.getByRole('heading', { name: 'Tag groups' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /^Templates/ }))
    expect(screen.getByRole('heading', { name: 'Journal templates' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /^Timezone/ }))
    await user.click(screen.getByRole('radio', { name: /PT.*Los Angeles/ }))
    expect(onTimezoneChange).toHaveBeenCalledWith({ kind: 'preset', id: 'PT' })
  })

  it('moves crosshair, range and zoom synchronization into Workspace settings', async () => {
    const user = userEvent.setup()
    const onSyncFlagsChange = vi.fn()
    render(<SettingsDialog symbols={[nq]} timezone={{ kind: 'preset', id: 'ET' }} onTimezoneChange={vi.fn()} syncFlags={{ crosshair: true, dateRange: true, lockZoom: false }} onSyncFlagsChange={onSyncFlagsChange} onClose={() => undefined} />)

    await user.click(screen.getByRole('button', { name: /Chart synchronization/ }))
    const crosshair = screen.getByRole('switch', { name: 'Sync crosshair across charts' })
    const dateRange = screen.getByRole('switch', { name: 'Sync date range across charts' })
    const zoom = screen.getByRole('switch', { name: 'Sync zoom across charts' })
    expect(crosshair).toBeChecked()
    expect(dateRange).toBeChecked()
    expect(zoom).not.toBeChecked()

    await user.click(crosshair)
    await user.click(dateRange)
    await user.click(zoom)

    expect(onSyncFlagsChange.mock.calls).toEqual([
      [{ crosshair: false }],
      [{ dateRange: false }],
      [{ lockZoom: true }],
    ])
  })
})
