import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, MousePointer2, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { replayEngine } from '../../replay/replay-engine'
import { sessionDateValue, sessionOpenTimestamp } from '../../replay/session-date'
import { useReplaySelector } from '../../replay/use-replay'
import { useEvalStore } from '../../store/eval-store'

const SPEEDS = [0.5, 1, 2, 5, 20, 100, 500]

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
  disabled: boolean
  min?: string
  onSelect: (date: string) => void
}

function ReplayDatePicker({ date, disabled, min, onSelect }: ReplayDatePickerProps) {
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
        min={min}
        onChange={(event) => { if (event.target.value) onSelect(event.target.value) }}
        className="pointer-events-none absolute size-px opacity-0"
      />
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
    status: snapshot.status,
    error: snapshot.error,
  }))
  const evalLocked = useEvalStore((state) => state.phase === 'running')
  const evalStartTs = useEvalStore((state) => state.phase === 'running' ? (state.startTs ?? 0) : 0)
  if (replay.replayMode === 'inactive') return null

  const selecting = replay.replayMode === 'selecting'
  const evalMinDate = evalStartTs ? new Date(evalStartTs * 1000).toISOString().slice(0, 10) : undefined
  const formatter = replay.sessionTz ? cursorFormatter(replay.sessionTz) : null
  const date = replay.cursorTs ? sessionDateValue(replay.cursorTs, replay.sessionTz || 'UTC') : ''

  return (
    <footer id="replay-controls" className="relative z-40 shrink-0 border-t border-line bg-[#101114]" aria-label="Replay controls">
      <div className="absolute inset-x-0 top-0 h-px bg-line"><div className={`h-full bg-active transition-opacity duration-150 ${replay.playing ? 'animate-replay-pulse opacity-100' : 'opacity-0'}`} /></div>
      <div className="grid h-12 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-1.5 sm:px-3">
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

        <div className="flex items-center justify-center gap-0.5" role="group" aria-label="Replay transport">
          <button type="button" onClick={() => replayEngine.beginReplaySelection()} aria-label={selecting ? 'Waiting for replay bar selection' : 'Select another replay start bar'} aria-pressed={selecting} className={`mr-1 flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2 text-ui-control font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-active sm:mr-2 sm:px-2.5 ${selecting ? 'bg-active text-white' : 'bg-surface-3 text-ink hover:bg-surface-4'}`}>
            <MousePointer2 size={14} strokeWidth={1.8} /><span className="hidden sm:inline">Select bar</span>
          </button>
          <span aria-hidden="true" className="mr-1 hidden h-5 w-px bg-line sm:block" />
          <TransportButton className="hidden sm:grid" label="Previous day" shortcut="Shift+←" disabled={selecting || evalLocked} onClick={() => { void replayEngine.seek(Math.max(0, replay.cursorTs - 86400)) }}><SkipBack size={15} /></TransportButton>
          <TransportButton label="Step back" shortcut="←" disabled={selecting || evalLocked} onClick={() => replayEngine.stepBack()}><ChevronLeft size={18} /></TransportButton>
          <button
            type="button"
            disabled={selecting || (replay.status !== 'ready' && replay.status !== 'buffering')}
            onClick={() => replayEngine.togglePlay()}
            className="mx-1 grid size-9 place-items-center rounded-control bg-active text-white transition-[background-color,transform] duration-100 hover:bg-active-bright active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35"
            aria-label={replay.playing ? 'Pause replay (Space)' : 'Play replay (Space)'}
            title={replay.playing ? 'Pause · Space' : 'Play · Space'}
          >
            {replay.playing ? <Pause size={16} fill="currentColor" /> : <Play className="translate-x-px" size={16} fill="currentColor" />}
          </button>
          <TransportButton label="Step forward" shortcut="→" disabled={selecting} onClick={() => replayEngine.stepForward()}><ChevronRight size={18} /></TransportButton>
          <TransportButton className="hidden sm:grid" label="Next day" shortcut="Shift+→" disabled={selecting} onClick={() => { void replayEngine.seek(replay.cursorTs + 86400) }}><SkipForward size={15} /></TransportButton>
          <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-line sm:block" />
          <label className="group relative flex h-8 shrink-0 items-center rounded-control border border-line-strong bg-surface-2 px-1 text-ui-control text-ink transition-colors hover:bg-surface-3 focus-within:border-active focus-within:bg-surface-3 sm:px-1.5">
            <span className="sr-only">Replay speed</span>
            <select disabled={selecting} value={replay.speed} onChange={(event) => replayEngine.setSpeed(Number(event.target.value))} className="h-full appearance-none bg-transparent py-0 pl-1 pr-4 font-mono font-semibold text-inherit outline-none [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-35">
              {SPEEDS.map((speed) => <option key={speed} value={speed} className="bg-surface-1 text-ink">{speed}x</option>)}
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-1 text-muted" size={12} strokeWidth={1.8} />
          </label>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-1 sm:gap-3">
          <ReplayDatePicker date={date} min={evalMinDate} disabled={selecting} onSelect={(nextDate) => {
            const targetTs = sessionOpenTimestamp(nextDate, replay.sessionTz || 'UTC')
            if (targetTs !== null) void replayEngine.seek(Math.max(targetTs, evalStartTs))
          }} />
        </div>
      </div>
      {selecting ? <span role="status" className="sr-only">Select a bar on the chart</span> : null}
      {replay.error && replay.status !== 'error' ? <div role="status" className="border-t border-loss/20 bg-loss/8 px-3 py-1.5 text-ui-body text-loss-bright">{replay.error}</div> : null}
    </footer>
  )
}
