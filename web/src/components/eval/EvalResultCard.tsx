import { RotateCcw, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { EvalConfig, EvalRuntime, EvalStatus } from '../../eval/rules'

const fmt$ = (n: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

interface EvalResultCardProps {
  verdict: 'passed' | 'failed'
  failReason: 'total' | 'daily' | null
  config: EvalConfig
  runtime: EvalRuntime
  status: EvalStatus
  endingEquity: number
  onRetry: () => void
  onAbandon: () => void
  onClose: () => void
}

export function EvalResultCard({
  verdict,
  failReason,
  config,
  runtime,
  status,
  endingEquity,
  onRetry,
  onAbandon,
  onClose,
}: EvalResultCardProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const passed = verdict === 'passed'
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (dialog) dialog.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previousFocus?.focus()
    }
  }, [])

  const startFresh = (): void => {
    onAbandon()
    window.location.assign('/start/eval')
  }

  const reason = passed
    ? `Profit target reached · ${fmt$(status.realizedProfit)} profit${config.minTradingDays > 0 ? ` · ${status.daysTraded} days traded` : ''}`
    : failReason === 'daily'
      ? `Daily loss limit hit · ${fmt$(status.dailyLoss)} loss today`
      : `Total loss breached · account below ${fmt$(status.floor)} floor`

  const stats: ReadonlyArray<readonly [string, string]> = [
    ['Ending equity', fmt$(endingEquity)],
    ['Net profit', fmt$(status.realizedProfit)],
    ['Peak equity', fmt$(runtime.peakEquity)],
    ['Days traded', String(status.daysTraded)],
  ]

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-surface-0/80 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="eval-result-title"
        aria-describedby="eval-result-description"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-xl border border-line bg-surface-1 p-6 shadow-overlay outline-none focus-visible:ring-2 focus-visible:ring-active"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 grid size-11 place-items-center rounded-control text-muted hover:bg-surface-3 hover:text-ink sm:right-3 sm:top-3 sm:size-8"
          aria-label="Close result"
        >
          <X size={16} />
        </button>

        <h2
          id="eval-result-title"
          className={`text-[22px] font-bold leading-tight ${passed ? 'text-profit-bright' : 'text-loss-bright'}`}
        >
          {passed ? 'EVALUATION PASSED' : 'EVALUATION FAILED'}
        </h2>
        <p id="eval-result-description" className="mt-1.5 text-ui-body text-muted">{reason}</p>

        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-control bg-line">
          {stats.map(([label, value]) => (
            <div key={label} className="bg-surface-1 p-2.5">
              <dt className="text-ui-meta text-dim">{label}</dt>
              <dd className="mt-0.5 font-mono text-ui-title text-ink">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex flex-col gap-2">
          {passed ? (
            <button type="button" onClick={startFresh} className="primary-button min-h-11 w-full sm:min-h-9">Start new evaluation</button>
          ) : (
            <>
              <button type="button" onClick={onRetry} className="primary-button min-h-11 w-full gap-2 sm:min-h-9">
                Retry same rules <RotateCcw size={14} />
              </button>
              <button type="button" onClick={startFresh} className="secondary-button min-h-11 w-full sm:min-h-9">
                Start fresh evaluation
              </button>
            </>
          )}
          <button type="button" onClick={onClose} className="mt-1 min-h-11 text-ui-body text-dim hover:text-muted sm:min-h-9">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
