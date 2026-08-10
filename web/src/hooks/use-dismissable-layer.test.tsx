import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDismissableLayer, type DismissReason } from './use-dismissable-layer'

afterEach(cleanup)

interface FixtureProps {
  onDismiss: (reason: DismissReason) => void
}

function Fixture({ onDismiss }: FixtureProps) {
  const [open, setOpen] = useState<boolean>(true)
  const layerRef = useRef<HTMLDivElement>(null)
  useDismissableLayer({
    open,
    layerRef,
    onDismiss: (reason) => {
      onDismiss(reason)
      setOpen(false)
    },
  })
  return (
    <div>
      <button type="button">Outside</button>
      {open ? <div ref={layerRef}><button type="button">Inside</button></div> : null}
    </div>
  )
}

describe('useDismissableLayer', () => {
  it('keeps the layer open for internal interaction and dismisses on outside pointer', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()
    render(<Fixture onDismiss={onDismiss} />)

    await user.click(screen.getByRole('button', { name: 'Inside' }))
    expect(onDismiss).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Outside' }))
    expect(onDismiss).toHaveBeenCalledWith('pointer-outside')
  })

  it('dismisses with Escape before the event reaches global hotkeys', async () => {
    const onDismiss = vi.fn()
    const globalHandler = vi.fn()
    const user = userEvent.setup()
    window.addEventListener('keydown', globalHandler)
    render(<Fixture onDismiss={onDismiss} />)

    await user.keyboard('{Escape}')
    expect(onDismiss).toHaveBeenCalledWith('escape')
    expect(globalHandler).not.toHaveBeenCalled()
    window.removeEventListener('keydown', globalHandler)
  })
})
