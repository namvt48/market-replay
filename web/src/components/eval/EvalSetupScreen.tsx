import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchCalendar, fetchSymbols } from '../../api/client'
import type { CalendarEntry, SymbolMeta } from '../../api/types'
import {
  EVAL_PRESETS,
  evalConfigSchema,
  evalStatus,
  newRuntime,
  type EvalConfig,
} from '../../eval/rules'
import { useEvalStore } from '../../store/eval-store'
import { flushPreferenceSync } from '../../store/preference-sync'

function terminalEvalConfig(config: EvalConfig): EvalConfig {
  return { ...config, phase: 'eval', verificationProfitTarget: 0, payout: undefined }
}

function formatMoney(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function parseDateToEpoch(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return Math.floor(Date.now() / 1000)
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000)
}

function epochToDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10)
}

export function EvalSetupScreen() {
  const createEvaluation = useEvalStore((state) => state.createEvaluation)

  const [symbols, setSymbols] = useState<SymbolMeta[]>([])
  const [symbolsFailed, setSymbolsFailed] = useState(false)
  const [calendar, setCalendar] = useState<CalendarEntry[]>([])
  const [calendarFailed, setCalendarFailed] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [config, setConfig] = useState<EvalConfig>(() => terminalEvalConfig(EVAL_PRESETS[0]))
  const [starting, setStarting] = useState(false)
  const startingRef = useRef(false)

  // Evaluations are account-wide. The first available market only provides
  // the shared replay calendar/timezone anchor; it does not restrict trading.
  useEffect(() => {
    let cancelled = false
    fetchSymbols()
      .then((list) => {
        if (cancelled) return
        setSymbols(list)
        setSymbolsFailed(false)
      })
      .catch(() => {
        if (cancelled) return
        setSymbolsFailed(true)
      })
    return () => { cancelled = true }
  }, [])

  // Load one canonical 1m calendar and use its epoch timestamp as the shared
  // cursor. Every chart source is then aligned to this cursor by the engine.
  useEffect(() => {
    const meta = symbols[0]
    if (!meta) return
    const range = meta?.ranges['1m']
    const now = Math.floor(Date.now() / 1000)
    const from = range?.from ?? now - 730 * 86400
    const to = range?.to ?? now
    let cancelled = false
    setCalendar([])
    setCalendarFailed(false)
    setStartDate('')
    fetchCalendar(meta.symbol, '1m', from, to)
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
  }, [symbols])

  // Escape returns to the workspace.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') window.location.assign('/')
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const presets = useMemo(() => EVAL_PRESETS.map(terminalEvalConfig), [])

  const previewLine = useMemo(() => {
    const runtime = newRuntime(config)
    const status = evalStatus(config, runtime, {
      balance: config.accountSize,
      equity: config.accountSize,
      trades: [],
    })
    const passAt = config.accountSize + config.profitTarget
    const parts = [
      `Pass at $${formatMoney(passAt)}`,
      `fail below $${formatMoney(status.floor)}`,
    ]
    if (config.maxDailyLoss > 0) parts.push(`daily stop $${formatMoney(config.maxDailyLoss)}`)
    return parts.join(' \u00b7 ')
  }, [config])

  const validation = evalConfigSchema.safeParse(config)
  const canStart = symbols.length > 0 && startDate !== '' && validation.success
  const calendarBounds = useMemo(() => {
    const first = calendar[0]
    const last = calendar[calendar.length - 1]
    if (first && last) return { min: first.date, max: last.date }
    const range = symbols[0]?.ranges['1m']
    if (!range) return null
    return { min: epochToDate(range.from), max: epochToDate(range.to) }
  }, [calendar, symbols])
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

  async function handleStart() {
    if (!canStart || startingRef.current) return
    startingRef.current = true
    setStarting(true)
    const entry = calendar.find((e) => e.date === startDate)
    const startTs = entry?.firstTs ?? parseDateToEpoch(startDate)
    const sessionTimezone = symbols[0]?.sessionTz ?? 'UTC'
    createEvaluation(config, null, startDate, startTs, sessionTimezone)
    await flushPreferenceSync()
    window.location.assign('/')
  }

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

        <label className="field-label max-w-sm">
          <span>Start date</span>
          <input
            type="date"
            value={startDate}
            min={calendarBounds?.min || undefined}
            max={calendarBounds?.max || undefined}
            onChange={(event) => { if (event.target.value) setStartDate(event.target.value) }}
            className="h-11 w-full rounded-control border border-line bg-surface-2 px-3 text-ui-control text-ink outline-none transition-colors hover:border-line-strong focus-visible:border-active [color-scheme:dark] sm:h-9"
            aria-label="Start date"
          />
          {symbolsFailed ? <span className="text-ui-body text-loss">Markets are unavailable.</span> : null}
          {calendarFailed ? <span className="text-ui-body text-loss">Calendar is unavailable.</span> : null}
        </label>

        <p className="font-mono text-ui-body text-muted">{previewLine}</p>
        {validationMessage ? <p role="alert" className="text-ui-body text-loss-bright">Check rule parameters: {validationMessage}</p> : null}

        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart || starting}
          className="primary-button min-h-11 w-full sm:min-h-9 sm:w-auto"
        >
          CREATE EVALUATION ACCOUNT <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}
