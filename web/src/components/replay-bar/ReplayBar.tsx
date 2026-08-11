import { CalendarDays, Check, ChevronDown, MousePointer2, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useDismissableLayer } from '../../hooks/use-dismissable-layer'
import { replayEngine, SPEEDS, STEP_TIMEFRAMES, type ReplayStepTimeframe } from '../../replay/replay-engine'
import { sessionDateValue, sessionOpenTimestamp } from '../../replay/session-date'
import { useReplaySelector } from '../../replay/use-replay'
import { useEvalStore } from '../../store/eval-store'

// Intl.DateTimeFormat construction is expensive and this bar re-renders
// on every cursor tick, so formatters are built once per session
// timezone rather than once per render.
const cursorFormatters = new Map<string, Intl.DateTimeFormat>()
function cursorFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = cursorFormatters.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  cursorFormatters.set(timeZone, formatter)
  return formatter
}
interface TransportButtonProps {
  label: string
  shortcut: string
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  className?: string
}

function TransportButton({ label, shortcut, onClick, children, disabled = false, className = '' }: TransportButtonProps) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`replay-icon-button disabled:cursor-not-allowed disabled:opacity-30 ${className}`} aria-label={`${label} (${shortcut})`} title={`${label} · ${shortcut}`}>{children}</button>
}

interface ReplayDatePickerProps {
  date: string
  min: string
  disabled: boolean
  onSelect: (date: string) => void
}

function ReplayDatePicker({ date, min, disabled, onSelect }: ReplayDatePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const openPicker = (): void => {
    const input = inputRef.current
    if (!input) return
    try {
      if (typeof input.showPicker === 'function') input.showPicker()
      else input.click()
    } catch {
      input.click()
    }
  }

  return (
    <div className="relative hidden lg:block">
      <button type="button" disabled={disabled} onClick={openPicker} aria-label={`Choose replay date${date ? `, current date ${date}` : ''}`} className="flex h-8 items-center gap-1.5 rounded-control px-2 font-mono text-ui-meta text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35">
        <CalendarDays size={13} />
        <span>{date || 'Choose date'}</span>
      </button>
      <input
        ref={inputRef}
        aria-hidden="true"
        tabIndex={-1}
        disabled={disabled}
        type="date"
        value={date}
        min={min || undefined}
        onChange={(event) => { if (!disabled && event.target.value) onSelect(event.target.value) }}
        className="pointer-events-none absolute size-px opacity-0"
      />
    </div>
  )
}

interface ReplayIntervalMenuProps {
  disabled: boolean
  value: ReplayStepTimeframe
}

function ReplayIntervalMenu({ disabled, value }: ReplayIntervalMenuProps) {
  const [open, setOpen] = useState(false)
  const layerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useDismissableLayer({
    open,
    layerRef,
    onDismiss: (reason) => {
      setOpen(false)
      if (reason === 'escape') queueMicrotask(() => triggerRef.current?.focus())
    },
  })

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => menuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
  }, [open])

  const selectInterval = (timeframe: ReplayStepTimeframe): void => {
    replayEngine.setStepTimeframe(timeframe)
    setOpen(false)
    queueMicrotask(() => triggerRef.current?.focus())
  }

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')]
    if (options.length === 0) return
    event.preventDefault()
    const current = Math.max(0, options.indexOf(document.activeElement as HTMLElement))
    const columns = 2
    const delta = event.key === 'ArrowDown' ? columns
      : event.key === 'ArrowUp' ? -columns
        : event.key === 'ArrowRight' ? 1
          : event.key === 'ArrowLeft' ? -1
            : 0
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? options.length - 1
        : (current + delta + options.length) % options.length
    options[next]?.focus()
  }

  return (
    <div ref={layerRef} className="relative ml-0.5 shrink-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label="Replay interval"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`flex h-11 min-w-[3.5rem] items-center justify-between gap-1 rounded-control border px-2 font-mono text-ui-control font-medium transition-[border-color,background-color,color] disabled:cursor-not-allowed disabled:opacity-35 sm:h-9 ${open ? 'border-active/70 bg-surface-2 text-ink' : 'border-transparent text-ink hover:border-line hover:bg-surface-2'} focus-visible:border-active focus-visible:bg-surface-2 focus-visible:outline-none`}
      >
        <span>{value}</span>
        <ChevronDown aria-hidden="true" className={`text-muted transition-transform duration-100 ${open ? 'rotate-180' : ''}`} size={12} strokeWidth={1.8} />
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Replay intervals"
          onKeyDown={moveFocus}
          className="absolute bottom-[calc(100%+0.375rem)] right-0 z-50 grid w-36 grid-cols-2 gap-1 rounded-panel border border-line-strong bg-[#111214] p-1.5 shadow-overlay"
        >
          {STEP_TIMEFRAMES.map((timeframe) => {
            const selected = timeframe === value
            return (
              <button
                key={timeframe}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => selectInterval(timeframe)}
                className="flex h-10 items-center justify-between rounded-control px-2 font-mono text-ui-control font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:bg-surface-2 focus-visible:text-ink focus-visible:outline-none aria-selected:bg-active/15 aria-selected:text-active-bright sm:h-9"
              >
                {timeframe}
                <Check aria-hidden="true" className={selected ? 'opacity-100' : 'opacity-0'} size={12} strokeWidth={2} />
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function ReplayBar() {
  // cursorTs genuinely ticks with replay; everything else here is
  // transport state, so selecting keeps unrelated snapshot churn out.
  const replay = useReplaySelector((snapshot) => ({
    replayMode: snapshot.replayMode,
    sessionTz: snapshot.symbol?.sessionTz ?? '',
    cursorTs: snapshot.cursorTs,
    playing: snapshot.playing,
    speed: snapshot.speed,
    stepTimeframe: snapshot.stepTimeframe,
    status: snapshot.status,
    error: snapshot.error,
  }))
  const evalLocked = useEvalStore((state) => state.phase === 'running')
  if (replay.replayMode === 'inactive') return null

  const selecting = replay.replayMode === 'selecting'
  const formatter = replay.sessionTz ? cursorFormatter(replay.sessionTz) : null
  const date = replay.cursorTs ? sessionDateValue(replay.cursorTs, replay.sessionTz || 'UTC') : ''

  return (
    <footer id="replay-controls" className="relative z-40 shrink-0 border-t border-line bg-[#101114]" aria-label="Replay controls">
      <div className="absolute inset-x-0 top-0 h-px bg-line"><div className={`h-full bg-active transition-opacity duration-150 ${replay.playing ? 'animate-replay-pulse opacity-100' : 'opacity-0'}`} /></div>
      <div className="flex h-12 items-center justify-center px-1.5 sm:px-3 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="hidden min-w-0 items-center gap-3 md:flex">
          {selecting ? (
            <span className="flex shrink-0 items-center gap-1.5 text-ui-body font-medium text-active-bright">
              <span className="size-1.5 animate-replay-pulse rounded-full bg-active" />Select a bar on the chart
            </span>
          ) : (
            <>
              <span className={`flex shrink-0 items-center gap-1.5 text-ui-body font-medium ${replay.playing ? 'text-profit-bright' : 'text-muted'}`}>
                <span className={`size-1.5 rounded-full ${replay.playing ? 'animate-replay-pulse bg-profit' : 'bg-dim'}`} />{replay.playing ? 'Playing' : 'Paused'}
              </span>
              <time className="truncate font-mono text-ui-meta text-dim" dateTime={replay.cursorTs ? new Date(replay.cursorTs * 1000).toISOString() : undefined}>{formatter && replay.cursorTs ? formatter.format(new Date(replay.cursorTs * 1000)) : 'No replay time'}</time>
            </>
          )}
        </div>

        <div className="flex max-w-full min-w-0 items-center justify-center gap-0.5" role="group" aria-label="Replay transport">
          {!evalLocked && (
            <>
              <button type="button" onClick={() => replayEngine.beginReplaySelection()} aria-label={selecting ? 'Waiting for replay bar selection' : 'Select replay start bar'} aria-pressed={selecting} className={`mr-0.5 flex size-11 shrink-0 items-center justify-center gap-1.5 rounded-control text-ui-control font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-active sm:mr-1 sm:h-9 sm:w-auto sm:px-2.5 ${selecting ? 'bg-active text-white' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
                <MousePointer2 size={15} strokeWidth={1.8} /><span className="hidden sm:inline">Bar replay</span>
              </button>
            </>
          )}

          <label className="flex h-11 shrink-0 items-center gap-1.5 px-1 sm:h-9 sm:gap-2 sm:px-2">
            <span className="sr-only">Replay speed</span>
            <input
              type="range"
              min={SPEEDS[0]}
              max={SPEEDS[SPEEDS.length - 1]}
              step={1}
              value={replay.speed}
              disabled={selecting}
              aria-label="Replay speed"
              aria-valuetext={`${replay.speed} times per second`}
              onChange={(event) => replayEngine.setSpeed(Number(event.currentTarget.value))}
              className="h-11 w-16 cursor-pointer accent-active disabled:cursor-not-allowed disabled:opacity-35 sm:h-9 sm:w-24"
            />
            <output className="w-7 font-mono text-ui-meta font-semibold text-ink" aria-hidden="true">{replay.speed}x</output>
          </label>

          <span aria-hidden="true" className="mx-0.5 hidden h-5 w-px bg-line sm:block" />
          <TransportButton label="Previous replay interval" shortcut="Shift+←" disabled={selecting || evalLocked} onClick={() => replayEngine.stepBack()}><SkipBack size={16} /></TransportButton>
          <button
            type="button"
            disabled={selecting || (replay.status !== 'ready' && replay.status !== 'buffering')}
            onClick={() => replayEngine.togglePlay()}
            className="mx-1 grid size-11 place-items-center rounded-control bg-active text-white transition-[background-color,transform] duration-100 hover:bg-active-bright active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35 sm:size-9"
            aria-label={replay.playing ? 'Pause replay (Space)' : 'Play replay (Space)'}
            title={replay.playing ? 'Pause · Space' : 'Play · Space'}
          >
            {replay.playing ? <Pause size={16} fill="currentColor" /> : <Play className="translate-x-px" size={16} fill="currentColor" />}
          </button>
          <ReplayIntervalMenu disabled={selecting} value={replay.stepTimeframe} />
          <TransportButton label="Next replay interval" shortcut="Shift+→" disabled={selecting} onClick={() => replayEngine.stepForward()}><SkipForward size={16} /></TransportButton>
        </div>

        <div className="hidden min-w-0 items-center justify-end gap-1 sm:gap-3 lg:flex">
          {evalLocked ? null : (
            <ReplayDatePicker date={date} min="" disabled={selecting} onSelect={(nextDate) => {
              const targetTs = sessionOpenTimestamp(nextDate, replay.sessionTz || 'UTC')
              if (targetTs !== null) void replayEngine.seek(targetTs)
            }} />
          )}
        </div>
      </div>
      {selecting ? <span role="status" className="sr-only">Select a bar on the chart</span> : null}
      {replay.error && replay.status !== 'error' ? <div role="status" className="border-t border-loss/20 bg-loss/8 px-3 py-1.5 text-ui-body text-loss-bright">{replay.error}</div> : null}
    </footer>
  )
}
