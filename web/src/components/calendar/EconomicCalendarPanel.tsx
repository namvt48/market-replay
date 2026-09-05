import { AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, LocateFixed, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchEconWeek } from '../../api/client'
import type { EconEventView, EconImportance, EconMeta, EconWeek } from '../../api/types'
import { useChartWorkspace } from '../../chart-workspace/use-chart-workspace'
import { DEFAULT_CHART_TIMEZONE, chartTimezoneDisplayTimestamp, chartTimezoneIntlContext, chartTimezoneQueryValue } from '../../replay/chart-timezone'
import { useReplaySelector } from '../../replay/use-replay'
import { useUiStore } from '../../store/ui-store'

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

const WEEK_LABEL_OPTIONS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function importanceLabel(importance: EconImportance): string {
  if (importance === 'high') return 'High'
  if (importance === 'medium') return 'Medium'
  if (importance === 'low') return 'Low'
  return 'Normal'
}

function importanceTone(importance: EconImportance): string {
  if (importance === 'high') return 'text-loss-bright'
  if (importance === 'medium') return 'text-caution-bright'
  if (importance === 'low') return 'text-muted'
  return 'text-dim'
}

function dateKey(formatter: Intl.DateTimeFormat, timestamp: number): string {
  const parts = formatter.formatToParts(timestamp * 1000)
  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  return `${year}-${month}-${day}`
}

function timeUntil(timestamp: number, cursorTs: number): string {
  const minutes = Math.max(0, Math.ceil((timestamp - cursorTs) / 60))
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours < 24) return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
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
  const replay = useReplaySelector((snapshot) => ({ cursorTs: snapshot.cursorTs }))
  const { state: chartWorkspace } = useChartWorkspace()
  const chartTimezone = chartWorkspace.timezone ?? DEFAULT_CHART_TIMEZONE
  const calendarTimeZone = chartTimezoneQueryValue(chartTimezone)
  const intlContext = chartTimezoneIntlContext(chartTimezone)
  const [requestCursorTs, setRequestCursorTs] = useState(() => replay.cursorTs)
  const [browsingAt, setBrowsingAt] = useState<number | null>(null)
  const importance = useUiStore((state) => state.calendarImportance)
  const country = useUiStore((state) => state.calendarCountry)
  const setImportance = useUiStore((state) => state.setCalendarImportance)
  const setCountry = useUiStore((state) => state.setCalendarCountry)
  const [retryVersion, setRetryVersion] = useState(0)
  const [weekState, setWeekState] = useState<WeekState>({ status: 'idle', data: null })
  const nextEventRef = useRef<HTMLLIElement>(null)
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
      timeZone: calendarTimeZone,
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
  }, [calendarTimeZone, country, importance, queryAt, requestCursorTs, retryVersion])

  const formatters = useMemo(() => ({
    dayKey: new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: intlContext.timeZone }),
    day: new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: intlContext.timeZone }),
    time: new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: intlContext.timeZone }),
    week: new Intl.DateTimeFormat('en-US', { ...WEEK_LABEL_OPTIONS, timeZone: intlContext.timeZone }),
  }), [intlContext.timeZone])

  const days = useMemo<DayGroup[]>(() => {
    if (!week) return []
    const groups = new Map<string, DayGroup>()
    for (const event of week.events) {
      const displayTs = chartTimezoneDisplayTimestamp(event.ts, chartTimezone)
      const key = dateKey(formatters.dayKey, displayTs)
      const existing = groups.get(key)
      if (existing) existing.events.push(event)
      else groups.set(key, { key, label: formatters.day.format(displayTs * 1000), events: [event] })
    }
    return [...groups.values()]
  }, [chartTimezone, formatters.day, formatters.dayKey, week])

  const nextEventTs = useMemo(
    () => week?.events.find((event) => event.ts > replay.cursorTs)?.ts ?? null,
    [replay.cursorTs, week],
  )
  const weekLabel = week
    ? formatters.week.formatRange(
      new Date(chartTimezoneDisplayTimestamp(week.weekStart, chartTimezone) * 1000),
      new Date(chartTimezoneDisplayTimestamp(week.weekEnd, chartTimezone) * 1000 - 1),
    )
    : 'Replay week'
  useEffect(() => {
    nextEventRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [nextEventTs])
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
      <header className="shrink-0 border-b border-line bg-[#181c27]">
        <div className="flex min-h-16 items-center gap-3 px-3.5">
          <div className="min-w-0 flex-1">
            <span className="block font-mono text-[0.6875rem] font-medium tracking-[0.08em] text-dim">REPLAY CALENDAR</span>
            <h2 className="mt-0.5 truncate text-ui-title font-semibold tracking-[-0.01em] text-ink">{weekLabel}</h2>
          </div>
          <div className="flex shrink-0 overflow-hidden rounded-control border border-line bg-surface-0">
            <button type="button" disabled={!week} onClick={() => { if (week) showWeek(week.weekStart - 1) }} className="tool-button rounded-none" aria-label="Previous calendar week"><ChevronLeft size={16} /></button>
            <span aria-hidden="true" className="my-1.5 w-px bg-line" />
            <button type="button" disabled={!week} onClick={() => { if (week) showWeek(week.weekEnd) }} className="tool-button rounded-none" aria-label="Next calendar week"><ChevronRight size={16} /></button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-line px-3.5 py-2.5">
          <div className="min-w-0">
            <label className="mb-1 block font-mono text-[0.625rem] font-medium tracking-[0.08em] text-dim" htmlFor="calendar-importance">IMPACT</label>
            <select id="calendar-importance" aria-label="Minimum importance" value={importance} onChange={(event) => setImportance(event.target.value === 'medium' || event.target.value === 'high' ? event.target.value : '')} className="field h-10 w-full px-2.5 font-mono text-ui-meta">
              <option value="">All impact</option>
              <option value="medium">Medium +</option>
              <option value="high">High only</option>
            </select>
          </div>
          <div className="min-w-0">
            <label className="mb-1 block font-mono text-[0.625rem] font-medium tracking-[0.08em] text-dim" htmlFor="calendar-country">REGION</label>
            <select id="calendar-country" aria-label="Country" value={country} onChange={(event) => setCountry(event.target.value)} className="field h-10 w-full px-2.5 font-mono text-ui-meta">
              <option value="">All countries</option>
              {['US', ...meta.countries.filter((item) => item !== 'US')].map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        </div>

        {browsingAt !== null || weekState.status === 'loading' ? <div className="flex min-h-8 items-center justify-between border-t border-line px-3 text-ui-meta">
          {browsingAt !== null ? (
            <button type="button" onClick={returnToReplay} className="flex min-h-8 items-center gap-1.5 font-medium text-active-bright hover:text-ink"><LocateFixed size={13} />Return to replay week</button>
          ) : <span />}
          {weekState.status === 'loading' ? <span role="status" className="text-dim">Updating…</span> : null}
        </div> : null}
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
              <h3 className="sticky top-0 z-10 flex h-9 items-center justify-between border-y border-line bg-[#181c27] px-3.5 text-ui-meta font-semibold text-ink shadow-[0_1px_0_rgb(0_0_0_/_16%)]">
                <span>{day.label}</span><span className="font-mono text-[0.6875rem] font-medium text-dim">{day.events.length} EVENTS</span>
              </h3>
              <ol className="divide-y divide-line">
                {day.events.map((event) => {
                  const released = event.released && event.ts <= replay.cursorTs
                  const next = event.ts === nextEventTs
                  return (
                    <li ref={next ? nextEventRef : undefined} key={event.id} aria-current={next ? 'true' : undefined} className={`grid scroll-mt-9 grid-cols-[3.75rem_minmax(0,1fr)] gap-3 px-3.5 py-3 transition-colors [content-visibility:auto] ${next ? 'bg-active/[0.09]' : 'hover:bg-surface-2/45'}`}>
                      <div className="border-r border-line pr-2">
                        <time className="block font-mono text-ui-body font-medium tabular-nums text-ink" dateTime={new Date(event.ts * 1000).toISOString()}>{formatters.time.format(chartTimezoneDisplayTimestamp(event.ts, chartTimezone) * 1000)}</time>
                        <span className={`mt-1.5 flex items-center gap-1 font-mono text-[0.6875rem] font-semibold ${importanceTone(event.importance)}`} aria-label={`${event.importance} importance`}><span aria-hidden="true" className="size-1 rounded-full bg-current" />{importanceLabel(event.importance)}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h4 className="truncate text-ui-body font-semibold leading-5 text-ink">{event.title}</h4>
                            <p className="mt-1 font-mono text-[0.6875rem] font-medium tracking-[0.04em] text-dim">{event.country}{event.currency ? ` · ${event.currency}` : ''}</p>
                          </div>
                          {released ? (
                            <span className="flex shrink-0 items-center gap-1 pt-0.5 font-mono text-[0.6875rem] font-medium text-profit-bright"><Check size={12} strokeWidth={2} />RELEASED</span>
                          ) : next ? (
                            <span className="shrink-0 rounded-[3px] bg-active px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold tracking-[0.04em] text-white" aria-label={`Next event in ${timeUntil(event.ts, replay.cursorTs)}`}>NEXT {timeUntil(event.ts, replay.cursorTs)}</span>
                          ) : (
                            <span className="flex shrink-0 items-center gap-1 pt-0.5 font-mono text-[0.625rem] font-medium text-dim"><Clock3 size={11} />PENDING</span>
                          )}
                        </div>
                        <dl className="mt-2.5 grid grid-cols-3 divide-x divide-line border-y border-line bg-surface-0/35 text-ui-meta">
                          <div className="min-w-0 px-2 py-1.5 first:pl-0"><dt className="font-mono text-[0.625rem] font-medium tracking-[0.06em] text-dim">ACT</dt><dd className={`mt-0.5 truncate font-mono text-ui-body ${released && event.actual !== undefined ? 'font-semibold text-ink' : 'text-dim'}`} aria-label={released ? undefined : 'Actual not released'}>{released ? event.actual ?? '—' : '—'}</dd></div>
                          <div className="min-w-0 px-2 py-1.5"><dt className="font-mono text-[0.625rem] font-medium tracking-[0.06em] text-dim">FCST</dt><dd className="mt-0.5 truncate font-mono text-ui-body text-muted">{event.forecast ?? '—'}</dd></div>
                          <div className="min-w-0 px-2 py-1.5 pr-0"><dt className="font-mono text-[0.625rem] font-medium tracking-[0.06em] text-dim">PREV</dt><dd className="mt-0.5 truncate font-mono text-ui-body text-muted">{event.previous ?? '—'}</dd></div>
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
