import { Check, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { SymbolMeta } from '../../api/types'

type SymbolCategory = 'All' | 'Stocks' | 'Funds' | 'Futures' | 'Forex' | 'Crypto' | 'Indices' | 'Bonds' | 'Economy' | 'Options'

const CATEGORIES: readonly SymbolCategory[] = ['All', 'Stocks', 'Funds', 'Futures', 'Forex', 'Crypto', 'Indices', 'Bonds', 'Economy', 'Options']

const CATEGORY_KINDS: Record<Exclude<SymbolCategory, 'All'>, readonly string[]> = {
  Stocks: ['stock', 'equity'],
  Funds: ['fund', 'etf'],
  Futures: ['future', 'futures'],
  Forex: ['forex', 'fx'],
  Crypto: ['crypto', 'swap'],
  Indices: ['index', 'indices'],
  Bonds: ['bond'],
  Economy: ['economy', 'economic'],
  Options: ['option'],
}

interface SymbolBrowserDialogProps {
  symbols: readonly SymbolMeta[]
  activeSymbol: string
  initialQuery?: string
  onSelect: (symbol: SymbolMeta) => void
  onClose: () => void
}

function categoryMatches(symbol: SymbolMeta, category: SymbolCategory): boolean {
  if (category === 'All') return true
  const kind = symbol.kind.toLowerCase()
  return CATEGORY_KINDS[category].some((candidate) => kind.includes(candidate))
}

function symbolAccent(kind: string): string {
  const normalized = kind.toLowerCase()
  if (normalized.includes('future')) return 'bg-sky-500 text-white'
  if (normalized.includes('crypto') || normalized.includes('swap')) return 'bg-amber-400 text-black'
  if (normalized.includes('stock') || normalized.includes('equity')) return 'bg-emerald-500 text-white'
  return 'bg-surface-3 text-ink'
}

export function SymbolBrowserDialog({ symbols, activeSymbol, initialQuery = '', onSelect, onClose }: SymbolBrowserDialogProps): ReactElement {
  const [query, setQuery] = useState(initialQuery)
  const [category, setCategory] = useState<SymbolCategory>('All')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return symbols.filter((symbol) => categoryMatches(symbol, category) && (!normalized || `${symbol.symbol} ${symbol.name} ${symbol.kind} ${symbol.currency}`.toLowerCase().includes(normalized)))
  }, [category, query, symbols])

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    searchRef.current?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => setFocusedIndex(0), [category, query])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); setFocusedIndex((index) => Math.min(index + 1, Math.max(0, matches.length - 1))); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); setFocusedIndex((index) => Math.max(0, index - 1)); return }
    if (event.key === 'Enter' && matches[focusedIndex]) { event.preventDefault(); onSelect(matches[focusedIndex]); return }
    if (event.key !== 'Tab') return
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
    const first = items[0]
    const last = items.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-stretch justify-center bg-black/70 p-0 sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="symbol-browser-title" onKeyDown={handleKeyDown} className="flex h-full w-full flex-col overflow-hidden bg-[#171819] shadow-overlay sm:h-[min(43rem,82dvh)] sm:w-[min(52rem,calc(100vw-2rem))] sm:rounded-panel sm:border sm:border-line-strong">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-3 sm:px-4">
          <Search size={17} className="shrink-0 text-muted" aria-hidden="true" />
          <h2 id="symbol-browser-title" className="sr-only">Symbol search</h2>
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search symbols" placeholder="Search symbol or name" className="h-full min-w-0 flex-1 bg-transparent text-ui-title text-ink outline-none placeholder:text-dim focus-visible:!outline-none" />
          <kbd className="hidden rounded-[4px] border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-ui-meta text-dim sm:inline">ESC</kbd>
          <button type="button" onClick={onClose} className="tool-button sm:hidden" aria-label="Close symbol search"><X size={17} /></button>
        </header>
        <nav aria-label="Symbol categories" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-2 [scrollbar-width:none]">
          {CATEGORIES.map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className="h-7 shrink-0 rounded-full bg-surface-2 px-3 text-ui-control text-muted transition-colors hover:text-ink aria-pressed:bg-ink aria-pressed:text-surface-0">{item}</button>)}
        </nav>
        <div className="grid h-7 shrink-0 grid-cols-[minmax(5rem,0.8fr)_minmax(0,1.5fr)] items-center border-b border-line px-3 text-ui-meta text-dim sm:grid-cols-[minmax(7rem,0.8fr)_minmax(12rem,1.7fr)_minmax(7rem,0.8fr)] sm:px-4">
          <span>Symbol</span><span>Name</span><span className="hidden text-right sm:block">Market</span>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {matches.map((symbol, index) => (
            <li key={symbol.symbol} className="border-b border-line last:border-0">
              <button type="button" aria-label={`Select ${symbol.symbol}, ${symbol.name}`} tabIndex={index === focusedIndex ? 0 : -1} onMouseMove={() => setFocusedIndex(index)} onClick={() => onSelect(symbol)} className={`grid min-h-10 w-full grid-cols-[minmax(5rem,0.8fr)_minmax(0,1.5fr)] items-center gap-2 px-3 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none sm:grid-cols-[minmax(7rem,0.8fr)_minmax(12rem,1.7fr)_minmax(7rem,0.8fr)] sm:px-4 ${index === focusedIndex ? 'bg-surface-2/70' : ''}`}>
                <span className="flex min-w-0 items-center gap-2"><span className={`grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-bold ${symbolAccent(symbol.kind)}`} aria-hidden="true">{symbol.symbol.slice(0, 1)}</span><strong className="truncate text-ui-body font-medium text-ink">{symbol.symbol}</strong></span>
                <span className="truncate text-ui-body text-ink">{symbol.name}</span>
                <span className="hidden min-w-0 items-center justify-end gap-2 sm:flex"><span className="truncate text-ui-meta text-dim">{symbol.kind} · {symbol.currency}</span>{symbol.symbol === activeSymbol ? <Check size={13} className="shrink-0 text-active-bright" aria-label="Current symbol" /> : null}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 ? <li className="grid min-h-40 place-items-center px-4 text-center text-ui-body text-dim">No symbols match this search.</li> : null}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
