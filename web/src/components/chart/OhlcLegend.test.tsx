import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HoverBarStore } from '../../replay/hover-bar-store'
import { OhlcLegend } from './OhlcLegend'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('OhlcLegend', () => {
  it('shows the exact hovered candle with precision and signed non-color cues', () => {
    let frame: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1 })
    const store = new HoverBarStore()
    render(<OhlcLegend store={store} precision={2} timezone={{ kind: 'preset', id: 'UTC' }} />)
    act(() => {
      store.emit({ time: 1_700_000_000, open: 100, high: 103, low: 99, close: 102, hovered: true })
      if (frame) (frame as FrameRequestCallback)(0)
    })
    expect(screen.getByText('100.00')).toBeInTheDocument()
    expect(screen.getByText('103.00')).toBeInTheDocument()
    expect(screen.getByText('+2.00 (+2.00%)')).toBeInTheDocument()
    expect(screen.getByText(/2023/)).toBeInTheDocument()
    expect(screen.queryByText(/EDT|EST/)).not.toBeInTheDocument()
    expect(screen.queryByText('latest')).not.toBeInTheDocument()
  })

  it('marks the latest-bar fallback as muted', () => {
    let frame: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1 })
    const store = new HoverBarStore()
    render(<OhlcLegend store={store} precision={1} timezone={{ kind: 'preset', id: 'ET' }} />)
    act(() => {
      store.emit({ time: 1_700_000_000, open: 102, high: 103, low: 99, close: 100, hovered: false })
      if (frame) (frame as FrameRequestCallback)(0)
    })
    expect(screen.getByText('-2.0 (-1.96%)')).toBeInTheDocument()
    expect(screen.getByText('latest')).toBeInTheDocument()
  })
})
