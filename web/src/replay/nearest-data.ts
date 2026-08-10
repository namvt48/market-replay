import type { CalendarEntry } from '../api/types'

export type NearestDataDirection = 'nearest' | 'at-or-after'

function clampToEntry(entry: CalendarEntry, timestamp: number): number {
  return Math.max(entry.firstTs, Math.min(timestamp, entry.lastTs))
}

/** Resolves a timestamp onto a real trading day represented by the data calendar. */
export function nearestDataTimestamp(
  entries: CalendarEntry[],
  timestamp: number,
  direction: NearestDataDirection = 'nearest',
): number | null {
  const available = entries
    .filter((entry) => entry.bars > 0 && entry.firstTs <= entry.lastTs)
    .toSorted((first, second) => first.firstTs - second.firstTs)
  if (available.length === 0) return null

  if (direction === 'at-or-after') {
    const next = available.find((entry) => entry.lastTs >= timestamp)
    return next ? clampToEntry(next, timestamp) : available.at(-1)?.lastTs ?? null
  }

  let best = clampToEntry(available[0], timestamp)
  let bestDistance = Math.abs(best - timestamp)
  for (const entry of available.slice(1)) {
    const candidate = clampToEntry(entry, timestamp)
    const distance = Math.abs(candidate - timestamp)
    if (distance < bestDistance || (distance === bestDistance && candidate > best)) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}
