import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HoverBarStore } from '../../replay/hover-bar-store'
import { OhlcLegend } from './OhlcLegend'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('OhlcLegend', () => {
  it('shows the exact hovered candle with precision and signed non-color cues', () => {
    let frame: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1 })
    const store = new HoverBarStore()
    render(<OhlcLegend store={store} precision={2} />)
    act(() => {
      store.emit({ time: 1_700_000_000, open: 100, high: 103, low: 99, close: 102, hovered: true })
      if (frame) (frame as FrameRequestCallback)(0)
    })
    expect(screen.getByText('100.00')).toBeInTheDocument()
    expect(screen.getByText('103.00')).toBeInTheDocument()
    expect(screen.getByText('+2.00 (+2.00%)')).toBeInTheDocument()
    expect(screen.queryByRole('time')).not.toBeInTheDocument()
    expect(screen.getByLabelText('OHLC values')).toBeInTheDocument()
    expect(screen.queryByText('latest')).not.toBeInTheDocument()
  })

  it('marks the latest-bar fallback as muted', () => {
    let frame: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1 })
    const store = new HoverBarStore()
    render(<OhlcLegend store={store} precision={1} />)
    act(() => {
      store.emit({ time: 1_700_000_000, open: 102, high: 103, low: 99, close: 100, hovered: false })
      if (frame) (frame as FrameRequestCallback)(0)
    })
    expect(screen.getByText('-2.0 (-1.96%)')).toBeInTheDocument()
    expect(screen.getByText('latest')).toBeInTheDocument()
  })

  it('hides the whole readout when it exceeds the available width and restores it after resize', () => {
    let containerWidth = 160
    const contentWidth = 320
    let notifyResize: (() => void) | null = null
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('aria-label') === 'OHLC values' ? containerWidth : 0
    })
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.parentElement?.getAttribute('aria-label') === 'OHLC values' ? contentWidth : 0
    })
    class ResizeObserverMock implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) { notifyResize = () => callback([], this) }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)

    let frame: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1 })
    const store = new HoverBarStore()
    const { container } = render(<OhlcLegend store={store} precision={2} />)
    act(() => {
      store.emit({ time: 1_700_000_000, open: 100, high: 103, low: 99, close: 102, hovered: true })
      if (frame) (frame as FrameRequestCallback)(0)
    })

    const legend = container.querySelector<HTMLElement>('[aria-label="OHLC values"]')
    expect(legend).toHaveAttribute('data-overflowing', 'true')
    expect(legend).toHaveAttribute('aria-hidden', 'true')
    expect(legend?.firstElementChild).toHaveClass('invisible')

    containerWidth = 360
    act(() => {
      const resize = notifyResize
      if (resize) resize()
    })
    expect(legend).toHaveAttribute('data-overflowing', 'false')
    expect(legend).not.toHaveAttribute('aria-hidden')
    expect(legend?.firstElementChild).not.toHaveClass('invisible')
  })
})
