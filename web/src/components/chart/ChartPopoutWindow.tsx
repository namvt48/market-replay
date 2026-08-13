/*
THESIS: A detached chart is another viewport onto the same workstation, never a second replay client.
OWN-WORLD: Graphite browser canvas, one compact linked-state strip, blue only for live shared state.
STORY: Move a pane to another screen, keep operating one replay, then return it without losing context.
FIRST VIEWPORT: Linked-session strip above a full-height chart, drawing rail at left, replay dock below.
FORM: Narrow extension of Replay Desk; no separate visual-world seed applies.
*/
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ChartPopoutTarget } from './chart-popout'

interface ChartPopoutWindowProps {
  target: ChartPopoutTarget
  onClose: () => void
  children: ReactNode
}

export function ChartPopoutWindow({ target, onClose, children }: ChartPopoutWindowProps): ReactElement {
  const closeFrameRef = useRef<number | null>(null)
  useEffect(() => {
    if (closeFrameRef.current) {
      window.cancelAnimationFrame(closeFrameRef.current)
      closeFrameRef.current = null
    }
    const handleChildClose = (): void => onClose()
    const closeWithWorkspace = (): void => {
      if (!target.window.closed) target.window.close()
    }

    target.window.addEventListener('pagehide', handleChildClose)
    window.addEventListener('pagehide', closeWithWorkspace)
    return () => {
      target.window.removeEventListener('pagehide', handleChildClose)
      window.removeEventListener('pagehide', closeWithWorkspace)
      // Let every nested chart effect destroy its adapter while the child
      // document is still alive. Closing synchronously here disposes the
      // canvas before Lightweight Charts can release its subscriptions.
      closeFrameRef.current = window.requestAnimationFrame(() => {
        closeFrameRef.current = window.requestAnimationFrame(() => {
          closeFrameRef.current = null
          if (!target.window.closed) target.window.close()
        })
      })
    }
  }, [onClose, target])

  return createPortal(children, target.root)
}
