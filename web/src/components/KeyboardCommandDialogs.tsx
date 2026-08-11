import { CalendarDays, Check, CircleSlash2, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { HotkeyDialogState, ShortcutCategory } from '../hooks/tradingview-shortcuts'
import { TRADINGVIEW_SHORTCUTS } from '../hooks/tradingview-shortcuts'
import { replayEngine } from '../replay/replay-engine'
import { sessionDateValue, sessionOpenTimestamp } from '../replay/session-date'
import { normalizeTimeframe } from '../replay/timeframe'
import { BUILT_IN_TIMEFRAMES, timeframePreferenceStore } from '../replay/timeframe-preferences'
import { useReplaySelector } from '../replay/use-replay'
import { useEvalStore } from '../store/eval-store'
import { useUiStore } from '../store/ui-store'

interface KeyboardCommandDialogsProps {
  state: HotkeyDialogState | null
  onClose: () => void
}

interface DialogFrameProps {
  title: string
  description: string
  children: ReactNode
  onClose: () => void
}

const CATEGORIES: readonly ShortcutCategory[] = ['Chart', 'Drawings', 'Multi-chart', 'Trading', 'Market Replay']

function trapFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab') return
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
  if (items.length === 0) return
  const first = items[0]
  const last = items.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function DialogFrame({ title, description, children, onClose }: DialogFrameProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    const initialTarget = dialog?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
      ?? dialog?.querySelector<HTMLElement>('button:not(:disabled), [tabindex="0"]')
    initialTarget?.focus()
  }, [])
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="keyboard-dialog-title" aria-describedby="keyboard-dialog-description" tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); return }; trapFocus(event) }} className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-panel border border-line-strong bg-[#111214] shadow-overlay sm:w-[min(46rem,calc(100vw-2rem))] sm:rounded-panel">
        <header className="flex shrink-0 items-start justify-between border-b border-line px-4 py-3">
          <div className="min-w-0"><h2 id="keyboard-dialog-title" className="text-ui-title font-semibold text-ink">{title}</h2><p id="keyboard-dialog-description" className="mt-0.5 text-ui-meta text-dim">{description}</p></div>
          <button type="button" onClick={onClose} className="tool-button -mr-1" aria-label={`Close ${title}`}><X size={16} /></button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  )
}

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const normalized = query.trim().toLowerCase()
  const shortcuts = normalized
    ? TRADINGVIEW_SHORTCUTS.filter((shortcut) => `${shortcut.action} ${shortcut.keys.join(' ')} ${shortcut.note ?? ''}`.toLowerCase().includes(normalized))
    : TRADINGVIEW_SHORTCUTS
  const supported = TRADINGVIEW_SHORTCUTS.filter((shortcut) => shortcut.support !== 'unavailable').length
  return (
    <DialogFrame title="Keyboard shortcuts" description={`${supported} TradingView-compatible actions enabled · product-specific gaps are listed explicitly`} onClose={onClose}>
      <div className="shrink-0 border-b border-line p-3">
        <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" size={14} /><span className="sr-only">Search shortcuts</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search action or key…" className="field-input h-9 w-full pl-9" /></label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {CATEGORIES.map((category) => {
          const entries = shortcuts.filter((shortcut) => shortcut.category === category)
          if (entries.length === 0) return null
          return (
            <section key={category} className="mb-5 last:mb-0">
              <h3 className="mb-2 text-ui-meta font-semibold tracking-[0.06em] text-muted">{category.toUpperCase()}</h3>
              <ul className="overflow-hidden rounded-control border border-line">
                {entries.map((shortcut) => (
                  <li key={shortcut.id} className="grid gap-1 border-b border-line px-3 py-2.5 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-ui-body text-ink">{shortcut.support === 'unavailable' ? <CircleSlash2 size={13} className="shrink-0 text-dim" /> : <Check size={13} className="shrink-0 text-profit-bright" />}<span>{shortcut.action}</span>{shortcut.support === 'adapted' ? <span className="rounded-[3px] bg-active/10 px-1.5 py-0.5 text-[10px] font-semibold text-active-bright">ADAPTED</span> : null}</div>
                      {shortcut.note ? <p className="mt-1 pl-5 text-ui-meta leading-relaxed text-dim">{shortcut.note}</p> : null}
                    </div>
                    <div className="flex flex-wrap gap-1 pl-5 sm:justify-end sm:pl-0">{shortcut.keys.map((key) => <kbd key={key} className="rounded-[3px] border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-ui-meta text-muted">{key}</kbd>)}</div>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </DialogFrame>
  )
}

function SymbolSearch({ initialQuery, onClose }: { initialQuery: string; onClose: () => void }) {
  const replay = useReplaySelector((snapshot) => ({ symbols: snapshot.symbols, symbol: snapshot.symbol?.symbol ?? '' }))
  const evalLocked = useEvalStore((store) => store.phase === 'running')
  const [query, setQuery] = useState(initialQuery)
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return replay.symbols.filter((symbol) => !normalized || `${symbol.symbol} ${symbol.name}`.toLowerCase().includes(normalized)).slice(0, 20)
  }, [query, replay.symbols])
  const choose = (symbol: string): void => { if (!evalLocked) void replayEngine.selectSymbol(symbol); onClose() }
  return (
    <DialogFrame title="Quick symbol search" description="TradingView: Ctrl/⌘+K or start typing a ticker" onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); const first = matches[0]; if (first) choose(first.symbol) }}>
        <label className="relative block border-b border-line p-3"><Search className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-dim" size={15} /><span className="sr-only">Symbol</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="NQ, ES…" className="field-input h-10 w-full pl-9 font-mono" /></label>
        {evalLocked ? <p role="status" className="border-b border-loss/20 bg-loss/8 px-4 py-2 text-ui-meta text-loss-bright">Symbol is locked during an evaluation.</p> : null}
        <ul className="max-h-80 overflow-y-auto p-2">
          {matches.map((symbol, index) => <li key={symbol.symbol}><button type="button" disabled={evalLocked} onClick={() => choose(symbol.symbol)} className="flex h-10 w-full items-center justify-between rounded-control px-3 text-left hover:bg-surface-2 focus-visible:bg-surface-2 disabled:opacity-40"><span><strong className="font-mono text-ui-body text-ink">{symbol.symbol}</strong><span className="ml-2 text-ui-meta text-dim">{symbol.name}</span></span>{symbol.symbol === replay.symbol ? <span className="text-ui-meta text-active-bright">Current</span> : index === 0 ? <kbd className="font-mono text-ui-meta text-dim">Enter</kbd> : null}</button></li>)}
          {matches.length === 0 ? <li className="px-3 py-8 text-center text-ui-body text-dim">No matching replay symbol</li> : null}
        </ul>
      </form>
    </DialogFrame>
  )
}

function IntervalSearch({ initialQuery, onClose }: { initialQuery: string; onClose: () => void }) {
  const setActiveTf = useUiStore((store) => store.setActiveTf)
  const [query, setQuery] = useState(initialQuery)
  const [error, setError] = useState<string | null>(null)
  const normalized = normalizeTimeframe(/^\d+$/.test(query.trim()) ? `${query.trim()}m` : query.trim())
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!normalized) { setError('Use a number for minutes, or suffix h, d, w, M'); return }
    const preferences = timeframePreferenceStore.getSnapshot()
    if (!BUILT_IN_TIMEFRAMES.includes(normalized) && !preferences.customTimeframes.includes(normalized)) {
      const result = timeframePreferenceStore.addCustom(normalized)
      if (!result.ok) { setError(result.error); return }
    }
    setActiveTf(normalized)
    onClose()
  }
  return (
    <DialogFrame title="Change interval" description="TradingView: start typing a number, or press comma" onClose={onClose}>
      <form onSubmit={submit} className="p-4">
        <label className="text-ui-meta font-medium text-muted">Interval<input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setError(null) }} placeholder="5, 15, 1h, 1d…" className="field-input mt-1.5 h-10 w-full font-mono" aria-invalid={error ? true : undefined} /></label>
        <div className="mt-3 flex items-center justify-between gap-3"><p className={`text-ui-meta ${error ? 'text-loss-bright' : 'text-dim'}`}>{error ?? (normalized ? `Switch active chart to ${normalized}` : 'A bare number means minutes.')}</p><button type="submit" disabled={!normalized} className="primary-button shrink-0">Apply</button></div>
      </form>
    </DialogFrame>
  )
}

function GoToDate({ onClose }: { onClose: () => void }) {
  const replay = useReplaySelector((snapshot) => ({ sessionTz: snapshot.symbol?.sessionTz ?? 'UTC', cursorTs: snapshot.cursorTs }))
  const [date, setDate] = useState(replay.cursorTs ? sessionDateValue(replay.cursorTs, replay.sessionTz) : '')
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const timestamp = sessionOpenTimestamp(date, replay.sessionTz)
    if (timestamp === null) return
    void replayEngine.seek(timestamp)
    onClose()
  }
  return (
    <DialogFrame title="Go to date" description={`Session timezone: ${replay.sessionTz}`} onClose={onClose}>
      <form onSubmit={submit} className="p-4">
        <label className="text-ui-meta font-medium text-muted"><span className="flex items-center gap-1.5"><CalendarDays size={13} />Date</span><input autoFocus type="date" value={date} onChange={(event) => setDate(event.target.value)} className="field-input mt-1.5 h-10 w-full" /></label>
        <div className="mt-4 flex justify-end"><button type="submit" disabled={!date} className="primary-button">Go to date</button></div>
      </form>
    </DialogFrame>
  )
}

export function KeyboardCommandDialogs({ state, onClose }: KeyboardCommandDialogsProps) {
  if (!state) return null
  if (state.type === 'shortcuts') return <ShortcutHelp onClose={onClose} />
  if (state.type === 'symbol') return <SymbolSearch key={`symbol-${state.query}`} initialQuery={state.query} onClose={onClose} />
  if (state.type === 'interval') return <IntervalSearch key={`interval-${state.query}`} initialQuery={state.query} onClose={onClose} />
  return <GoToDate onClose={onClose} />
}
