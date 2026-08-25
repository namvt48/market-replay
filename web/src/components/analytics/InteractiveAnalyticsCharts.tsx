import { useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PointDatum, SessionDatum, SplitPointDatum } from './analytics-view-model'

const colors = {
  grid: '#3b3f46', axis: '#747982', text: '#aeb4bd', blue: '#1677ff', blueBright: '#69a7ff',
  green: '#0caf8d', greenBright: '#4bd6b8', red: '#e85d52', redBright: '#ff8a80', track: '#2b2e33',
} as const

type Tone = 'default' | 'profit' | 'loss' | 'blue'

interface TooltipRow { label: string; value: string; tone?: Tone }
interface TooltipData { title: string; rows: TooltipRow[] }
interface TooltipState extends TooltipData { x: number; y: number; placement: 'above' | 'below' }

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
  const [crosshairX, setCrosshairX] = useState<number | null>(null)

  const position = (_container: HTMLDivElement, clientX: number, clientY: number): Pick<TooltipState, 'x' | 'y' | 'placement'> => {
    const halfWidth = 112
    return {
      x: Math.min(window.innerWidth - halfWidth - 8, Math.max(halfWidth + 8, clientX)),
      y: clientY,
      placement: clientY < 170 ? 'below' : 'above',
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const target = event.target instanceof Element ? event.target.closest('[data-chart-tip]') : null
    const marked = decodeTip(target?.getAttribute('data-chart-tip') ?? undefined)
    const point = position(event.currentTarget, event.clientX, event.clientY)
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)))
    setCrosshairX(ratio * 100)
    const data = marked ?? inspectAtRatio?.(ratio)
    setTooltip(data ? { ...data, ...point } : null)
  }

  const onFocus = (event: FocusEvent<HTMLDivElement>): void => {
    const target = event.target instanceof Element ? event.target.closest('[data-chart-tip]') : null
    const data = decodeTip(target?.getAttribute('data-chart-tip') ?? undefined)
    if (!data || !target) return
    const targetBounds = target.getBoundingClientRect()
    const bounds = event.currentTarget.getBoundingClientRect()
    setCrosshairX(((targetBounds.left + targetBounds.width / 2 - bounds.left) / Math.max(1, bounds.width)) * 100)
    setTooltip({ ...data, ...position(event.currentTarget, targetBounds.left + targetBounds.width / 2, targetBounds.top) })
  }

  const toneClass = (tone: Tone | undefined): string => {
    if (tone === 'profit') return 'text-profit-bright'
    if (tone === 'loss') return 'text-loss-bright'
    if (tone === 'blue') return 'text-active-bright'
    return 'text-white'
  }

  return (
    <div className={`relative ${className}`} onPointerMove={onPointerMove} onPointerLeave={() => { setTooltip(null); setCrosshairX(null) }} onFocus={onFocus} onBlur={() => { setTooltip(null); setCrosshairX(null) }}>
      {children}
      {crosshairX !== null ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-10 border-l border-dashed border-[#aeb4bd]/45" style={{ left: `${crosshairX}%` }} /> : null}
      {tooltip && typeof document !== 'undefined' ? createPortal(<div role="tooltip" style={{ left: tooltip.x, top: tooltip.y }} className={`pointer-events-none fixed z-[140] min-w-40 -translate-x-1/2 rounded-md border border-[#626975] bg-[#090b0e] px-3 py-2 shadow-[0_16px_38px_rgba(0,0,0,0.72)] ${tooltip.placement === 'above' ? '-translate-y-[calc(100%+12px)]' : 'translate-y-3'}`}>
        <p className="whitespace-nowrap text-ui-meta font-medium text-[#b9bec6]">{tooltip.title}</p>
        <dl className="mt-1.5 space-y-1">
          {tooltip.rows.map((row) => <div key={`${row.label}-${row.value}`} className="flex items-center justify-between gap-5 text-ui-meta"><dt className="whitespace-nowrap text-[#9298a2]">{row.label}</dt><dd className={`whitespace-nowrap font-mono font-semibold tabular-nums ${toneClass(row.tone)}`}>{row.value}</dd></div>)}
        </dl>
      </div>, document.body) : null}
    </div>
  )
}

interface LineChartProps {
  values: number[]
  compact?: boolean
  ariaLabel: string
  valueLabel?: string
  valueFormatter?: (value: number) => string
  referenceLines?: readonly LineChartReferenceLine[]
  showPoints?: boolean
}

export interface LineChartReferenceLine {
  value: number
  label: string
  tone: 'profit' | 'loss'
}

interface ChartPoint { x: number; y: number }

interface ChartPlot { left: number; right: number; top: number; bottom: number }

function linePoints(values: number[], width: number, height: number, plot: ChartPlot, min: number, max: number): ChartPoint[] {
  const span = Math.max(1, max - min)
  return values.map((value, index) => ({
    x: plot.left + index / Math.max(1, values.length - 1) * (width - plot.left - plot.right),
    y: plot.top + (max - value) / span * (height - plot.top - plot.bottom),
  }))
}

export function LineChart({ values, compact = false, ariaLabel, valueLabel = 'Value', valueFormatter = number, referenceLines = [], showPoints = false }: LineChartProps) {
  const [keyboardIndex, setKeyboardIndex] = useState<number | null>(null)
  const width = 1000
  const height = compact ? 92 : 260
  const plot = compact ? { left: 108, right: 10, top: 8, bottom: 8 } : { left: 82, right: 22, top: 22, bottom: 22 }
  const plottedValues = values.length > 0 ? values : [0]
  const domainValues = referenceLines.length > 0 ? [0, ...plottedValues, ...referenceLines.map((line) => line.value)] : plottedValues
  const axis = domainAxisTicks(Math.min(...domainValues), Math.max(...domainValues))
  const points = linePoints(plottedValues, width, height, plot, axis.minimum, axis.maximum)
  const yForValue = (value: number): number => plot.top + (axis.maximum - value) / Math.max(1, axis.maximum - axis.minimum) * (height - plot.top - plot.bottom)
  const inspect = (ratio: number): TooltipData => {
    const index = Math.round(ratio * Math.max(0, plottedValues.length - 1))
    const value = plottedValues[index] ?? 0
    return { title: `Trade ${Math.max(1, index)} of ${Math.max(0, plottedValues.length - 1)}`, rows: [{ label: valueLabel, value: valueFormatter(value), tone: value >= 0 ? 'profit' : 'loss' }] }
  }
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    setKeyboardIndex((current) => Math.min(plottedValues.length - 1, Math.max(0, (current ?? 0) + delta)))
  }
  const active = keyboardIndex === null ? null : points[keyboardIndex]
  return (
    <TooltipSurface className={`w-full ${compact ? 'h-20' : 'h-64 min-w-[720px]'}`} inspectAtRatio={inspect}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${ariaLabel}. Move the pointer across the chart to inspect each trade.`} tabIndex={0} onKeyDown={onKeyDown} onFocus={() => setKeyboardIndex(0)} onBlur={() => setKeyboardIndex(null)} className="h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-active">
        {compact ? null : axis.values.map((value) => { const y = yForValue(value); const zero = Math.abs(value) < Number.EPSILON; return <g key={value}><line x1={plot.left} x2={width - plot.right} y1={y} y2={y} stroke={zero ? colors.axis : colors.grid} strokeOpacity={zero ? "0.8" : undefined} strokeDasharray="7 7" vectorEffect="non-scaling-stroke" /><text x={plot.left - 8} y={Math.max(9, y - 3)} textAnchor="end" fill={colors.text} fontSize="9.5" fontFamily="JetBrains Mono Variable">{valueFormatter(value)}</text></g> })}
        {referenceLines.map((line) => {
          const y = yForValue(line.value)
          const color = line.tone === 'profit' ? colors.greenBright : colors.redBright
          return <g key={`${line.label}-${line.value}`}><line x1={plot.left} x2={width - plot.right} y1={y} y2={y} stroke={color} strokeWidth="1.25" vectorEffect="non-scaling-stroke" /><text x={width - plot.right - 4} y={Math.max(12, y - 5)} textAnchor="end" fill={color} fontSize="11" fontWeight="600">{line.label}</text></g>
        })}
        <polyline points={points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" stroke={colors.blue} strokeWidth={compact ? 2 : 2.4} vectorEffect="non-scaling-stroke" />
        {showPoints ? points.map((point, index) => <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r="2.75" fill="#0d0f12" stroke="#f4f5f7" strokeWidth="1.25" vectorEffect="non-scaling-stroke" aria-hidden="true" />) : null}
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
    <circle cx="90" cy="90" r={radius} fill="none" stroke={colors.track} strokeWidth="32" />
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
    <circle cx="90" cy="90" r="66" fill="none" stroke={colors.track} strokeWidth="12" />
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
    {[0.25, 0.5, 0.75, 1].map((scale) => <polygon key={scale} points={`90,${90 - radius * scale} ${90 + radius * scale},90 90,${90 + radius * scale} ${90 - radius * scale},90`} fill="none" stroke={colors.axis} strokeWidth="0.8" />)}
    <line x1="90" y1="32" x2="90" y2="148" stroke={colors.axis} strokeWidth="0.8" /><line x1="32" y1="90" x2="148" y2="90" stroke={colors.axis} strokeWidth="0.8" /><polygon points={points.map(({ x, y }) => `${x},${y}`).join(' ')} fill={colors.blue} fillOpacity="0.2" stroke={colors.blueBright} strokeWidth="2" />
    {datum.values.map((value, index) => { const p = points[index] ?? { x: 0, y: 0 }; return <circle key={labels[index]} tabIndex={0} aria-label={`${labels[index]} ${datum.label} ${number(value)}`} data-chart-tip={encodeTip({ title: labels[index] ?? 'Session', rows: [{ label: datum.label, value: number(value), tone: 'blue' }] })} cx={p.x} cy={p.y} r="5" fill={colors.blue} stroke="#fff" strokeWidth="1.25" className="cursor-help outline-none" /> })}
    <text x="90" y="18" textAnchor="middle" fill={colors.text} fontSize="11">Out of session</text><text x="171" y="94" textAnchor="end" fill={colors.text} fontSize="11">Asia</text><text x="90" y="172" textAnchor="middle" fill={colors.text} fontSize="11">New York</text><text x="9" y="94" fill={colors.text} fontSize="11">London</text>
  </svg></TooltipSurface>
}

interface VerticalBarsProps { data: PointDatum[]; ariaLabel: string; tone?: 'blue' | 'green'; valueSuffix?: string }

function niceStep(maximum: number, targetTicks = 4): number {
  const rough = Math.max(Number.EPSILON, maximum / targetTicks)
  if (maximum <= 4) return Math.max(0.25, Math.ceil(rough * 4) / 4)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / magnitude
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return factor * magnitude
}

function axisTicks(maximum: number, targetTicks = 4): { maximum: number; step: number; values: number[] } {
  const step = niceStep(maximum, targetTicks)
  const axisMaximum = Math.max(step, Math.ceil(maximum / step) * step)
  const count = Math.round(axisMaximum / step)
  return { maximum: axisMaximum, step, values: Array.from({ length: count + 1 }, (_, index) => index * step) }
}

function nextNiceStep(step: number): number {
  if (step < 0.25) return 0.25
  if (step < 0.5) return 0.5
  if (step < 1) return 1
  const magnitude = 10 ** Math.floor(Math.log10(step))
  const normalized = step / magnitude
  if (normalized < 2) return 2 * magnitude
  if (normalized < 2.5) return 2.5 * magnitude
  if (normalized < 5) return 5 * magnitude
  return 10 * magnitude
}

function domainAxisTicks(minimum: number, maximum: number, maxLines = 5): { minimum: number; maximum: number; values: number[] } {
  let low = Math.min(minimum, maximum)
  let high = Math.max(minimum, maximum)
  if (Math.abs(high - low) < Number.EPSILON) {
    low = Math.min(0, low)
    high = Math.max(0, high)
    if (Math.abs(high - low) < Number.EPSILON) high = 1
  }
  const span = high - low
  let step = niceStep(span, maxLines - 1)
  let axisMinimum = Math.floor(low / step) * step
  let axisMaximum = Math.ceil(high / step) * step
  let count = Math.round((axisMaximum - axisMinimum) / step) + 1
  while (count > maxLines) {
    step = nextNiceStep(step)
    axisMinimum = Math.floor(low / step) * step
    axisMaximum = Math.ceil(high / step) * step
    count = Math.round((axisMaximum - axisMinimum) / step) + 1
  }
  return { minimum: axisMinimum, maximum: axisMaximum, values: Array.from({ length: count }, (_, index) => axisMinimum + index * step) }
}

export function VerticalBars({ data, ariaLabel, tone = 'blue', valueSuffix = '' }: VerticalBarsProps) {
  const max = Math.max(1, ...data.map((datum) => datum.value))
  const axis = axisTicks(max)
  const step = 746 / data.length
  return <TooltipSurface className="h-64 w-full min-w-0"><svg viewBox="0 0 820 250" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={ariaLabel}>
    {axis.values.map((value) => { const y = 226 - value / axis.maximum * 198; return <g key={value}><line x1="64" y1={y} x2="810" y2={y} stroke={colors.grid} strokeDasharray="7 7" vectorEffect="non-scaling-stroke" /><text x="58" y={y - 3} textAnchor="end" fill={colors.text} fontSize="8.5" fontFamily="JetBrains Mono Variable">{number(value)}{valueSuffix}</text></g> })}
    {data.map((datum, index) => { const height = datum.value / axis.maximum * 198; const x = 68 + index * step; return <g key={datum.label}><rect tabIndex={0} aria-label={`${datum.label}, ${number(datum.value)}${valueSuffix}`} data-chart-tip={encodeTip({ title: datum.label, rows: [{ label: ariaLabel.split(' by ')[0] ?? 'Value', value: `${number(datum.value)}${valueSuffix}`, tone: tone === 'green' ? 'profit' : 'blue' }] })} x={x} y={226 - height} width={Math.max(5, step * 0.62)} height={height} rx="3" fill={tone === 'green' ? colors.green : colors.blue} fillOpacity="0.8" stroke={tone === 'green' ? colors.greenBright : colors.blueBright} strokeWidth="0.7" vectorEffect="non-scaling-stroke" className="cursor-help outline-none" /><text x={x + step * 0.31} y="246" textAnchor="middle" fill={colors.text} fontSize="10">{datum.label}</text></g> })}
  </svg></TooltipSurface>
}

interface SplitBarsProps { data: SplitPointDatum[]; ariaLabel: string; valueFormatter?: (value: number) => string }

export function SplitBars({ data, ariaLabel, valueFormatter = signedMoney }: SplitBarsProps) {
  const max = Math.max(1, ...data.flatMap((datum) => [Math.abs(datum.profit), Math.abs(datum.loss)]))
  const axis = axisTicks(max, 2)
  const ticks = [...axis.values.slice(1).map((value) => -value).reverse(), ...axis.values]
  const step = 746 / data.length
  return <TooltipSurface className="h-64 w-full min-w-0"><svg viewBox="0 0 820 250" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={ariaLabel}>
    {ticks.map((value) => { const y = 132 - value / axis.maximum * 98; return <g key={value}><line x1="64" y1={y} x2="810" y2={y} stroke={colors.grid} strokeDasharray="7 7" vectorEffect="non-scaling-stroke" /><text x="58" y={y - 3} textAnchor="end" fill={colors.text} fontSize="8.5" fontFamily="JetBrains Mono Variable">{valueFormatter(value)}</text></g> })}<line x1="64" y1="132" x2="810" y2="132" stroke={colors.axis} vectorEffect="non-scaling-stroke" />
    {data.map((datum, index) => { const profitHeight = Math.abs(datum.profit) / axis.maximum * 98; const lossHeight = Math.abs(datum.loss) / axis.maximum * 98; const x = 68 + index * step; const width = Math.max(5, step * 0.65); const tip = encodeTip({ title: datum.label, rows: [{ label: 'Profit', value: valueFormatter(datum.profit), tone: 'profit' }, { label: 'Loss', value: valueFormatter(datum.loss), tone: 'loss' }, { label: 'Net', value: valueFormatter(datum.profit + datum.loss), tone: datum.profit + datum.loss >= 0 ? 'profit' : 'loss' }] }); return <g key={datum.label}><rect tabIndex={0} aria-label={`${datum.label}, profit ${valueFormatter(datum.profit)}`} data-chart-tip={tip} x={x} y={132 - profitHeight} width={width} height={profitHeight} rx="3" fill={colors.green} fillOpacity="0.68" stroke={colors.greenBright} strokeWidth="0.7" vectorEffect="non-scaling-stroke" className="cursor-help outline-none" /><rect tabIndex={0} aria-label={`${datum.label}, loss ${valueFormatter(datum.loss)}`} data-chart-tip={tip} x={x} y="132" width={width} height={lossHeight} rx="3" fill={colors.red} fillOpacity="0.72" stroke={colors.redBright} strokeWidth="0.7" vectorEffect="non-scaling-stroke" className="cursor-help outline-none" /><text x={x + width / 2} y="246" textAnchor="middle" fill={colors.text} fontSize="10">{datum.label}</text></g> })}
  </svg></TooltipSurface>
}

interface DayData { label: string; profit: number; loss: number; winRate: number | null }
interface HorizontalDayBarsProps { data: DayData[] }

export function HorizontalDayBars({ data }: HorizontalDayBarsProps) {
  const max = Math.max(...data.flatMap((datum) => [Math.abs(datum.profit), Math.abs(datum.loss)]), 1)
  return <TooltipSurface className="h-64 min-w-[720px] w-full"><svg viewBox="0 0 920 260" className="h-full w-full" role="img" aria-label="Profit, loss and win rate by weekday">
    <text x="900" y="18" textAnchor="end" fill={colors.text} fontSize="12" fontWeight="600">Win rate</text><line x1="440" y1="26" x2="440" y2="250" stroke={colors.axis} />
    {data.map((datum, index) => { const y = 40 + index * 31; const lossWidth = Math.abs(datum.loss) / max * 350; const profitWidth = datum.profit / max * 350; const winRate = datum.winRate === null ? '—' : `${datum.winRate.toFixed(2)}%`; const tip = encodeTip({ title: datum.label, rows: [{ label: 'Profit', value: signedMoney(datum.profit), tone: 'profit' }, { label: 'Loss', value: signedMoney(datum.loss), tone: 'loss' }, { label: 'Win rate', value: winRate, tone: 'profit' }] }); return <g key={datum.label}><line x1="55" y1={y + 11} x2="810" y2={y + 11} stroke={colors.grid} strokeDasharray="7 7" /><text x="10" y={y + 9} fill={colors.text} fontSize="12">{datum.label}</text><rect tabIndex={0} aria-label={`${datum.label}, loss ${signedMoney(datum.loss)}`} data-chart-tip={tip} x={440 - lossWidth} y={y - 3} width={lossWidth} height="18" rx="3" fill={colors.red} className="cursor-help outline-none" /><rect tabIndex={0} aria-label={`${datum.label}, profit ${signedMoney(datum.profit)}`} data-chart-tip={tip} x="440" y={y - 3} width={profitWidth} height="18" rx="3" fill={colors.green} className="cursor-help outline-none" /><rect tabIndex={0} aria-label={`${datum.label}, win rate ${datum.winRate ?? 0} percent`} data-chart-tip={tip} x="834" y={y - 4} width="66" height="20" rx="4" fill={colors.green} className="cursor-help outline-none" /><text x="867" y={y + 10} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="600">{winRate}</text></g> })}
  </svg></TooltipSurface>
}

interface FrequencyChartProps { labels: string[]; values: number[]; ariaLabel: string }

export function FrequencyChart({ labels, values, ariaLabel }: FrequencyChartProps) {
  const max = Math.max(...values, 1)
  const axis = axisTicks(max)
  const step = 202 / values.length
  return <TooltipSurface className="h-44 w-full"><svg viewBox="0 0 260 170" className="h-full w-full" role="img" aria-label={ariaLabel}>
    {axis.values.map((value) => { const y = 140 - value / axis.maximum * 125; return <g key={value}><line x1="45" x2="250" y1={y} y2={y} stroke={colors.grid} strokeDasharray="6 6" /><text x="40" y={Math.max(10, y - 3)} textAnchor="end" fill={colors.text} fontSize="8.5" fontFamily="JetBrains Mono Variable">{number(value)}</text></g> })}
    {values.map((value, index) => { const height = value / axis.maximum * 125; const x = 50 + index * step; return <g key={`${labels[index]}-${value}`}><rect tabIndex={0} aria-label={`${labels[index]}, ${number(value)} trades`} data-chart-tip={encodeTip({ title: labels[index] ?? `Period ${index + 1}`, rows: [{ label: 'Trades', value: number(value), tone: 'blue' }] })} x={x} y={140 - height} width="9" height={height} rx="3" fill={colors.blue} className="cursor-help outline-none" /><text x={x + 4.5} y="161" textAnchor="middle" fill={colors.text} fontSize="10">{labels[index]}</text></g> })}
  </svg></TooltipSurface>
}
