import { CircleHelp } from 'lucide-react'
import { useId, type ReactNode } from 'react'

interface InfoTipProps {
  label: string
  children: ReactNode
}

export function DecisionInfoTip({ label, children }: InfoTipProps) {
  const id = useId()
  return (
    <span className="group relative inline-flex align-middle">
      <button type="button" aria-label={`About ${label}`} aria-describedby={id} className="ml-1 inline-grid size-5 place-items-center rounded-md text-[#858b94] transition-colors hover:bg-[#272a2f] hover:text-white focus-visible:ring-2 focus-visible:ring-active">
        <CircleHelp size={12} strokeWidth={1.8} />
      </button>
      <span id={id} role="tooltip" className="pointer-events-none absolute left-1/2 top-7 z-40 hidden w-72 -translate-x-1/2 rounded-md border border-[#515761] bg-[#0b0d10] p-3 text-left text-xs font-normal leading-[1.55] text-[#c8cdd4] shadow-[0_12px_34px_rgba(0,0,0,0.55)] group-hover:block group-focus-within:block">{children}</span>
    </span>
  )
}

interface SectionTitleProps {
  children: ReactNode
  info?: string
  action?: ReactNode
}

export function DecisionSectionTitle({ children, info, action }: SectionTitleProps) {
  return (
    <div className="mb-4 flex min-h-11 flex-wrap items-center justify-between gap-3">
      <h2 className="text-[21px] font-semibold leading-7 tracking-[-0.02em] text-[#f3f5f7]">{children}{info ? <DecisionInfoTip label={String(children)}>{info}</DecisionInfoTip> : null}</h2>
      {action}
    </div>
  )
}

interface PanelProps {
  children: ReactNode
  className?: string
}

export function DecisionPanel({ children, className = '' }: PanelProps) {
  return <section className={`rounded-[14px] border border-[#3c4148] bg-[#121416] ${className}`}>{children}</section>
}

interface MetricProps {
  label: string
  value: string
  note?: string
  tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'blue'
}

export function DecisionMetric({ label, value, note, tone = 'neutral' }: MetricProps) {
  const toneClass = tone === 'positive' ? 'text-profit-bright' : tone === 'negative' ? 'text-loss-bright' : tone === 'warning' ? 'text-[#e4b740]' : tone === 'blue' ? 'text-active-bright' : 'text-white'
  return (
    <div tabIndex={0} title={`${label}: ${value}${note ? ` — ${note}` : ''}`} className="group relative min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-active">
      <p className="text-[12px] leading-5 text-[#aeb5bf]">{label}</p>
      <p className={`mt-0.5 font-mono text-[21px] font-semibold leading-7 tracking-[-0.025em] tabular-nums ${toneClass}`}>{value}</p>
      {note ? <p className="mt-1 text-xs leading-5 text-[#8f97a3]">{note}</p> : null}
      <span role="tooltip" className="pointer-events-none absolute left-0 top-[calc(100%+6px)] z-30 hidden min-w-48 rounded-md border border-[#515761] bg-[#0b0d10] px-3 py-2 text-xs shadow-[0_12px_32px_rgba(0,0,0,0.55)] group-hover:block group-focus:block"><span className="text-[#9ba2ad]">{label}</span><strong className={`ml-5 font-mono ${toneClass}`}>{value}</strong>{note ? <span className="mt-1 block max-w-64 text-[#b8bec7]">{note}</span> : null}</span>
    </div>
  )
}

interface SignalBadgeProps {
  label: string
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
}

export function SignalBadge({ label, tone }: SignalBadgeProps) {
  const classes = tone === 'positive' ? 'border-profit/70 bg-profit/15 text-profit-bright' : tone === 'negative' ? 'border-loss/70 bg-loss/15 text-loss-bright' : tone === 'warning' ? 'border-[#a97f0b] bg-[#2d260f] text-[#e4b740]' : 'border-[#4a5058] bg-[#202328] text-[#c5cad1]'
  return <span className={`inline-flex min-h-7 items-center rounded-full border px-3 text-xs font-semibold ${classes}`}>{label}</span>
}
