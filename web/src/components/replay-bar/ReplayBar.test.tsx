import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEvalStore } from '../../store/eval-store'
import { ReplayBar } from './ReplayBar'

const replayMocks = vi.hoisted(() => ({
  togglePlay: vi.fn(),
  stepBack: vi.fn(),
  stepForward: vi.fn(),
  seek: vi.fn(),
  setSpeed: vi.fn(),
  setStepTimeframe: vi.fn(),
  beginReplaySelection: vi.fn(),
  exitReplay: vi.fn(),
  snapshot: {
    replayMode: 'active',
    replayStartTs: 1_724_999_000,
    playing: false,
    status: 'ready',
    cursorTs: 1_725_000_000,
    speed: 5,
    stepTimeframe: '1m',
    error: null,
    symbol: { sessionTz: 'America/New_York' },
    fill: { equityCents: 1_025_000, config: { startingEquityCents: 1_000_000 } },
  },
}))

vi.mock('../../replay/use-replay', () => ({
  useReplaySnapshot: () => replayMocks.snapshot,
  useReplaySelector: (select: (value: typeof replayMocks.snapshot) => unknown) => select(replayMocks.snapshot),
}))
vi.mock('../../replay/replay-engine', () => ({
  replayEngine: replayMocks,
  SPEEDS: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  STEP_TIMEFRAMES: ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '4h'],
}))

beforeEach(() => {
  vi.clearAllMocks()
  replayMocks.snapshot.replayMode = 'active'
  replayMocks.snapshot.playing = false
  replayMocks.snapshot.speed = 5
  replayMocks.snapshot.stepTimeframe = '1m'
})
afterEach(cleanup)

describe('ReplayBar', () => {
  it('stays out of the chart layout until Replay is activated', () => {
    replayMocks.snapshot.replayMode = 'inactive'
    const { container } = render(<ReplayBar />)

    expect(container).toBeEmptyDOMElement()
    replayMocks.snapshot.replayMode = 'active'
  })

  it('shows bar-selection guidance and disables playback until a candle is selected', async () => {
    replayMocks.snapshot.replayMode = 'selecting'
    render(<ReplayBar />)

    expect(screen.getByRole('status')).toHaveTextContent('Select a bar on the chart')
    expect(screen.getByRole('button', { name: 'Play replay (Space)' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close Replay' })).not.toBeInTheDocument()
    replayMocks.snapshot.replayMode = 'active'
  })

  it('presents one compact, keyboard-described transport group', async () => {
    const user = userEvent.setup()
    render(<ReplayBar />)

    expect(screen.getByRole('contentinfo', { name: 'Replay controls' })).toHaveAttribute('id', 'replay-controls')
    expect(screen.getByRole('group', { name: 'Replay transport' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Select replay start bar' }))
    await user.click(screen.getByRole('button', { name: 'Play replay (Space)' }))
    await user.click(screen.getByRole('button', { name: 'Previous replay interval (Shift+←)' }))
    await user.click(screen.getByRole('button', { name: 'Next replay interval (Shift+→)' }))

    expect(replayMocks.togglePlay).toHaveBeenCalledOnce()
    expect(replayMocks.beginReplaySelection).toHaveBeenCalledOnce()
    expect(replayMocks.stepBack).toHaveBeenCalledOnce()
    expect(replayMocks.stepForward).toHaveBeenCalledOnce()
  })

  it('uses a 1x–16x speed slider and the requested replay intervals', async () => {
    const user = userEvent.setup()
    render(<ReplayBar />)

    const speed = screen.getByRole('slider', { name: 'Replay speed' })
    expect(speed).toHaveAttribute('min', '1')
    expect(speed).toHaveAttribute('max', '16')
    expect(speed).toHaveValue('5')
    fireEvent.change(speed, { target: { value: '16' } })
    expect(replayMocks.setSpeed).toHaveBeenCalledWith(16)

    const interval = screen.getByRole('button', { name: 'Replay interval' })
    expect(interval).toHaveTextContent('1m')
    expect(interval).toHaveAttribute('aria-expanded', 'false')
    await user.click(interval)
    expect(interval).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['1m', '3m', '5m', '10m', '15m', '30m', '1h', '4h'])
    await user.click(screen.getByRole('option', { name: '30m' }))
    expect(replayMocks.setStepTimeframe).toHaveBeenCalledWith('30m')
    expect(interval).toHaveAttribute('aria-expanded', 'false')
  })

  it('supports keyboard navigation in the themed replay interval menu', async () => {
    const user = userEvent.setup()
    render(<ReplayBar />)
    const trigger = screen.getByRole('button', { name: 'Replay interval' })

    await user.click(trigger)
    await waitFor(() => expect(screen.getByRole('option', { name: '1m' })).toHaveFocus())
    await user.keyboard('{End}{Enter}')

    expect(replayMocks.setStepTimeframe).toHaveBeenCalledWith('4h')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('keeps the replay date accessible without turning metadata into primary buttons', () => {
    render(<ReplayBar />)

    const dateButton = screen.getByRole('button', { name: /Choose replay date/ })
    expect(dateButton).toHaveTextContent('2024-08-30')
    const dateInput = document.querySelector<HTMLInputElement>('input[type="date"]')
    expect(dateInput).toHaveAttribute('aria-hidden', 'true')
    if (!dateInput) throw new Error('expected the calendar-backed date input')
    fireEvent.change(dateInput, { target: { value: '2024-07-02' } })
    expect(replayMocks.seek).toHaveBeenCalledWith(Date.parse('2024-07-02T13:30:00Z') / 1_000)
    expect(screen.queryByText('Equity')).not.toBeInTheDocument()
    expect(dateButton.textContent).not.toMatch(/:\d{2}:\d{2}/)
  })

  it('keeps play and pause as the only filled transport control', () => {
    const { rerender } = render(<ReplayBar />)

    expect(screen.getByRole('button', { name: 'Play replay (Space)' })).toHaveClass('bg-active', 'text-white')
    expect(screen.getByRole('slider', { name: 'Replay speed' })).toHaveClass('accent-active')
    expect(screen.getByRole('button', { name: 'Replay interval' })).toHaveClass('border-transparent')
    expect(screen.getByRole('button', { name: 'Select replay start bar' })).not.toHaveClass('bg-active')

    replayMocks.snapshot.playing = true
    rerender(<ReplayBar />)
    expect(screen.getByRole('button', { name: 'Pause replay (Space)' })).toHaveClass('bg-active', 'text-white')
  })

  it('locks backward transport and hides date changes while keeping evaluation playback available', async () => {
    const user = userEvent.setup()
    useEvalStore.setState({ phase: 'running', startTs: 1_724_999_000 })
    try {
      render(<ReplayBar />)
      const stepBack = screen.getByRole('button', { name: 'Previous replay interval (Shift+←)' })
      expect(stepBack).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Select replay start bar' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Waiting for replay bar selection' })).not.toBeInTheDocument()

      await user.click(stepBack)
      expect(replayMocks.stepBack).not.toHaveBeenCalled()
      expect(replayMocks.seek).not.toHaveBeenCalled()

      const play = screen.getByRole('button', { name: 'Play replay (Space)' })
      expect(play).toBeEnabled()
      await user.click(play)
      expect(replayMocks.togglePlay).toHaveBeenCalledOnce()

      expect(screen.queryByRole('button', { name: /Choose replay date/ })).not.toBeInTheDocument()
      const dateInput = document.querySelector<HTMLInputElement>('input[type="date"]')
      expect(dateInput).not.toBeInTheDocument()
      expect(replayMocks.seek).not.toHaveBeenCalled()

      expect(screen.getByRole('button', { name: 'Next replay interval (Shift+→)' })).toBeEnabled()
    } finally {
      useEvalStore.setState({ phase: 'idle', startTs: null })
    }
  })
})
