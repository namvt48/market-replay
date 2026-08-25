import { CircleHelp } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface AnalyticsInfoTipProps {
  label: string
  children: ReactNode
  className?: string
}

interface TooltipPosition {
  x: number
  y: number
  placement: 'above' | 'below'
}

const tooltipWidth = 288
const viewportMargin = 12

export function AnalyticsInfoTip({ label, children, className = '' }: AnalyticsInfoTipProps): ReactElement {
  const id = useId()
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  useEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const update = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const halfWidth = Math.min(tooltipWidth, window.innerWidth - viewportMargin * 2) / 2
      const x = Math.min(window.innerWidth - viewportMargin - halfWidth, Math.max(viewportMargin + halfWidth, rect.left + rect.width / 2))
      const placement = rect.top >= 150 ? 'above' : 'below'
      setPosition({ x, y: placement === 'above' ? rect.top : rect.bottom, placement })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  return (
    <span className={`inline-flex align-middle ${className}`} onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      <button ref={anchorRef} type="button" aria-label={`About ${label}`} aria-describedby={id} className="inline-grid size-5 place-items-center rounded-control text-dim transition-colors hover:bg-surface-3 hover:text-ink focus-visible:text-ink">
        <CircleHelp size={12} strokeWidth={1.8} />
      </button>
      {open && position && typeof document !== 'undefined' ? createPortal(
        <span
          id={id}
          role="tooltip"
          style={{ left: position.x, top: position.y }}
          className={`pointer-events-none fixed z-[140] w-[min(18rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-control border border-line-strong bg-surface-0 p-3 text-left text-ui-meta font-normal leading-5 text-muted shadow-overlay ${position.placement === 'above' ? '-translate-y-[calc(100%+10px)]' : 'translate-y-2.5'}`}
        >
          {children}
        </span>,
        document.body,
      ) : null}
    </span>
  )
}
