import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState, type ChangeEvent, type ReactElement } from 'react'
import type { CalendarDatum } from './analytics-view-model'

type CalendarMetric = 'dollar' | 'percent' | 'riskReward'
type CalendarView = 'month' | 'year'

interface PerformanceCalendarProps {
  entries: CalendarDatum[]
  initialDate: string
  onSelectDate?: (date: string) => void
}

interface CalendarCursor {
  year: number
  month: number
}

interface MonthCell {
  date: string
  day: number
  outside: boolean
  entry: CalendarDatum | null
}

const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const percentage = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const compactNumber = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })

function parseDateKey(value: string): CalendarCursor {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value)
  if (!match) {
    const now = new Date()
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() }
  }
  return { year: Number(match[1]), month: Number(match[2]) - 1 }
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function buildMonthCells(year: number, month: number, entries: Map<string, CalendarDatum>): MonthCell[] {
  const first = new Date(Date.UTC(year, month, 1))
  const mondayOffset = (first.getUTCDay() + 6) % 7
  const start = new Date(Date.UTC(year, month, 1 - mondayOffset))
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    const key = dateKey(date)
    return {
      date: key,
      day: date.getUTCDate(),
      outside: date.getUTCMonth() !== month,
      entry: entries.get(key) ?? null,
    }
  })
}

function metricValue(entry: CalendarDatum, metric: CalendarMetric): string {
  if (metric === 'percent') return `${percentage.format(entry.pnlPercent)}%`
  if (metric === 'riskReward') return entry.riskReward === null ? '—' : `${entry.riskReward.toFixed(2)} RR`
  return currency.format(entry.pnl)
}

function compactMetricValue(entry: CalendarDatum, metric: CalendarMetric): string {
  if (metric === 'percent') return `${percentage.format(entry.pnlPercent)}%`
  if (metric === 'riskReward') return entry.riskReward === null ? '—' : `${entry.riskReward.toFixed(1)}R`
  const absolute = Math.abs(entry.pnl)
  const compact = absolute >= 1_000 ? `${compactNumber.format(absolute / 1_000)}K` : compactNumber.format(absolute)
  return `${entry.pnl < 0 ? '−' : ''}$${compact}`
}

function cellTone(entry: CalendarDatum | null, outside: boolean): string {
  if (outside) return 'border-line bg-surface-2 text-dim'
  if (!entry) return 'border-line-strong bg-surface-0 text-muted'
  if (entry.pnl > 0) return 'border-profit/60 bg-profit/15 text-profit-bright'
  if (entry.pnl < 0) return 'border-loss/60 bg-loss/15 text-loss-bright'
  return 'border-caution/70 bg-caution/15 text-caution-bright'
}

function tradeLabel(trades: number): string {
  return `${trades} trade${trades === 1 ? '' : 's'}`
}

interface MonthGridProps {
  year: number
  month: number
  entries: Map<string, CalendarDatum>
  metric: CalendarMetric
  onSelectDate?: (date: string) => void
}

function MonthGrid({ year, month, entries, metric, onSelectDate }: MonthGridProps): ReactElement {
  const cells = useMemo(() => buildMonthCells(year, month, entries), [entries, month, year])
  return (
    <div className="min-w-0 sm:min-w-[760px]" role="group" aria-label={`${monthNames[month]} ${year} performance calendar`}>
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((day) => <div key={day} className="pb-2 text-center text-ui-meta font-medium text-muted sm:text-ui-control"><span className="sm:hidden">{day.slice(0, 1)}</span><span className="hidden sm:inline">{day}</span></div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const showData = !cell.outside && cell.entry !== null
          const value = showData && cell.entry ? metricValue(cell.entry, metric) : ''
          const label = cell.entry
            ? `${cell.date}, ${tradeLabel(cell.entry.trades)}, ${metric === 'dollar' ? 'profit' : metric === 'percent' ? 'profit percent' : 'risk reward'} ${value}`
            : cell.date
          return (
            <button
              key={cell.date}
              type="button"
              disabled={!showData || !onSelectDate}
              onClick={() => onSelectDate?.(cell.date)}
              aria-label={showData ? `Open ${label}` : label}
              className={`flex min-h-20 min-w-0 flex-col justify-between rounded-control border p-1 text-left transition-colors hover:brightness-110 disabled:cursor-default disabled:hover:brightness-100 sm:min-h-24 sm:p-2.5 ${cellTone(cell.entry, cell.outside)}`}
            >
              <div className="flex items-start justify-between gap-1 text-[10px] sm:gap-2 sm:text-ui-body">
                <span className={showData ? 'min-w-0 truncate text-muted' : 'text-transparent'}>{showData && cell.entry ? <><span className="sm:hidden">{cell.entry.trades}t</span><span className="hidden sm:inline">{tradeLabel(cell.entry.trades)}</span></> : '—'}</span>
                <strong className={`shrink-0 font-mono tabular-nums ${cell.outside ? 'text-dim' : 'text-ink'}`}>{cell.day}</strong>
              </div>
              {showData && cell.entry ? <strong className="min-w-0 truncate font-mono text-[10px] font-semibold tabular-nums sm:text-ui-title"><span className="sm:hidden">{compactMetricValue(cell.entry, metric)}</span><span className="hidden sm:inline">{value}</span></strong> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface YearGridProps {
  year: number
  entries: Map<string, CalendarDatum>
  onOpenMonth: (month: number) => void
  onSelectDate?: (date: string) => void
}

function YearGrid({ year, entries, onOpenMonth, onSelectDate }: YearGridProps): ReactElement {
  return (
    <div className="grid gap-x-7 gap-y-6 md:grid-cols-2 xl:grid-cols-4" aria-label={`${year} yearly performance calendar`}>
      {monthNames.map((monthName, month) => {
        const cells = buildMonthCells(year, month, entries)
        return (
          <section key={monthName} aria-labelledby={`calendar-month-${year}-${month}`}>
            <h3 id={`calendar-month-${year}-${month}`} className="mb-2 text-center text-ui-title font-medium text-ink">{monthName}</h3>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((cell) => {
                const hasTrades = !cell.outside && cell.entry !== null
                const sharedClass = `grid aspect-square min-h-8 place-items-center rounded-control border font-mono text-ui-meta tabular-nums ${cellTone(cell.entry, cell.outside)}`
                if (!hasTrades) return <div key={cell.date} aria-hidden="true" className={sharedClass}>{cell.day}</div>
                return (
                  <button
                    key={cell.date}
                    type="button"
                    aria-label={`Open ${monthName} ${cell.day}, ${year}; ${tradeLabel(cell.entry?.trades ?? 0)}`}
                    onClick={() => onSelectDate ? onSelectDate(cell.date) : onOpenMonth(month)}
                    className={`${sharedClass} transition-colors hover:brightness-125`}
                  >
                    {cell.day}
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function PerformanceCalendar({ entries, initialDate, onSelectDate }: PerformanceCalendarProps): ReactElement {
  const initialCursor = useMemo(() => parseDateKey(initialDate), [initialDate])
  const [cursor, setCursor] = useState<CalendarCursor>(initialCursor)
  const [metric, setMetric] = useState<CalendarMetric>('dollar')
  const [view, setView] = useState<CalendarView>('month')
  const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.date, entry])), [entries])

  const shiftMonth = (amount: number): void => {
    setCursor((current) => {
      const date = new Date(Date.UTC(current.year, current.month + amount, 1))
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() }
    })
  }
  const shiftYear = (amount: number): void => setCursor((current) => ({ ...current, year: current.year + amount }))
  const changeMetric = (event: ChangeEvent<HTMLSelectElement>): void => setMetric(event.target.value as CalendarMetric)
  const openMonth = (month: number): void => {
    setCursor((current) => ({ ...current, month }))
    setView('month')
  }

  return (
    <section aria-labelledby="performance-calendar-title">
      <h2 id="performance-calendar-title" className="mb-4 text-[21px] font-semibold leading-7 tracking-[-0.02em] text-ink">Performance calendar</h2>
      <div className="rounded-[14px] border border-line-strong bg-surface-1 p-3 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="relative">
            <span className="sr-only">Calendar metric</span>
            <select value={metric} onChange={changeMetric} className="h-11 appearance-none rounded-[18px] border border-line-strong bg-surface-0 pl-4 pr-10 text-ui-control font-medium text-ink outline-none transition-colors hover:border-muted focus:border-active sm:h-9">
              <option value="dollar">Dollar Profit</option>
              <option value="percent">% Profit</option>
              <option value="riskReward">Risk Reward</option>
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted" />
          </label>
          <div className="flex rounded-control bg-surface-0 p-1" role="group" aria-label="Calendar view">
            <button type="button" aria-label="Month view" aria-pressed={view === 'month'} onClick={() => setView('month')} className="min-h-9 rounded-control px-4 text-ui-control font-medium text-muted transition-colors hover:text-ink aria-pressed:bg-surface-3 aria-pressed:text-ink">Month</button>
            <button type="button" aria-label="Year view" aria-pressed={view === 'year'} onClick={() => setView('year')} className="min-h-9 rounded-control px-4 text-ui-control font-medium text-muted transition-colors hover:text-ink aria-pressed:bg-surface-3 aria-pressed:text-ink">Year</button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 sm:gap-5">
          {view === 'month' ? (
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)} className="tool-button"><ChevronLeft size={18} /></button>
              <span className="min-w-24 text-center text-[19px] font-semibold text-ink">{monthNames[cursor.month]}</span>
              <button type="button" aria-label="Next month" onClick={() => shiftMonth(1)} className="tool-button"><ChevronRight size={18} /></button>
            </div>
          ) : null}
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous year" onClick={() => shiftYear(-1)} className="tool-button"><ChevronLeft size={18} /></button>
            <span className="min-w-16 text-center text-[19px] font-semibold text-ink">{cursor.year}</span>
            <button type="button" aria-label="Next year" onClick={() => shiftYear(1)} className="tool-button"><ChevronRight size={18} /></button>
          </div>
          <span role="status" aria-label="Calendar period" className="sr-only" aria-live="polite">
            {view === 'month' ? `${monthNames[cursor.month]} ${cursor.year}` : String(cursor.year)}
          </span>
        </div>

        <div className="mt-5 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active" tabIndex={view === 'month' ? 0 : undefined} role={view === 'month' ? 'region' : undefined} aria-label={view === 'month' ? 'Scrollable monthly performance calendar' : undefined}>
          {view === 'month'
            ? <MonthGrid year={cursor.year} month={cursor.month} entries={entryMap} metric={metric} onSelectDate={onSelectDate} />
            : <YearGrid year={cursor.year} entries={entryMap} onOpenMonth={openMonth} onSelectDate={onSelectDate} />}
        </div>
      </div>
    </section>
  )
}
