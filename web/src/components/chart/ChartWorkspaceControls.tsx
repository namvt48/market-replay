import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useChartWorkspace } from '../../chart-workspace/use-chart-workspace'
import { useDismissableLayer, type DismissReason } from '../../hooks/use-dismissable-layer'

const MARKET_SESSIONS = [
  { value: 'rth', label: 'RTH', accessibleLabel: 'Regular trading hours (RTH)', title: 'RTH · Show 09:30–16:00 in the symbol timezone' },
  { value: 'eth', label: 'ETH', accessibleLabel: 'Electronic trading hours (ETH)', title: 'ETH · Show the full electronic session' },
] as const

interface SessionMenuPosition {
  left: number
  top: number
}

export function ChartWorkspaceControls(): ReactElement {
  const { state, dispatch } = useChartWorkspace()
  const [sessionMenuOpen, setSessionMenuOpen] = useState<boolean>(false)
  const [sessionMenuPosition, setSessionMenuPosition] = useState<SessionMenuPosition | null>(null)
  const sessionTriggerRef = useRef<HTMLButtonElement>(null)
  const sessionMenuRef = useRef<HTMLDivElement>(null)

  const activeSession = MARKET_SESSIONS.find(({ value }) => value === state.marketSession) ?? MARKET_SESSIONS[1]

  const dismissSessionMenu = useCallback((reason: DismissReason): void => {
    setSessionMenuOpen(false)
    if (reason === 'escape') queueMicrotask(() => sessionTriggerRef.current?.focus())
  }, [])

  useDismissableLayer({
    open: sessionMenuOpen,
    layerRef: sessionMenuRef,
    additionalRefs: [sessionTriggerRef],
    onDismiss: dismissSessionMenu,
  })

  useEffect(() => {
    if (!sessionMenuOpen) return
    queueMicrotask(() => sessionMenuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
  }, [sessionMenuOpen])

  useEffect(() => {
    if (!sessionMenuOpen) return
    const updatePosition = (): void => {
      const rect = sessionTriggerRef.current?.getBoundingClientRect()
      if (!rect) return
      setSessionMenuPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 112)),
        top: rect.bottom + 6,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [sessionMenuOpen])

  const selectMarketSession = (marketSession: 'eth' | 'rth'): void => {
    if (marketSession !== state.marketSession) dispatch({ type: 'set-market-session', marketSession })
    setSessionMenuOpen(false)
    queueMicrotask(() => sessionTriggerRef.current?.focus())
  }

  const toggleSessionMenu = (): void => {
    if (sessionMenuOpen) {
      setSessionMenuOpen(false)
      return
    }
    const rect = sessionTriggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setSessionMenuPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 112)),
      top: rect.bottom + 6,
    })
    setSessionMenuOpen(true)
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5" aria-label="Shared chart controls">
      <div className="relative shrink-0">
        <button
          ref={sessionTriggerRef}
          type="button"
          onClick={toggleSessionMenu}
          aria-label={`Market session: ${activeSession.accessibleLabel}`}
          aria-haspopup="listbox"
          aria-expanded={sessionMenuOpen}
          title={activeSession.title}
          className={`topbar-control flex h-7 min-w-[4.25rem] items-center justify-between gap-2 rounded-control border px-2.5 font-mono text-ui-meta font-semibold transition-[border-color,background-color,color] duration-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-active ${sessionMenuOpen ? 'border-line-strong bg-surface-2 text-ink' : 'border-line bg-surface-1 text-ink hover:border-line-strong hover:bg-surface-2'}`}
        >
          <span>{activeSession.label}</span>
          <ChevronDown aria-hidden="true" className={`text-muted transition-transform duration-100 ${sessionMenuOpen ? 'rotate-180' : ''}`} size={12} strokeWidth={2} />
        </button>
      </div>

      {sessionMenuOpen && sessionMenuPosition ? createPortal(
          <div
            ref={sessionMenuRef}
            role="listbox"
            aria-label="Market session"
            style={sessionMenuPosition}
            className="fixed z-[70] w-[6.5rem] rounded-[8px] border border-line-strong bg-[#111214] p-1.5 shadow-overlay"
          >
            {MARKET_SESSIONS.map((marketSession) => {
              const selected = marketSession.value === state.marketSession
              return (
                <button
                  key={marketSession.value}
                  type="button"
                  role="option"
                  aria-label={marketSession.accessibleLabel}
                  aria-selected={selected}
                  title={marketSession.title}
                  onClick={() => selectMarketSession(marketSession.value)}
                  className="flex h-7 w-full items-center rounded-control px-2.5 text-left font-mono text-ui-meta font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:bg-surface-2 focus-visible:text-ink focus-visible:outline-none aria-selected:bg-active/15 aria-selected:text-active-bright"
                >
                  {marketSession.label}
                </button>
              )
            })}
          </div>,
          document.body,
        ) : null}
    </div>
  )
}
