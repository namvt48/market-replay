import { describe, expect, it } from 'vitest'
import { ReplayEngine } from './replay-engine'
import { MAX_VIEWPORT_RAW_BARS } from './viewport-data'

/**
 * pruneFillSnapshots and the fillSnapshots map it trims are both private —
 * see the class's own doc comment on `fillSnapshots` for the ascending-
 * insertion-order invariant the pruning loop relies on. Exercising it
 * through the public API would need a 6,000+ bar fixture just to reach the
 * eviction threshold, so this pokes the private state directly instead: a
 * narrow, deliberate exception to this suite's usual public-API-only style,
 * justified by the size of the fixture the alternative would require.
 */
function fillSnapshotsOf(engine: ReplayEngine): Map<number, unknown> {
  return (engine as unknown as { fillSnapshots: Map<number, unknown> }).fillSnapshots
}

function pruneFillSnapshotsOf(engine: ReplayEngine): void {
  (engine as unknown as { pruneFillSnapshots: () => void }).pruneFillSnapshots()
}

function setCursorIndexOf(engine: ReplayEngine, index: number): void {
  (engine as unknown as { cursorIndex: number }).cursorIndex = index
}

describe('pruneFillSnapshots', () => {
  it('evicts every entry that fell out of the trailing window and keeps the rest', () => {
    const engine = new ReplayEngine()
    const snapshots = fillSnapshotsOf(engine)
    // One entry per bar index, inserted in ascending order — exactly how
    // advance()'s forward walk populates this map in practice. cursorIndex
    // sits 5 bars past the retention cap, so the map holds 6 entries beyond
    // budget by the time prune runs (advance() always inserts the current
    // bar's entry before calling prune, same as here).
    const cursorIndex = MAX_VIEWPORT_RAW_BARS + 5
    for (let index = 0; index <= cursorIndex; index += 1) snapshots.set(index, { index })

    setCursorIndexOf(engine, cursorIndex)
    pruneFillSnapshotsOf(engine)

    const floor = cursorIndex - MAX_VIEWPORT_RAW_BARS
    expect(floor).toBeGreaterThan(0)
    expect(snapshots.has(floor - 1)).toBe(false)
    expect(snapshots.has(floor)).toBe(true)
    expect(snapshots.has(cursorIndex)).toBe(true)
    expect(snapshots.size).toBe(MAX_VIEWPORT_RAW_BARS + 1)
  })

  it('evicts every entry that aged out in one call, not just the single oldest one', () => {
    const engine = new ReplayEngine()
    const snapshots = fillSnapshotsOf(engine)
    for (let index = 0; index <= MAX_VIEWPORT_RAW_BARS; index += 1) snapshots.set(index, { index })
    // Simulates a single advance() call that processed many bars at once
    // (a large step timeframe at high replay speed) before pruning ran —
    // several entries age out in the same call, not just the newest one.
    const jump = 250
    setCursorIndexOf(engine, MAX_VIEWPORT_RAW_BARS + jump)

    pruneFillSnapshotsOf(engine)

    const floor = MAX_VIEWPORT_RAW_BARS + jump - MAX_VIEWPORT_RAW_BARS
    for (let index = 0; index < floor; index += 1) expect(snapshots.has(index)).toBe(false)
    expect(snapshots.has(floor)).toBe(true)
    expect(snapshots.size).toBe(MAX_VIEWPORT_RAW_BARS + 1 - floor)
  })

  it('does nothing while the map is still within budget', () => {
    const engine = new ReplayEngine()
    const snapshots = fillSnapshotsOf(engine)
    for (let index = 0; index < 10; index += 1) snapshots.set(index, { index })
    setCursorIndexOf(engine, 9)

    pruneFillSnapshotsOf(engine)

    expect(snapshots.size).toBe(10)
  })
})
