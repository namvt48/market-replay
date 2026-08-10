import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReplaySnapshot } from './replay-engine'

const engine = vi.hoisted(() => {
  let snapshot = { cursorTs: 0, status: 'ready', qty: 1 } as unknown as ReplaySnapshot
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit: (patch: Partial<ReplaySnapshot>) => {
      snapshot = { ...snapshot, ...patch }
      listeners.forEach((listener) => listener())
    },
  }
})

vi.mock('./replay-engine', () => ({ replayEngine: { getSnapshot: engine.getSnapshot, subscribe: engine.subscribe } }))

const { useReplaySelector } = await import('./use-replay')

afterEach(() => vi.restoreAllMocks())

describe('useReplaySelector', () => {
  it('does not re-render when the selected slice is unchanged', () => {
    const renders = vi.fn()
    function QtyReadout() {
      const qty = useReplaySelector((snapshot) => snapshot.qty)
      renders()
      return <span data-testid="qty">{qty}</span>
    }
    render(<QtyReadout />)
    const initialRenders = renders.mock.calls.length

    // The cursor advancing is exactly what happens ~10x/s during replay.
    act(() => engine.emit({ cursorTs: 1 }))
    act(() => engine.emit({ cursorTs: 2 }))
    expect(renders.mock.calls.length).toBe(initialRenders)

    act(() => engine.emit({ qty: 4 }))
    expect(renders.mock.calls.length).toBeGreaterThan(initialRenders)
    expect(screen.getByTestId('qty')).toHaveTextContent('4')
  })

  it('treats an object selection as unchanged while its fields are', () => {
    const renders = vi.fn()
    function StatusReadout() {
      // A fresh object literal every call — the common selector shape, and
      // the one that would loop forever under identity comparison.
      const view = useReplaySelector((snapshot) => ({ status: snapshot.status, qty: snapshot.qty }))
      renders()
      return <span data-testid="status">{`${view.status}:${view.qty}`}</span>
    }
    render(<StatusReadout />)
    const initialRenders = renders.mock.calls.length

    act(() => engine.emit({ cursorTs: 10 }))
    expect(renders.mock.calls.length).toBe(initialRenders)

    act(() => engine.emit({ status: 'buffering' }))
    expect(screen.getByTestId('status')).toHaveTextContent('buffering:4')
    expect(renders.mock.calls.length).toBeGreaterThan(initialRenders)
  })
})
