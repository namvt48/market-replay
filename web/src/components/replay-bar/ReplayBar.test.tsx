import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReplayBar } from './ReplayBar'

const replayMocks = vi.hoisted(() => ({
  togglePlay: vi.fn(),
  stepBack: vi.fn(),
  stepForward: vi.fn(),
  seek: vi.fn(),
  setSpeed: vi.fn(),
  beginReplaySelection: vi.fn(),
  exitReplay: vi.fn(),
  snapshot: {
    replayMode: 'active',
    replayStartTs: 1_724_999_000,
    playing: false,
    status: 'ready',
    cursorTs: 1_725_000_000,
    speed: 5,
    error: null,
    symbol: { sessionTz: 'America/New_York' },
    fill: { equityCents: 1_025_000, config: { startingEquityCents: 1_000_000 } },
  },
}))

vi.mock('../../replay/use-replay', () => ({
  useReplaySnapshot: () => replayMocks.snapshot,
  useReplaySelector: (select: (value: typeof replayMocks.snapshot) => unknown) => select(replayMocks.snapshot),
}))
vi.mock('../../replay/replay-engine', () => ({ replayEngine: replayMocks }))

beforeEach(() => {
  vi.clearAllMocks()
  replayMocks.snapshot.replayMode = 'active'
  replayMocks.snapshot.playing = false
  replayMocks.snapshot.speed = 5
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
    await user.click(screen.getByRole('button', { name: 'Select another replay start bar' }))
    await user.click(screen.getByRole('button', { name: 'Play replay (Space)' }))
    await user.click(screen.getByRole('button', { name: 'Step back (←)' }))
    await user.click(screen.getByRole('button', { name: 'Step forward (→)' }))

    expect(replayMocks.togglePlay).toHaveBeenCalledOnce()
    expect(replayMocks.beginReplaySelection).toHaveBeenCalledOnce()
    expect(replayMocks.stepBack).toHaveBeenCalledOnce()
    expect(replayMocks.stepForward).toHaveBeenCalledOnce()
  })

  it('keeps speed and date accessible without turning metadata into primary buttons', async () => {
    const user = userEvent.setup()
    render(<ReplayBar />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Replay speed' }), '20')
    expect(replayMocks.setSpeed).toHaveBeenCalledWith(20)
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

  it('keeps play, pause and every high-speed option high contrast', () => {
    const { rerender } = render(<ReplayBar />)

    expect(screen.getByRole('button', { name: 'Play replay (Space)' })).toHaveClass('bg-active', 'text-white')
    expect(screen.getByRole('combobox', { name: 'Replay speed' })).toHaveClass('[color-scheme:dark]')
    for (const speed of ['20x', '100x', '500x']) {
      expect(screen.getByRole('option', { name: speed })).toHaveClass('bg-surface-1', 'text-ink')
    }

    replayMocks.snapshot.playing = true
    rerender(<ReplayBar />)
    expect(screen.getByRole('button', { name: 'Pause replay (Space)' })).toHaveClass('bg-active', 'text-white')
  })
})
