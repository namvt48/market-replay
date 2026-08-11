// React glue for the eval-session store, which stays framework-agnostic
// (same split as ui-store + use-replay). useEvalSession exposes the
// reactive session for screens; useEvalTicker feeds replay-engine snapshots
// into the store, calling the store action imperatively so the bridge adds
// no extra React state of its own.
import { useEffect } from 'react'
import { flushEvalSessionPersistence, getEvalState, useEvalStore } from '../store/eval-store'
import type { EvalFillState, EvalSessionState } from '../store/eval-store'
import { replayEngine } from './replay-engine'

/** Reactive view of the whole eval session; re-renders on eval ticks. */
export function useEvalSession(): { session: EvalSessionState } {
  const session = useEvalStore()
  return { session }
}

/**
 * Pumps replay-engine snapshots into the eval store while the engine is
 * ready.
 *
 * Subscribes to the engine directly instead of through useReplaySnapshot:
 * this hook mounts at the root of the workspace, and reading the snapshot
 * reactively made every engine emit re-render the entire tree — top bar,
 * chart tiles, drawing toolbar and sidebar included — roughly 10x a second
 * during replay, purely to hand three fields to a store action. Going
 * straight to the engine keeps the bridge free of React state, as its own
 * contract always claimed.
 */
export function useEvalTicker(): void {
  useEffect(() => {
    let lastCursorTs: number | null = null
    let lastFill: EvalFillState | null = null
    const pump = (): void => {
      const { cursorTs, fill: activeFill, evalFill, status } = replayEngine.getSnapshot()
      const fill = evalFill ?? activeFill
      if (status !== 'ready' || !fill) return
      // Same guard the effect's dependency array used to provide: emits that
      // changed neither the cursor nor the fill must not re-tick.
      if (cursorTs === lastCursorTs && fill === lastFill) return
      lastCursorTs = cursorTs
      lastFill = fill
      getEvalState().tick({ cursorTs, fill })
    }
    pump()
    return replayEngine.subscribe(pump)
  }, [])
  useEffect(() => {
    window.addEventListener('pagehide', flushEvalSessionPersistence)
    return () => {
      window.removeEventListener('pagehide', flushEvalSessionPersistence)
      flushEvalSessionPersistence()
    }
  }, [])
}
