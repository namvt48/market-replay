import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { fetchCalendar, fetchSymbols } from '../../api/client'
import type { CalendarEntry, SymbolMeta } from '../../api/types'
import {
  customConfig,
  evalConfigSchema,
  evalStatus,
  newRuntime,
  type EvalConfig,
} from '../../eval/rules'
import { SOURCE_NAME_MAX_LENGTH, normalizedSourceName } from '../../sources/source-name'
import { getEvalState, renameEvalAccount, useEvalStore } from '../../store/eval-store'
import { flushPreferenceSync } from '../../store/preference-sync'

const MONEY_STEP = 500

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

interface NumberFieldProps {
  label: string
  value: number
  min: number
  max?: number
  step?: number
  hint?: string
  onChange: (value: number) => void
}

function NumberField({ label, value, min, max, step = MONEY_STEP, hint, onChange }: NumberFieldProps): ReactElement {
  return (
    <label className="field-label min-w-0">
      <span className="font-medium uppercase tracking-[0.08em] text-dim">
        {label}{hint ? <span className="font-normal"> {hint}</span> : null}
      </span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber
          if (Number.isFinite(next)) onChange(next)
        }}
        className="field-input h-11 w-full text-ui-control tabular-nums hover:border-line-strong focus-visible:border-active"
      />
    </label>
  )
}

interface CheckOptionProps {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}

function CheckOption({ checked, label, onChange }: CheckOptionProps): ReactElement {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-ui-meta font-medium uppercase tracking-[0.06em] text-muted">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} className="peer sr-only" />
      <span className="grid size-4 shrink-0 place-items-center rounded-[3px] border border-line-strong bg-surface-0 text-transparent transition-colors peer-checked:border-active peer-checked:bg-active peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-active">
        <Check size={11} strokeWidth={3} aria-hidden="true" />
      </span>
      <span>{label}</span>
    </label>
  )
}

export function EvalSetupScreen(): ReactElement {
  const startEvaluation = useEvalStore((state) => state.startEvaluation)

  const [symbols, setSymbols] = useState<SymbolMeta[]>([])
  const [symbolsFailed, setSymbolsFailed] = useState(false)
  const [calendar, setCalendar] = useState<CalendarEntry[]>([])
  const [calendarFailed, setCalendarFailed] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [accountName, setAccountName] = useState('')
  const [config, setConfig] = useState<EvalConfig>(() => terminalEvalConfig(customConfig()))
  const [starting, setStarting] = useState(false)
  const startingRef = useRef(false)

  // The selected market provides the initial chart, calendar, and timezone
  // anchor. The account can still accumulate trades across symbols afterward.
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

  const selectedMeta = symbols[0] ?? null
  const updateConfig = (changes: Partial<EvalConfig>): void => {
    setConfig((current) => ({ ...current, ...changes, firm: 'Custom' }))
  }

  const preview = useMemo(() => {
    const runtime = newRuntime(config)
    const status = evalStatus(config, runtime, {
      balance: config.accountSize,
      equity: config.accountSize,
      trades: [],
    })
    return { passAt: config.accountSize + config.profitTarget, floor: status.floor }
  }, [config])

  const validation = evalConfigSchema.safeParse(config)
  const normalizedAccountName = normalizedSourceName(accountName)
  const canStart = selectedMeta !== null && startDate !== '' && normalizedAccountName !== '' && validation.success
  const calendarBounds = useMemo(() => {
    const first = calendar[0]
    const last = calendar[calendar.length - 1]
    if (first && last) return { min: first.date, max: last.date }
    const range = selectedMeta?.ranges['1m']
    if (!range) return null
    return { min: epochToDate(range.from), max: epochToDate(range.to) }
  }, [calendar, selectedMeta])
  const validationMessage = validation.success
    ? normalizedAccountName === ''
      ? 'Enter a name for this evaluation account.'
      : null
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
    if (!selectedMeta) return
    // The first available market only supplies the shared calendar/timezone
    // anchor. Evaluation ownership is workspace-wide, never symbol-owned.
    startEvaluation(config, null, startDate, startTs, selectedMeta.sessionTz || 'UTC')
    const accountId = getEvalState().accountId
    if (accountId) renameEvalAccount(accountId, normalizedAccountName)
    await flushPreferenceSync()
    window.location.assign('/')
  }

  const trailing = config.drawdownType === 'trailing'
  const consistencyEnabled = config.consistencyRulePct > 0

  return (
    <main className="h-[100dvh] overflow-y-auto bg-surface-0 text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-9 lg:px-8">
        <header className="mb-7 flex items-start gap-3 sm:mb-9">
          <button type="button" onClick={() => window.location.assign('/')} className="secondary-button mt-0.5 size-11 shrink-0 px-0 sm:size-9" aria-label="Back to workspace">
            <ArrowLeft size={15} aria-hidden="true" />
          </button>
          <div>
            <p className="text-ui-meta font-semibold uppercase tracking-[0.14em] text-dim">New evaluation</p>
            <h1 className="mt-1 text-[clamp(1.65rem,4vw,2.4rem)] font-bold leading-tight tracking-[-0.025em] text-ink">Evaluation Simulator</h1>
            <p className="mt-2 max-w-2xl text-ui-body leading-relaxed text-muted">Configure the prop-firm rules, choose a historical starting point, then trade forward without peeking.</p>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-6" aria-label="Evaluation rules">
          <label className="field-label min-w-0 lg:col-span-3">
            <span className="font-medium uppercase tracking-[0.08em] text-dim">Account name</span>
            <input
              type="text"
              value={accountName}
              maxLength={SOURCE_NAME_MAX_LENGTH}
              required
              autoComplete="off"
              placeholder="e.g. August NQ evaluation"
              onChange={(event) => setAccountName(event.currentTarget.value)}
              className="field-input h-11 w-full font-sans text-ui-control hover:border-line-strong focus-visible:border-active"
              aria-label="Account name"
            />
          </label>

          <label className="field-label min-w-0 lg:col-span-3">
            <span className="font-medium uppercase tracking-[0.08em] text-dim">Start date <span className="font-normal">(locked once you begin)</span></span>
            <input type="date" value={startDate} min={calendarBounds?.min || undefined} max={calendarBounds?.max || undefined} onChange={(event) => { if (event.currentTarget.value) setStartDate(event.currentTarget.value) }} className="field-input h-11 w-full text-ui-control [color-scheme:dark] hover:border-line-strong focus-visible:border-active" aria-label="Start date" />
            {symbolsFailed ? <span role="alert" className="text-loss-bright">Markets are unavailable. Reload to try again.</span> : null}
            {calendarFailed ? <span role="alert" className="text-loss-bright">Calendar is unavailable. Reload to try again.</span> : null}
          </label>

          <div className="lg:col-span-2"><NumberField label="Account size" value={config.accountSize} min={MONEY_STEP} onChange={(accountSize) => updateConfig({ accountSize })} /></div>
          <div className="lg:col-span-2"><NumberField label="Profit target" value={config.profitTarget} min={MONEY_STEP} onChange={(profitTarget) => updateConfig({ profitTarget })} /></div>
          <div className="lg:col-span-2"><NumberField label="Max daily loss" hint="(0 = none)" value={config.maxDailyLoss} min={0} onChange={(maxDailyLoss) => updateConfig({ maxDailyLoss })} /></div>
          <div className="lg:col-span-2"><NumberField label="Max total loss" value={config.maxTotalLoss} min={MONEY_STEP} onChange={(maxTotalLoss) => updateConfig({ maxTotalLoss })} /></div>
          <div className="lg:col-span-2"><NumberField label="Min trading days" hint="(0 = none)" value={config.minTradingDays} min={0} max={365} step={1} onChange={(minTradingDays) => updateConfig({ minTradingDays })} /></div>
          <div className="lg:col-span-2"><NumberField label="Consistency" hint="(0 = none)" value={config.consistencyRulePct} min={0} max={100} step={5} onChange={(consistencyRulePct) => updateConfig({ consistencyRulePct })} /></div>
        </section>

        <section className="mt-6" aria-labelledby="drawdown-heading">
          <h2 id="drawdown-heading" className="text-ui-meta font-medium uppercase tracking-[0.08em] text-dim">Drawdown type</h2>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Drawdown type">
              {(['static', 'trailing'] as const).map((type) => (
                <button key={type} type="button" onClick={() => updateConfig({ drawdownType: type, ...(type === 'static' ? { trailingLocksAtStart: false, trailingEod: false } : {}) })} aria-pressed={config.drawdownType === type} className={`min-h-11 min-w-28 rounded-control border px-4 text-ui-meta font-semibold uppercase tracking-[0.08em] transition-colors ${config.drawdownType === type ? 'border-active bg-active text-white' : 'border-line-strong bg-surface-0 text-muted hover:border-muted hover:text-ink'}`}>
                  {type}
                </button>
              ))}
            </div>
            {trailing ? (
              <div className="flex flex-col gap-x-5 sm:flex-row sm:items-center">
                <CheckOption checked={config.trailingLocksAtStart} label="Lock at starting balance" onChange={(trailingLocksAtStart) => updateConfig({ trailingLocksAtStart })} />
                <CheckOption checked={config.trailingEod} label="EOD trailing" onChange={(trailingEod) => updateConfig({ trailingEod })} />
              </div>
            ) : null}
            <CheckOption checked={consistencyEnabled} label="Consistency rule" onChange={(enabled) => updateConfig({ consistencyRulePct: enabled ? 40 : 0 })} />
          </div>
        </section>

        <section className="mt-8 border-t border-line pt-5" aria-label="Evaluation summary">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <div>
              <dt className="text-ui-meta text-dim">Pass balance</dt>
              <dd className="mt-0.5 font-mono text-ui-title font-semibold tabular-nums text-profit-bright">${formatMoney(preview.passAt)}</dd>
            </div>
            <div>
              <dt className="text-ui-meta text-dim">Loss floor · {config.drawdownType}{config.trailingEod ? ' EOD' : ''}</dt>
              <dd className="mt-0.5 font-mono text-ui-title font-semibold tabular-nums text-loss-bright">${formatMoney(preview.floor)}</dd>
            </div>
            <div>
              <dt className="text-ui-meta text-dim">Daily stop</dt>
              <dd className="mt-0.5 font-mono text-ui-title font-semibold tabular-nums text-ink">{config.maxDailyLoss > 0 ? `$${formatMoney(config.maxDailyLoss)}` : 'None'}</dd>
            </div>
            <div>
              <dt className="text-ui-meta text-dim">Best day limit</dt>
              <dd className={`mt-0.5 font-mono text-ui-title font-semibold tabular-nums ${consistencyEnabled ? 'text-caution-bright' : 'text-muted'}`}>{consistencyEnabled ? `≤ ${config.consistencyRulePct}%` : 'None'}</dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-h-5">
              {validationMessage ? <p role="alert" className="text-ui-body text-loss-bright">{validationMessage}</p> : <p className="text-ui-body text-muted">Ready to start from <span className="font-mono text-ink">{startDate || '—'}</span></p>}
            </div>
            <button type="button" onClick={() => { void handleStart() }} disabled={!canStart || starting} className="primary-button min-h-11 w-full shrink-0 gap-2 px-5 uppercase tracking-[0.08em] sm:w-auto">
              {starting ? 'Starting evaluation…' : 'Start evaluation'} {!starting ? <ArrowRight size={14} aria-hidden="true" /> : null}
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
