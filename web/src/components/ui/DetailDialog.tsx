import { X } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface DetailDialogProps {
  titleId: string
  title: ReactNode
  status: ReactNode
  children: ReactNode
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}

function trapFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab') return
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

/** Shared shell for source details. It deliberately owns only dialog
 * mechanics; Session and Eval retain their distinct information hierarchy. */
export function DetailDialog({ titleId, title, status, children, onClose, returnFocusRef }: DetailDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
    return () => { queueMicrotask(() => returnFocusRef?.current?.focus()) }
  }, [returnFocusRef])

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/72 p-4 backdrop-blur-[2px] max-sm:p-0" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); return }; trapFocus(event) }} className="flex max-h-[85dvh] w-[min(720px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[24px] border border-line-strong bg-[#101114] shadow-overlay outline-none max-sm:h-full max-sm:max-h-none max-sm:w-full max-sm:rounded-none">
        <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-line bg-surface-0/55 px-4 sm:px-5">
          <div className="min-w-0 flex-1">{title}</div>
          <div className="flex shrink-0 items-center gap-2">{status}<button type="button" onClick={onClose} className="tool-button" aria-label="Close details"><X size={17} /></button></div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
