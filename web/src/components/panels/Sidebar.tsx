import { Activity, BookOpen, CalendarDays, CircleDollarSign, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { replayEngine } from '../../replay/replay-engine'
import { shortReplaySessionHash } from '../../replay/session-state'
import { useReplaySelector } from '../../replay/use-replay'
import { useEvalStore } from '../../store/eval-store'
import { useUiStore } from '../../store/ui-store'
import { EvaluationPanel } from '../eval/EvaluationPanel'
import { CalendarErrorPanel, EconomicCalendarPanel } from '../calendar/EconomicCalendarPanel'
import { useEconMeta } from '../calendar/use-econ-meta'
import { SessionsPanel } from '../sessions/SessionsPanel'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
function SectionHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return <div className="flex h-9 items-center justify-between border-b border-line px-3"><h2 className="text-ui-meta font-semibold tracking-[0.04em] text-muted">{children}</h2>{action}</div>
}

function TradePanel() {
  // Live position readout, so following fill/lastBar per emit is the
  // point — the selector just keeps the other ~20 snapshot fields from
  // dragging this panel into re-renders it has no reason to do.
  const replay = useReplaySelector((snapshot) => ({
    fill: snapshot.fill,
    symbol: snapshot.symbol,
    lastBar: snapshot.lastBar,
    qty: snapshot.qty,
    status: snapshot.status,
    replayMode: snapshot.replayMode,
    sessionStatus: snapshot.sessionStatus,
    sessionId: snapshot.sessionId,
  }))
  const fill = replay.fill
  const position = fill?.position
  const symbol = replay.symbol
  const [stop, setStop] = useState('')
  const [target, setTarget] = useState('')
  const price = replay.lastBar && symbol ? replay.lastBar.closeTicks * symbol.tickSize : 0
  const tradingEnabled = replay.status === 'ready' && replay.replayMode === 'active'

  useEffect(() => {
    if (!position || !symbol) return
    const direction = position.qty > 0 ? 1 : -1
    setStop(((position.avgPriceTicks - direction * 8) * symbol.tickSize).toFixed(symbol.priceDecimals))
    setTarget(((position.avgPriceTicks + direction * 16) * symbol.tickSize).toFixed(symbol.priceDecimals))
  }, [position, symbol])

  return (
    <div className="min-h-0 overflow-y-auto">
      <section>
        <SectionHeading>POSITION</SectionHeading>
        <div className="space-y-3 p-3">
          <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-ui-body">
            <span className="text-muted">Instrument</span><span className="font-mono text-ink">{symbol?.symbol ?? '—'}</span>
            <span className="text-muted">Side / size</span><span className={`font-mono ${position ? position.qty > 0 ? 'text-profit-bright' : 'text-loss-bright' : 'text-ink'}`}>{position ? `${position.qty > 0 ? 'Long' : 'Short'} ${Math.abs(position.qty)}` : 'Flat'}</span>
            <span className="text-muted">Average</span><span className="font-mono text-ink">{position && symbol ? (position.avgPriceTicks * symbol.tickSize).toFixed(symbol.priceDecimals) : '—'}</span>
            <span className="text-muted">Unrealized P&amp;L</span><span className={`font-mono font-semibold ${(fill?.unrealizedCents ?? 0) >= 0 ? 'text-profit-bright' : 'text-loss-bright'}`}>{money.format((fill?.unrealizedCents ?? 0) / 100)}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => replayEngine.placeMarket('buy')} disabled={!tradingEnabled} className="trade-button bg-profit text-[#04120f] hover:bg-profit-bright disabled:opacity-40"><span>BUY MKT</span><kbd>B</kbd></button>
            <button type="button" onClick={() => replayEngine.placeMarket('sell')} disabled={!tradingEnabled} className="trade-button bg-loss text-[#190707] hover:bg-loss-bright disabled:opacity-40"><span>SELL MKT</span><kbd>S</kbd></button>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-ui-meta font-medium text-muted">QUANTITY</legend>
            <div className="grid grid-cols-5 gap-1 rounded-control bg-surface-0 p-1">
              {[1, 2, 3, 4, 5].map((qty) => <button key={qty} type="button" aria-pressed={replay.qty === qty} onClick={() => replayEngine.setQty(qty)} className="h-7 rounded-[3px] font-mono text-ui-control text-muted hover:text-ink aria-pressed:bg-surface-3 aria-pressed:text-ink">{qty}</button>)}
            </div>
          </fieldset>

          {position && symbol ? (
            <form
              className="space-y-2 border-t border-line pt-3"
              onSubmit={(event) => {
                event.preventDefault()
                const stopPrice = Number(stop)
                const targetPrice = Number(target)
                if (Number.isFinite(stopPrice) && Number.isFinite(targetPrice)) replayEngine.placeBracket(stopPrice, targetPrice)
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                <label className="field-label">Stop loss<input className="field-input" inputMode="decimal" value={stop} onChange={(event) => setStop(event.target.value)} /></label>
                <label className="field-label">Take profit<input className="field-input" inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} /></label>
              </div>
              <button type="submit" className="secondary-button w-full">Place bracket</button>
            </form>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={!position || !tradingEnabled} onClick={() => replayEngine.flatten()} className="secondary-button">Flatten <kbd>F</kbd></button>
            <button type="button" disabled={!position || !tradingEnabled} onClick={() => replayEngine.reverse()} className="secondary-button">Reverse <kbd>R</kbd></button>
          </div>
          <p className="text-ui-meta leading-relaxed text-dim">Shift-click chart places a limit; Ctrl-click places a stop. Side is inferred from current price. Fills always evaluate on real 1m bars.</p>
        </div>
      </section>

      <section className="border-t border-line">
        <SectionHeading>WORKING ORDERS <span className="font-mono text-dim">{fill?.orders.length ?? 0}</span></SectionHeading>
        {fill?.orders.length ? (
          <ul className="divide-y divide-line">
            {fill.orders.map((order) => (
              <li key={order.id} className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2 text-ui-body">
                <div><span className={order.side === 'buy' ? 'text-profit-bright' : 'text-loss-bright'}>{order.side.toUpperCase()}</span> <span className="text-ink">{order.qty} {order.type.toUpperCase()}</span><div className="mt-0.5 font-mono text-dim">{order.priceTicks !== null && symbol ? (order.priceTicks * symbol.tickSize).toFixed(symbol.priceDecimals) : 'Next bar open'}</div></div>
                <button type="button" onClick={() => replayEngine.cancelOrder(order.id)} className="grid size-8 place-items-center rounded-control text-muted hover:bg-loss/10 hover:text-loss-bright" aria-label={`Cancel ${order.side} ${order.type} order`}><X size={14} /></button>
              </li>
            ))}
          </ul>
        ) : <p className="px-3 py-5 text-center text-ui-body text-dim">No working orders</p>}
      </section>

      <section className="border-t border-line">
        <SectionHeading>STUDY</SectionHeading>
        <div className="p-3 text-ui-body">
          <div className="flex items-center justify-between"><span className="text-muted">Current session</span><span className="font-mono text-ink">{replay.sessionId ? `#${shortReplaySessionHash(replay.sessionId)}` : 'None active'}</span></div>
          <div className="mt-2 flex items-center justify-between"><span className="text-muted">Session price</span><span className="font-mono text-ink">{price ? price.toFixed(symbol?.priceDecimals ?? 2) : '—'}</span></div>
        </div>
      </section>
    </div>
  )
}

export function Sidebar() {
  const open = useUiStore((state) => state.sidebarOpen)
  const tab = useUiStore((state) => state.sidebarTab)
  const setTab = useUiStore((state) => state.setSidebarTab)
  const evalAccountId = useEvalStore((state) => state.accountId)
  const econMeta = useEconMeta()
  const calendarVisible = econMeta.state.status === 'error'
    || (econMeta.state.status === 'success' && econMeta.state.data.available)
    || tab === 'calendar'
  const tabs = [
    { id: 'trade' as const, label: 'Trade', icon: CircleDollarSign },
    { id: 'sessions' as const, label: 'Journal', icon: BookOpen },
    ...(calendarVisible ? [{ id: 'calendar' as const, label: 'Calendar', icon: CalendarDays }] : []),
    { id: 'evaluation' as const, label: 'Eval', icon: Activity },
  ]

  useEffect(() => {
    if (evalAccountId) setTab('evaluation')
  }, [evalAccountId, setTab])

  useEffect(() => {
    if (tab === 'calendar' && econMeta.state.status === 'success' && !econMeta.state.data.available) setTab('trade')
  }, [econMeta.state, setTab, tab])

  const panel = tab === 'trade'
    ? <TradePanel />
    : tab === 'sessions'
      ? <SessionsPanel />
      : tab === 'calendar'
        ? econMeta.state.status === 'success'
          ? <EconomicCalendarPanel meta={econMeta.state.data} />
          : econMeta.state.status === 'error'
            ? <CalendarErrorPanel onRetry={econMeta.retry} />
            : <div role="status" className="grid h-full place-items-center text-ui-body text-dim">Loading calendar metadata…</div>
        : <EvaluationPanel />

  if (!open) return null
  return (
    <aside className="flex h-[38vh] w-full shrink-0 flex-col border-t border-line bg-surface-1 lg:h-auto lg:w-80 lg:border-l lg:border-t-0" aria-label="Workspace panels">
      <nav className={`grid h-11 shrink-0 border-b border-line ${tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`} aria-label="Workspace panels">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined} aria-label={id === 'evaluation' ? 'Evaluation accounts' : undefined} className="flex min-w-0 items-center justify-center gap-1 border-b-2 border-transparent px-1 text-ui-meta font-medium text-muted hover:bg-surface-2 hover:text-ink aria-[current=page]:border-active aria-[current=page]:text-ink"><Icon size={13} strokeWidth={1.75} /><span className="truncate">{label}</span></button>)}
      </nav>
      <div className="min-h-0 flex-1">{panel}</div>
    </aside>
  )
}
