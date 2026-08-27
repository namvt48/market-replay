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

  it('shows one custom configuration without instrument or preset controls', () => {
    render(<EvalSetupScreen />)

    expect(screen.getByLabelText('Account name')).toBeVisible()
    expect(screen.queryByRole('combobox', { name: 'Instrument' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /FTMO|TopStep|Apex/ })).not.toBeInTheDocument()
  })

  it('starts from editable custom rules with $500 money increments', () => {
    render(<EvalSetupScreen />)
    expect(screen.getByRole('region', { name: 'Evaluation summary' })).toHaveTextContent('Pass balance$54,000')
    const moneyFields = screen.getAllByRole('spinbutton').filter((field) => field.getAttribute('step') === '500')
    expect(moneyFields).toHaveLength(4)
    expect(screen.getByLabelText(/Account size/i)).toHaveValue(50000)
    fireEvent.change(screen.getByLabelText(/Profit target/i), { target: { value: '3500' } })
    expect(screen.getByRole('region', { name: 'Evaluation summary' })).toHaveTextContent('Pass balance$53,500')
    expect(screen.queryByRole('heading', { name: /payout/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/verification|funded/i)).not.toBeInTheDocument()
  })

  it('supports disabling and re-enabling the consistency rule', async () => {
    const user = userEvent.setup()
    render(<EvalSetupScreen />)

    const consistency = screen.getByLabelText(/Consistency \(0 = none\)/i)
    expect(consistency).toHaveValue(40)
    await user.click(screen.getByText('Consistency rule'))
    expect(consistency).toHaveValue(0)
    await user.click(screen.getByText('Consistency rule'))
    expect(consistency).toHaveValue(40)
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
      await user.type(screen.getByLabelText('Account name'), 'ES custom eval')

      await user.click(screen.getByRole('button', { name: /START EVALUATION/i }))
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
      await user.type(screen.getByLabelText('Account name'), 'August evaluation')
      await user.click(screen.getByRole('button', { name: /START EVALUATION/i }))
      await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/'))

      const session = localStorage.getItem('replay:eval')
      const registry = localStorage.getItem('replay:eval:accounts')
      expect(session).toBeTruthy()
      expect(registry).toBeTruthy()
      const parsed = JSON.parse(session ?? '{}') as { phase?: string; instrument?: string; name?: string; config?: { firm?: string; verificationProfitTarget?: number; payout?: unknown } }
      expect(parsed.phase).toBe('running')
      expect(parsed.instrument).toBeNull()
      expect(parsed.name).toBe('August evaluation')
      expect(parsed.config?.firm).toBe('Custom')
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
