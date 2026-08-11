import { ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchCalendar, fetchSymbols } from '../../api/client'
import type { CalendarEntry, SymbolMeta } from '../../api/types'
import {
  EVAL_PRESETS,
  customConfig,
  evalConfigSchema,
  evalStatus,
  newRuntime,
  type ConsistencyMode,
  type EvalConfig,
} from '../../eval/rules'
import { useEvalStore } from '../../store/eval-store'
import { flushPreferenceSync } from '../../store/preference-sync'

type NumberField = 'accountSize' | 'profitTarget' | 'verificationProfitTarget' | 'maxDailyLoss' | 'maxTotalLoss' | 'maxPositionSize' | 'minTradingDays' | 'consistencyRulePct'
type DrawdownMode = 'static' | 'trailing' | 'locked' | 'target-locked' | 'eod'

const NUMBER_FIELDS: { key: NumberField; label: string; step: number }[] = [
  { key: 'accountSize', label: 'Account size', step: 500 },
  { key: 'profitTarget', label: 'Profit target', step: 500 },
  { key: 'verificationProfitTarget', label: 'Verification target (0 = one phase)', step: 500 },
  { key: 'maxDailyLoss', label: 'Max daily loss (0 = none)', step: 500 },
  { key: 'maxTotalLoss', label: 'Max total loss', step: 500 },
  { key: 'maxPositionSize', label: 'Max position size (0 = unlimited)', step: 1 },
  { key: 'minTradingDays', label: 'Min trading days (0 = none)', step: 1 },
  { key: 'consistencyRulePct', label: 'Consistency max % (0 = none)', step: 1 },
]

const DRAWDOWN_MODES: { mode: DrawdownMode; label: string }[] = [
  { mode: 'static', label: 'STATIC' },
  { mode: 'trailing', label: 'TRAILING' },
  { mode: 'locked', label: 'LOCK AT STARTING BALANCE' },
  { mode: 'target-locked', label: 'LOCK AT PROFIT TARGET' },
  { mode: 'eod', label: 'EOD TRAILING' },
]

function drawdownMode(config: EvalConfig): DrawdownMode {
  if (config.drawdownType === 'static') return 'static'
  if (config.trailingEod) return 'eod'
  if (config.trailingLockAtTarget) return 'target-locked'
  if (config.trailingLocksAtStart) return 'locked'
  return 'trailing'
}

function applyDrawdownMode(config: EvalConfig, mode: DrawdownMode): EvalConfig {
  if (mode === 'static') return { ...config, firm: 'Custom', drawdownType: 'static', trailingLocksAtStart: false, trailingLockAtTarget: false, trailingEod: false }
  if (mode === 'locked') return { ...config, firm: 'Custom', drawdownType: 'trailing', trailingLocksAtStart: true, trailingLockAtTarget: false, trailingEod: false }
  if (mode === 'target-locked') return { ...config, firm: 'Custom', drawdownType: 'trailing', trailingLocksAtStart: false, trailingLockAtTarget: true, lockMargin: config.lockMargin || 2000, trailingEod: false }
  if (mode === 'eod') return { ...config, firm: 'Custom', drawdownType: 'trailing', trailingLocksAtStart: false, trailingLockAtTarget: false, trailingEod: true }
  return { ...config, firm: 'Custom', drawdownType: 'trailing', trailingLocksAtStart: false, trailingLockAtTarget: false, trailingEod: false }
}

const CONSISTENCY_MODES: ReadonlyArray<{ value: ConsistencyMode; label: string }> = [
  { value: 'net-profit', label: 'Best day / net profit (Apex)' },
  { value: 'of-profit-target', label: 'Best day / profit target (Topstep)' },
  { value: 'positive-days', label: 'Best day / positive-days profit (FTMO 1-step)' },
]

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
  const [config, setConfig] = useState<EvalConfig>(() => ({ ...EVAL_PRESETS[0] }))
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
          : activeMode === 'target-locked'
            ? `locks after target + $${formatMoney(config.lockMargin)}`
          : 'trailing'
    const parts = [
      `Pass at $${formatMoney(passAt)}`,
      `breach below $${formatMoney(status.floor)} (${breach})`,
    ]
    if (config.maxDailyLoss > 0) parts.push(`daily stop $${formatMoney(config.maxDailyLoss)}`)
    if (config.maxPositionSize > 0) parts.push(`max ${config.maxPositionSize} contracts`)
    if (config.verificationProfitTarget > 0) parts.push(`verification target $${formatMoney(config.verificationProfitTarget)}`)
    if (config.consistencyRulePct > 0) {
      const base = config.consistencyMode === 'of-profit-target'
        ? 'profit target'
        : config.consistencyMode === 'positive-days'
          ? 'positive-days profit'
          : 'net profit'
      parts.push(`best day ≤ ${config.consistencyRulePct}% of ${base}`)
    }
    return parts.join(' \u00b7 ')
  }, [config, activeMode])

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
            <div className="field-label">
              <span>Market access</span>
              <div className="flex h-11 items-center justify-between rounded-control border border-line bg-surface-2 px-3 sm:h-9">
                <span className="text-ui-control font-medium text-ink">All symbols</span>
                <span className="font-mono text-ui-meta text-dim">{symbols.length > 0 ? `${symbols.length} AVAILABLE` : 'LOADING'}</span>
              </div>
              {symbolsFailed && <span className="text-ui-body text-loss">Failed to load symbols</span>}
            </div>
            <label className="field-label">
              <span>Start date (locked once you begin)</span>
              <input
                type="date"
                value={startDate}
                min={calendarBounds?.min || undefined}
                max={calendarBounds?.max || undefined}
                onChange={(e) => { if (e.target.value) setStartDate(e.target.value) }}
                className="h-11 w-full rounded-control border border-line bg-surface-2 px-3 text-ui-control text-ink outline-none transition-colors hover:border-line-strong focus-visible:border-active [color-scheme:dark] sm:h-9"
                aria-label="Start date"
              />
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
                  min={field.key === 'accountSize' || field.key === 'profitTarget' || field.key === 'maxTotalLoss' ? 1 : 0}
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
                    }))
                  }
                  aria-invalid={(field.key === 'accountSize' || field.key === 'profitTarget' || field.key === 'maxTotalLoss') && config[field.key] <= 0}
                  className="field-input min-h-11 w-full sm:min-h-9"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <label className="field-label">
            <span>Consistency formula</span>
            <div className="relative">
              <select
                value={config.consistencyMode}
                onChange={(event) => setConfig((previous) => ({ ...previous, firm: 'Custom', consistencyMode: event.target.value as ConsistencyMode }))}
                className={selectClass}
                aria-label="Consistency formula"
              >
                {CONSISTENCY_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" size={14} />
            </div>
          </label>
          <label className="field-label">
            <span>Daily loss basis</span>
            <div className="relative">
              <select
                value={config.dailyLossBase}
                onChange={(event) => setConfig((previous) => ({ ...previous, firm: 'Custom', dailyLossBase: event.target.value === 'midnight-balance' ? 'midnight-balance' : 'day-start-equity' }))}
                className={selectClass}
                aria-label="Daily loss basis"
              >
                <option value="day-start-equity">Equity at first session tick</option>
                <option value="midnight-balance">Midnight balance</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" size={14} />
            </div>
          </label>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-ui-body font-medium text-muted">Drawdown type</h2>
          <div className="grid grid-cols-2 gap-1 rounded-control bg-surface-0 p-0.5 sm:grid-cols-5">
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

        {activeMode === 'target-locked' ? (
          <label className="field-label max-w-xs">
            <span>Lock margin above profit target</span>
            <input
              type="number"
              min={0}
              step={100}
              value={config.lockMargin}
              onChange={(event) => setConfig((previous) => ({ ...previous, firm: 'Custom', lockMargin: Math.max(0, Math.round(Number(event.target.value) || 0)) }))}
              className="field-input min-h-11 w-full sm:min-h-9"
            />
          </label>
        ) : null}

        {config.firm !== 'Custom' && config.payout ? (
          <section className="border-y border-line py-4" aria-labelledby="payout-rules-heading">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="payout-rules-heading" className="text-ui-body font-medium text-ink">Funded payout rules</h2>
              <span className="font-mono text-ui-meta text-profit-bright">{config.payout.profitSplit}% trader split</span>
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-ui-body sm:grid-cols-2">
              <div className="flex justify-between gap-3"><dt className="text-muted">Eligibility</dt><dd className="text-right text-ink">{config.payout.eligibilityMode}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Winning days</dt><dd className="font-mono text-ink">{config.payout.minWinningDays || '—'}{config.payout.minDailyProfit > 0 ? ` × $${formatMoney(config.payout.minDailyProfit)}` : ''}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Funded days</dt><dd className="font-mono text-ink">{config.payout.minFundedDays || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Payout consistency</dt><dd className="font-mono text-ink">{config.payout.eligibilityConsistencyPct > 0 ? `${config.payout.eligibilityConsistencyPct}%` : 'None'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Payout cap</dt><dd className="font-mono text-ink">{config.payout.maxPayoutPct > 0 ? `${config.payout.maxPayoutPct}%` : 'No % cap'} · {config.payout.maxPayoutAmount > 0 ? `$${formatMoney(config.payout.maxPayoutAmount)}` : 'No $ cap'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Safety net</dt><dd className="text-right text-ink">{config.payout.safetyNet === 'drawdown-plus' ? `Drawdown + $${formatMoney(config.payout.safetyNetMargin)}` : 'None'}</dd></div>
            </dl>
          </section>
        ) : null}

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
