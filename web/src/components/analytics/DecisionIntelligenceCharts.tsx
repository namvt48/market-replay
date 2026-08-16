import { useState, type PointerEvent, type ReactNode } from 'react'

interface TooltipData {
  title: string
  rows: Array<{ label: string; value: string; tone?: 'positive' | 'negative' }>
}

interface InspectorProps {
  children: ReactNode
  className: string
  inspect: (ratio: number) => TooltipData
}

function Inspector({ children, className, inspect }: InspectorProps) {
  const [tooltip, setTooltip] = useState<(TooltipData & { x: number }) | null>(null)
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)))
    setTooltip({ ...inspect(ratio), x: Math.min(88, Math.max(12, ratio * 100)) })
  }
  return (
    <div className={`relative ${className}`} onPointerMove={onPointerMove} onPointerLeave={() => setTooltip(null)}>
      {children}
      {tooltip ? <div role="tooltip" style={{ left: `${tooltip.x}%` }} className="pointer-events-none absolute top-2 z-20 min-w-48 -translate-x-1/2 rounded-md border border-[#555b64] bg-[#0b0d10] px-3 py-2.5 shadow-[0_14px_36px_rgba(0,0,0,0.56)]"><p className="text-xs font-semibold text-white">{tooltip.title}</p><dl className="mt-2 space-y-1">{tooltip.rows.map((row) => <div key={`${row.label}-${row.value}`} className="flex justify-between gap-5 text-xs"><dt className="text-[#9ba2ad]">{row.label}</dt><dd className={`font-mono font-semibold ${row.tone === 'positive' ? 'text-profit-bright' : row.tone === 'negative' ? 'text-loss-bright' : 'text-white'}`}>{row.value}</dd></div>)}</dl></div> : null}
    </div>
  )
}

interface ConfidenceBandProps {
  lower: number
  median: number
  upper: number
  actual: number
}

export function ConfidenceBand({ lower, median, upper, actual }: ConfidenceBandProps) {
  const minimum = Math.min(-0.15, lower - 0.1)
  const maximum = Math.max(0.15, upper + 0.1)
  const x = (value: number): number => 54 + (value - minimum) / Math.max(0.01, maximum - minimum) * 852
  const inspect = (): TooltipData => ({ title: '90% bootstrap interval', rows: [{ label: 'Lower', value: `${lower.toFixed(3)}R` }, { label: 'Median', value: `${median.toFixed(3)}R` }, { label: 'Upper', value: `${upper.toFixed(3)}R` }, { label: 'Observed', value: `${actual.toFixed(3)}R`, tone: actual > 0 ? 'positive' : 'negative' }] })
  return <Inspector className="h-40 min-w-[620px] w-full" inspect={inspect}><svg viewBox="0 0 960 150" className="h-full w-full" role="img" aria-label={`Expectancy 90 percent confidence interval from ${lower.toFixed(3)}R to ${upper.toFixed(3)}R, median ${median.toFixed(3)}R`}><line x1="54" x2="906" y1="94" y2="94" stroke="#555b64" strokeDasharray="7 7" /><line x1={x(0)} x2={x(0)} y1="35" y2="118" stroke="#e85d52" strokeOpacity="0.75" /><rect x={x(lower)} y="65" width={Math.max(2, x(upper) - x(lower))} height="28" rx="7" fill="#163a5e" stroke="#4092e6" /><line x1={x(median)} x2={x(median)} y1="57" y2="101" stroke="#8fc5ff" strokeWidth="3" /><circle cx={x(actual)} cy="79" r="6" fill="#0caf8d" stroke="#b9fff0" strokeWidth="2" /><text x={x(0)} y="132" textAnchor="middle" fill="#9ba2ad" fontSize="11">0R</text><text x={x(lower)} y="50" textAnchor="middle" fill="#aeb5bf" fontSize="11">{lower.toFixed(2)}R</text><text x={x(upper)} y="50" textAnchor="middle" fill="#aeb5bf" fontSize="11">{upper.toFixed(2)}R</text></svg></Inspector>
}

interface StabilityChartProps {
  windows: Array<{ label: string; expectancyR: number; trades: number }>
}

export function StabilityChart({ windows }: StabilityChartProps) {
  const max = Math.max(0.1, ...windows.map((window) => Math.abs(window.expectancyR)))
  const inspect = (ratio: number): TooltipData => {
    const index = Math.min(windows.length - 1, Math.max(0, Math.floor(ratio * windows.length)))
    const window = windows[index]
    return { title: window?.label ?? 'Window', rows: [{ label: 'Expectancy', value: `${(window?.expectancyR ?? 0).toFixed(3)}R`, tone: (window?.expectancyR ?? 0) >= 0 ? 'positive' : 'negative' }, { label: 'Trades', value: String(window?.trades ?? 0) }] }
  }
  return <Inspector className="h-52 min-w-[520px] w-full" inspect={inspect}><svg viewBox="0 0 720 200" className="h-full w-full" role="img" aria-label="Walk-forward expectancy by window"><line x1="44" x2="700" y1="100" y2="100" stroke="#747982" />{windows.map((window, index) => { const slot = 656 / Math.max(1, windows.length); const height = Math.abs(window.expectancyR) / max * 72; const y = window.expectancyR >= 0 ? 100 - height : 100; return <g key={window.label}><rect x={48 + index * slot} y={y} width={Math.max(16, slot - 18)} height={height} rx="4" fill={window.expectancyR >= 0 ? '#0caf8d' : '#e85d52'} opacity="0.86" /><text x={48 + index * slot + Math.max(16, slot - 18) / 2} y="180" textAnchor="middle" fill="#9ba2ad" fontSize="11">{window.label}</text></g> })}</svg></Inspector>
}

interface DistributionChartProps { bins: Array<{ fromInclusiveR: number; toExclusiveR: number | null; count: number }> }

export function MfeDistributionChart({ bins }: DistributionChartProps) {
  const max = Math.max(1, ...bins.map((bin) => bin.count))
  const inspect = (ratio: number): TooltipData => { const index = Math.min(bins.length - 1, Math.max(0, Math.floor(ratio * bins.length))); const bin = bins[index]; const upper = bin?.toExclusiveR === null ? '∞' : (bin?.toExclusiveR ?? 0).toFixed(1); return { title: `MFE ${(bin?.fromInclusiveR ?? 0).toFixed(1)}–${upper}R`, rows: [{ label: 'Trades', value: String(bin?.count ?? 0) }] } }
  return <Inspector className="h-56 min-w-[560px] w-full" inspect={inspect}><svg viewBox="0 0 760 210" className="h-full w-full" role="img" aria-label="Maximum favorable excursion distribution"><line x1="40" x2="738" y1="169" y2="169" stroke="#555b64" />{bins.map((bin, index) => { const slot = 690 / Math.max(1, bins.length); const height = bin.count / max * 130; return <g key={`${bin.fromInclusiveR}-${index}`}><rect x={44 + index * slot} y={169 - height} width={Math.max(4, slot - 8)} height={height} rx="4" fill="#1677ff" opacity="0.82" /><text x={44 + index * slot + Math.max(4, slot - 8) / 2} y="190" textAnchor="middle" fill="#9ba2ad" fontSize="10">{bin.fromInclusiveR.toFixed(1)}</text></g> })}</svg></Inspector>
}
