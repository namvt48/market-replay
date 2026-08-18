import {
  ArrowLeft, CalendarDays, Camera, ChevronLeft, ChevronRight, ClipboardCheck, ExternalLink,
  FileText, List, Minimize2, Search, X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { ChartPopoutWindow } from '../chart/ChartPopoutWindow'
import { openWorkspacePopout, type ChartPopoutTarget } from '../chart/chart-popout'
import { captureActiveChart } from '../../review/capture-chart'
import { reviewDocumentKey, reviewTradeSnapshot, type ReviewTrade } from '../../review/types'
import { useReviewTrades } from '../../review/use-review-trades'
import { useReplaySelector } from '../../replay/use-replay'
import { useReviewStore } from '../../store/review-store'
import { useUiStore } from '../../store/ui-store'
import { MarkdownPreview } from './MarkdownPreview'
import { ReviewMetadata } from './ReviewMetadata'
import { useChartWorkspace } from '../../chart-workspace/use-chart-workspace'
import { chartTimezoneDateValue, formatChartTime, type ChartTimezone } from '../../replay/chart-timezone'

const monthTitle = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long' })
const calendarDate = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
const calendarWeekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' })
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

function pnlLabel(cents: number): string {
  const formatted = money.format(Math.abs(cents) / 100)
  if (cents > 0) return `+${formatted}`
  if (cents < 0) return `−${formatted}`
  return formatted
}

interface ReviewHeaderProps {
  sourceTitle: string
  detached: boolean
  onClose: () => void
  onDetachChange: (detached: boolean) => void
}

function ReviewHeader({ sourceTitle, detached, onClose, onDetachChange }: ReviewHeaderProps): ReactElement {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface-0 px-2">
      <button type="button" onClick={onClose} className="tool-button shrink-0" aria-label="Close Review"><X size={17} /></button>
      <div className="min-w-0 flex-1 text-center">
        <p className="truncate text-ui-body font-semibold text-ink">Trade Review</p>
        <p className="truncate text-ui-meta text-dim">{sourceTitle}</p>
      </div>
      <button type="button" onClick={() => onDetachChange(!detached)} className="tool-button shrink-0" aria-label={detached ? 'Return Review to sidebar' : 'Detach Review window'} title={detached ? 'Return to sidebar' : 'Open in a separate window'}>{detached ? <Minimize2 size={16} /> : <ExternalLink size={16} />}</button>
    </header>
  )
}

function TradeList({ trades, selectedId, onSelect, timezone }: { trades: ReviewTrade[]; selectedId: string | null; onSelect: (id: string) => void; timezone: ChartTimezone }): ReactElement {
  const [query, setQuery] = useState('')
  const normalized = query.trim().toLocaleLowerCase()
  const filtered = trades.filter((trade) => `${trade.symbol} ${trade.side} ${pnlLabel(trade.realizedCents)}`.toLocaleLowerCase().includes(normalized))
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-3">
        <label className="relative block">
          <span className="sr-only">Search trades</span>
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbol, side, or P&L" className="field-input h-10 w-full pl-10 font-sans text-ui-control" />
        </label>
      </div>
      <div className="flex items-center justify-between border-y border-line px-3 py-2 text-ui-meta"><span className="font-semibold tracking-[0.04em] text-muted">CLOSED TRADES</span><span className="font-mono text-dim">{filtered.length}</span></div>
      {filtered.length ? (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto" aria-label="Trade Review history">
          {filtered.map((trade) => (
            <li key={trade.id}>
              <button type="button" onClick={() => onSelect(trade.id)} aria-current={selectedId === trade.id ? 'true' : undefined} className="grid min-h-14 w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 px-3 py-2 text-left transition-colors hover:bg-surface-2 aria-[current=true]:bg-surface-3">
                <FileText size={15} className="row-span-2 text-[#8bb9d1]" />
                <strong className="min-w-0 truncate text-ui-control font-semibold text-ink">{trade.symbol}, {trade.side === 'long' ? 'buy' : 'sell'}</strong>
                <span className={`shrink-0 justify-self-end rounded-[12px] px-2 py-0.5 font-mono text-ui-meta font-semibold ${trade.realizedCents >= 0 ? 'bg-profit/25 text-profit-bright' : 'bg-loss/20 text-loss-bright'}`}>{pnlLabel(trade.realizedCents)}</span>
                <span className="font-mono text-ui-meta text-dim">{trade.rMultiple === null ? 'R —' : `${trade.rMultiple.toFixed(2)}R`}</span>
                <time dateTime={new Date(trade.exitTs * 1000).toISOString()} className="whitespace-nowrap font-mono text-[11px] leading-4 text-[#8fc5df]">{formatChartTime(trade.exitTs, timezone)}</time>
              </button>
            </li>
          ))}
        </ul>
      ) : <div className="grid min-h-0 flex-1 place-items-center px-6 text-center"><div><Search size={22} className="mx-auto text-dim" /><p className="mt-3 text-ui-body font-medium text-ink">No matching trades</p><p className="mt-1 text-ui-meta text-dim">Try a symbol, side, or P&amp;L amount.</p></div></div>}
    </div>
  )
}

function shiftMonth(value: string, delta: number): string {
  const [year, month] = value.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1 + delta, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
}

function TradeCalendar({ trades, onSelect, timezone }: { trades: ReviewTrade[]; onSelect: (id: string) => void; timezone: ChartTimezone }): ReactElement {
  const latestTs = trades[0]?.exitTs ?? Math.floor(Date.now() / 1000)
  const [month, setMonth] = useState(() => chartTimezoneDateValue(latestTs, timezone).slice(0, 7))
  useEffect(() => setMonth(chartTimezoneDateValue(latestTs, timezone).slice(0, 7)), [latestTs, timezone])
  const grouped = useMemo(() => {
    const map = new Map<number, ReviewTrade[]>()
    for (const trade of trades) {
      const date = chartTimezoneDateValue(trade.exitTs, timezone)
      if (!date.startsWith(month)) continue
      const day = Number(date.slice(8, 10))
      map.set(day, [...(map.get(day) ?? []), trade])
    }
    return map
  }, [month, timezone, trades])
  const daysWithTrades = [...grouped.entries()].sort(([left], [right]) => right - left)
  const monthDate = new Date(`${month}-01T12:00:00Z`)
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-2">
      <div className="flex h-11 shrink-0 items-center justify-between px-3"><button type="button" onClick={() => setMonth((value) => shiftMonth(value, -1))} className="tool-button" aria-label="Previous month"><ChevronLeft size={16} /></button><strong className="text-ui-control font-semibold text-ink">{monthTitle.format(monthDate)}</strong><button type="button" onClick={() => setMonth((value) => shiftMonth(value, 1))} className="tool-button" aria-label="Next month"><ChevronRight size={16} /></button></div>
      {daysWithTrades.length ? (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto border-t border-line" aria-label={`Trade days in ${monthTitle.format(monthDate)}`}>
          {daysWithTrades.map(([day, dayTrades]) => {
            const date = new Date(`${month}-${String(day).padStart(2, '0')}T12:00:00Z`)
            const pnl = dayTrades.reduce((sum, trade) => sum + trade.realizedCents, 0)
            const latestTrade = dayTrades.toSorted((left, right) => right.exitTs - left.exitTs)[0]
            return (
              <li key={day}>
                <button type="button" onClick={() => latestTrade && onSelect(latestTrade.id)} aria-label={`${calendarDate.format(date)}, ${dayTrades.length} closed trade${dayTrades.length === 1 ? '' : 's'}, ${pnlLabel(pnl)}`} className="grid min-h-16 w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left hover:bg-surface-2">
                  <span className="grid h-11 place-items-center rounded-control border border-line-strong bg-surface-2"><span className="text-ui-meta text-muted">{calendarWeekday.format(date)}</span><strong className="-mt-1 font-mono text-ui-control text-ink">{day}</strong></span>
                  <span className="min-w-0"><strong className="block truncate text-ui-body font-medium text-ink">{calendarDate.format(date)}</strong><span className="mt-0.5 block text-ui-meta text-muted">{dayTrades.length} closed trade{dayTrades.length === 1 ? '' : 's'}</span></span>
                  <span className="flex shrink-0 items-center gap-1.5"><span className={`font-mono text-ui-meta font-semibold ${pnl >= 0 ? 'text-profit-bright' : 'text-loss-bright'}`}>{pnlLabel(pnl)}</span><ChevronRight size={14} className="text-dim" /></span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : <div className="grid min-h-0 flex-1 place-items-center border-t border-line px-6 text-center"><div><CalendarDays size={22} className="mx-auto text-dim" /><p className="mt-3 text-ui-body font-medium text-ink">No trades this month</p><p className="mt-1 text-ui-meta text-dim">Use the arrows to review another month.</p></div></div>}
    </div>
  )
}

function EmptyReview({ status, error }: { status: 'idle' | 'loading' | 'success' | 'error'; error: string | null }): ReactElement {
  return <div className="grid min-h-0 flex-1 place-items-center px-6 text-center"><div><ClipboardCheck size={26} className="mx-auto text-dim" /><p className="mt-3 text-ui-control font-semibold text-ink">{status === 'loading' ? 'Loading trade history…' : status === 'error' ? 'Review unavailable' : 'No trades to review'}</p><p className={`mx-auto mt-1 max-w-xs text-ui-body leading-5 ${status === 'error' ? 'text-loss-bright' : 'text-dim'}`}>{error ?? 'Start or open a replay Session or Eval account. Closed trades will appear here automatically.'}</p></div></div>
}

function TradeEditor({ trade, trades, onBack, onNavigate, detached, timezone }: { trade: ReviewTrade; trades: ReviewTrade[]; onBack: () => void; onNavigate: (tradeId: string) => void; detached: boolean; timezone: ChartTimezone }): ReactElement {
  const symbols = useReplaySelector((snapshot) => snapshot.symbols)
  const key = reviewDocumentKey(trade.sourceType, trade.sourceId, trade.id)
  const document = useReviewStore((state) => state.documents[key])
  const setNote = useReviewStore((state) => state.setNote)
  const addScreenshot = useReviewStore((state) => state.addScreenshot)
  const removeScreenshot = useReviewStore((state) => state.removeScreenshot)
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const [captureState, setCaptureState] = useState<'idle' | 'capturing' | 'error'>('idle')
  const index = trades.findIndex((item) => item.id === trade.id)
  const note = document?.note ?? ''
  const insertTemplate = (): void => setNote(key, reviewTradeSnapshot(trade), ['## Trade thesis', '', '- Setup:', '- Entry trigger:', '- Invalidation:', '', '## Execution review', '', '- What went well:', '- What to improve:', ''].join('\n'))
  const screenshot = async (): Promise<void> => {
    setCaptureState('capturing')
    try {
      const dataUrl = await captureActiveChart()
      addScreenshot(key, reviewTradeSnapshot(trade), { id: crypto.randomUUID(), dataUrl, capturedAt: Date.now() })
      setCaptureState('idle')
    } catch {
      setCaptureState('error')
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-2">
        <button type="button" onClick={onBack} className="secondary-button min-h-8 px-2.5"><ArrowLeft size={14} />All trades</button>
        <span className="min-w-0 flex-1 truncate text-ui-meta text-muted">Modified {document ? formatChartTime(document.updatedAt / 1000, timezone) : '—'}</span>
        <button type="button" disabled={index >= trades.length - 1} onClick={() => trades[index + 1] && onNavigate(trades[index + 1].id)} className="tool-button" aria-label="Previous trade"><ChevronLeft size={16} /></button>
        <button type="button" disabled={index <= 0} onClick={() => trades[index - 1] && onNavigate(trades[index - 1].id)} className="tool-button" aria-label="Next trade"><ChevronRight size={16} /></button>
      </div>
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
        <h2 className="min-w-0 truncate text-ui-title font-semibold text-ink">{trade.symbol}, {trade.side === 'long' ? 'buy' : 'sell'} <span className="ml-1 font-mono text-ui-meta text-muted">{formatChartTime(trade.exitTs, timezone)}</span></h2>
        <span className={`shrink-0 rounded-[12px] px-2.5 py-1 font-mono text-ui-meta font-semibold ${trade.realizedCents >= 0 ? 'bg-profit/25 text-profit-bright' : 'bg-loss/20 text-loss-bright'}`}>{pnlLabel(trade.realizedCents)}</span>
      </div>
      <section className={`flex min-h-[260px] flex-1 flex-col overflow-hidden ${detached ? 'lg:min-h-[440px]' : ''}`} aria-label="Markdown trade note">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
          <span className="text-ui-meta text-dim">Markdown supported</span>
          <div className="flex rounded-control bg-surface-2 p-0.5"><button type="button" onClick={() => setMode('write')} aria-pressed={mode === 'write'} className="rounded-control px-2.5 py-1 text-ui-meta text-muted aria-pressed:bg-surface-3 aria-pressed:text-ink">Write</button><button type="button" onClick={() => setMode('preview')} aria-pressed={mode === 'preview'} className="rounded-control px-2.5 py-1 text-ui-meta text-muted aria-pressed:bg-surface-3 aria-pressed:text-ink">Preview</button></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {document?.screenshots.length ? <div className="mb-4 grid gap-3 xl:grid-cols-2">{document.screenshots.map((item) => <figure key={item.id} className="group relative overflow-hidden rounded-panel border-2 border-active bg-chart"><img src={item.dataUrl} alt={`Chart captured ${formatChartTime(item.capturedAt / 1000, timezone)}`} className="block h-auto w-full" /><button type="button" onClick={() => removeScreenshot(key, item.id)} className="absolute right-2 top-2 hidden size-8 place-items-center rounded-control bg-surface-0/90 text-muted shadow-overlay hover:text-loss-bright group-hover:grid focus:grid" aria-label="Remove chart screenshot"><X size={14} /></button></figure>)}</div> : null}
          {mode === 'write' ? <textarea autoFocus value={note} onChange={(event) => setNote(key, reviewTradeSnapshot(trade), event.target.value)} placeholder="Enter your review in Markdown. Type / for commands…" className="min-h-[220px] w-full resize-none bg-transparent text-ui-control leading-6 text-ink outline-none placeholder:italic placeholder:text-dim" aria-label="Trade review Markdown" /> : note ? <MarkdownPreview markdown={note} /> : <p className="italic text-ui-control text-dim">Nothing to preview yet.</p>}
        </div>
        <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-t border-line px-3">
          <button type="button" onClick={() => void screenshot()} disabled={captureState === 'capturing'} className="secondary-button min-h-9"><Camera size={15} />{captureState === 'capturing' ? 'Capturing…' : 'Screenshot chart'}</button>
          <button type="button" onClick={insertTemplate} className="secondary-button min-h-9"><FileText size={15} />Template</button>
          {captureState === 'error' ? <span role="alert" className="text-ui-meta text-loss-bright">Chart capture failed. Make sure the chart is visible.</span> : null}
        </div>
      </section>
      <ReviewMetadata trade={trade} symbols={symbols} timezone={timezone} />
    </div>
  )
}

interface ReviewSurfaceProps {
  detached: boolean
  onClose: () => void
  onDetachChange: (detached: boolean) => void
  view: 'trades' | 'calendar'
  onViewChange: (view: 'trades' | 'calendar') => void
  selectedId: string | null
  onSelectedIdChange: (tradeId: string | null) => void
}

function ReviewSurface({ detached, onClose, onDetachChange, view, onViewChange, selectedId, onSelectedIdChange }: ReviewSurfaceProps): ReactElement {
  const { state: chartWorkspace } = useChartWorkspace()
  const review = useReviewTrades()
  const selected = review.trades.find((trade) => trade.id === selectedId) ?? null
  useEffect(() => {
    if (selectedId && !review.trades.some((trade) => trade.id === selectedId)) onSelectedIdChange(null)
  }, [onSelectedIdChange, review.trades, selectedId])
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-0 text-ink">
      <ReviewHeader sourceTitle={review.source?.title ?? 'No source selected'} detached={detached} onClose={onClose} onDetachChange={onDetachChange} />
      {selected ? <TradeEditor trade={selected} trades={review.trades} onBack={() => onSelectedIdChange(null)} onNavigate={onSelectedIdChange} detached={detached} timezone={chartWorkspace.timezone} /> : (
        <>
          <nav className="mx-auto mt-2 flex w-[min(11rem,calc(100%-1rem))] shrink-0 rounded-panel border border-line-strong bg-surface-0 p-0.5" aria-label="Review history view">
            <button type="button" onClick={() => onViewChange('trades')} aria-pressed={view === 'trades'} className="flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-control text-ui-body text-muted aria-pressed:bg-surface-3 aria-pressed:font-semibold aria-pressed:text-ink"><List size={14} />Trades</button>
            <button type="button" onClick={() => onViewChange('calendar')} aria-pressed={view === 'calendar'} className="flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-control text-ui-body text-muted aria-pressed:bg-surface-3 aria-pressed:font-semibold aria-pressed:text-ink"><CalendarDays size={14} />Calendar</button>
          </nav>
          {review.status !== 'success' || review.trades.length === 0 ? <EmptyReview status={review.status} error={review.error} /> : view === 'trades' ? <TradeList trades={review.trades} selectedId={selectedId} onSelect={onSelectedIdChange} timezone={chartWorkspace.timezone} /> : <TradeCalendar trades={review.trades} onSelect={onSelectedIdChange} timezone={chartWorkspace.timezone} />}
        </>
      )}
    </div>
  )
}

export function ReviewPanel(): ReactElement {
  const source = useUiStore((state) => state.reviewSource)
  const setSidebarTab = useUiStore((state) => state.setSidebarTab)
  const [popout, setPopout] = useState<ChartPopoutTarget | null>(null)
  const [popoutBlocked, setPopoutBlocked] = useState(false)
  const [view, setView] = useState<'trades' | 'calendar'>('trades')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const closeReview = (): void => {
    setPopout(null)
    setSidebarTab(source?.type === 'evaluation' ? 'evaluation' : 'sessions')
  }
  const setDetached = (detached: boolean): void => {
    if (!detached) {
      setPopout(null)
      setPopoutBlocked(false)
      setSidebarTab('review')
      return
    }
    const target = openWorkspacePopout('trade-review', 'Trade Review', { width: 720, height: 900 })
    if (!target) {
      setPopoutBlocked(true)
      return
    }
    setPopoutBlocked(false)
    setPopout(target)
  }
  const surface = (
    <ReviewSurface
      detached={popout !== null}
      onClose={closeReview}
      onDetachChange={setDetached}
      view={view}
      onViewChange={setView}
      selectedId={selectedId}
      onSelectedIdChange={setSelectedId}
    />
  )

  return (
    <div className="relative h-full min-h-0">
      {popout ? (
        <>
          <div className="grid h-full place-items-center px-5 text-center">
            <div>
              <ExternalLink size={22} className="mx-auto text-active-bright" />
              <p className="mt-3 text-ui-body font-semibold text-ink">Review is detached</p>
              <p className="mt-1 text-ui-meta leading-5 text-muted">Continue reviewing in the separate browser window.</p>
              <div className="mt-4 flex justify-center gap-2">
                <button type="button" onClick={() => popout.window.focus()} className="secondary-button">Focus window</button>
                <button type="button" onClick={() => setDetached(false)} className="secondary-button">Return here</button>
              </div>
            </div>
          </div>
          <ChartPopoutWindow target={popout} onClose={() => setPopout(null)}>{surface}</ChartPopoutWindow>
        </>
      ) : surface}
      {popoutBlocked ? <p role="alert" className="absolute bottom-3 left-3 right-3 rounded-control border border-loss/40 bg-surface-2 px-3 py-2 text-ui-meta text-loss-bright">The browser blocked the Review window. Allow pop-ups, then try again.</p> : null}
    </div>
  )
}
