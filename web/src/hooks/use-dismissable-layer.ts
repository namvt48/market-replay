import { useEffect, type RefObject } from 'react'

export type DismissReason = 'escape' | 'focus-outside' | 'pointer-outside'

interface UseDismissableLayerOptions {
  open: boolean
  layerRef: RefObject<HTMLElement | null>
  additionalRefs?: ReadonlyArray<RefObject<HTMLElement | null>>
  onDismiss: (reason: DismissReason) => void
}

function containsTarget(element: HTMLElement | null, target: EventTarget | null): boolean {
  return target instanceof Node && element?.contains(target) === true
}

export function useDismissableLayer({ open, layerRef, additionalRefs = [], onDismiss }: UseDismissableLayerOptions): void {
  useEffect(() => {
    if (!open) return

    const isInsideLayer = (target: EventTarget | null): boolean =>
      containsTarget(layerRef.current, target) || additionalRefs.some((ref) => containsTarget(ref.current, target))

    const handlePointerDown = (event: PointerEvent): void => {
      if (!isInsideLayer(event.target)) onDismiss('pointer-outside')
    }
    const handleFocusIn = (event: FocusEvent): void => {
      if (!isInsideLayer(event.target)) onDismiss('focus-outside')
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onDismiss('escape')
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('focusin', handleFocusIn, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('focusin', handleFocusIn, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [additionalRefs, layerRef, onDismiss, open])
}
