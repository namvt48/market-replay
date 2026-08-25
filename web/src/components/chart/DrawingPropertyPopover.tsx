import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface DrawingPropertyPopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  ariaLabel: string
  children: ReactNode
  className?: string
  positionKey: string
}

interface DrawingColorPaletteProps {
  anchorRef: RefObject<HTMLElement | null>
  ariaLabel: string
  color: string
  opacity: number
  opacityLabel: string
  positionKey: string
  onColor: (color: string) => void
  onOpacity: (opacity: number) => void
  children?: ReactNode
}

interface PopoverPosition {
  left: number
  top: number
  maxHeight: number
}

const DRAWING_COLOR_ROWS = [
  ['#f2f3f5', '#dedfe3', '#c5c7cc', '#a9abb1', '#85878d', '#6b6d73', '#515359', '#393b40', '#232529', '#090a0c'],
  ['#f23645', '#ff9800', '#ffca28', '#4caf50', '#26a69a', '#26c6da', '#2962ff', '#7e57c2', '#ab47bc', '#ec407a'],
  ['#ffb3b8', '#ffe0b2', '#fff9c4', '#c8e6c9', '#b2dfdb', '#b2ebf2', '#bbdefb', '#c5cae9', '#e1bee7', '#f8bbd0'],
  ['#ef9a9a', '#ffcc80', '#fff59d', '#a5d6a7', '#80cbc4', '#80deea', '#90caf9', '#9fa8da', '#ce93d8', '#f48fb1'],
  ['#e57373', '#ffb74d', '#ffee58', '#81c784', '#4db6ac', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8', '#f06292'],
  ['#ef5350', '#ffa726', '#ffeb3b', '#66bb6a', '#26a69a', '#26c6da', '#42a5f5', '#5c6bc0', '#ab47bc', '#ec407a'],
  ['#c62828', '#ef6c00', '#ffb300', '#2e7d32', '#00796b', '#00838f', '#1565c0', '#303f9f', '#7b1fa2', '#c2185b'],
  ['#9f1d20', '#e65100', '#f57c00', '#00695c', '#00695c', '#006064', '#0d47a1', '#1a237e', '#4a148c', '#880e4f'],
] as const

export function DrawingPropertyPopover({ anchorRef, ariaLabel, children, className = '', positionKey }: DrawingPropertyPopoverProps): ReactElement | null {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null)

  useLayoutEffect(() => {
    const updatePosition = (): void => {
      const anchor = anchorRef.current
      const popover = popoverRef.current
      if (!anchor || !popover) return
      const viewportPadding = 8
      const gap = 6
      const anchorRect = anchor.getBoundingClientRect()
      const popoverRect = popover.getBoundingClientRect()
      const boundedHeight = Math.min(popoverRect.height, window.innerHeight - viewportPadding * 2)
      const roomBelow = window.innerHeight - viewportPadding - anchorRect.bottom - gap
      const roomAbove = anchorRect.top - viewportPadding - gap
      const openAbove = popoverRect.height > roomBelow && roomAbove > roomBelow
      const idealTop = openAbove ? anchorRect.top - gap - boundedHeight : anchorRect.bottom + gap
      setPopoverPosition({
        left: Math.max(viewportPadding, Math.min(anchorRect.left, window.innerWidth - popoverRect.width - viewportPadding)),
        top: Math.max(viewportPadding, Math.min(idealTop, window.innerHeight - boundedHeight - viewportPadding)),
        maxHeight: Math.max(0, window.innerHeight - viewportPadding * 2),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition)
    if (popoverRef.current) observer?.observe(popoverRef.current)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      observer?.disconnect()
    }
  }, [anchorRef, positionKey])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={ariaLabel}
      aria-modal="false"
      style={{ left: popoverPosition?.left ?? 0, top: popoverPosition?.top ?? 0, maxHeight: popoverPosition?.maxHeight, visibility: popoverPosition ? 'visible' : 'hidden' }}
      className={`fixed z-[110] overflow-y-auto rounded-panel border border-[#363636] bg-[#1f1f1f] text-[#d6d6d6] shadow-overlay [scrollbar-color:#454545_transparent] [scrollbar-width:thin] ${className}`}
    >
      {children}
    </div>,
    document.body,
  )
}

export function DrawingColorPalette({ anchorRef, ariaLabel, color, opacity, opacityLabel, positionKey, onColor, onOpacity, children }: DrawingColorPaletteProps): ReactElement {
  return (
    <DrawingPropertyPopover anchorRef={anchorRef} ariaLabel={ariaLabel} positionKey={positionKey} className="w-[15.5rem] p-3">
      <div className="grid grid-cols-10 gap-1.5">
        {DRAWING_COLOR_ROWS.flat().map((value, index) => (
          <button key={`${value}-${index}`} type="button" aria-label={`Set color ${value}`} onClick={() => onColor(value)} className="grid size-4 place-items-center rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-active" style={{ backgroundColor: value }}>
            {color.toLowerCase() === value ? <span aria-hidden="true" className="size-[13px] rounded-[2px] border-2 border-[#1f1f1f] ring-1 ring-white" /> : null}
          </button>
        ))}
      </div>
      <div className="my-3 h-px bg-[#424242]" />
      <div className="mb-1.5 flex items-center justify-between text-ui-meta text-[#858585]"><span>Opacity</span><output className="rounded-control border border-[#4b4d52] px-2 py-0.5 font-mono text-ui-control text-[#d6d6d6]">{Math.round(opacity * 100)}%</output></div>
      <input aria-label={opacityLabel} type="range" min="0" max="100" value={Math.round(opacity * 100)} onChange={(event) => onOpacity(Number(event.target.value) / 100)} className="h-5 w-full accent-active" />
      {children}
    </DrawingPropertyPopover>
  )
}
