import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface DrawdownPoint {
  date: string
  equity: number
  peak: number
  dollars: number
  percent: number
}

export interface SimulationSeries {
  id: string
  label: string
  color: string
  values: number[]
}

interface TooltipRow {
  label: string
  value: string
  tone?: 'profit' | 'loss' | 'blue'
}

interface TooltipData {
  title: string
  rows: TooltipRow[]
}

interface InspectorProps {
  children: ReactNode
  className: string
  inspect: (xRatio: number, yRatio: number) => TooltipData
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const compactMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })

function Inspector({ children, className, inspect }: InspectorProps) {
  const [tooltip, setTooltip] = useState<(TooltipData & { x: number; y: number; placement: 'above' | 'below' }) | null>(null)

  const showAt = (element: HTMLDivElement, clientX: number, clientY: number): void => {
    const bounds = element.getBoundingClientRect()
    const xRatio = Math.min(1, Math.max(0, (clientX - bounds.left) / Math.max(1, bounds.width)))
    const yRatio = Math.min(1, Math.max(0, (clientY - bounds.top) / Math.max(1, bounds.height)))
    setTooltip({
      ...inspect(xRatio, yRatio),
      x: Math.min(window.innerWidth - 120, Math.max(120, clientX)),
      y: clientY,
      placement: clientY < 180 ? 'below' : 'above',
    })
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    showAt(event.currentTarget, event.clientX, event.clientY)
  }

  const toneClass = (tone: TooltipRow['tone']): string => {
    if (tone === 'profit') return 'text-profit-bright'
    if (tone === 'loss') return 'text-loss-bright'
    if (tone === 'blue') return 'text-active-bright'
    return 'text-white'
  }

  return (
    <div
      className={`relative ${className}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setTooltip(null)}
    >
      {children}
      {tooltip && typeof document !== 'undefined' ? createPortal(
        <div
          role="tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
          className={`pointer-events-none fixed z-[140] min-w-52 -translate-x-1/2 rounded-md border border-[#626975] bg-[#090b0e] px-3 py-2.5 shadow-[0_16px_38px_rgba(0,0,0,0.72)] ${tooltip.placement === 'above' ? '-translate-y-[calc(100%+12px)]' : 'translate-y-3'}`}
        >
          <p className="whitespace-nowrap text-xs font-semibold leading-4 text-[#e6e9ed]">{tooltip.title}</p>
          <dl className="mt-2 space-y-1.5">
            {tooltip.rows.map((row) => (
              <div key={`${row.label}-${row.value}`} className="flex items-center justify-between gap-6 text-xs leading-4">
                <dt className="whitespace-nowrap text-[#9ba2ad]">{row.label}</dt>
                <dd className={`whitespace-nowrap font-mono font-semibold tabular-nums ${toneClass(row.tone)}`}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>, document.body
      ) : null}
    </div>
  )
}

interface DrawdownChartProps {
  points: DrawdownPoint[]
  mode: 'dollar' | 'percent'
}

export function DrawdownChart({ points, mode }: DrawdownChartProps) {
  const width = 1120
  const height = 310
  const plot = { left: 66, right: 18, top: 26, bottom: 68 }
  const values = points.map((point) => mode === 'dollar' ? point.dollars : point.percent)
  const minimum = Math.min(-1, ...values)
  const floor = mode === 'dollar' ? Math.floor(minimum / 5_000) * 5_000 : Math.floor(minimum / 5) * 5
  const y = (value: number): number => plot.top + (value / floor) * (height - plot.top - plot.bottom)
  const x = (index: number): number => plot.left + index / Math.max(1, points.length - 1) * (width - plot.left - plot.right)
  const barWidth = Math.max(1.2, (width - plot.left - plot.right) / points.length * 0.62)
  const inspect = (ratio: number): TooltipData => {
    const index = Math.round(ratio * Math.max(0, points.length - 1))
    const point = points[index] ?? points[0]
    return {
      title: point?.date ?? 'Trade',
      rows: [
        { label: 'Trade', value: `${index + 1} of ${points.length}` },
        { label: 'Equity', value: money.format(point?.equity ?? 0) },
        { label: 'Peak equity', value: money.format(point?.peak ?? 0) },
        { label: 'Drawdown', value: mode === 'dollar' ? money.format(point?.dollars ?? 0) : `${(point?.percent ?? 0).toFixed(2)}%`, tone: 'loss' },
      ],
    }
  }
  const [keyboardIndex, setKeyboardIndex] = useState<number>(0)
  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setKeyboardIndex((current) => Math.min(points.length - 1, Math.max(0, current + (event.key === 'ArrowRight' ? 1 : -1))))
  }

  return (
    <Inspector className="h-[330px] min-w-[820px] w-full" inspect={(ratio) => inspect(ratio)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-active"
        role="img"
        aria-label={`Drawdown on equity in ${mode === 'dollar' ? 'dollars' : 'percent'}. Move the pointer or use arrow keys to inspect trades.`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = floor * ratio
          const lineY = y(value)
          return <g key={ratio}><line x1={plot.left} x2={width - plot.right} y1={lineY} y2={lineY} stroke="#656a72" strokeDasharray="8 7" opacity="0.78" /><text x={plot.left - 12} y={lineY + 4} textAnchor="end" fill="#9ba2ad" fontSize="12" fontFamily="Roboto Variable">{mode === 'dollar' ? compactMoney.format(Math.abs(value)) : `${value.toFixed(0)}%`}</text></g>
        })}
        {points.map((point, index) => {
          const value = mode === 'dollar' ? point.dollars : point.percent
          const barY = y(value)
          return <rect key={`${point.date}-${index}`} x={x(index) - barWidth / 2} y={plot.top} width={barWidth} height={Math.max(0.8, barY - plot.top)} rx="0.8" fill={index === keyboardIndex ? '#ff8a80' : '#d9574c'} opacity={value === 0 ? 0.35 : 0.93} />
        })}
        <line x1={x(keyboardIndex)} x2={x(keyboardIndex)} y1={plot.top} y2={height - plot.bottom} stroke="#f1f3f5" strokeDasharray="3 4" opacity="0.48" />
        {points.filter((_, index) => index % Math.max(1, Math.ceil(points.length / 9)) === 0).map((point, index) => {
          const originalIndex = index * Math.max(1, Math.ceil(points.length / 9))
          return <text key={point.date} x={x(originalIndex)} y={height - 42} transform={`rotate(-43 ${x(originalIndex)} ${height - 42})`} textAnchor="end" fill="#8f97a3" fontSize="11" fontFamily="JetBrains Mono Variable">{point.date}</text>
        })}
        <text x={width / 2} y={height - 5} textAnchor="middle" fill="#f1f3f5" fontSize="12" fontWeight="600">Trade date</text>
        <text x="15" y={height / 2} transform={`rotate(-90 15 ${height / 2})`} textAnchor="middle" fill="#f1f3f5" fontSize="12" fontWeight="600">{mode === 'dollar' ? 'Drawdown ($)' : 'Drawdown (% of peak)'}</text>
      </svg>
    </Inspector>
  )
}

interface HistogramChartProps {
  bins: Array<{ label: string; value: number }>
}

export function HistogramChart({ bins }: HistogramChartProps) {
  const width = 1060
  const height = 250
  const inset = { left: 54, right: 16, top: 20, bottom: 46 }
  const maximum = Math.max(1, ...bins.map((bin) => bin.value))
  const inspect = (ratio: number): TooltipData => {
    const index = Math.min(bins.length - 1, Math.max(0, Math.floor(ratio * bins.length)))
    const bin = bins[index] ?? bins[0]
    return { title: `MAE ${bin?.label ?? ''}R`, rows: [{ label: 'Winning trades', value: String(bin?.value ?? 0) }, { label: 'Share', value: `${(((bin?.value ?? 0) / Math.max(1, bins.reduce((sum, item) => sum + item.value, 0))) * 100).toFixed(1)}%` }] }
  }
  return (
    <Inspector className="h-[270px] min-w-[720px] w-full" inspect={(ratio) => inspect(ratio)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label="Maximum adverse excursion distribution. Move the pointer across bars for exact values.">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const lineY = inset.top + ratio * (height - inset.top - inset.bottom)
          return <g key={ratio}><line x1={inset.left} x2={width - inset.right} y1={lineY} y2={lineY} stroke="#5d626a" strokeDasharray="8 7" opacity="0.75" /><text x={inset.left - 11} y={lineY + 4} textAnchor="end" fill="#9ba2ad" fontSize="11">{Math.round(maximum * (1 - ratio))}</text></g>
        })}
        {bins.map((bin, index) => {
          const slot = (width - inset.left - inset.right) / bins.length
          const barHeight = bin.value / maximum * (height - inset.top - inset.bottom)
          return <g key={bin.label}><rect x={inset.left + index * slot + 2} y={height - inset.bottom - barHeight} width={Math.max(2, slot - 5)} height={barHeight} rx="5" fill="#d9685b" stroke="#f0796d" opacity="0.92" /><text x={inset.left + index * slot + slot / 2} y={height - 23} textAnchor="middle" fill="#aab0b9" fontSize="11">{bin.label}</text></g>
        })}
        <text x={width / 2} y={height - 2} textAnchor="middle" fill="#eff1f4" fontSize="12" fontWeight="600">MAE (in R)</text>
      </svg>
    </Inspector>
  )
}

interface MultiSeriesChartProps {
  series: SimulationSeries[]
  selectedId: string
  yLabel: string
  valueFormatter: (value: number) => string
  tooltipRows: (series: SimulationSeries, index: number) => TooltipRow[]
  ariaLabel: string
  includeZero?: boolean
}

export function MultiSeriesChart({ series, selectedId, yLabel, valueFormatter, tooltipRows, ariaLabel, includeZero = true }: MultiSeriesChartProps) {
  const width = 1080
  const height = 320
  const plot = { left: 62, right: 18, top: 24, bottom: 46 }
  const allValues = series.flatMap((item) => item.values)
  const rawMinimum = Math.min(...allValues)
  const rawMaximum = Math.max(...allValues)
  const padding = Math.max(1, (rawMaximum - rawMinimum) * 0.08)
  const minimum = includeZero ? Math.min(0, rawMinimum - padding) : rawMinimum - padding
  const maximum = includeZero ? Math.max(1, rawMaximum + padding) : rawMaximum + padding
  const span = Math.max(1, maximum - minimum)
  const x = (index: number, count: number): number => plot.left + index / Math.max(1, count - 1) * (width - plot.left - plot.right)
  const y = (value: number): number => plot.top + (maximum - value) / span * (height - plot.top - plot.bottom)
  const selected = series.find((item) => item.id === selectedId) ?? series[0]
  const inspect = (ratio: number, yRatio: number): TooltipData => {
    const count = selected?.values.length ?? 1
    const index = Math.round(ratio * Math.max(0, count - 1))
    const expectedValue = maximum - yRatio * span
    const nearest = series.reduce((best, item) => Math.abs((item.values[index] ?? 0) - expectedValue) < Math.abs((best.values[index] ?? 0) - expectedValue) ? item : best, selected ?? series[0])
    return { title: `${nearest?.label ?? 'Scenario'} · trade ${index + 1}`, rows: tooltipRows(nearest, index) }
  }
  return (
    <Inspector className="h-[340px] min-w-[820px] w-full" inspect={inspect}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label={`${ariaLabel}. Move the pointer over a line to inspect the scenario.`}>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = maximum - ratio * span
          const lineY = y(value)
          return <g key={ratio}><line x1={plot.left} x2={width - plot.right} y1={lineY} y2={lineY} stroke="#535860" strokeDasharray="8 7" opacity="0.78" /><text x={plot.left - 10} y={lineY + 4} textAnchor="end" fill="#9ba2ad" fontSize="11" fontFamily="JetBrains Mono Variable">{valueFormatter(value)}</text></g>
        })}
        {series.map((item) => <polyline key={item.id} points={item.values.map((value, index) => `${x(index, item.values.length).toFixed(1)},${y(value).toFixed(1)}`).join(' ')} fill="none" stroke={item.color} strokeWidth={item.id === selectedId ? 2.3 : 1.35} opacity={item.id === selectedId ? 1 : 0.74} vectorEffect="non-scaling-stroke" />)}
        <text x="14" y={height / 2} transform={`rotate(-90 14 ${height / 2})`} textAnchor="middle" fill="#e9ecf0" fontSize="12" fontWeight="600">{yLabel}</text>
      </svg>
    </Inspector>
  )
}

interface MonteCarloChartProps {
  series: SimulationSeries[]
}

export function MonteCarloChart({ series }: MonteCarloChartProps) {
  return (
    <MultiSeriesChart
      series={series}
      selectedId={series[0]?.id ?? ''}
      yLabel="Balance"
      valueFormatter={(value) => compactMoney.format(value)}
      ariaLabel="Monte Carlo balance simulations"
      includeZero={false}
      tooltipRows={(_, index) => series.slice(0, 10).map((item) => ({ label: item.label, value: money.format(item.values[index] ?? 0) }))}
    />
  )
}
