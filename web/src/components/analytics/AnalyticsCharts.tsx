import type { PointDatum, SessionDatum, SplitPointDatum } from './analytics-view-model'

interface LineChartProps {
  values: number[]
  compact?: boolean
  ariaLabel: string
}

function linePoints(values: number[], width: number, height: number, inset: number): string {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(1, max - min)
  return values.map((value, index) => {
    const x = inset + (index / Math.max(1, values.length - 1)) * (width - inset * 2)
    const y = inset + ((max - value) / span) * (height - inset * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

export function LineChart({ values, compact = false, ariaLabel }: LineChartProps) {
  const width = 1000
  const height = compact ? 92 : 260
  const points = linePoints(values, width, height, compact ? 7 : 22)
  const zeroY = (() => {
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = Math.max(1, max - min)
    return 22 + ((max - 0) / span) * (height - 44)
  })()

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel} className={compact ? 'h-20 w-full' : 'h-64 w-full min-w-[720px]'}>
      <title>{ariaLabel}</title>
      {compact ? null : [22, 76, 130, 184, 238].map((y) => <line key={y} x1="22" x2="978" y1={y} y2={y} stroke="#434651" strokeDasharray="7 7" vectorEffect="non-scaling-stroke" />)}
      {compact ? null : <line x1="22" x2="978" y1={zeroY} y2={zeroY} stroke="#5b8cff" strokeOpacity="0.55" vectorEffect="non-scaling-stroke" />}
      <polyline points={points} fill="none" stroke="#2962ff" strokeWidth={compact ? 2 : 2.4} vectorEffect="non-scaling-stroke" />
      {values.map((_, index) => {
        if (!compact && index % 2 !== 0) return null
        const [x, y] = points.split(' ')[index]?.split(',').map(Number) ?? [0, 0]
        return <circle key={`${x}-${y}`} cx={x} cy={y} r={compact ? 2.4 : 2.8} fill="#131722" stroke="#d1d4dc" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      })}
    </svg>
  )
}

interface DonutProps {
  buy: number
  sell: number
  ariaLabel: string
}

export function Donut({ buy, sell, ariaLabel }: DonutProps) {
  const radius = 66
  const circumference = 2 * Math.PI * radius
  const buyLength = circumference * buy / 100
  return (
    <svg viewBox="0 0 180 180" className="mx-auto size-48 max-w-full" role="img" aria-label={ariaLabel}>
      <title>{ariaLabel}</title>
      <circle cx="90" cy="90" r={radius} fill="none" stroke="#2a2e39" strokeWidth="32" />
      <circle cx="90" cy="90" r={radius} fill="none" stroke="#089981" strokeWidth="32" strokeDasharray={`${buyLength} ${circumference - buyLength}`} transform="rotate(-90 90 90)" />
      <circle cx="90" cy="90" r={radius} fill="none" stroke="#2962ff" strokeWidth="32" strokeDasharray={`${circumference - buyLength} ${buyLength}`} strokeDashoffset={-buyLength} transform="rotate(-90 90 90)" />
      <text x="48" y="94" fill="#ffffff" fontSize="12" fontWeight="600">{buy.toFixed(1)}%</text>
      <text x="109" y="94" fill="#ffffff" fontSize="12" fontWeight="600">{sell.toFixed(1)}%</text>
    </svg>
  )
}

interface WinRateRingsProps {
  buy: number
  sell: number
}

export function WinRateRings({ buy, sell }: WinRateRingsProps) {
  const outerCircumference = 2 * Math.PI * 66
  const innerCircumference = 2 * Math.PI * 49
  return (
    <svg viewBox="0 0 180 180" className="mx-auto size-48 max-w-full" role="img" aria-label={`Buy win rate ${buy} percent, sell win rate ${sell} percent`}>
      <title>Buy and sell win rates</title>
      <circle cx="90" cy="90" r="66" fill="none" stroke="#d1d4dc" strokeWidth="12" />
      <circle cx="90" cy="90" r="66" fill="none" stroke="#089981" strokeWidth="12" strokeDasharray={`${outerCircumference * buy / 100} ${outerCircumference * (100 - buy) / 100}`} transform="rotate(-90 90 90)" />
      <circle cx="90" cy="90" r="49" fill="none" stroke="#d1d4dc" strokeWidth="12" />
      <circle cx="90" cy="90" r="49" fill="none" stroke="#2962ff" strokeWidth="12" strokeDasharray={`${innerCircumference * sell / 100} ${innerCircumference * (100 - sell) / 100}`} transform="rotate(-90 90 90)" />
    </svg>
  )
}

interface RadarProps {
  datum: SessionDatum
}

export function Radar({ datum }: RadarProps) {
  const center = 90
  const radius = 58
  const [top, right, bottom, left] = datum.values
  const toPoint = (value: number, axis: 0 | 1 | 2 | 3): string => {
    const distance = radius * value / 100
    if (axis === 0) return `${center},${center - distance}`
    if (axis === 1) return `${center + distance},${center}`
    if (axis === 2) return `${center},${center + distance}`
    return `${center - distance},${center}`
  }
  const values = [top, right, bottom, left] as const
  return (
    <svg viewBox="0 0 180 180" className="mx-auto h-56 w-full max-w-64" role="img" aria-label={`${datum.label} by trading session`}>
      <title>{datum.label} by trading session</title>
      {[0.25, 0.5, 0.75, 1].map((scale) => (
        <polygon key={scale} points={`90,${90 - radius * scale} ${90 + radius * scale},90 90,${90 + radius * scale} ${90 - radius * scale},90`} fill="none" stroke="#898c96" strokeWidth="0.8" />
      ))}
      <line x1="90" y1="32" x2="90" y2="148" stroke="#898c96" strokeWidth="0.8" />
      <line x1="32" y1="90" x2="148" y2="90" stroke="#898c96" strokeWidth="0.8" />
      <polygon points={values.map((value, index) => toPoint(value, index as 0 | 1 | 2 | 3)).join(' ')} fill="#2962ff" fillOpacity="0.22" stroke="#5b8cff" strokeWidth="2" />
      {values.map((value, index) => {
        const [x, y] = toPoint(value, index as 0 | 1 | 2 | 3).split(',').map(Number)
        return <circle key={index} cx={x} cy={y} r="4" fill="#2962ff" stroke="#ffffff" strokeWidth="1" />
      })}
      <text x="90" y="19" textAnchor="middle" fill="#a3a6af" fontSize="10">Out of session</text>
      <text x="166" y="94" textAnchor="end" fill="#a3a6af" fontSize="10">Asia</text>
      <text x="90" y="170" textAnchor="middle" fill="#a3a6af" fontSize="10">New York</text>
      <text x="14" y="94" fill="#a3a6af" fontSize="10">London</text>
    </svg>
  )
}

interface VerticalBarsProps {
  data: PointDatum[]
  ariaLabel: string
  tone?: 'blue' | 'green'
}

export function VerticalBars({ data, ariaLabel, tone = 'blue' }: VerticalBarsProps) {
  const max = Math.max(1, ...data.map((datum) => datum.value))
  const barWidth = 760 / data.length
  return (
    <svg viewBox="0 0 820 250" preserveAspectRatio="none" className="h-64 w-full min-w-[720px]" role="img" aria-label={ariaLabel}>
      <title>{ariaLabel}</title>
      {[28, 80, 132, 184, 236].map((y) => <line key={y} x1="40" y1={y} x2="810" y2={y} stroke="#434651" strokeDasharray="7 7" vectorEffect="non-scaling-stroke" />)}
      {data.map((datum, index) => {
        const height = datum.value / max * 198
        const x = 44 + index * barWidth
        return <g key={datum.label}>
          <rect x={x} y={226 - height} width={Math.max(5, barWidth * 0.62)} height={height} rx="3" fill={tone === 'green' ? '#089981' : '#168bf2'} fillOpacity="0.78" stroke={tone === 'green' ? '#22ab94' : '#5b8cff'} strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
          <text x={x + barWidth * 0.31} y="245" textAnchor="middle" fill="#a3a6af" fontSize="10">{datum.label}</text>
        </g>
      })}
    </svg>
  )
}

interface SplitBarsProps {
  data: SplitPointDatum[]
  ariaLabel: string
}

export function SplitBars({ data, ariaLabel }: SplitBarsProps) {
  const max = Math.max(1, ...data.flatMap((datum) => [Math.abs(datum.profit), Math.abs(datum.loss)]))
  const barWidth = 760 / data.length
  return (
    <svg viewBox="0 0 820 250" preserveAspectRatio="none" className="h-64 w-full min-w-[720px]" role="img" aria-label={ariaLabel}>
      <title>{ariaLabel}</title>
      {[28, 80, 132, 184, 236].map((y) => <line key={y} x1="40" y1={y} x2="810" y2={y} stroke="#434651" strokeDasharray="7 7" vectorEffect="non-scaling-stroke" />)}
      <line x1="40" y1="132" x2="810" y2="132" stroke="#898c96" vectorEffect="non-scaling-stroke" />
      {data.map((datum, index) => {
        const positiveHeight = Math.abs(datum.profit) / max * 98
        const negativeHeight = Math.abs(datum.loss) / max * 98
        const x = 44 + index * barWidth
        const width = Math.max(5, barWidth * 0.65)
        return <g key={datum.label}>
          <rect x={x} y={132 - positiveHeight} width={width} height={positiveHeight} rx="3" fill="#089981" fillOpacity="0.62" stroke="#22ab94" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
          <rect x={x} y="132" width={width} height={negativeHeight} rx="3" fill="#e86759" fillOpacity="0.64" stroke="#ff7b6e" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
          <text x={x + width / 2} y="246" textAnchor="middle" fill="#a3a6af" fontSize="9">{datum.label}</text>
        </g>
      })}
    </svg>
  )
}

interface HorizontalDayBarsProps {
  data: Array<{ label: string; profit: number; loss: number; winRate: number | null }>
}

export function HorizontalDayBars({ data }: HorizontalDayBarsProps) {
  const max = Math.max(...data.flatMap((datum) => [Math.abs(datum.profit), Math.abs(datum.loss)]), 1)
  return (
    <svg viewBox="0 0 920 260" className="h-64 min-w-[720px] w-full" role="img" aria-label="Profit, loss and win rate by weekday">
      <title>Profit, loss and win rate by weekday</title>
      <text x="900" y="18" textAnchor="end" fill="#a3a6af" fontSize="12" fontWeight="600">Win rate</text>
      <line x1="440" y1="26" x2="440" y2="250" stroke="#898c96" />
      {data.map((datum, index) => {
        const y = 40 + index * 31
        const lossWidth = Math.abs(datum.loss) / max * 350
        const profitWidth = datum.profit / max * 350
        return <g key={datum.label}>
          <line x1="55" y1={y + 11} x2="810" y2={y + 11} stroke="#434651" strokeDasharray="7 7" />
          <text x="10" y={y + 9} fill="#a3a6af" fontSize="11">{datum.label}</text>
          <rect x={440 - lossWidth} y={y - 3} width={lossWidth} height="18" rx="3" fill="#e86759" />
          <rect x="440" y={y - 3} width={profitWidth} height="18" rx="3" fill="#089981" />
          <rect x="834" y={y - 4} width="66" height="20" rx="4" fill="#089981" />
          <text x="867" y={y + 10} textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">{datum.winRate === null ? '—' : `${datum.winRate}%`}</text>
        </g>
      })}
    </svg>
  )
}

interface FrequencyChartProps {
  labels: string[]
  values: number[]
  ariaLabel: string
}

export function FrequencyChart({ labels, values, ariaLabel }: FrequencyChartProps) {
  const max = Math.max(...values, 1)
  const barStep = 220 / values.length
  return (
    <svg viewBox="0 0 260 170" className="h-44 w-full" role="img" aria-label={ariaLabel}>
      <title>{ariaLabel}</title>
      {[15, 55, 95, 135].map((y) => <line key={y} x1="25" x2="250" y1={y} y2={y} stroke="#434651" strokeDasharray="6 6" />)}
      {values.map((value, index) => {
        const height = value / max * 125
        const x = 32 + index * barStep
        return <g key={`${labels[index]}-${value}`}>
          <rect x={x} y={140 - height} width="8" height={height} rx="4" fill="#168bf2" />
          <text x={x + 4} y="160" textAnchor="middle" fill="#a3a6af" fontSize="9">{labels[index]}</text>
        </g>
      })}
    </svg>
  )
}
