import { describe, expect, it } from 'vitest'
import type { ClosedTrade, ReplaySession } from '../api/types'
import { createFillEngine } from '../fill-engine/engine'
import { restoreReplayIndicators, restoreReplayRuntime, serializeReplayRuntime, shortReplaySessionHash } from './session-state'

const session: ReplaySession = {
  id: '018f08de-1111-7222-8333-abcdef123456', name: '', symbol: 'NQ', tf: '1m', startTs: 100,
  cursorTs: 200, equityCents: 1_025_000, status: 'paused', kind: 'replay', config: {}, createdAt: 100, updatedAt: 200,
}

const trade: ClosedTrade = {
  id: 'trade-1', sessionId: session.id, symbol: 'NQ', side: 'long', qty: 1,
  entryTs: 120, entryPriceTicks: 100, exitTs: 180, exitPriceTicks: 120,
  realizedCents: 25_000, feesCents: 0, mfeTicks: 24, maeTicks: 2, rMultiple: 2, createdAt: 180,
  initialStopTicks: 95, initialTakeProfitTicks: 120,
  protectionAdjustments: [{ role: 'stopLoss', ts: 150, priceTicks: 100 }], exitReason: 'takeProfit',
}

function baseFill() {
  return createFillEngine({ symbol: 'NQ', tickValueCents: 1250, commissionPerSideCents: 0, slippageTicks: 0, maxContracts: 5, startingEquityCents: 1_000_000 })
}

describe('replay session state', () => {
  it('creates a stable short hash without exposing the raw UUID', () => {
    expect(shortReplaySessionHash(session.id)).toMatch(/^[A-Z0-9]{6}$/)
    expect(shortReplaySessionHash(session.id)).toBe(shortReplaySessionHash(session.id))
    expect(shortReplaySessionHash(`${session.id}-other`)).not.toBe(shortReplaySessionHash(session.id))
  })

  it('restores the persisted runtime and the authoritative trade journal', () => {
    const running = { ...baseFill(), realizedCents: 25_000, equityCents: 1_025_000, sequence: 7 }
    const restored = restoreReplayRuntime(baseFill(), { ...session, config: serializeReplayRuntime(running) }, [trade])
    expect(restored).toMatchObject({ realizedCents: 25_000, equityCents: 1_025_000, sequence: 7 })
    expect(restored.trades).toEqual([expect.objectContaining({
      id: 'trade-1', realizedCents: 25_000, initialStopTicks: 95, initialTakeProfitTicks: 120,
      protectionAdjustments: [{ role: 'stopLoss', ts: 150, priceTicks: 100 }], exitReason: 'takeProfit',
    })])
  })

  it('rebuilds closed-accounting stats from trades for legacy sessions', () => {
    const restored = restoreReplayRuntime(baseFill(), session, [trade])
    expect(restored).toMatchObject({ realizedCents: 25_000, equityCents: 1_025_000 })
    expect(restored.trades).toHaveLength(1)
  })

  it('round-trips active indicators inside the replay session config', () => {
    const indicators = [{ id: 'gb69-cbmor', scriptId: 'gb69-cbmor', name: 'GB69 CBMOR', visible: true, inputs: { show_lines: false } }]
    const config = serializeReplayRuntime(baseFill(), indicators)

    expect(restoreReplayIndicators({ ...session, config })).toEqual(indicators)
  })
})
