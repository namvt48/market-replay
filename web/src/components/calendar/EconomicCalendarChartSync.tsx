import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchEconWeek } from '../../api/client'
import type { EconEventView } from '../../api/types'
import type { EconomicEventMarker } from '../../replay/chart-adapter'
import { replayEngine } from '../../replay/replay-engine'
import { useReplaySelector } from '../../replay/use-replay'
import { useUiStore } from '../../store/ui-store'
import { economicCalendarWeekKey } from './calendar-week'

const IMPORTANCE_RANK = { none: 0, low: 1, medium: 2, high: 3 } as const

function toMarkers(
  events: readonly EconEventView[],
  cursorTs: number,
  minImportance: '' | 'medium' | 'high',
  country: string,
): EconomicEventMarker[] {
  const minimumRank = minImportance ? IMPORTANCE_RANK[minImportance] : 0
  // Fetch/merge stores events in timestamp/id order. Array.filter preserves
  // that order, so cursor-only updates must not sort the same list again.
  const ordered = events
    .filter((event) => (!country || event.country === country) && IMPORTANCE_RANK[event.importance] >= minimumRank)
  const nextTime = ordered.find((event) => event.ts > cursorTs)?.ts ?? null
  return ordered.map((event) => ({
    id: event.id,
    time: event.ts,
    country: event.country,
    currency: event.currency,
    title: event.title,
    importance: event.importance,
    state: event.ts <= cursorTs ? 'past' : event.ts === nextTime ? 'next' : 'scheduled',
  }))
}

/**
 * Keeps the chart annotation layer synchronized even when the Calendar tab
 * is closed. Fetching is keyed by local Monday, so replay frames never turn
 * into a request loop.
 */
export function EconomicCalendarChartSync(): React.ReactNode {
  const replay = useReplaySelector((snapshot) => ({
    cursorTs: snapshot.cursorTs,
    timeZone: snapshot.symbol?.sessionTz || 'UTC',
  }))
  const importance = useUiStore((state) => state.calendarImportance)
  const country = useUiStore((state) => state.calendarCountry)
  const cursorRef = useRef(replay.cursorTs)
  cursorRef.current = replay.cursorTs
  const weekKey = economicCalendarWeekKey(replay.cursorTs, replay.timeZone)
  const [events, setEvents] = useState<EconEventView[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!weekKey) {
      setEvents([])
      setError(null)
      return
    }
    const controller = new AbortController()
    const requestCursor = cursorRef.current
    setEvents([])
    setError(null)
    const queryFilters = {
      minImportance: importance || undefined,
      countries: country ? [country] : undefined,
    }
    void fetchEconWeek({
      at: requestCursor,
      cursorTs: requestCursor,
      timeZone: replay.timeZone,
      ...queryFilters,
    }, controller.signal)
      .then(async (week) => {
        if (controller.signal.aborted) return
        setEvents([...week.events].sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id)))
        const followingWeek = await fetchEconWeek({
          at: week.weekEnd,
          cursorTs: requestCursor,
          timeZone: replay.timeZone,
          ...queryFilters,
        }, controller.signal)
        if (controller.signal.aborted) return
        const byId = new Map([...week.events, ...followingWeek.events].map((event) => [event.id, event]))
        setEvents([...byId.values()].sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id)))
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setEvents([])
        setError(reason instanceof Error && reason.message ? reason.message : 'Economic-event markers could not be loaded.')
      })
    return () => controller.abort()
  }, [country, importance, replay.timeZone, weekKey])

  const markers = useMemo(
    () => toMarkers(events, replay.cursorTs, importance, country),
    [country, events, importance, replay.cursorTs],
  )
  useEffect(() => { replayEngine.setEconomicEventMarkers(markers) }, [markers])
  useEffect(() => () => replayEngine.setEconomicEventMarkers([]), [])

  return error ? <span className="sr-only" role="status">{error}</span> : null
}
