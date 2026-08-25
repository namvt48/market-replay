import type { ReactNode } from 'react'
import { AnalyticsInfoTip } from './AnalyticsFloatingTooltip'

interface InfoTipProps {
  label: string
  children: ReactNode
}

export function DecisionInfoTip({ label, children }: InfoTipProps) {
  return <AnalyticsInfoTip label={label} className="ml-1">{children}</AnalyticsInfoTip>
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
  const toneClass = tone === 'positive' ? 'text-profit-bright' : tone === 'negative' ? 'text-loss-bright' : tone === 'warning' ? 'text-caution-bright' : tone === 'blue' ? 'text-active-bright' : 'text-ink'
  return (
    <div className="min-w-0">
      <p className="text-ui-body text-[#aeb5bf]">{label}</p>
      <p className={`mt-0.5 font-mono text-[21px] font-semibold leading-7 tracking-[-0.025em] tabular-nums ${toneClass}`}>{value}</p>
      {note ? <p className="mt-1 text-ui-meta text-[#8f97a3]">{note}</p> : null}
    </div>
  )
}

interface SignalBadgeProps {
  label: string
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
}

export function SignalBadge({ label, tone }: SignalBadgeProps) {
  const classes = tone === 'positive' ? 'border-profit/70 bg-profit/15 text-profit-bright' : tone === 'negative' ? 'border-loss/70 bg-loss/15 text-loss-bright' : tone === 'warning' ? 'border-caution/70 bg-caution/15 text-caution-bright' : 'border-line-strong bg-surface-2 text-ink'
  return <span className={`inline-flex min-h-7 items-center rounded-full border px-3 text-ui-meta font-semibold ${classes}`}>{label}</span>
}
