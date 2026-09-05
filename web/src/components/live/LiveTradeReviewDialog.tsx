import { FileText, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ClosedTrade, SymbolMeta } from '../../api/types'
import type { ChartTimezone } from '../../replay/chart-timezone'
import { reviewDocumentKey, reviewTradeSnapshot, type ReviewTrade } from '../../review/types'
import { useReviewStore } from '../../store/review-store'
import { DetailDialog } from '../ui/DetailDialog'
import { InlineMarkdownEditor } from '../review/InlineMarkdownEditor'
import { MarkdownPreview } from '../review/MarkdownPreview'
import { ReviewMetadata } from '../review/ReviewMetadata'
import { buildTradeFromForm, type TradeForm } from './live-trade-form'

const emptyForm: TradeForm = { symbol: '', side: 'long', qty: '1', entryPrice: '', exitPrice: '', stopLoss: '', takeProfit: '', entryTime: '', exitTime: '' }

function reviewTrade(sessionId: string, trade: ClosedTrade): ReviewTrade {
  return {
    id: trade.id, sourceId: sessionId, sourceType: 'live', symbol: trade.symbol, side: trade.side, qty: trade.qty,
    entryTs: trade.entryTs, exitTs: trade.exitTs, entryPriceTicks: trade.entryPriceTicks, exitPriceTicks: trade.exitPriceTicks,
    realizedCents: trade.realizedCents, feesCents: trade.feesCents, mfeTicks: trade.mfeTicks, maeTicks: trade.maeTicks,
    rMultiple: trade.rMultiple, initialStopTicks: trade.initialStopTicks, initialTakeProfitTicks: trade.initialTakeProfitTicks,
    protectionAdjustments: trade.protectionAdjustments, exitReason: trade.exitReason,
  }
}

interface Props {
  sessionId: string
  accountName: string
  symbols: SymbolMeta[]
  onClose: () => void
  onSave: (trade: ClosedTrade) => Promise<void>
}

export function LiveTradeReviewDialog({ sessionId, accountName, symbols, onClose, onSave }: Props) {
  const setNote = useReviewStore((state) => state.setNote)
  const [form, setForm] = useState<TradeForm>(emptyForm)
  const [saved, setSaved] = useState<ReviewTrade | null>(null)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const currentNote = useReviewStore((state) => saved ? state.documents[reviewDocumentKey(saved.sourceType, saved.sourceId, saved.id)]?.note ?? '' : '')
  const key = saved ? reviewDocumentKey(saved.sourceType, saved.sourceId, saved.id) : ''
  const timezone: ChartTimezone = { kind: 'preset', id: 'ET' }
  const canSave = Boolean(form.symbol && form.entryPrice && form.exitPrice)
  const template = useMemo(() => ['## Trade thesis', '', '- Setup:', '- Entry trigger:', '- Invalidation:', '', '## Execution review', '', '- What went well:', '- What to improve:', ''].join('\n'), [])

  const save = async () => {
    if (!canSave || saving) return
    setSaving(true)
    try {
      const built = buildTradeFromForm(form)
      const trade: ClosedTrade = { ...built, sessionId, createdAt: built.exitTs }
      await onSave(trade)
      setSaved(reviewTrade(sessionId, trade))
    } finally {
      setSaving(false)
    }
  }

  return (
    <DetailDialog
      titleId="live-trade-review-heading"
      title={<div><h2 id="live-trade-review-heading" className="text-ui-title font-semibold text-ink">{saved ? `${saved.symbol} · ${saved.side === 'long' ? 'Long' : 'Short'}` : 'New live trade'}</h2><p className="mt-0.5 text-ui-meta text-muted">{accountName}</p></div>}
      status={saved ? <span className="rounded-control bg-profit/15 px-2 py-1 font-mono text-ui-meta text-profit-bright">SAVED</span> : <span className="rounded-control bg-surface-2 px-2 py-1 font-mono text-ui-meta text-muted">LIVE</span>}
      onClose={onClose}
      contentClassName="max-h-[92dvh] w-[min(1080px,calc(100vw-2rem))]"
    >
      {!saved ? <section className="p-5 sm:p-6"><div className="mb-5"><h3 className="text-ui-control font-semibold text-ink">Add trade</h3><p className="mt-1 text-ui-meta text-muted">Save the execution first; its review and Details are created automatically.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><select className="field-input h-11" value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value })} aria-label="Trade symbol"><option value="" disabled>Select symbol</option>{symbols.map((symbol) => <option key={symbol.symbol} value={symbol.symbol}>{symbol.symbol} · {symbol.name}</option>)}</select><select className="field-input h-11" value={form.side} onChange={(event) => setForm({ ...form, side: event.target.value as 'long' | 'short' })} aria-label="Side"><option value="long">Long</option><option value="short">Short</option></select><input className="field-input h-11" type="number" min={1} value={form.qty} onChange={(event) => setForm({ ...form, qty: event.target.value })} aria-label="Quantity" placeholder="Quantity" /><input className="field-input h-11" type="number" step="any" value={form.entryPrice} onChange={(event) => setForm({ ...form, entryPrice: event.target.value })} aria-label="Entry price" placeholder="Entry price ($)" /><input className="field-input h-11" type="number" step="any" value={form.exitPrice} onChange={(event) => setForm({ ...form, exitPrice: event.target.value })} aria-label="Exit price" placeholder="Exit price ($)" /><input className="field-input h-11" type="number" step="any" value={form.stopLoss} onChange={(event) => setForm({ ...form, stopLoss: event.target.value })} aria-label="Stop loss" placeholder="Stop loss ($)" /><input className="field-input h-11" type="number" step="any" value={form.takeProfit} onChange={(event) => setForm({ ...form, takeProfit: event.target.value })} aria-label="Take profit" placeholder="Take profit ($)" /><input className="field-input h-11" type="datetime-local" value={form.entryTime} onChange={(event) => setForm({ ...form, entryTime: event.target.value })} aria-label="Entry time" /><input className="field-input h-11" type="datetime-local" value={form.exitTime} onChange={(event) => setForm({ ...form, exitTime: event.target.value })} aria-label="Exit time" /></div><button type="button" className="primary-button mt-5 h-11" disabled={!canSave || saving} onClick={() => void save()}><Plus size={15} />{saving ? 'Saving…' : 'Add trade & review'}</button></section> : <div className="flex min-h-[720px] flex-col"><section className="flex min-h-[470px] flex-1 flex-col overflow-hidden" aria-label="Live trade review note"><div className="flex h-11 shrink-0 items-center justify-between border-y border-line px-4"><span className="text-ui-meta text-dim">Markdown supported</span><div className="flex rounded-control bg-surface-2 p-0.5"><button type="button" onClick={() => setMode('write')} aria-pressed={mode === 'write'} className="rounded-control px-3 py-1.5 text-ui-meta text-muted aria-pressed:bg-surface-3 aria-pressed:text-ink">Write</button><button type="button" onClick={() => setMode('preview')} aria-pressed={mode === 'preview'} className="rounded-control px-3 py-1.5 text-ui-meta text-muted aria-pressed:bg-surface-3 aria-pressed:text-ink">Preview</button></div></div><div className="min-h-0 flex-1 p-4 sm:p-5">{mode === 'write' ? <InlineMarkdownEditor value={currentNote} onChange={(note) => setNote(key, reviewTradeSnapshot(saved), note)} onImageOpen={() => {}} /> : <div className="h-full overflow-y-auto">{currentNote ? <MarkdownPreview markdown={currentNote} /> : <p className="italic text-ui-control text-dim">Nothing to preview yet.</p>}</div>}</div><div className="flex min-h-16 items-center gap-2 border-t border-line px-4"><button type="button" onClick={() => setNote(key, reviewTradeSnapshot(saved), template)} disabled={currentNote.trim().length > 0} className="secondary-button min-h-10"><FileText size={15} />Template</button><span className="text-ui-meta text-dim">Tag groups and generated Details are below.</span></div></section><ReviewMetadata trade={saved} symbols={symbols} timezone={timezone} /></div>}
    </DetailDialog>
  )
}
