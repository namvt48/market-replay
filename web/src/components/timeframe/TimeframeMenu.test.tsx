import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { timeframePreferenceStore } from '../../replay/timeframe-preferences'
import { TimeframeMenu } from './TimeframeMenu'

beforeEach(() => {
  window.localStorage.clear()
  timeframePreferenceStore.reload()
})

afterEach(cleanup)

describe('TimeframeMenu', () => {
  it('mounts the portal at the trigger position without a top-left frame', async () => {
    const user = userEvent.setup()
    render(<TimeframeMenu active="1m" onSelect={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Timeframe menu' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 120, y: 8, left: 120, right: 152, top: 8, bottom: 40, width: 32, height: 32, toJSON: () => ({}),
    })
    const nativeAppendChild = Node.prototype.appendChild
    let firstPortalLeft: string | null = null
    const appendSpy = vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function appendChild<T extends Node>(this: Node, child: T): T {
      if (child instanceof HTMLElement && child.matches('[role="menu"][aria-label="Timeframes"]')) firstPortalLeft ??= child.style.left
      return nativeAppendChild.call(this, child) as T
    })

    await user.click(trigger)

    appendSpy.mockRestore()
    expect(firstPortalLeft).toBe('120px')
  })

  it('sorts custom intervals numerically inside each timeframe group', async () => {
    const user = userEvent.setup()
    expect(timeframePreferenceStore.addCustom('7m')).toEqual({ ok: true, value: '7m' })
    render(<TimeframeMenu active="1m" onSelect={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Timeframe menu' }))

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Add custom interval…',
      '1 minute', '2 minutes', '3 minutes', '5 minutes', '7 minutes', '10 minutes', '15 minutes', '30 minutes', '45 minutes',
      '1 hour', '2 hours', '3 hours', '4 hours', '6 hours', '12 hours',
      '1 day',
      '1 week',
      '1 month',
    ])
  })

  it('adds, canonicalizes, selects and persists a custom timeframe', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<TimeframeMenu active="1m" onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: 'Timeframe menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Add custom interval…' }))
    await user.type(screen.getByLabelText('Interval'), '7')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(onSelect).toHaveBeenCalledWith('7m')
    expect(screen.queryByRole('dialog', { name: 'Add custom interval' })).not.toBeInTheDocument()
    expect(window.localStorage.getItem('market-replay:timeframe-preferences')).toContain('7m')
  })

  it('adds custom week and month intervals', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<TimeframeMenu active="1m" onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'Timeframe menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Add custom interval…' }))
    await user.selectOptions(screen.getByLabelText('Type'), 'w')
    await user.type(screen.getByLabelText('Interval'), '2')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(onSelect).toHaveBeenLastCalledWith('2w')

    await user.click(screen.getByRole('button', { name: 'Timeframe menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Add custom interval…' }))
    await user.selectOptions(screen.getByLabelText('Type'), 'M')
    await user.type(screen.getByLabelText('Interval'), '3')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(onSelect).toHaveBeenLastCalledWith('3M')
    expect(window.localStorage.getItem('market-replay:timeframe-preferences')).toContain('2w')
    expect(window.localStorage.getItem('market-replay:timeframe-preferences')).toContain('3M')
  })

  it('shows normalized duplicate validation inline', async () => {
    const user = userEvent.setup()
    render(<TimeframeMenu active="1m" onSelect={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Timeframe menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Add custom interval…' }))
    await user.type(screen.getByLabelText('Interval'), '60')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('alert')).toHaveTextContent('1h already exists')
  })

  it('omits the SECONDS group and custom-interval Seconds option when the symbol has no 5s data', async () => {
    const user = userEvent.setup()
    render(<TimeframeMenu active="1m" onSelect={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Timeframe menu' }))
    expect(screen.queryByText('SECONDS')).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '5 seconds' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'Add custom interval…' }))
    expect(screen.queryByRole('option', { name: 'Seconds' })).not.toBeInTheDocument()
  })

  it('shows a SECONDS group and lets a custom seconds interval be added when the symbol has 5s data', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<TimeframeMenu active="1m" onSelect={onSelect} hasSecondsData />)
    await user.click(screen.getByRole('button', { name: 'Timeframe menu' }))
    expect(screen.getByText('SECONDS')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent).slice(0, 4)).toEqual([
      'Add custom interval…', '5 seconds', '15 seconds', '30 seconds',
    ])

    await user.click(screen.getByRole('menuitem', { name: 'Add custom interval…' }))
    await user.selectOptions(screen.getByLabelText('Type'), 's')
    await user.type(screen.getByLabelText('Interval'), '10')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(onSelect).toHaveBeenCalledWith('10s')
  })

  it('stars and unstars an interval and supports arrow-key menu navigation', async () => {
    const user = userEvent.setup()
    render(<TimeframeMenu active="1m" onSelect={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Timeframe menu' }))
    const first = screen.getByRole('menuitem', { name: '1 minute' })
    first.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: '2 minutes' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Unstar 5m' }))
    expect(screen.getByRole('button', { name: 'Star 5m' })).toBeInTheDocument()
    expect(timeframePreferenceStore.getSnapshot().starredTimeframes).not.toContain('5m')
  })
})
