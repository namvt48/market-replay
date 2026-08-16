import { useEffect, useMemo, useState } from 'react'
import { fetchTrades } from '../api/client'
import type { ClosedTrade } from '../api/types'
import type { EvalTradeRecord } from '../eval/rules'
import type { EngineTrade } from '../fill-engine/types'
import { evalAccountName } from '../eval/rules'
import { useReplaySelector } from '../replay/use-replay'
import { useEvalSession } from '../replay/use-eval-session'
import { loadEvalAccounts } from '../store/eval-store'
import { useUiStore, type ReviewSource } from '../store/ui-store'
import type { ReviewTrade } from './types'

interface ReviewTradesState {
  source: ReviewSource | null
  trades: ReviewTrade[]
  status: 'idle' | 'loading' | 'success' | 'error'
  error: string | null
}

function fromEngineTrade(source: ReviewSource, trade: EngineTrade | ClosedTrade): ReviewTrade {
  return {
    id: trade.id,
    sourceId: source.id,
    sourceType: source.type,
    symbol: trade.symbol,
    side: trade.side,
    qty: trade.qty,
    entryTs: trade.entryTs,
    exitTs: trade.exitTs,
    entryPriceTicks: trade.entryPriceTicks,
    exitPriceTicks: trade.exitPriceTicks,
    realizedCents: trade.realizedCents,
    feesCents: trade.feesCents,
    mfeTicks: trade.mfeTicks,
    maeTicks: trade.maeTicks,
    rMultiple: trade.rMultiple,
    initialStopTicks: trade.initialStopTicks,
    initialTakeProfitTicks: trade.initialTakeProfitTicks,
    protectionAdjustments: trade.protectionAdjustments,
    exitReason: trade.exitReason,
  }
}

function fromEvalTrade(source: ReviewSource, trade: EvalTradeRecord, index: number): ReviewTrade {
  return {
    id: trade.id ?? `${source.id}-${trade.exitTime}-${index}`,
    sourceId: source.id,
    sourceType: source.type,
    symbol: trade.symbol ?? '—',
    side: trade.side ?? 'long',
    qty: trade.qty ?? 1,
    entryTs: trade.entryTime ?? null,
    exitTs: trade.exitTime,
    entryPriceTicks: trade.entryPriceTicks ?? null,
    exitPriceTicks: trade.exitPriceTicks ?? null,
    realizedCents: trade.realizedCents ?? 0,
    feesCents: trade.feesCents ?? 0,
    mfeTicks: trade.mfeTicks ?? 0,
    maeTicks: trade.maeTicks ?? 0,
    rMultiple: trade.rMultiple ?? null,
    initialStopTicks: trade.initialStopTicks ?? null,
    initialTakeProfitTicks: trade.initialTakeProfitTicks ?? null,
    protectionAdjustments: trade.protectionAdjustments ?? [],
    exitReason: trade.exitReason ?? null,
  }
}

export function useReviewTrades(): ReviewTradesState {
  const selectedSource = useUiStore((state) => state.reviewSource)
  const replay = useReplaySelector((snapshot) => ({
    sessionId: snapshot.sessionId,
    sessionStatus: snapshot.sessionStatus,
    symbol: snapshot.activeSymbol?.symbol ?? snapshot.symbol?.symbol ?? 'Replay session',
    trades: snapshot.fill?.trades ?? [],
  }))
  const evaluation = useEvalSession((state) => ({
    accountId: state.accountId,
    phase: state.phase,
    config: state.config,
    trades: state.trades,
  }))
  const fallbackSource = useMemo<ReviewSource | null>(() => {
    if (evaluation.accountId && evaluation.phase === 'running') {
      return { id: evaluation.accountId, type: 'evaluation', title: evaluation.config ? evalAccountName(evaluation.config) : 'Evaluation account' }
    }
    if (replay.sessionId && replay.sessionStatus === 'active') return { id: replay.sessionId, type: 'session', title: replay.symbol }
    return null
  }, [evaluation.accountId, evaluation.config, evaluation.phase, replay.sessionId, replay.sessionStatus, replay.symbol])
  const source = selectedSource ?? fallbackSource
  const [remote, setRemote] = useState<{ key: string; trades: ReviewTrade[]; error: string | null } | null>(null)
  const sourceKey = source ? `${source.type}:${source.id}` : ''

  const immediate = useMemo<ReviewTrade[] | null>(() => {
    if (!source) return []
    if (source.type === 'session' && source.id === replay.sessionId) return replay.trades.map((trade) => fromEngineTrade(source, trade))
    if (source.type === 'evaluation') {
      const records = source.id === evaluation.accountId ? evaluation.trades : loadEvalAccounts().find((account) => account.accountId === source.id)?.trades
      return (records ?? []).map((trade, index) => fromEvalTrade(source, trade, index))
    }
    return null
  }, [evaluation.accountId, evaluation.trades, replay.sessionId, replay.trades, source])

  useEffect(() => {
    if (!source || immediate !== null) return
    const controller = new AbortController()
    setRemote(null)
    void fetchTrades(source.id).then((trades) => {
      if (!controller.signal.aborted) setRemote({ key: sourceKey, trades: trades.map((trade) => fromEngineTrade(source, trade)), error: null })
    }).catch(() => {
      if (!controller.signal.aborted) setRemote({ key: sourceKey, trades: [], error: 'Trade history could not be loaded. Check the persistence service and try again.' })
    })
    return () => controller.abort()
  }, [immediate, source, sourceKey])

  if (!source) return { source: null, trades: [], status: 'idle', error: null }
  if (immediate !== null) return { source, trades: immediate.toSorted((a, b) => b.exitTs - a.exitTs), status: 'success', error: null }
  if (!remote || remote.key !== sourceKey) return { source, trades: [], status: 'loading', error: null }
  return { source, trades: remote.trades.toSorted((a, b) => b.exitTs - a.exitTs), status: remote.error ? 'error' : 'success', error: remote.error }
}
