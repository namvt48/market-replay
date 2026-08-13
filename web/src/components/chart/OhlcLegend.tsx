import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { useHoverBar, type HoverBarStore } from '../../replay/hover-bar-store'

interface OhlcLegendProps {
  store: HoverBarStore
  precision: number
}

export function OhlcLegend({ store, precision }: OhlcLegendProps): ReactElement {
  const bar = useHoverBar(store)
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(true)
  const hasBar = bar !== null

  useLayoutEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return

    const syncVisibility = (): void => {
      const nextFits = content.scrollWidth <= container.clientWidth
      setFits((current) => current === nextFits ? current : nextFits)
    }

    syncVisibility()
    if (typeof ResizeObserver === 'undefined') return
    const resizeObserver = new ResizeObserver(syncVisibility)
    resizeObserver.observe(container)
    resizeObserver.observe(content)
    return () => resizeObserver.disconnect()
  }, [hasBar, precision])

  if (!bar) return <div className="h-7 min-w-0 flex-1" aria-label="OHLC unavailable" />
  const change = bar.close - bar.open
  const percent = bar.open === 0 ? null : change / bar.open * 100
  const sign = change >= 0 ? '+' : ''
  return (
    <div ref={containerRef} className="pointer-events-none h-7 min-w-0 flex-1 overflow-hidden" aria-label="OHLC values" aria-hidden={fits ? undefined : true} data-overflowing={fits ? 'false' : 'true'}>
      <div ref={contentRef} className={`flex w-max flex-nowrap items-center gap-x-2 whitespace-nowrap font-mono text-ui-meta tabular-nums ${fits ? '' : 'invisible'} ${bar.hovered ? 'text-ink' : 'text-dim'}`}>
        <span className="text-muted">O <b className="font-normal text-inherit">{bar.open.toFixed(precision)}</b></span>
        <span className="text-muted">H <b className="font-normal text-inherit">{bar.high.toFixed(precision)}</b></span>
        <span className="text-muted">L <b className="font-normal text-inherit">{bar.low.toFixed(precision)}</b></span>
        <span className="text-muted">C <b className="font-normal text-inherit">{bar.close.toFixed(precision)}</b></span>
        <span className={change > 0 ? 'text-profit-bright' : change < 0 ? 'text-loss-bright' : 'text-muted'}>{sign}{change.toFixed(precision)} ({percent === null ? '—' : `${sign}${percent.toFixed(2)}%`})</span>
        {!bar.hovered ? <span className="font-sans text-ui-meta text-dim">latest</span> : null}
      </div>
    </div>
  )
}
