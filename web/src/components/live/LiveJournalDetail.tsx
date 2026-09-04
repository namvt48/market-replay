import { Download, ImagePlus, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteJournalImage, fetchTrades, listJournalImages, putTrades, uploadJournalImage } from '../../api/client'
import type { JournalImageMeta } from '../../api/client'
import type { ClosedTrade } from '../../api/types'
import type { LiveTemplate } from '../../store/live-store'
import type { AccountStage } from './live-calendar'
import { DetailDialog } from '../ui/DetailDialog'
import { TradeHistoryTable } from '../trades/TradeHistoryTable'
import { buildTradeFromForm } from './live-trade-form'
import type { TradeForm } from './live-trade-form'
import { liveTradesToCsv, parseLiveTradesCsv } from './live-csv'

const emptyForm: TradeForm = { symbol: '', side: 'long', qty: '1', entryPrice: '', exitPrice: '' }

interface Props {
  sessionId: string
  title: string
  stage: AccountStage
  onClose: () => void
  onChanged: () => void
  onDelete: () => void
  onToggleStage: () => void
  templates: LiveTemplate[]
  onCompose: (templateId: string) => void
}

export function LiveJournalDetail({ sessionId, title, stage, onClose, onChanged, onDelete, onToggleStage, templates, onCompose }: Props) {
  const [images, setImages] = useState<JournalImageMeta[]>([])
  const [trades, setTrades] = useState<ClosedTrade[]>([])
  const [form, setForm] = useState<TradeForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [composeTemplate, setComposeTemplate] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [importFeedback, setImportFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    const [imgs, trs] = await Promise.all([
      listJournalImages(sessionId),
      fetchTrades(sessionId),
    ])
    setImages(imgs)
    setTrades(trs)
  }, [sessionId])

  useEffect(() => { void reload() }, [reload])

  const handleUpload = async (file: File) => {
    await uploadJournalImage(sessionId, file)
    await reload()
  }

  const handleDeleteImage = async (id: string) => {
    await deleteJournalImage(id)
    await reload()
  }

  const handleAddTrade = async () => {
    setSaving(true)
    try {
      const next = buildTradeFromForm(form)
      await putTrades(sessionId, [...trades, { ...next, sessionId, createdAt: next.exitTs }])
      onChanged()
      setForm(emptyForm)
      await reload()
    } finally {
      setSaving(false)
    }
  }

  const handleExportCsv = () => {
    const csv = liveTradesToCsv(trades)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    const safeTitle = title.trim().replace(/\s+/g, '-') || 'live-account'
    anchor.download = `${safeTitle}-trades.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const handleImportCsv = async (file: File) => {
    setImportFeedback(null)
    try {
      const imported = parseLiveTradesCsv(await file.text())
      if (imported.length === 0) {
        setImportFeedback({ tone: 'error', text: 'No valid trades found in the file.' })
        return
      }
      const rows: ClosedTrade[] = imported.map((row) => ({ ...row, sessionId, createdAt: row.exitTs }))
      await putTrades(sessionId, [...trades, ...rows])
      onChanged()
      setImportFeedback({ tone: 'ok', text: `Imported ${imported.length} trade${imported.length === 1 ? '' : 's'}.` })
      await reload()
    } finally {
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  return (
    <DetailDialog
      titleId="live-journal-detail-heading"
      title={<div className="flex min-w-0 items-center gap-1.5"><h2 id="live-journal-detail-heading" className="truncate text-ui-title font-semibold text-ink">{title}</h2></div>}
      status={
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleStage}
            aria-label={`Mark ${title} ${stage === 'eval' ? 'funded' : 'eval'}`}
            className={`rounded-control px-2 py-1 font-mono text-ui-meta font-semibold transition-colors ${stage === 'eval' ? 'bg-[#f59e0b]/15 text-[#fbbf24] hover:bg-[#f59e0b]/25' : 'bg-[#10b981]/15 text-[#34d399] hover:bg-[#10b981]/25'}`}
          >
            {stage === 'eval' ? 'EVAL' : 'FUNDED'}
          </button>
          <span className="rounded-control bg-surface-2 px-2 py-1 font-mono text-ui-meta font-semibold text-active-bright">LIVE</span>
          <button
            type="button"
            onClick={() => { if (confirmingDelete) onDelete(); else setConfirmingDelete(true) }}
            aria-label={confirmingDelete ? 'Confirm delete account' : 'Delete account'}
            className={`flex h-8 items-center gap-1.5 rounded-control px-2 font-mono text-ui-meta font-semibold transition-colors ${confirmingDelete ? 'bg-loss/20 text-loss-bright' : 'text-muted hover:bg-loss/10 hover:text-loss-bright'}`}
          >
            <Trash2 size={14} />
            {confirmingDelete ? 'Confirm?' : 'Delete'}
          </button>
        </div>
      }
      onClose={onClose}
    >
      <div className="sticky top-0 z-10 border-b border-line bg-[#101114] p-4 sm:p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-ui-meta font-semibold uppercase tracking-[0.08em] text-muted">Add trade</h4>
          <div className="flex items-center gap-1.5">
            <button type="button" className="tool-button gap-1.5" aria-label="Export trades CSV" onClick={handleExportCsv} disabled={trades.length === 0}>
              <Download size={14} /> Export CSV
            </button>
            <label className="tool-button gap-1.5">
              <Upload size={14} /> Import CSV
              <input ref={importInputRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Import trades CSV" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportCsv(f) }} />
            </label>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="field-input h-9" placeholder="Symbol" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} aria-label="Trade symbol" />
          <select className="field-input h-9" value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as 'long' | 'short' })} aria-label="Side">
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
          <input className="field-input h-9" type="number" min={1} placeholder="Qty" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} aria-label="Quantity" />
          <input className="field-input h-9" type="number" step="any" placeholder="Entry price ($)" value={form.entryPrice} onChange={(e) => setForm({ ...form, entryPrice: e.target.value })} aria-label="Entry price" />
          <input className="field-input h-9" type="number" step="any" placeholder="Exit price ($)" value={form.exitPrice} onChange={(e) => setForm({ ...form, exitPrice: e.target.value })} aria-label="Exit price" />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" className="primary-button h-9" disabled={saving || !form.symbol || !form.entryPrice || !form.exitPrice} onClick={() => void handleAddTrade()}>
            {saving ? 'Saving…' : 'Add trade'}
          </button>
          {importFeedback && (
            <p role="status" className={`text-ui-meta ${importFeedback.tone === 'ok' ? 'text-profit-bright' : 'text-loss-bright'}`}>{importFeedback.text}</p>
          )}
        </div>
      </div>

      <section className="p-4 sm:p-5">
        <TradeHistoryTable
          headingId="live-trade-history"
          fullBleed
          trades={trades.map((trade) => ({
            id: trade.id,
            symbol: trade.symbol,
            side: trade.side,
            qty: trade.qty,
            entryTime: trade.entryTs,
            exitTime: trade.exitTs,
            realizedCents: trade.realizedCents,
            mfeTicks: trade.mfeTicks,
            maeTicks: trade.maeTicks,
            rMultiple: trade.rMultiple,
          }))}
        />

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-control border border-line bg-surface-0 p-3">
            <h4 className="mb-2 text-ui-meta font-semibold uppercase tracking-[0.08em] text-muted">Screenshots</h4>
            <label className="tool-button mb-2 inline-flex items-center gap-1.5">
              <ImagePlus size={15} /> Attach image
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = '' }} />
            </label>
            {images.length === 0 && <p className="text-ui-body text-muted">No screenshots yet.</p>}
            <ul className="grid grid-cols-3 gap-2">
              {images.map((img) => (
                <li key={img.id} className="group relative overflow-hidden rounded-control border border-line">
                  <img src={`/api/v1/images/${img.id}`} alt={img.caption || 'journal screenshot'} className="aspect-video w-full object-cover" loading="lazy" />
                  <button type="button" onClick={() => void handleDeleteImage(img.id)} className="absolute right-1 top-1 rounded bg-surface-0/90 p-1 text-loss-bright opacity-0 transition-opacity group-hover:opacity-100" aria-label={`Delete ${img.id}`}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-control border border-line bg-surface-0 p-3">
            <h4 className="mb-2 text-ui-meta font-semibold uppercase tracking-[0.08em] text-muted">Journal note</h4>
            <div className="flex flex-wrap items-center gap-2">
              <select className="field-input h-9 min-w-40 flex-1" value={composeTemplate} onChange={(e) => setComposeTemplate(e.target.value)} aria-label="Stats template">
                <option value="" disabled>Pick a template…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button type="button" className="primary-button h-9" disabled={!composeTemplate} onClick={() => onCompose(composeTemplate)}>Compose</button>
            </div>
          </div>
        </div>
      </section>
    </DetailDialog>
  )
}

/** Shared stat mini-card, also used by the journal composer preview. */
export function StatCard({ label, value, tone = 'text-ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-h-20 rounded-[14px] border border-line-strong bg-surface-1 px-4 py-3">
      <dt className="text-ui-body text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  )
}