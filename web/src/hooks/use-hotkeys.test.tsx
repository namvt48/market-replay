import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChartWorkspaceProvider } from '../chart-workspace/ChartWorkspaceContext'
import { replayEngine } from '../replay/replay-engine'
import { useEvalStore } from '../store/eval-store'
import { useHotkeys } from './use-hotkeys'

function Harness() {
  const hotkeys = useHotkeys()
  return (
    <div>
      <output aria-label="Hotkey dialog">{hotkeys.dialog ? `${hotkeys.dialog.type}:${'query' in hotkeys.dialog ? hotkeys.dialog.query : ''}` : 'closed'}</output>
      <button type="button" onClick={hotkeys.closeDialog}>Close hotkey dialog</button>
      <div role="application" aria-label="Chart keyboard surface" tabIndex={0} onKeyDown={(event) => event.stopPropagation()}>Chart keyboard surface</div>
      <label>Editable field<input /></label>
    </div>
  )
}

function renderHarness(): void {
  render(<ChartWorkspaceProvider><Harness /></ChartWorkspaceProvider>)
}

describe('useHotkeys TradingView compatibility', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('routes bare letters to symbol search, Shift for limit tickets, and Alt+Q for market orders', async () => {
    const user = userEvent.setup()
    const placeMarket = vi.spyOn(replayEngine, 'placeMarket').mockImplementation(() => undefined)
    const placePendingAtLast = vi.spyOn(replayEngine, 'placePendingAtLast').mockImplementation(() => undefined)
    const setDrawingTool = vi.spyOn(replayEngine, 'setDrawingTool').mockImplementation(() => undefined)
    renderHarness()

    await user.keyboard('b')
    expect(screen.getByLabelText('Hotkey dialog')).toHaveTextContent('symbol:b')
    expect(placeMarket).not.toHaveBeenCalled()
    expect(placePendingAtLast).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Close hotkey dialog' }))
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    fireEvent.keyDown(window, { key: 'b', shiftKey: true })
    fireEvent.keyUp(window, { key: 'Shift' })
    expect(placePendingAtLast).toHaveBeenCalledWith('buy', 'limit')
    expect(placeMarket).not.toHaveBeenCalled()
    expect(setDrawingTool).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'q', altKey: true })
    expect(placeMarket).toHaveBeenCalledWith('buy')
  })

  it('does not arm Measure from Shift alone before the chart receives a modified pointerdown', async () => {
    const user = userEvent.setup()
    const setDrawingTool = vi.spyOn(replayEngine, 'setDrawingTool').mockImplementation(() => undefined)
    renderHarness()

    await user.keyboard('{Shift>}{/Shift}')

    expect(setDrawingTool).not.toHaveBeenCalled()
  })

  it('captures trading shortcuts before a focused chart surface can stop keyboard propagation', () => {
    const placeMarket = vi.spyOn(replayEngine, 'placeMarket').mockImplementation(() => undefined)
    const placePendingAtLast = vi.spyOn(replayEngine, 'placePendingAtLast').mockImplementation(() => undefined)
    renderHarness()
    const chart = screen.getByRole('application', { name: 'Chart keyboard surface' })
    chart.focus()

    fireEvent.keyDown(chart, { key: 'b', shiftKey: true })
    fireEvent.keyDown(chart, { key: 's', shiftKey: true })
    fireEvent.keyDown(chart, { key: 'q', altKey: true })
    fireEvent.keyDown(chart, { key: 'q', altKey: true, shiftKey: true })

    expect(placePendingAtLast).toHaveBeenNthCalledWith(1, 'buy', 'limit')
    expect(placePendingAtLast).toHaveBeenNthCalledWith(2, 'sell', 'limit')
    expect(placeMarket).toHaveBeenNthCalledWith(1, 'buy')
    expect(placeMarket).toHaveBeenNthCalledWith(2, 'sell')
  })

  it('routes digits to interval entry and ignores shortcuts inside editable controls', async () => {
    const user = userEvent.setup()
    renderHarness()

    await user.keyboard('5')
    expect(screen.getByLabelText('Hotkey dialog')).toHaveTextContent('interval:5')
    await user.click(screen.getByRole('button', { name: 'Close hotkey dialog' }))

    const input = screen.getByRole('textbox', { name: 'Editable field' })
    await user.click(input)
    await user.type(input, 'NQ5')
    expect(input).toHaveValue('NQ5')
    expect(screen.getByLabelText('Hotkey dialog')).toHaveTextContent('closed')
  })

  it('activates TradingView drawing shortcuts with Alt/Option', async () => {
    const user = userEvent.setup()
    const setDrawingTool = vi.spyOn(replayEngine, 'setDrawingTool').mockImplementation(() => undefined)
    renderHarness()

    await user.keyboard('{Alt>}f{/Alt}')
    expect(setDrawingTool).toHaveBeenCalledWith('fib-retracement')
    await user.keyboard('{Alt>}{Shift>}r{/Shift}{/Alt}')
    expect(setDrawingTool).toHaveBeenCalledWith('rectangle')
  })

  it('blocks backward replay shortcuts while an evaluation runs but keeps forward ones', () => {
    const stepBack = vi.spyOn(replayEngine, 'stepBack').mockImplementation(() => undefined)
    const stepForward = vi.spyOn(replayEngine, 'stepForward').mockImplementation(() => undefined)
    const seek = vi.spyOn(replayEngine, 'seek').mockResolvedValue(undefined)
    useEvalStore.setState({ phase: 'running', startTs: 1_724_999_000 })
    renderHarness()
    try {
      fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true })
      fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true, ctrlKey: true })
      expect(stepBack).not.toHaveBeenCalled()
      expect(seek).not.toHaveBeenCalled()

      fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true })
      expect(stepForward).toHaveBeenCalledOnce()
      fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true, ctrlKey: true })
      expect(seek).toHaveBeenCalledTimes(1)
    } finally {
      useEvalStore.setState({ phase: 'idle', startTs: null })
    }
  })

  it('blocks the browser native reload on Ctrl+R / Cmd+R', () => {
    renderHarness()
    const ctrlEvent = new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, cancelable: true })
    const ctrlPrevented = vi.spyOn(ctrlEvent, 'preventDefault')
    window.dispatchEvent(ctrlEvent)
    expect(ctrlPrevented).toHaveBeenCalled()

    const metaEvent = new KeyboardEvent('keydown', { key: 'r', metaKey: true, cancelable: true })
    const metaPrevented = vi.spyOn(metaEvent, 'preventDefault')
    window.dispatchEvent(metaEvent)
    expect(metaPrevented).toHaveBeenCalled()
  })
})
