import { ChevronDown, Plus, Star, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Timeframe } from '../../api/types'
import { useDismissableLayer } from '../../hooks/use-dismissable-layer'
import { BUILT_IN_TIMEFRAMES, timeframePreferenceStore } from '../../replay/timeframe-preferences'
import { normalizeTimeframe, parseTimeframe, sortTimeframes, type TimeframeUnit } from '../../replay/timeframe'
import { useTimeframePreferences } from './use-timeframe-preferences'

interface TimeframeMenuProps {
  active: Timeframe
  onSelect: (timeframe: Timeframe) => void
}

interface CategoryProps extends TimeframeMenuProps {
  title: string
  timeframes: Timeframe[]
  starred: Timeframe[]
}

interface MenuPosition {
  left: number
  top: number
}

function getMenuPosition(trigger: HTMLElement | null): MenuPosition | null {
  if (!trigger) return null
  const rect = trigger.getBoundingClientRect()
  const menuWidth = 224
  return {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
    top: rect.bottom + 4,
  }
}

function intervalLabel(timeframe: Timeframe): string {
  const parsed = parseTimeframe(timeframe)
  if (!parsed) return timeframe
  const unit = parsed.unit === 'm' ? 'minute' : parsed.unit === 'h' ? 'hour' : parsed.unit === 'd' ? 'day' : parsed.unit === 'w' ? 'week' : 'month'
  return `${parsed.multiplier} ${unit}${parsed.multiplier === 1 ? '' : 's'}`
}

function Category({ title, timeframes, active, starred, onSelect }: CategoryProps) {
  if (timeframes.length === 0) return null
  return (
    <section className="border-t border-line first:border-0">
      <h3 className="px-3 pb-1 pt-2 text-ui-meta font-semibold text-dim">{title}</h3>
      {timeframes.map((timeframe) => {
        const isStarred = starred.includes(timeframe)
        return (
          <div key={timeframe} className="group flex items-center px-1.5 hover:bg-surface-2">
            <button
              role="menuitem"
              type="button"
              onClick={() => onSelect(timeframe)}
              aria-current={active === timeframe ? 'true' : undefined}
              className="h-8 flex-1 rounded-control px-2 text-left text-ui-control text-muted aria-[current=true]:bg-surface-3 aria-[current=true]:font-medium aria-[current=true]:text-ink"
            >
              {intervalLabel(timeframe)}
            </button>
            <button
              type="button"
              onClick={() => timeframePreferenceStore.toggleStar(timeframe)}
              className="grid size-8 shrink-0 place-items-center rounded-control text-dim opacity-70 hover:text-ink group-hover:opacity-100"
              aria-label={`${isStarred ? 'Unstar' : 'Star'} ${timeframe}`}
              aria-pressed={isStarred}
            >
              <Star size={13} fill={isStarred ? 'currentColor' : 'none'} />
            </button>
          </div>
        )
      })}
    </section>
  )
}

export function TimeframeMenu({ active, onSelect }: TimeframeMenuProps) {
  const preferences = useTimeframePreferences()
  const [open, setOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [interval, setInterval] = useState('')
  const [unit, setUnit] = useState<TimeframeUnit>('m')
  const [error, setError] = useState<string | null>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const intervalRef = useRef<HTMLInputElement>(null)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const dismissBoundaries = useMemo(() => [menuRef], [])
  const all = [...new Set([...BUILT_IN_TIMEFRAMES, ...preferences.customTimeframes])]
  const minutes = sortTimeframes(all.filter((timeframe) => parseTimeframe(timeframe)?.unit === 'm'))
  const hours = sortTimeframes(all.filter((timeframe) => parseTimeframe(timeframe)?.unit === 'h'))
  const days = sortTimeframes(all.filter((timeframe) => parseTimeframe(timeframe)?.unit === 'd'))
  const weeks = sortTimeframes(all.filter((timeframe) => parseTimeframe(timeframe)?.unit === 'w'))
  const months = sortTimeframes(all.filter((timeframe) => parseTimeframe(timeframe)?.unit === 'M'))
  const normalizedDraft = normalizeTimeframe(`${interval}${unit}`)

  useDismissableLayer({ open, layerRef, additionalRefs: dismissBoundaries, onDismiss: (reason) => { setOpen(false); if (reason === 'escape') queueMicrotask(() => triggerRef.current?.focus()) } })
  useEffect(() => {
    if (!open) return
    const updatePosition = (): void => {
      const position = getMenuPosition(triggerRef.current)
      if (position) setMenuPosition(position)
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])
  useEffect(() => {
    if (!customOpen) return
    const trigger = triggerRef.current
    intervalRef.current?.focus()
    return () => trigger?.focus()
  }, [customOpen])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const result = timeframePreferenceStore.addCustom(`${interval}${unit}`)
    if (!result.ok) { setError(result.error); return }
    setInterval(''); setError(null); setCustomOpen(false); onSelect(result.value)
  }
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    if (items.length === 0) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }
  const trapDialogFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setCustomOpen(false)
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')]
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
  const choose = (timeframe: Timeframe): void => { onSelect(timeframe); setOpen(false) }
  const toggleMenu = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    const position = getMenuPosition(triggerRef.current)
    if (!position) return
    setMenuPosition(position)
    setOpen(true)
  }

  return (
    <div ref={layerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleMenu}
        aria-label="Timeframe menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className="grid size-8 place-items-center rounded-control text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <ChevronDown size={14} />
      </button>

      {open && menuPosition ? createPortal(
        <div ref={menuRef} role="menu" aria-label="Timeframes" onKeyDown={moveFocus} style={menuPosition} className="fixed z-50 w-56 overflow-hidden rounded-panel border border-line-strong bg-[#111214] shadow-overlay">
          <button role="menuitem" type="button" onClick={() => { setOpen(false); setCustomOpen(true) }} className="flex h-11 w-full items-center gap-2 border-b border-line px-3 text-left text-ui-control text-muted hover:bg-surface-2 hover:text-ink">
            <Plus size={15} />Add custom interval…
          </button>
          <div className="max-h-[32rem] overflow-y-auto py-1">
            <Category title="MINUTES" timeframes={minutes} active={active} starred={preferences.starredTimeframes} onSelect={choose} />
            <Category title="HOURS" timeframes={hours} active={active} starred={preferences.starredTimeframes} onSelect={choose} />
            <Category title="DAYS" timeframes={days} active={active} starred={preferences.starredTimeframes} onSelect={choose} />
            <Category title="WEEKS" timeframes={weeks} active={active} starred={preferences.starredTimeframes} onSelect={choose} />
            <Category title="MONTHS" timeframes={months} active={active} starred={preferences.starredTimeframes} onSelect={choose} />
          </div>
        </div>,
        document.body,
      ) : null}

      {customOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setCustomOpen(false) }}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="custom-interval-title" tabIndex={-1} onKeyDown={trapDialogFocus} className="w-full overflow-hidden rounded-t-panel border border-line-strong bg-surface-1 shadow-overlay sm:w-[25rem] sm:rounded-panel">
            <header className="flex h-12 items-center justify-between border-b border-line px-4">
              <h2 id="custom-interval-title" className="text-ui-title font-semibold text-ink">Add custom interval</h2>
              <button type="button" onClick={() => setCustomOpen(false)} className="tool-button" aria-label="Close custom interval"><X size={16} /></button>
            </header>
            <form onSubmit={submit}>
              <div className="grid gap-4 p-4 sm:grid-cols-[6rem_1fr] sm:items-center">
                <label htmlFor="interval-unit" className="text-ui-body text-muted">Type</label>
                <select id="interval-unit" value={unit} onChange={(event) => { setUnit(event.target.value as TimeframeUnit); setError(null) }} className="field-input h-9">
                  <option value="m">Minutes</option>
                  <option value="h">Hours</option>
                  <option value="d">Days</option>
                  <option value="w">Weeks</option>
                  <option value="M">Months</option>
                </select>
                <label htmlFor="custom-timeframe" className="text-ui-body text-muted">Interval</label>
                <input ref={intervalRef} id="custom-timeframe" type="number" min={1} inputMode="numeric" value={interval} onChange={(event) => { setInterval(event.target.value); setError(null) }} className="field-input h-9" aria-invalid={error ? true : undefined} />
              </div>
              {error ? <p role="alert" className="px-4 pb-3 text-ui-meta text-loss-bright">{error}</p> : null}
              <footer className="flex justify-end gap-2 border-t border-line p-3">
                <button type="button" onClick={() => setCustomOpen(false)} className="secondary-button">Cancel</button>
                <button type="submit" disabled={!normalizedDraft} className="primary-button">Add</button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
