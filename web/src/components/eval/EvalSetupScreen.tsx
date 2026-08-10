import { ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchCalendar, fetchSymbols } from '../../api/client'
import type { CalendarEntry, SymbolMeta } from '../../api/types'
import {
  EVAL_PRESETS,
  customConfig,
  evalConfigSchema,
  evalStatus,
  newRuntime,
  type EvalConfig,
} from '../../eval/rules'
import { useEvalStore } from '../../store/eval-store'

type NumberField = 'accountSize' | 'profitTarget' | 'maxDailyLoss' | 'maxTotalLoss' | 'minTradingDays' | 'consistencyRulePct'
type DrawdownMode = 'static' | 'trailing' | 'locked' | 'eod'

const NUMBER_FIELDS: { key: NumberField; label: string; step: number }[] = [
  { key: 'accountSize', label: 'Account size', step: 500 },
  { key: 'profitTarget', label: 'Profit target', step: 500 },
  { key: 'maxDailyLoss', label: 'Max daily loss (0 = none)', step: 500 },
  { key: 'maxTotalLoss', label: 'Max total loss', step: 500 },
  { key: 'minTradingDays', label: 'Min trading days (0 = none)', step: 1 },
  { key: 'consistencyRulePct', label: 'Consistency max % (0 = none)', step: 1 },
]

const DRAWDOWN_MODES: { mode: DrawdownMode; label: string }[] = [
  { mode: 'static', label: 'STATIC' },
  { mode: 'trailing', label: 'TRAILING' },
  { mode: 'locked', label: 'LOCK AT STARTING BALANCE' },
  { mode: 'eod', label: 'EOD TRAILING' },
]

function drawdownMode(config: EvalConfig): DrawdownMode {
  if (config.drawdownType === 'static') return 'static'
  if (config.trailingEod) return 'eod'
  if (config.trailingLocksAtStart) return 'locked'
  return 'trailing'
}

function applyDrawdownMode(config: EvalConfig, mode: DrawdownMode): EvalConfig {
  if (mode === 'static') return { ...config, firm: 'Custom', drawdownType: 'static', trailingLocksAtStart: false, trailingEod: false }
  if (mode === 'locked') return { ...config, firm: 'Custom', drawdownType: 'trailing', trailingLocksAtStart: true, trailingEod: false }
  if (mode === 'eod') return { ...config, firm: 'Custom', drawdownType: 'trailing', trailingLocksAtStart: false, trailingEod: true }
  return { ...config, firm: 'Custom', drawdownType: 'trailing', trailingLocksAtStart: false, trailingEod: false }
}

function formatMoney(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function parseDateToEpoch(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return Math.floor(Date.now() / 1000)
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000)
}

export function EvalSetupScreen() {
  const createEvaluation = useEvalStore((state) => state.createEvaluation)

  const [symbols, setSymbols] = useState<SymbolMeta[]>([])
  const [symbolsFailed, setSymbolsFailed] = useState(false)
  const [calendar, setCalendar] = useState<CalendarEntry[]>([])
  const [calendarFailed, setCalendarFailed] = useState(false)
  const [instrument, setInstrument] = useState('')
  const [startDate, setStartDate] = useState('')
  const [config, setConfig] = useState<EvalConfig>(() => ({ ...EVAL_PRESETS[0] }))

  // Load the symbol list once on mount; default to the first symbol.
  useEffect(() => {
    let cancelled = false
    fetchSymbols()
      .then((list) => {
        if (cancelled) return
        setSymbols(list)
        setSymbolsFailed(false)
        if (list[0]) setInstrument(list[0].symbol)
      })
      .catch(() => {
        if (cancelled) return
        setSymbolsFailed(true)
      })
    return () => { cancelled = true }
  }, [])

  // Load the 1m calendar for the active instrument; default to the middle date.
  useEffect(() => {
    if (!instrument) return
    const meta = symbols.find((s) => s.symbol === instrument)
    const range = meta?.ranges['1m']
    const now = Math.floor(Date.now() / 1000)
    const from = range?.from ?? now - 730 * 86400
    const to = range?.to ?? now
    let cancelled = false
    setCalendar([])
    setCalendarFailed(false)
    setStartDate('')
    fetchCalendar(instrument, '1m', from, to)
      .then((entries) => {
        if (cancelled) return
        setCalendar(entries)
        const mid = entries[Math.floor(entries.length / 2)]
        if (mid) setStartDate(mid.date)
      })
      .catch(() => {
        if (cancelled) return
        setCalendarFailed(true)
      })
    return () => { cancelled = true }
  }, [instrument, symbols])

  // Escape returns to the workspace.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') window.location.assign('/')
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const presets = useMemo(
    () => [...EVAL_PRESETS, customConfig(config.accountSize)],
    [config.accountSize],
  )
  const activeMode = drawdownMode(config)

  const previewLine = useMemo(() => {
    const runtime = newRuntime(config)
    const status = evalStatus(config, runtime, {
      balance: config.accountSize,
      equity: config.accountSize,
      trades: [],
    })
    const passAt = config.accountSize + config.profitTarget
    const breach = activeMode === 'static'
      ? 'static'
      : activeMode === 'eod'
        ? 'EOD trailing'
        : activeMode === 'locked'
          ? `locked at $${formatMoney(config.accountSize)}`
          : 'trailing'
    const parts = [
      `Pass at $${formatMoney(passAt)}`,
      `breach below $${formatMoney(status.floor)} (${breach})`,
    ]
    if (config.maxDailyLoss > 0) parts.push(`daily stop $${formatMoney(config.maxDailyLoss)}`)
    if (config.consistencyRulePct > 0) parts.push(`best day ≤ ${config.consistencyRulePct}% of net profit`)
    return parts.join(' \u00b7 ')
  }, [config, activeMode])

  const validation = evalConfigSchema.safeParse(config)
  const canStart = instrument !== '' && startDate !== '' && validation.success
  const validationMessage = validation.success
    ? null
    : config.accountSize <= 0
      ? 'Account size must be greater than 0.'
      : config.profitTarget <= 0
        ? 'Profit target must be greater than 0.'
        : config.maxTotalLoss <= 0
          ? 'Max total loss must be greater than 0.'
          : config.consistencyRulePct < 0 || config.consistencyRulePct > 100
            ? 'Consistency must be between 0 and 100%.'
            : 'Rule parameters contain an invalid value.'

  function handleStart() {
    if (!canStart) return
    const entry = calendar.find((e) => e.date === startDate)
    const startTs = entry?.firstTs ?? parseDateToEpoch(startDate)
    const sessionTimezone = symbols.find((symbol) => symbol.symbol === instrument)?.sessionTz ?? 'UTC'
    createEvaluation(config, instrument, startDate, startTs, sessionTimezone)
    window.location.assign('/')
  }

  const selectClass =
    'h-11 w-full appearance-none rounded-control border border-line bg-surface-2 pl-3 pr-8 text-ui-control text-ink outline-none transition-colors hover:border-line-strong focus-visible:border-active sm:h-9'

  return (
    <div className="h-[100dvh] overflow-y-auto bg-surface-0 text-ink">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => window.location.assign('/')}
            className="secondary-button min-h-11 w-fit sm:min-h-9"
            aria-label="Back to workspace"
          >
            <ArrowLeft size={14} /> BACK
          </button>
          <span className="text-ui-body font-semibold tracking-[0.14em] text-dim">EVALUATION</span>
          <h1
            className="font-bold leading-[1.05] tracking-[-0.02em] text-ink"
            style={{ fontSize: 'clamp(1.75rem, 4vw, 2.875rem)' }}
          >
            Evaluation Simulator
          </h1>
          <p className="max-w-xl text-ui-title leading-relaxed text-muted">
            Chase the profit target without breaching the daily-loss or drawdown limits on historical replay data. Pure simulation: no real firm, account, or funding.
          </p>
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="text-ui-body font-medium text-muted">Account preset</h2>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => {
              const active = preset.firm === config.firm
              return (
                <button
                  key={preset.firm}
                  type="button"
                  onClick={() => setConfig({ ...preset })}
                  aria-pressed={active}
                  className={`min-h-11 rounded-control border px-3 py-1.5 text-ui-control font-medium transition-colors sm:min-h-9 ${
                    active
                      ? 'border-active bg-active text-white'
                      : 'border-line bg-surface-2 text-muted hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {preset.firm}
                </button>
              )
            })}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="field-label">
              <span>Instrument</span>
              <div className="relative">
                <select
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                  className={selectClass}
                  aria-label="Instrument"
                >
                  {symbols.length === 0
                    ? <option value="">—</option>
                    : symbols.map((s) => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" size={14} />
              </div>
              {symbolsFailed && <span className="text-ui-body text-loss">Failed to load symbols</span>}
            </label>
            <label className="field-label">
              <span>Start date (locked once you begin)</span>
              <div className="relative">
                <select
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={selectClass}
                  aria-label="Start date"
                >
                  {calendar.length === 0
                    ? <option value="">—</option>
                    : calendar.map((entry) => <option key={entry.date} value={entry.date}>{entry.date}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" size={14} />
              </div>
              {calendarFailed && <span className="text-ui-body text-loss">Failed to load calendar</span>}
            </label>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-ui-body font-medium text-muted">Rule parameters</h2>
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
          >
            {NUMBER_FIELDS.map((field) => (
              <label key={field.key} className="field-label">
                <span>{field.label}</span>
                <input
                  type="number"
                  min={field.key === 'maxDailyLoss' || field.key === 'minTradingDays' || field.key === 'consistencyRulePct' ? 0 : 1}
                  max={field.key === 'consistencyRulePct' ? 100 : undefined}
                  step={field.step}
                  inputMode="numeric"
                  value={config[field.key]}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      [field.key]: field.key === 'consistencyRulePct'
                        ? Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0)))
                        : Math.max(0, Math.round(Number(e.target.value) || 0)),
                      firm: 'Custom',
                    } as EvalConfig))
                  }
                  aria-invalid={field.key !== 'maxDailyLoss' && field.key !== 'minTradingDays' && field.key !== 'consistencyRulePct' && config[field.key] <= 0}
                  className="field-input min-h-11 w-full sm:min-h-9"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-ui-body font-medium text-muted">Drawdown type</h2>
          <div className="grid grid-cols-2 gap-1 rounded-control bg-surface-0 p-0.5 sm:grid-cols-4">
            {DRAWDOWN_MODES.map(({ mode, label }) => {
              const active = mode === activeMode
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setConfig((prev) => applyDrawdownMode(prev, mode))}
                  aria-pressed={active}
                  className={`min-h-11 rounded-[3px] px-2 py-1.5 text-ui-control font-medium leading-tight transition-colors sm:min-h-9 ${
                    active ? 'bg-active text-white' : 'text-muted hover:bg-surface-3 hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </section>

        <p className="font-mono text-ui-body text-muted">{previewLine}</p>
        {validationMessage ? <p role="alert" className="text-ui-body text-loss-bright">Check rule parameters: {validationMessage}</p> : null}

        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart}
          className="primary-button min-h-11 w-full sm:min-h-9 sm:w-auto"
        >
          CREATE EVALUATION ACCOUNT <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}
