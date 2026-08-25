import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCalendar, fetchSymbols } from '../../api/client'
import type { CalendarEntry, SymbolMeta } from '../../api/types'
import { EvalSetupScreen } from './EvalSetupScreen'

const api = vi.hoisted(() => ({
  fetchPreferences: vi.fn().mockResolvedValue({}),
  putPreference: vi.fn().mockResolvedValue(undefined),
  deletePreference: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../api/preferences', () => api)

vi.mock('../../api/client', () => ({
  fetchSymbols: vi.fn().mockResolvedValue([]),
  fetchCalendar: vi.fn().mockResolvedValue([]),
}))

const ES: SymbolMeta = {
  symbol: 'ES',
  name: 'E-mini S&P 500',
  kind: 'future',
  tickSize: 0.25,
  pointValue: 50,
  currency: 'USD',
  priceDecimals: 2,
  sessionTz: 'America/New_York',
  rollRule: '',
  commissionPerSide: 0,
  defaultSlippageTicks: 1,
  ranges: { '1m': { from: 1588000000, to: 1588200000 } },
}
const CALENDAR: CalendarEntry[] = [
  { date: '2020-04-27', firstTs: 1587938400, lastTs: 1588024799, bars: 1440 },
  { date: '2020-04-28', firstTs: 1588024800, lastTs: 1588111199, bars: 1440 },
  { date: '2020-04-29', firstTs: 1588111200, lastTs: 1588197599, bars: 1440 },
]

describe('EvalSetupScreen', () => {
  afterEach(cleanup)

  it('creates one evaluation account for every available symbol without an instrument field', () => {
    render(<EvalSetupScreen />)

    expect(screen.queryByRole('combobox', { name: 'Instrument' })).not.toBeInTheDocument()
  })

  it('uses fixed presets without exposing rule settings', async () => {
    const user = userEvent.setup()
    render(<EvalSetupScreen />)
    await user.click(screen.getByRole('button', { name: 'TopStep 50K (EOD trail)' }))
    expect(screen.getByText(/Pass at \$53,000/)).toBeVisible()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /payout/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/verification|funded/i)).not.toBeInTheDocument()
  })

  describe('start date picker', () => {
    beforeEach(() => {
      localStorage.clear()
      vi.mocked(fetchSymbols).mockResolvedValue([ES])
      vi.mocked(fetchCalendar).mockResolvedValue(CALENDAR)
    })
    afterEach(() => {
      vi.mocked(fetchSymbols).mockResolvedValue([])
      vi.mocked(fetchCalendar).mockResolvedValue([])
    })

    it('renders a calendar date picker bounded by the 1m data range', async () => {
      render(<EvalSetupScreen />)

      const picker = await screen.findByLabelText('Start date')
      expect(picker).toHaveAttribute('type', 'date')
      await vi.waitFor(() => expect(picker).toHaveValue('2020-04-28'))
      expect(picker).toHaveAttribute('min', '2020-04-27')
      expect(picker).toHaveAttribute('max', '2020-04-29')
    })

    it('starts the evaluation on the date chosen in the calendar picker', async () => {
      const assign = vi.fn()
      vi.stubGlobal('location', { assign })
      const user = userEvent.setup()
      render(<EvalSetupScreen />)

      const picker = await screen.findByLabelText('Start date')
      await vi.waitFor(() => expect(picker).toHaveValue('2020-04-28'))
      fireEvent.change(picker, { target: { value: '2020-04-29' } })
      expect(picker).toHaveValue('2020-04-29')

      await user.click(screen.getByRole('button', { name: /CREATE EVALUATION ACCOUNT/i }))
      await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/'))

      const session = localStorage.getItem('replay:eval')
      expect(session).toBeTruthy()
      expect(session).toContain('"startDate":"2020-04-29"')
      expect(session).toContain('"startTs":1588111200')
      vi.unstubAllGlobals()
    })
  })

  describe('create flow', () => {
    beforeEach(() => {
      localStorage.clear()
      api.putPreference.mockClear()
      vi.mocked(fetchSymbols).mockResolvedValue([ES])
      vi.mocked(fetchCalendar).mockResolvedValue(CALENDAR)
    })
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.mocked(fetchSymbols).mockResolvedValue([])
      vi.mocked(fetchCalendar).mockResolvedValue([])
    })

    it('persists the new account locally and pushes it to the backend before navigating home', async () => {
      const assign = vi.fn()
      vi.stubGlobal('location', { assign })
      const user = userEvent.setup()
      render(<EvalSetupScreen />)

      const picker = await screen.findByLabelText('Start date')
      await vi.waitFor(() => expect(picker).toHaveValue('2020-04-28'))
      await user.click(screen.getByRole('button', { name: /CREATE EVALUATION ACCOUNT/i }))
      await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/'))

      const session = localStorage.getItem('replay:eval')
      const registry = localStorage.getItem('replay:eval:accounts')
      expect(session).toBeTruthy()
      expect(registry).toBeTruthy()
      const parsed = JSON.parse(session ?? '{}') as { config?: { verificationProfitTarget?: number; payout?: unknown } }
      expect(parsed.config?.verificationProfitTarget).toBe(0)
      expect(parsed.config?.payout).toBeUndefined()
      expect(api.putPreference).toHaveBeenCalledWith('replay:eval', session)
      expect(api.putPreference).toHaveBeenCalledWith('replay:eval:accounts', registry)

      const lastPushOrder = Math.max(...api.putPreference.mock.invocationCallOrder)
      const navigateOrder = assign.mock.invocationCallOrder[0]
      expect(lastPushOrder).toBeLessThan(navigateOrder)
    })
  })
})
