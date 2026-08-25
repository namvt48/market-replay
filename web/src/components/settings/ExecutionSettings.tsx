import { RotateCcw, Save } from 'lucide-react'
import { useMemo, useState, type ReactElement } from 'react'
import type { SymbolMeta } from '../../api/types'
import { useWorkspaceSettingsStore, type ExecutionCostOverride } from '../../store/workspace-settings-store'

interface ExecutionSettingsProps {
  symbols: SymbolMeta[]
}

export function ExecutionSettings({ symbols }: ExecutionSettingsProps): ReactElement {
  const stored = useWorkspaceSettingsStore((state) => state.executionCosts)
  const setExecutionCost = useWorkspaceSettingsStore((state) => state.setExecutionCost)
  const initial = useMemo(() => Object.fromEntries(symbols.map((symbol) => [symbol.symbol, stored[symbol.symbol] ?? {
    spreadTicks: symbol.defaultSlippageTicks,
    commissionPerSide: symbol.commissionPerSide,
  }])), [stored, symbols])
  const [draft, setDraft] = useState<Record<string, ExecutionCostOverride>>(initial)
  const [saved, setSaved] = useState(false)

  const update = (symbol: string, key: keyof ExecutionCostOverride, value: string): void => {
    const numeric = Number(value)
    setSaved(false)
    setDraft((current) => ({ ...current, [symbol]: { ...current[symbol], [key]: Number.isFinite(numeric) ? Math.max(0, numeric) : 0 } }))
  }

  const save = (): void => {
    for (const [symbol, value] of Object.entries(draft)) setExecutionCost(symbol, value)
    setSaved(true)
  }

  return (
    <section aria-labelledby="execution-settings-title" className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl">
        <p className="text-ui-meta font-semibold uppercase tracking-[0.08em] text-active-bright">Execution model</p>
        <h2 id="execution-settings-title" className="mt-1 text-xl font-semibold tracking-tight text-ink">Spreads &amp; commissions</h2>
        <p className="mt-2 text-ui-body leading-relaxed text-muted">Set the default transaction cost for each instrument. Changes apply when a new replay or evaluation starts.</p>
      </div>

      <div className="mt-6 overflow-hidden rounded-panel border border-line-strong bg-surface-0/40">
        <div className="hidden grid-cols-[minmax(11rem,1fr)_11rem_13rem] gap-4 border-b border-line bg-surface-2/60 px-4 py-2 text-ui-meta font-semibold uppercase tracking-[0.06em] text-dim sm:grid">
          <span>Instrument</span><span>Spread / slippage</span><span>Commission / side</span>
        </div>
        {symbols.map((symbol) => {
          const value = draft[symbol.symbol] ?? { spreadTicks: symbol.defaultSlippageTicks, commissionPerSide: symbol.commissionPerSide }
          const isDefault = value.spreadTicks === symbol.defaultSlippageTicks && value.commissionPerSide === symbol.commissionPerSide
          return (
            <div key={symbol.symbol} className="grid gap-3 border-b border-line px-4 py-4 last:border-b-0 sm:grid-cols-[minmax(11rem,1fr)_11rem_13rem] sm:items-end sm:gap-4">
              <div className="min-w-0 self-center">
                <div className="flex items-center gap-2"><strong className="font-mono text-ui-control text-ink">{symbol.symbol}</strong>{isDefault ? <span className="rounded-[3px] bg-surface-3 px-1.5 py-0.5 text-ui-meta text-dim">Default</span> : <span className="rounded-[3px] bg-active/12 px-1.5 py-0.5 text-ui-meta text-active-bright">Custom</span>}</div>
                <p className="mt-0.5 truncate text-ui-meta text-dim">{symbol.name}</p>
              </div>
              <label className="grid gap-1 text-ui-meta text-muted"><span className="sm:sr-only">{symbol.symbol} spread in ticks</span><span className="relative"><input aria-label={`${symbol.symbol} spread in ticks`} type="number" min="0" step="0.25" value={value.spreadTicks} onChange={(event) => update(symbol.symbol, 'spreadTicks', event.target.value)} className="field-input h-10 w-full pr-12 font-mono" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-dim">ticks</span></span></label>
              <div className="flex items-end gap-2">
                <label className="grid min-w-0 flex-1 gap-1 text-ui-meta text-muted"><span className="sm:sr-only">{symbol.symbol} commission per side</span><span className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim">$</span><input aria-label={`${symbol.symbol} commission per side`} type="number" min="0" step="0.01" value={value.commissionPerSide} onChange={(event) => update(symbol.symbol, 'commissionPerSide', event.target.value)} className="field-input h-10 w-full pl-7 font-mono" /></span></label>
                <button type="button" onClick={() => setDraft((current) => ({ ...current, [symbol.symbol]: { spreadTicks: symbol.defaultSlippageTicks, commissionPerSide: symbol.commissionPerSide } }))} className="tool-button size-10" aria-label={`Reset ${symbol.symbol} costs`} title="Reset to instrument defaults"><RotateCcw size={15} /></button>
              </div>
            </div>
          )
        })}
      </div>
      {symbols.length === 0 ? <p className="mt-6 rounded-control border border-line bg-surface-2 p-4 text-ui-body text-muted">Instrument metadata is still loading.</p> : null}
      <div className="mt-5 flex items-center gap-3"><button type="button" onClick={save} disabled={symbols.length === 0} className="primary-button"><Save size={15} />Save costs</button>{saved ? <span role="status" className="text-ui-body text-profit-bright">Saved for future sessions</span> : null}</div>
    </section>
  )
}
