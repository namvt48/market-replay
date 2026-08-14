import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLayoutPreset } from '../chart-workspace/layout-presets'
import type { ChartWorkspaceState } from '../chart-workspace/types'
import type { FillEngineState } from '../fill-engine/types'

const api = vi.hoisted(() => ({
  fetchWorkspaceSnapshot: vi.fn(),
  putWorkspaceSnapshot: vi.fn().mockResolvedValue({ revision: 1, capturedAt: 0, conflict: false }),
}))
vi.mock('../api/client', () => api)

import {
  captureChartWorkspaceState,
  compareSnapshotRank,
  fetchRemoteWorkspaceSnapshot,
  loadSessionWorkspaceSnapshot,
  registerChartWorkspaceSnapshotBridge,
  restoreChartWorkspaceState,
  saveSessionWorkspaceSnapshot,
  syncWorkspaceSnapshot,
  type SessionWorkspaceSnapshot,
} from './session-workspace-snapshot'

function layout(symbol = 'NQ'): ChartWorkspaceState {
  const state = createLayoutPreset('single')
  const active = state.panes[state.activePaneId]
  if (!active) throw new Error('Single-pane fixture is missing its active pane')
  return {
    ...state,
    panes: { ...state.panes, [active.id]: { ...active, symbol } },
  }
}

function fill(symbol = 'NQ'): FillEngineState {
  return {
    config: {
      symbol,
      tickValueCents: 500,
      commissionPerSideCents: 0,
      slippageTicks: 0,
      maxContracts: 10,
      startingEquityCents: 1_000_000,
    },
    position: null,
    orders: [],
    trades: [],
    realizedCents: 0,
    unrealizedCents: 0,
    equityCents: 1_000_000,
    lastTs: 120,
    sequence: 1,
  }
}

function snapshot(owner: SessionWorkspaceSnapshot['owner'], cursorTs: number): SessionWorkspaceSnapshot {
  return {
    version: 1,
    owner,
    reason: 'trade-close',
    capturedAt: cursorTs + 1,
    cursorTs,
    symbol: 'NQ',
    layout: layout(),
    viewports: { 'pane-1': { time: { from: 60, to: 120 }, logicalSpan: 60 } },
    drawings: { NQ: [] },
    fills: { NQ: fill() },
    indicators: [],
    preferences: {
      speed: 2,
      stepTimeframe: '5m',
      qty: 3,
      drawingMode: 'replay',
      keepDrawing: false,
      drawingsLocked: false,
      drawingsHidden: false,
      indicatorsHidden: false,
    },
  }
}

describe('session workspace snapshot storage', () => {
  beforeEach(() => localStorage.clear())

  it('stores replay sessions and eval accounts independently', () => {
    const replay = snapshot({ kind: 'replay', id: 'session-1' }, 120)
    const evaluation = snapshot({ kind: 'eval', id: 'account-1' }, 240)

    expect(saveSessionWorkspaceSnapshot(replay)).toBe(true)
    expect(saveSessionWorkspaceSnapshot(evaluation)).toBe(true)

    expect(loadSessionWorkspaceSnapshot(replay.owner)?.cursorTs).toBe(120)
    expect(loadSessionWorkspaceSnapshot(evaluation.owner)?.cursorTs).toBe(240)
  })

  it('overwrites the recovery point only for the same owner', () => {
    const owner = { kind: 'replay', id: 'session-1' } as const
    expect(saveSessionWorkspaceSnapshot(snapshot(owner, 120))).toBe(true)
    expect(saveSessionWorkspaceSnapshot({ ...snapshot(owner, 300), reason: 'explicit-exit' })).toBe(true)

    expect(loadSessionWorkspaceSnapshot(owner)).toMatchObject({ cursorTs: 300, reason: 'explicit-exit' })
  })

  it('fails closed when browser storage contains malformed data', () => {
    localStorage.setItem('market-replay:session-workspace-snapshots:v1', '{bad json')

    expect(loadSessionWorkspaceSnapshot({ kind: 'replay', id: 'session-1' })).toBeNull()
  })
})

describe('chart workspace snapshot bridge', () => {
  it('clones captures and restores without sharing mutable layout state', () => {
    const source = layout()
    const restore = vi.fn()
    const unregister = registerChartWorkspaceSnapshotBridge({ capture: () => source, restore })

    const captured = captureChartWorkspaceState()
    expect(captured).toEqual(source)
    expect(captured).not.toBe(source)

    if (!captured) throw new Error('Expected a captured layout')
    const active = captured.panes[captured.activePaneId]
    if (!active) throw new Error('Captured layout is missing its active pane')
    active.symbol = 'ES'
    expect(source.panes[source.activePaneId]?.symbol).toBe('NQ')

    expect(restoreChartWorkspaceState(captured)).toBe(true)
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ activePaneId: captured.activePaneId }))
    expect(restore.mock.calls[0]?.[0]).not.toBe(captured)
    unregister()
  })
})

describe('compareSnapshotRank', () => {
  it('ranks by capturedAt first', () => {
    expect(compareSnapshotRank({ reason: 'trade-close', capturedAt: 2000 }, { reason: 'explicit-exit', capturedAt: 1000 })).toBeGreaterThan(0)
    expect(compareSnapshotRank({ reason: 'explicit-exit', capturedAt: 1000 }, { reason: 'trade-close', capturedAt: 2000 })).toBeLessThan(0)
  })

  it('breaks a tie at the same capturedAt in favour of explicit-exit', () => {
    expect(compareSnapshotRank({ reason: 'explicit-exit', capturedAt: 1000 }, { reason: 'trade-close', capturedAt: 1000 })).toBeGreaterThan(0)
    expect(compareSnapshotRank({ reason: 'trade-close', capturedAt: 1000 }, { reason: 'explicit-exit', capturedAt: 1000 })).toBeLessThan(0)
  })

  it('is zero for an identical reason and capturedAt', () => {
    expect(compareSnapshotRank({ reason: 'trade-close', capturedAt: 1000 }, { reason: 'trade-close', capturedAt: 1000 })).toBe(0)
  })
})

describe('fetchRemoteWorkspaceSnapshot', () => {
  const owner = { kind: 'replay', id: 'session-1' } as const

  beforeEach(() => {
    api.fetchWorkspaceSnapshot.mockReset()
  })

  it('returns the parsed remote snapshot alongside its revision and capturedAt', async () => {
    const remote = snapshot(owner, 300)
    api.fetchWorkspaceSnapshot.mockResolvedValue({ revision: 4, capturedAt: remote.capturedAt, snapshot: remote })

    const result = await fetchRemoteWorkspaceSnapshot(owner)

    expect(result).toMatchObject({ revision: 4, capturedAt: remote.capturedAt })
    expect(result?.snapshot).toMatchObject({ cursorTs: 300 })
  })

  it('returns null when there is no remote snapshot yet', async () => {
    api.fetchWorkspaceSnapshot.mockResolvedValue(null)
    expect(await fetchRemoteWorkspaceSnapshot(owner)).toBeNull()
  })

  it('returns null instead of throwing when the backend is unreachable', async () => {
    api.fetchWorkspaceSnapshot.mockRejectedValue(new Error('offline'))
    await expect(fetchRemoteWorkspaceSnapshot(owner)).resolves.toBeNull()
  })

  it('returns null when the remote payload fails schema validation', async () => {
    api.fetchWorkspaceSnapshot.mockResolvedValue({ revision: 1, capturedAt: 0, snapshot: { bad: true } })
    expect(await fetchRemoteWorkspaceSnapshot(owner)).toBeNull()
  })
})

describe('syncWorkspaceSnapshot', () => {
  beforeEach(() => {
    api.putWorkspaceSnapshot.mockClear()
  })

  it('fires a PUT scoped to the snapshot owner', async () => {
    const owner = { kind: 'eval', id: 'account-1' } as const
    const toSync = snapshot(owner, 120)

    syncWorkspaceSnapshot(toSync)

    await vi.waitFor(() => expect(api.putWorkspaceSnapshot).toHaveBeenCalledWith('eval', 'account-1', toSync))
  })

  it('does not throw when the backend rejects the write', () => {
    api.putWorkspaceSnapshot.mockRejectedValueOnce(new Error('offline'))
    const owner = { kind: 'replay', id: 'session-1' } as const
    expect(() => syncWorkspaceSnapshot(snapshot(owner, 120))).not.toThrow()
  })
})
