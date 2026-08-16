import { useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { PointDatum, SessionDatum, SplitPointDatum } from './analytics-view-model'

const colors = {
  grid: '#3b3f46', axis: '#747982', text: '#aeb4bd', blue: '#1677ff', blueBright: '#69a7ff',
  green: '#0caf8d', greenBright: '#4bd6b8', red: '#e85d52', redBright: '#ff8a80', track: '#2b2e33',
} as const

type Tone = 'default' | 'profit' | 'loss' | 'blue'

interface TooltipRow { label: string; value: string; tone?: Tone }
interface TooltipData { title: string; rows: TooltipRow[] }
interface TooltipState extends TooltipData { x: number; y: number }

function number(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

function signedMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', signDisplay: 'exceptZero', maximumFractionDigits: 2,
  }).format(value)
}

function encodeTip(data: TooltipData): string {
  return JSON.stringify(data)
}

function decodeTip(value: string | undefined): TooltipData | null {
  if (!value) return null
  const parsed: unknown = JSON.parse(value)
  if (typeof parsed !== 'object' || parsed === null || !('title' in parsed) || !('rows' in parsed)) return null
  return parsed as TooltipData
}

interface TooltipSurfaceProps {
  children: ReactNode
  className: string
  inspectAtRatio?: (ratio: number) => TooltipData
}

function TooltipSurface({ children, className, inspectAtRatio }: TooltipSurfaceProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const position = (container: HTMLDivElement, clientX: number, clientY: number): { x: number; y: number } => {
    const bounds = container.getBoundingClientRect()
    return {
      x: Math.min(92, Math.max(8, (clientX - bounds.left) / Math.max(1, bounds.width) * 100)),
      y: Math.min(94, Math.max(9, (clientY - bounds.top) / Math.max(1, bounds.height) * 100)),
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const target = event.target instanceof Element ? event.target.closest('[data-chart-tip]') : null
    const marked = decodeTip(target?.getAttribute('data-chart-tip') ?? undefined)
    const point = position(event.currentTarget, event.clientX, event.clientY)
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)))
    const data = marked ?? inspectAtRatio?.(ratio)
    setTooltip(data ? { ...data, ...point } : null)
  }

  const onFocus = (event: FocusEvent<HTMLDivElement>): void => {
    const target = event.target instanceof Element ? event.target.closest('[data-chart-tip]') : null
    const data = decodeTip(target?.getAttribute('data-chart-tip') ?? undefined)
    if (!data || !target) return
    const targetBounds = target.getBoundingClientRect()
    setTooltip({ ...data, ...position(event.currentTarget, targetBounds.left + targetBounds.width / 2, targetBounds.top) })
  }

  const toneClass = (tone: Tone | undefined): string => {
    if (tone === 'profit') return 'text-profit-bright'
    if (tone === 'loss') return 'text-loss-bright'
    if (tone === 'blue') return 'text-active-bright'
    return 'text-white'
  }

  return (
    <div className={`relative ${className}`} onPointerMove={onPointerMove} onPointerLeave={() => setTooltip(null)} onFocus={onFocus} onBlur={() => setTooltip(null)}>
      {children}
      {tooltip ? <div role="tooltip" style={{ left: `${tooltip.x}%`, top: `${tooltip.y}%` }} className="pointer-events-none absolute z-20 min-w-40 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-md border border-[#4b5058] bg-[#0d0f12] px-3 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.46)]">
        <p className="whitespace-nowrap text-xs font-medium leading-4 text-[#b9bec6]">{tooltip.title}</p>
        <dl className="mt-1.5 space-y-1">
          {tooltip.rows.map((row) => <div key={`${row.label}-${row.value}`} className="flex items-center justify-between gap-5 text-xs leading-4"><dt className="whitespace-nowrap text-[#9298a2]">{row.label}</dt><dd className={`whitespace-nowrap font-mono font-semibold tabular-nums ${toneClass(row.tone)}`}>{row.value}</dd></div>)}
        </dl>
      </div> : null}
    </div>
  )
}

interface LineChartProps {
  values: number[]
  compact?: boolean
  ariaLabel: string
  valueLabel?: string
  valueFormatter?: (value: number) => string
}

interface ChartPoint { x: number; y: number }

function linePoints(values: number[], width: number, height: number, inset: number): ChartPoint[] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(1, max - min)
  return values.map((value, index) => ({
    x: inset + index / Math.max(1, values.length - 1) * (width - inset * 2),
    y: inset + (max - value) / span * (height - inset * 2),
  }))
}

export function LineChart({ values, compact = false, ariaLabel, valueLabel = 'Value', valueFormatter = number }: LineChartProps) {
  const [keyboardIndex, setKeyboardIndex] = useState<number | null>(null)
  const width = 1000
  const height = compact ? 92 : 260
  const inset = compact ? 8 : 22
  const points = linePoints(values, width, height, inset)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const zeroY = inset + (max / Math.max(1, max - min)) * (height - inset * 2)
  const inspect = (ratio: number): TooltipData => {
    const index = Math.round(ratio * Math.max(0, values.length - 1))
    const value = values[index] ?? 0
    return { title: `Trade ${Math.max(1, index)} of ${values.length - 1}`, rows: [{ label: valueLabel, value: valueFormatter(value), tone: value >= 0 ? 'profit' : 'loss' }] }
  }
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    setKeyboardIndex((current) => Math.min(values.length - 1, Math.max(0, (current ?? 0) + delta)))
  }
  const active = keyboardIndex === null ? null : points[keyboardIndex]
  return (
    <TooltipSurface className={`w-full ${compact ? 'h-20' : 'h-64 min-w-[720px]'}`} inspectAtRatio={inspect}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${ariaLabel}. Move the pointer across the chart to inspect each trade.`} tabIndex={0} onKeyDown={onKeyDown} onFocus={() => setKeyboardIndex(0)} onBlur={() => setKeyboardIndex(null)} className="h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-active">
        <title>{ariaLabel}</title>
        {compact ? null : [22, 76, 130, 184, 238].map((y) => <line key={y} x1="22" x2="978" y1={y} y2={y} stroke={colors.grid} strokeDasharray="7 7" vectorEffect="non-scaling-stroke" />)}
        {compact ? null : <line x1="22" x2="978" y1={zeroY} y2={zeroY} stroke={colors.axis} strokeOpacity="0.75" vectorEffect="non-scaling-stroke" />}
        <polyline points={points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" stroke={colors.blue} strokeWidth={compact ? 2 : 2.4} vectorEffect="non-scaling-stroke" />
        {active ? <circle cx={active.x} cy={active.y} r="5" fill="#0d0f12" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
    </TooltipSurface>
  )
}

interface DonutProps { buy: number; sell: number; ariaLabel: string }

export function Donut({ buy, sell, ariaLabel }: DonutProps) {
  const radius = 66
  const circumference = 2 * Math.PI * radius
  const buyLength = circumference * buy / 100
  return <TooltipSurface className="mx-auto size-48 max-w-full"><svg viewBox="0 0 180 180" className="size-full" role="img" aria-label={ariaLabel}>
    <title>{ariaLabel}</title><circle cx="90" cy="90" r={radius} fill="none" stroke={colors.track} strokeWidth="32" />
    <circle tabIndex={0} aria-label={`Buy trades ${buy.toFixed(1)} percent`} data-chart-tip={encodeTip({ title: 'Buy trades', rows: [{ label: 'Share', value: `${buy.toFixed(1)}%`, tone: 'profit' }] })} cx="90" cy="90" r={radius} fill="none" stroke={colors.green} strokeWidth="32" strokeDasharray={`${buyLength} ${circumference - buyLength}`} transform="rotate(-90 90 90)" className="cursor-help outline-none" />
    <circle tabIndex={0} aria-label={`Sell trades ${sell.toFixed(1)} percent`} data-chart-tip={encodeTip({ title: 'Sell trades', rows: [{ label: 'Share', value: `${sell.toFixed(1)}%`, tone: 'blue' }] })} cx="90" cy="90" r={radius} fill="none" stroke={colors.blue} strokeWidth="32" strokeDasharray={`${circumference - buyLength} ${buyLength}`} strokeDashoffset={-buyLength} transform="rotate(-90 90 90)" className="cursor-help outline-none" />
    <text x="90" y="88" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="600">{Math.round(buy + sell)}%</text><text x="90" y="105" textAnchor="middle" fill={colors.text} fontSize="11">trades</text>
  </svg></TooltipSurface>
}

interface WinRateRingsProps { buy: number; sell: number }

export function WinRateRings({ buy, sell }: WinRateRingsProps) {
  const outer = 2 * Math.PI * 66
  const inner = 2 * Math.PI * 49
  return <TooltipSurface className="mx-auto size-48 max-w-full"><svg viewBox="0 0 180 180" className="size-full" role="img" aria-label={`Buy win rate ${buy} percent, sell win rate ${sell} percent`}>
    <title>Buy and sell win rates</title><circle cx="90" cy="90" r="66" fill="none" stroke={colors.track} strokeWidth="12" />
    <circle tabIndex={0} aria-label={`Buy win rate ${buy.toFixed(1)} percent`} data-chart-tip={encodeTip({ title: 'Buy performance', rows: [{ label: 'Win rate', value: `${buy.toFixed(1)}%`, tone: 'profit' }] })} cx="90" cy="90" r="66" fill="none" stroke={colors.green} strokeWidth="12" strokeDasharray={`${outer * buy / 100} ${outer * (100 - buy) / 100}`} transform="rotate(-90 90 90)" className="cursor-help outline-none" />
    <circle cx="90" cy="90" r="49" fill="none" stroke={colors.track} strokeWidth="12" /><circle tabIndex={0} aria-label={`Sell win rate ${sell.toFixed(1)} percent`} data-chart-tip={encodeTip({ title: 'Sell performance', rows: [{ label: 'Win rate', value: `${sell.toFixed(1)}%`, tone: 'blue' }] })} cx="90" cy="90" r="49" fill="none" stroke={colors.blue} strokeWidth="12" strokeDasharray={`${inner * sell / 100} ${inner * (100 - sell) / 100}`} transform="rotate(-90 90 90)" className="cursor-help outline-none" />
    <text x="90" y="94" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="600">Win rate</text>
  </svg></TooltipSurface>
}

interface RadarProps { datum: SessionDatum }

export function Radar({ datum }: RadarProps) {
  const center = 90
  const radius = 58
  const labels = ['Out of session', 'Asia', 'New York', 'London'] as const
  const point = (value: number, axis: number): ChartPoint => {
    const distance = radius * value / 100
    if (axis === 0) return { x: center, y: center - distance }
    if (axis === 1) return { x: center + distance, y: center }
    if (axis === 2) return { x: center, y: center + distance }
    return { x: center - distance, y: center }
  }
  const points = datum.values.map(point)
  return <TooltipSurface className="mx-auto h-56 w-full max-w-64"><svg viewBox="0 0 180 180" className="h-full w-full" role="img" aria-label={`${datum.label} by trading session`}>
    <title>{datum.label} by trading session</title>{[0.25, 0.5, 0.75, 1].map((scale) => <polygon key={scale} points={`90,${90 - radius * scale} ${90 + radius * scale},90 90,${90 + radius * scale} ${90 - radius * scale},90`} fill="none" stroke={colors.axis} strokeWidth="0.8" />)}
    <line x1="90" y1="32" x2="90" y2="148" stroke={colors.axis} strokeWidth="0.8" /><line x1="32" y1="90" x2="148" y2="90" stroke={colors.axis} strokeWidth="0.8" /><polygon points={points.map(({ x, y }) => `${x},${y}`).join(' ')} fill={colors.blue} fillOpacity="0.2" stroke={colors.blueBright} strokeWidth="2" />
    {datum.values.map((value, index) => { const p = points[index] ?? { x: 0, y: 0 }; return <circle key={labels[index]} tabIndex={0} aria-label={`${labels[index]} ${datum.label} ${number(value)}`} data-chart-tip={encodeTip({ title: labels[index] ?? 'Session', rows: [{ label: datum.label, value: number(value), tone: 'blue' }] })} cx={p.x} cy={p.y} r="5" fill={colors.blue} stroke="#fff" strokeWidth="1.25" className="cursor-help outline-none" /> })}
    <text x="90" y="18" textAnchor="middle" fill={colors.text} fontSize="11">Out of session</text><text x="171" y="94" textAnchor="end" fill={colors.text} fontSize="11">Asia</text><text x="90" y="172" textAnchor="middle" fill={colors.text} fontSize="11">New York</text><text x="9" y="94" fill={colors.text} fontSize="11">London</text>
  </svg></TooltipSurface>
}

interface VerticalBarsProps { data: PointDatum[]; ariaLabel: string; tone?: 'blue' | 'green'; valueSuffix?: string }

export function VerticalBars({ data, ariaLabel, tone = 'blue', valueSuffix = '' }: VerticalBarsProps) {
  const max = Math.max(1, ...data.map((datum) => datum.value))
  const step = 760 / data.length
  return <TooltipSurface className="h-64 w-full min-w-[720px]"><svg viewBox="0 0 820 250" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={ariaLabel}>
    <title>{ariaLabel}</title>{[28, 80, 132, 184, 226].map((y) => <line key={y} x1="40" y1={y} x2="810" y2={y} stroke={colors.grid} strokeDasharray="7 7" vectorEffect="non-scaling-stroke" />)}
    {data.map((datum, index) => { const height = datum.value / max * 198; const x = 44 + index * step; return <g key={datum.label}><rect tabIndex={0} aria-label={`${datum.label}, ${number(datum.value)}${valueSuffix}`} data-chart-tip={encodeTip({ title: datum.label, rows: [{ label: ariaLabel.split(' by ')[0] ?? 'Value', value: `${number(datum.value)}${valueSuffix}`, tone: tone === 'green' ? 'profit' : 'blue' }] })} x={x} y={226 - height} width={Math.max(5, step * 0.62)} height={height} rx="3" fill={tone === 'green' ? colors.green : colors.blue} fillOpacity="0.8" stroke={tone === 'green' ? colors.greenBright : colors.blueBright} strokeWidth="0.7" vectorEffect="non-scaling-stroke" className="cursor-help outline-none" /><text x={x + step * 0.31} y="246" textAnchor="middle" fill={colors.text} fontSize="11">{datum.label}</text></g> })}
  </svg></TooltipSurface>
}

interface SplitBarsProps { data: SplitPointDatum[]; ariaLabel: string; valueFormatter?: (value: number) => string }

export function SplitBars({ data, ariaLabel, valueFormatter = signedMoney }: SplitBarsProps) {
  const max = Math.max(1, ...data.flatMap((datum) => [Math.abs(datum.profit), Math.abs(datum.loss)]))
  const step = 760 / data.length
  return <TooltipSurface className="h-64 w-full min-w-[720px]"><svg viewBox="0 0 820 250" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={ariaLabel}>
    <title>{ariaLabel}</title>{[28, 80, 132, 184, 226].map((y) => <line key={y} x1="40" y1={y} x2="810" y2={y} stroke={colors.grid} strokeDasharray="7 7" vectorEffect="non-scaling-stroke" />)}<line x1="40" y1="132" x2="810" y2="132" stroke={colors.axis} vectorEffect="non-scaling-stroke" />
    {data.map((datum, index) => { const profitHeight = Math.abs(datum.profit) / max * 98; const lossHeight = Math.abs(datum.loss) / max * 98; const x = 44 + index * step; const width = Math.max(5, step * 0.65); const tip = encodeTip({ title: datum.label, rows: [{ label: 'Profit', value: valueFormatter(datum.profit), tone: 'profit' }, { label: 'Loss', value: valueFormatter(datum.loss), tone: 'loss' }, { label: 'Net', value: valueFormatter(datum.profit + datum.loss), tone: datum.profit + datum.loss >= 0 ? 'profit' : 'loss' }] }); return <g key={datum.label}><rect tabIndex={0} aria-label={`${datum.label}, profit ${valueFormatter(datum.profit)}`} data-chart-tip={tip} x={x} y={132 - profitHeight} width={width} height={profitHeight} rx="3" fill={colors.green} fillOpacity="0.68" stroke={colors.greenBright} strokeWidth="0.7" vectorEffect="non-scaling-stroke" className="cursor-help outline-none" /><rect tabIndex={0} aria-label={`${datum.label}, loss ${valueFormatter(datum.loss)}`} data-chart-tip={tip} x={x} y="132" width={width} height={lossHeight} rx="3" fill={colors.red} fillOpacity="0.72" stroke={colors.redBright} strokeWidth="0.7" vectorEffect="non-scaling-stroke" className="cursor-help outline-none" /><text x={x + width / 2} y="246" textAnchor="middle" fill={colors.text} fontSize="11">{datum.label}</text></g> })}
  </svg></TooltipSurface>
}

interface DayData { label: string; profit: number; loss: number; winRate: number | null }
interface HorizontalDayBarsProps { data: DayData[] }

export function HorizontalDayBars({ data }: HorizontalDayBarsProps) {
  const max = Math.max(...data.flatMap((datum) => [Math.abs(datum.profit), Math.abs(datum.loss)]), 1)
  return <TooltipSurface className="h-64 min-w-[720px] w-full"><svg viewBox="0 0 920 260" className="h-full w-full" role="img" aria-label="Profit, loss and win rate by weekday">
    <title>Profit, loss and win rate by weekday</title><text x="900" y="18" textAnchor="end" fill={colors.text} fontSize="12" fontWeight="600">Win rate</text><line x1="440" y1="26" x2="440" y2="250" stroke={colors.axis} />
    {data.map((datum, index) => { const y = 40 + index * 31; const lossWidth = Math.abs(datum.loss) / max * 350; const profitWidth = datum.profit / max * 350; const tip = encodeTip({ title: datum.label, rows: [{ label: 'Profit', value: signedMoney(datum.profit), tone: 'profit' }, { label: 'Loss', value: signedMoney(datum.loss), tone: 'loss' }, { label: 'Win rate', value: datum.winRate === null ? '—' : `${datum.winRate}%`, tone: 'profit' }] }); return <g key={datum.label}><line x1="55" y1={y + 11} x2="810" y2={y + 11} stroke={colors.grid} strokeDasharray="7 7" /><text x="10" y={y + 9} fill={colors.text} fontSize="12">{datum.label}</text><rect tabIndex={0} aria-label={`${datum.label}, loss ${signedMoney(datum.loss)}`} data-chart-tip={tip} x={440 - lossWidth} y={y - 3} width={lossWidth} height="18" rx="3" fill={colors.red} className="cursor-help outline-none" /><rect tabIndex={0} aria-label={`${datum.label}, profit ${signedMoney(datum.profit)}`} data-chart-tip={tip} x="440" y={y - 3} width={profitWidth} height="18" rx="3" fill={colors.green} className="cursor-help outline-none" /><rect tabIndex={0} aria-label={`${datum.label}, win rate ${datum.winRate ?? 0} percent`} data-chart-tip={tip} x="834" y={y - 4} width="66" height="20" rx="4" fill={colors.green} className="cursor-help outline-none" /><text x="867" y={y + 10} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="600">{datum.winRate === null ? '—' : `${datum.winRate}%`}</text></g> })}
  </svg></TooltipSurface>
}

interface FrequencyChartProps { labels: string[]; values: number[]; ariaLabel: string }

export function FrequencyChart({ labels, values, ariaLabel }: FrequencyChartProps) {
  const max = Math.max(...values, 1)
  const step = 220 / values.length
  return <TooltipSurface className="h-44 w-full"><svg viewBox="0 0 260 170" className="h-full w-full" role="img" aria-label={ariaLabel}>
    <title>{ariaLabel}</title>{[15, 55, 95, 135].map((y) => <line key={y} x1="25" x2="250" y1={y} y2={y} stroke={colors.grid} strokeDasharray="6 6" />)}
    {values.map((value, index) => { const height = value / max * 125; const x = 32 + index * step; return <g key={`${labels[index]}-${value}`}><rect tabIndex={0} aria-label={`${labels[index]}, ${number(value)} trades`} data-chart-tip={encodeTip({ title: labels[index] ?? `Period ${index + 1}`, rows: [{ label: 'Trades', value: number(value), tone: 'blue' }] })} x={x} y={140 - height} width="9" height={height} rx="3" fill={colors.blue} className="cursor-help outline-none" /><text x={x + 4.5} y="161" textAnchor="middle" fill={colors.text} fontSize="11">{labels[index]}</text></g> })}
  </svg></TooltipSurface>
}
