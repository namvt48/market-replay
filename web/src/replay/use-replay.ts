import { useCallback, useRef, useSyncExternalStore } from 'react'
import { replayEngine, type ReplaySnapshot } from './replay-engine'

/**
 * Subscribes to the whole engine snapshot. Every emit re-renders the
 * caller, so prefer useReplaySelector unless a component genuinely reads
 * most of the snapshot: while replay is playing the engine emits ~10x a
 * second, and `cursorTs`/`fill`/`lastBar`/`stats` change on every one of
 * them whether or not the caller looks at them.
 */
export function useReplaySnapshot(): ReplaySnapshot {
  return useSyncExternalStore(replayEngine.subscribe, replayEngine.getSnapshot, replayEngine.getSnapshot)
}

/**
 * Field-wise comparison, so a selector can return a fresh object literal
 * without that literal counting as a change every emit. Non-objects fall
 * back to identity.
 */
function isEquivalentSelection(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true
  if (typeof previous !== 'object' || typeof next !== 'object' || previous === null || next === null) return false
  if (Array.isArray(previous) !== Array.isArray(next)) return false
  const previousRecord = previous as Record<string, unknown>
  const nextRecord = next as Record<string, unknown>
  const keys = Object.keys(previousRecord)
  if (keys.length !== Object.keys(nextRecord).length) return false
  return keys.every((key) => Object.is(previousRecord[key], nextRecord[key]))
}

/**
 * Subscribes to one slice of the engine snapshot, re-rendering only when
 * that slice changes.
 *
 * The engine replaces its snapshot object on every mutation, so a plain
 * whole-snapshot subscription re-renders every consumer at emit rate — which
 * is how the entire workspace tree (top bar, chart tiles, drawing toolbar,
 * sidebar) ended up re-rendering ~10x/s during replay.
 *
 * `selector` must be pure; it may be an inline arrow, since it is read
 * through a ref rather than used as a subscription key.
 */
export function useReplaySelector<T>(selector: (snapshot: ReplaySnapshot) => T): T {
  const selectorRef = useRef(selector)
  selectorRef.current = selector

  const cache = useRef<{ source: ReplaySnapshot; value: T } | null>(null)

  const getSelection = useCallback((): T => {
    const source = replayEngine.getSnapshot()
    const previous = cache.current
    // useSyncExternalStore calls this on every render as well as on every
    // notification, and requires a referentially stable result while
    // nothing changed — hence caching on both the source snapshot and the
    // selected value.
    if (previous && previous.source === source) return previous.value
    const selected = selectorRef.current(source)
    const value = previous && isEquivalentSelection(previous.value, selected) ? previous.value : selected
    cache.current = { source, value }
    return value
  }, [])

  return useSyncExternalStore(replayEngine.subscribe, getSelection, getSelection)
}
