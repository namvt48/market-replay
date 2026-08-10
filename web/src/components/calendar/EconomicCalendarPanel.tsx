import { AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, LocateFixed, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchEconWeek } from '../../api/client'
import type { EconEventView, EconImportance, EconMeta, EconWeek } from '../../api/types'
import { useReplaySelector } from '../../replay/use-replay'

/*
THESIS: The replay cursor is the calendar's “now”; the panel refuses a detached news-feed layout.
OWN-WORLD: Flat night-session rows, hairline day bands, mono release data, and sparse blue focus.
STORY: Scan this week, see the next risk, inspect known expectations, and reveal outcomes only as replay reaches them.
FIRST VIEWPORT: Week controls lead, filters stay compact, and a chronological day ledger fills the rail.
FORM: A dense macro desk blotter extending the established Replay Desk visual system.
*/

type WeekState =
  | { status: 'idle'; data: null }
  | { status: 'loading'; data: EconWeek | null }
  | { status: 'success'; data: EconWeek }
  | { status: 'error'; data: EconWeek | null; message: string }

interface DayGroup {
  key: string
  label: string
  events: EconEventView[]
}

interface EconomicCalendarPanelProps {
  meta: EconMeta
}

interface CalendarErrorPanelProps {
  onRetry: () => void
}

type ImportanceFilter = '' | Exclude<EconImportance, 'low'>

const WEEK_LABEL_OPTIONS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function timeZoneShortName(timeZone: string): string {
  if (timeZone === 'America/New_York') return 'ET'
  if (timeZone === 'America/Chicago') return 'CT'
  if (timeZone === 'America/Denver') return 'MT'
  if (timeZone === 'America/Los_Angeles') return 'PT'
  return timeZone === 'UTC' ? 'UTC' : timeZone
}

function importanceLabel(importance: EconImportance): string {
  if (importance === 'high') return 'H'
  if (importance === 'medium') return 'M'
  return 'L'
}

function importanceTone(importance: EconImportance): string {
  if (importance === 'high') return 'border-loss/40 bg-loss/10 text-loss-bright'
  if (importance === 'medium') return 'border-active/40 bg-active/10 text-active-bright'
  return 'border-line-strong bg-surface-2 text-muted'
}

function dateKey(formatter: Intl.DateTimeFormat, timestamp: number): string {
  const parts = formatter.formatToParts(timestamp * 1000)
  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  return `${year}-${month}-${day}`
}

export function CalendarErrorPanel({ onRetry }: CalendarErrorPanelProps) {
  return (
    <div className="grid h-full place-items-center p-5 text-center">
      <div className="max-w-56">
        <AlertTriangle className="mx-auto text-loss-bright" size={20} strokeWidth={1.6} aria-hidden="true" />
        <h2 className="mt-3 text-ui-title font-semibold text-ink">Calendar unavailable</h2>
        <p className="mt-1 text-ui-body leading-relaxed text-muted">The economic-calendar endpoint did not respond. Check the server, then retry.</p>
        <button type="button" onClick={onRetry} className="secondary-button mt-4 w-full"><RefreshCw size={14} />Retry calendar</button>
      </div>
    </div>
  )
}

export function EconomicCalendarPanel({ meta }: EconomicCalendarPanelProps) {
  const replay = useReplaySelector((snapshot) => ({
    cursorTs: snapshot.cursorTs,
    timeZone: snapshot.symbol?.sessionTz || 'UTC',
  }))
  const [requestCursorTs, setRequestCursorTs] = useState(() => replay.cursorTs)
  const [browsingAt, setBrowsingAt] = useState<number | null>(null)
  const [importance, setImportance] = useState<ImportanceFilter>('')
  const [country, setCountry] = useState('')
  const [retryVersion, setRetryVersion] = useState(0)
  const [weekState, setWeekState] = useState<WeekState>({ status: 'idle', data: null })
  const week = weekState.data
  const queryAt = browsingAt ?? requestCursorTs

  useEffect(() => {
    if (replay.cursorTs <= 0) return
    if (requestCursorTs <= 0) {
      setRequestCursorTs(replay.cursorTs)
      return
    }
    if (!week || weekState.status === 'loading') return
    const crossedFollowedWeek = browsingAt === null && (replay.cursorTs < week.weekStart || replay.cursorTs >= week.weekEnd)
    const visibilityChanged = week.events.some((event) => (
      event.released ? event.ts > replay.cursorTs : event.ts <= replay.cursorTs
    ))
    if (crossedFollowedWeek || visibilityChanged) setRequestCursorTs(replay.cursorTs)
  }, [browsingAt, replay.cursorTs, requestCursorTs, week, weekState.status])

  useEffect(() => {
    if (queryAt <= 0 || requestCursorTs <= 0) return
    const controller = new AbortController()
    setWeekState((current) => ({ status: 'loading', data: current.data }))
    void fetchEconWeek({
      at: queryAt,
      cursorTs: requestCursorTs,
      timeZone: replay.timeZone,
      minImportance: importance || undefined,
      countries: country ? [country] : undefined,
    }, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setWeekState({ status: 'success', data })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setWeekState((current) => ({
          status: 'error', data: current.data, message: errorMessage(error, 'This calendar week could not be loaded.'),
        }))
      })
    return () => controller.abort()
  }, [country, importance, queryAt, replay.timeZone, requestCursorTs, retryVersion])

  const formatters = useMemo(() => ({
    dayKey: new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: replay.timeZone }),
    day: new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: replay.timeZone }),
    time: new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: replay.timeZone }),
    week: new Intl.DateTimeFormat('en-US', { ...WEEK_LABEL_OPTIONS, timeZone: replay.timeZone }),
  }), [replay.timeZone])

  const days = useMemo<DayGroup[]>(() => {
    if (!week) return []
    const groups = new Map<string, DayGroup>()
    for (const event of week.events) {
      const key = dateKey(formatters.dayKey, event.ts)
      const existing = groups.get(key)
      if (existing) existing.events.push(event)
      else groups.set(key, { key, label: formatters.day.format(event.ts * 1000), events: [event] })
    }
    return [...groups.values()]
  }, [formatters.day, formatters.dayKey, week])

  const nextEventId = useMemo(
    () => week?.events.find((event) => event.ts > replay.cursorTs)?.id ?? null,
    [replay.cursorTs, week],
  )
  const weekLabel = week
    ? formatters.week.formatRange(new Date(week.weekStart * 1000), new Date(week.weekEnd * 1000 - 1))
    : 'Replay week'
  const showWeek = (at: number): void => {
    setRequestCursorTs(replay.cursorTs)
    setBrowsingAt(at)
  }
  const returnToReplay = (): void => {
    setRequestCursorTs(replay.cursorTs)
    setBrowsingAt(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy={weekState.status === 'loading'}>
      <header className="shrink-0 border-b border-line bg-surface-1">
        <div className="flex min-h-14 items-center gap-2 px-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-ui-meta text-dim">
              <CalendarDays size={13} strokeWidth={1.7} aria-hidden="true" />
              <span>{meta.count} events loaded</span>
              <span aria-hidden="true">·</span>
              <span title={replay.timeZone}>{timeZoneShortName(replay.timeZone)}</span>
            </div>
            <h2 className="mt-0.5 truncate text-ui-title font-semibold text-ink">{weekLabel}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button type="button" disabled={!week} onClick={() => { if (week) showWeek(week.weekStart - 1) }} className="tool-button" aria-label="Previous calendar week"><ChevronLeft size={16} /></button>
            <button type="button" disabled={!week} onClick={() => { if (week) showWeek(week.weekEnd) }} className="tool-button" aria-label="Next calendar week"><ChevronRight size={16} /></button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5 border-t border-line px-3 py-2">
          <label className="sr-only" htmlFor="calendar-importance">Minimum importance</label>
          <select id="calendar-importance" value={importance} onChange={(event) => setImportance(event.target.value as ImportanceFilter)} className="field h-11 px-2 font-mono text-ui-meta lg:h-8">
            <option value="">All impact</option>
            <option value="medium">Medium +</option>
            <option value="high">High only</option>
          </select>
          <label className="sr-only" htmlFor="calendar-country">Country</label>
          <select id="calendar-country" value={country} onChange={(event) => setCountry(event.target.value)} className="field h-11 px-2 font-mono text-ui-meta lg:h-8">
            <option value="">All countries</option>
            {meta.countries.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>

        <div className="flex min-h-8 items-center justify-between border-t border-line px-3 text-ui-meta">
          {browsingAt === null ? (
            <span className="flex items-center gap-1.5 text-active-bright"><span className="size-1.5 rounded-full bg-active" aria-hidden="true" />Following replay</span>
          ) : (
            <button type="button" onClick={returnToReplay} className="flex min-h-8 items-center gap-1.5 font-medium text-active-bright hover:text-ink"><LocateFixed size={13} />Return to replay week</button>
          )}
          {weekState.status === 'loading' ? <span role="status" className="text-dim">Updating…</span> : null}
        </div>
      </header>

      {weekState.status === 'error' ? (
        <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-loss/30 bg-loss/8 px-3 py-2 text-ui-body text-loss-bright">
          <AlertTriangle className="mt-0.5 shrink-0" size={14} />
          <span className="min-w-0 flex-1">{weekState.message}</span>
          <button type="button" onClick={() => setRetryVersion((current) => current + 1)} className="shrink-0 font-semibold text-ink hover:text-white">Retry</button>
        </div>
      ) : null}

      {!week && weekState.status !== 'error' ? (
        <div role="status" className="space-y-px p-3" aria-label="Loading economic calendar">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-16 border-b border-line bg-surface-2/35" />)}
        </div>
      ) : days.length > 0 ? (
        <ol className="min-h-0 flex-1 overflow-y-auto">
          {days.map((day) => (
            <li key={day.key}>
              <h3 className="sticky top-0 z-10 flex h-8 items-center justify-between border-y border-line bg-surface-1 px-3 text-ui-meta font-semibold text-muted">
                <span>{day.label}</span><span className="font-mono font-normal text-dim">{day.events.length}</span>
              </h3>
              <ol className="divide-y divide-line">
                {day.events.map((event) => {
                  const released = event.released && event.ts <= replay.cursorTs
                  const next = event.id === nextEventId
                  return (
                    <li key={event.id} className={`grid grid-cols-[3.25rem_minmax(0,1fr)] gap-2 border-l px-3 py-2.5 [content-visibility:auto] ${next ? 'border-l-active bg-active/5' : 'border-l-transparent'}`}>
                      <div className="pt-0.5">
                        <time className="block font-mono text-ui-body text-ink" dateTime={new Date(event.ts * 1000).toISOString()}>{formatters.time.format(event.ts * 1000)}</time>
                        <span className={`mt-1 inline-flex min-w-5 items-center justify-center rounded-[3px] border px-1 font-mono text-ui-meta font-semibold ${importanceTone(event.importance)}`} aria-label={`${event.importance} importance`}>{importanceLabel(event.importance)}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h4 className="truncate text-ui-body font-semibold text-ink">{event.title}</h4>
                            <p className="mt-0.5 font-mono text-ui-meta text-dim">{event.country}{event.currency ? ` · ${event.currency}` : ''}</p>
                          </div>
                          {released ? (
                            <span className="flex shrink-0 items-center gap-1 text-ui-meta text-profit-bright"><Check size={12} strokeWidth={2} />Released</span>
                          ) : next ? (
                            <span className="shrink-0 rounded-[3px] bg-active/15 px-1.5 font-mono text-ui-meta font-semibold text-active-bright">NEXT</span>
                          ) : (
                            <span className="flex shrink-0 items-center gap-1 text-ui-meta text-dim"><Clock3 size={11} />Scheduled</span>
                          )}
                        </div>
                        <dl className="mt-2 grid grid-cols-3 border-t border-line pt-1.5 text-ui-meta">
                          <div><dt className="text-dim">ACT</dt><dd className={`mt-0.5 truncate font-mono ${released && event.actual !== undefined ? 'font-semibold text-ink' : 'text-dim'}`} aria-label={released ? undefined : 'Actual not released'}>{released ? event.actual ?? '—' : '—'}</dd></div>
                          <div className="border-x border-line px-2"><dt className="text-dim">FCST</dt><dd className="mt-0.5 truncate font-mono text-muted">{event.forecast ?? '—'}</dd></div>
                          <div className="pl-2"><dt className="text-dim">PREV</dt><dd className="mt-0.5 truncate font-mono text-muted">{event.previous ?? '—'}</dd></div>
                        </dl>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </li>
          ))}
        </ol>
      ) : week ? (
        <div className="grid min-h-0 flex-1 place-items-center p-5 text-center">
          <div className="max-w-56">
            <CalendarDays className="mx-auto text-dim" size={22} strokeWidth={1.5} aria-hidden="true" />
            <h3 className="mt-3 text-ui-title font-semibold text-ink">No matching events</h3>
            <p className="mt-1 text-ui-body leading-relaxed text-muted">This week is clear for the selected country and impact filters.</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
