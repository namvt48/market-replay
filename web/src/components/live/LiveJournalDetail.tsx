import { Download, ImagePlus, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import { deleteJournalImage, fetchSymbols, fetchTrades, listJournalImages, putTrades, uploadJournalImage } from '../../api/client'
import type { JournalImageMeta } from '../../api/client'
import type { ClosedTrade, SymbolMeta } from '../../api/types'
import { clipboardImageFiles } from '../../lib/clipboard-images'
import { loadLiveNote, saveLiveNote, type LiveTemplate } from '../../store/live-store'
import type { AccountStage } from './live-calendar'
import { DetailDialog } from '../ui/DetailDialog'
import { MarkdownPreview } from '../review/MarkdownPreview'
import { TradeHistoryTable } from '../trades/TradeHistoryTable'
import { buildTradeFromForm } from './live-trade-form'
import type { TradeForm } from './live-trade-form'
import { liveTradesToCsv, parseLiveTradesCsv } from './live-csv'
import { LiveTradeReviewDialog } from './LiveTradeReviewDialog'
import { useUiStore } from '../../store/ui-store'

const emptyForm: TradeForm = { symbol: '', side: 'long', qty: '1', entryPrice: '', exitPrice: '', stopLoss: '', takeProfit: '', entryTime: '', exitTime: '' }

const tradeMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

function pnlLabel(cents: number): string {
  const formatted = tradeMoney.format(Math.abs(cents) / 100)
  if (cents > 0) return `+${formatted}`
  if (cents < 0) return `−${formatted}`
  return formatted
}

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
  const openReview = useUiStore((state) => state.openReview)
  const [images, setImages] = useState<JournalImageMeta[]>([])
  const [symbols, setSymbols] = useState<SymbolMeta[]>([])
  const [trades, setTrades] = useState<ClosedTrade[]>([])
  const [form, setForm] = useState<TradeForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [composeTemplate, setComposeTemplate] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [importFeedback, setImportFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState(() => loadLiveNote(sessionId))
  const [noteMode, setNoteMode] = useState<'write' | 'preview'>('write')
  const [imageFeedback, setImageFeedback] = useState<string | null>(null)
  const [detailView] = useState<'account' | 'legacy'>('account')
  const [tradeReviewOpen, setTradeReviewOpen] = useState(false)

  const totalPnlCents = useMemo(() => trades.reduce((sum, trade) => sum + trade.realizedCents, 0), [trades])

  const reload = useCallback(async () => {
    const [imgs, trs] = await Promise.all([
      listJournalImages(sessionId),
      fetchTrades(sessionId),
    ])
    setImages(imgs)
    setTrades(trs)
  }, [sessionId])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    let current = true
    void fetchSymbols().then((next) => { if (current) setSymbols(next) }).catch(() => { if (current) setSymbols([]) })
    return () => { current = false }
  }, [])

  const handleUpload = async (file: File) => {
    setImageFeedback(null)
    try {
      await uploadJournalImage(sessionId, file)
      await reload()
      setImageFeedback(`${file.name} attached.`)
    } catch {
      setImageFeedback(`Couldn't attach ${file.name}. Try again.`)
    }
  }

  const handleImagePaste = (event: ClipboardEvent<HTMLElement>) => {
    const pasted = clipboardImageFiles(event.clipboardData)
    if (pasted.length === 0) return
    event.preventDefault()
    void Promise.all(pasted.map(handleUpload))
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

  const handleReviewedTrade = async (trade: ClosedTrade) => {
    await putTrades(sessionId, [...trades, trade])
    onChanged()
    await reload()
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

  if (detailView === 'account') return (
    <>
      <LiveAccountDetailSurface
        sessionId={sessionId}
        title={title}
        stage={stage}
        trades={trades}
        confirmingDelete={confirmingDelete}
        onClose={onClose}
        onDelete={onDelete}
        onToggleStage={onToggleStage}
        onConfirmDelete={() => setConfirmingDelete(true)}
        onOpenTradeReview={() => setTradeReviewOpen(true)}
        onOpenExistingTradeReview={(tradeId) => openReview({ id: sessionId, type: 'live', title }, tradeId)}
      />
      {tradeReviewOpen ? <LiveTradeReviewDialog sessionId={sessionId} accountName={title} symbols={symbols} onClose={() => setTradeReviewOpen(false)} onSave={handleReviewedTrade} /> : null}
    </>
  )

  return (
    <DetailDialog
      titleId="live-journal-detail-heading"
      title={
        <div className="flex min-w-0 items-center gap-2">
          <h2 id="live-journal-detail-heading" className="truncate text-ui-title font-semibold text-ink">{title}</h2>
          <span
            className={`shrink-0 rounded-[12px] px-2.5 py-1 font-mono text-ui-meta font-semibold ${
              totalPnlCents > 0 ? 'bg-profit/25 text-profit-bright' : totalPnlCents < 0 ? 'bg-loss/20 text-loss-bright' : 'bg-surface-2 text-muted'
            }`}
          >
            {pnlLabel(totalPnlCents)}
          </span>
        </div>
      }
      status={
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleStage}
            aria-label={`Mark ${title} ${stage === 'eval' ? 'funded' : 'eval'}`}
            className={`flex w-[4.5rem] items-center justify-center rounded-control px-2 py-1 font-mono text-ui-meta font-semibold transition-colors ${stage === 'eval' ? 'bg-[#f59e0b]/15 text-[#fbbf24] hover:bg-[#f59e0b]/25' : 'bg-[#10b981]/15 text-[#34d399] hover:bg-[#10b981]/25'}`}
          >
            {stage === 'eval' ? 'EVAL' : 'FUNDED'}
          </button>
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
      <div className="sticky top-0 z-10 border-b border-line bg-[#101114] px-4 py-4 sm:px-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-ui-control font-semibold text-ink">Add trade</h4>
            <p className="mt-0.5 text-ui-meta text-muted">Record a closed position for this account.</p>
          </div>
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
          <select className="field-input h-10" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} aria-label="Trade symbol">
            <option value="" disabled>Select symbol</option>
            {symbols.map((symbol) => <option key={symbol.symbol} value={symbol.symbol}>{symbol.symbol} · {symbol.name}</option>)}
          </select>
          <select className="field-input h-10" value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as 'long' | 'short' })} aria-label="Side">
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
          <input className="field-input h-10" type="number" min={1} placeholder="Quantity" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} aria-label="Quantity" />
          <input className="field-input h-10" type="number" step="any" placeholder="Entry price ($)" value={form.entryPrice} onChange={(e) => setForm({ ...form, entryPrice: e.target.value })} aria-label="Entry price" />
          <input className="field-input h-10" type="number" step="any" placeholder="Exit price ($)" value={form.exitPrice} onChange={(e) => setForm({ ...form, exitPrice: e.target.value })} aria-label="Exit price" />
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
        <div className="space-y-4">
          <div className="overflow-hidden rounded-control border border-line bg-surface-0">
            <div className="flex h-10 items-center justify-between gap-2 border-b border-line px-3">
              <h4 className="min-w-0 truncate text-ui-meta font-semibold uppercase tracking-[0.08em] text-muted">Journal note</h4>
              <div className="flex shrink-0 rounded-control bg-surface-2 p-0.5">
                <button type="button" onClick={() => setNoteMode('write')} aria-pressed={noteMode === 'write'} className="rounded-control px-2.5 py-1 text-ui-meta text-muted aria-pressed:bg-surface-3 aria-pressed:text-ink">Write</button>
                <button type="button" onClick={() => setNoteMode('preview')} aria-pressed={noteMode === 'preview'} className="rounded-control px-2.5 py-1 text-ui-meta text-muted aria-pressed:bg-surface-3 aria-pressed:text-ink">Preview</button>
              </div>
            </div>
            <div className="min-h-28 p-3">
              {noteMode === 'write' ? (
                <textarea
                  autoFocus
                  value={note}
                  onChange={(event) => { setNote(event.target.value); saveLiveNote(sessionId, event.target.value) }}
                  onPaste={handleImagePaste}
                  placeholder="Enter your journal note in Markdown."
                  aria-label="Journal note Markdown"
                  className="min-h-24 w-full resize-none bg-transparent text-ui-control leading-6 text-ink outline-none placeholder:italic placeholder:text-dim"
                />
              ) : note ? (
                <MarkdownPreview markdown={note} />
              ) : (
                <p className="italic text-ui-control text-dim">Nothing to preview yet.</p>
              )}
            </div>
            <div className="flex min-h-14 flex-wrap items-center gap-2 border-t border-line px-3">
              <select className="field-input h-9 min-w-40 flex-1" value={composeTemplate} onChange={(e) => setComposeTemplate(e.target.value)} aria-label="Stats template">
                <option value="" disabled>Pick a template…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button type="button" className="primary-button h-9" disabled={!composeTemplate} onClick={() => onCompose(composeTemplate)}>Compose</button>
            </div>
          </div>
        </div>

        <TradeHistoryTable
          headingId="live-trade-history"
          fullBleed
          trades={trades.map((trade) => ({
            id: trade.id,
            symbol: trade.symbol,
            side: trade.side,
            qty: trade.qty,
            // Live journal trades are stored in milliseconds on the wire
            // (buildTradeFromForm uses Date.now(), CSV import uses Date.parse);
            // TradeHistoryTable formats chart seconds, so convert for display.
            entryTime: trade.entryTs / 1000,
            exitTime: trade.exitTs / 1000,
            realizedCents: trade.realizedCents,
            mfeTicks: trade.mfeTicks,
            maeTicks: trade.maeTicks,
            rMultiple: trade.rMultiple,
          }))}
        />

        <div className="mt-4 rounded-control border border-line bg-surface-0 p-3" onPaste={handleImagePaste} tabIndex={0} aria-label="Screenshots. Paste an image or attach one from your device.">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div><h4 className="text-ui-control font-semibold text-ink">Screenshots</h4><p className="mt-0.5 text-ui-meta text-muted">Paste an image here or attach one from your device.</p></div>
          <label className="tool-button mb-2 inline-flex items-center gap-1.5">
            <ImagePlus size={15} /> Attach image
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = '' }} />
          </label>
          </div>
          {imageFeedback ? <p role="status" className="mb-2 text-ui-meta text-muted">{imageFeedback}</p> : null}
          {images.length === 0 && <p className="text-ui-body text-muted">No screenshots yet.</p>}
          <ul className="grid grid-cols-3 gap-2">
            {images.map((img) => (
              <li key={img.id} className="group relative overflow-hidden rounded-panel border-2 border-active bg-chart">
                <img src={`/api/v1/images/${img.id}`} alt={img.caption || 'journal screenshot'} className="aspect-video w-full object-cover" loading="lazy" />
                <button type="button" onClick={() => void handleDeleteImage(img.id)} className="absolute right-1 top-1 rounded bg-surface-0/90 p-1 text-loss-bright opacity-0 transition-opacity group-hover:opacity-100" aria-label={`Delete ${img.id}`}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
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

function LiveAccountDetailSurface({ sessionId, title, stage, trades, confirmingDelete, onClose, onDelete, onToggleStage, onConfirmDelete, onOpenTradeReview, onOpenExistingTradeReview }: {
  sessionId: string
  title: string
  stage: AccountStage
  trades: ClosedTrade[]
  confirmingDelete: boolean
  onClose: () => void
  onDelete: () => void
  onToggleStage: () => void
  onConfirmDelete: () => void
  onOpenTradeReview: () => void
  onOpenExistingTradeReview: (tradeId: string) => void
}) {
  const totalPnlCents = trades.reduce((sum, trade) => sum + trade.realizedCents, 0)
  const winners = trades.filter((trade) => trade.realizedCents > 0).length
  const losers = trades.filter((trade) => trade.realizedCents < 0).length
  const winRate = trades.length ? (winners / trades.length) * 100 : 0
  const exportCsv = () => {
    const blob = new Blob([liveTradesToCsv(trades)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${title.trim().replace(/\s+/g, '-') || 'live-account'}-trades.csv`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }
  return <DetailDialog titleId="live-account-detail-heading" title={<div className="flex min-w-0 items-center gap-2"><h2 id="live-account-detail-heading" className="truncate text-ui-title font-semibold text-ink">{title}</h2><span className={`shrink-0 rounded-control px-2 py-1 font-mono text-ui-meta font-semibold ${totalPnlCents > 0 ? 'bg-profit/15 text-profit-bright' : totalPnlCents < 0 ? 'bg-loss/15 text-loss-bright' : 'bg-surface-2 text-muted'}`}>{pnlLabel(totalPnlCents)}</span></div>} status={<div className="flex shrink-0 items-center gap-1.5"><button type="button" onClick={onToggleStage} aria-label={`Mark ${title} ${stage === 'eval' ? 'funded' : 'eval'}`} className={`flex w-[4.5rem] items-center justify-center rounded-control px-2 py-1 font-mono text-ui-meta font-semibold ${stage === 'eval' ? 'bg-caution/15 text-caution-bright' : 'bg-profit/15 text-profit-bright'}`}>{stage === 'eval' ? 'EVAL' : 'FUNDED'}</button><button type="button" onClick={() => { if (confirmingDelete) onDelete(); else onConfirmDelete() }} aria-label={confirmingDelete ? 'Confirm delete account' : 'Delete account'} className={`flex h-8 items-center gap-1.5 rounded-control px-2 text-ui-meta ${confirmingDelete ? 'bg-loss/20 text-loss-bright' : 'text-muted hover:bg-loss/10 hover:text-loss-bright'}`}><Trash2 size={14} />{confirmingDelete ? 'Confirm?' : 'Delete'}</button></div>} onClose={onClose}><section className="p-4 sm:p-5"><dl className="grid gap-2 sm:grid-cols-4"><StatCard label="Net P&L" value={pnlLabel(totalPnlCents)} tone={totalPnlCents > 0 ? 'text-profit-bright' : totalPnlCents < 0 ? 'text-loss-bright' : 'text-ink'} /><StatCard label="Closed trades" value={String(trades.length)} /><StatCard label="Win rate" value={trades.length ? `${winRate.toFixed(1)}%` : '—'} /><StatCard label="Winners / losers" value={`${winners} / ${losers}`} /></dl><div className="mt-5 flex items-center justify-between gap-3"><div><h3 className="text-ui-control font-semibold text-ink">Trade history</h3><p className="mt-0.5 text-ui-meta text-muted">Review each live execution from this account.</p></div><div className="flex items-center gap-2"><button type="button" onClick={exportCsv} disabled={trades.length === 0} className="secondary-button h-9"><Download size={14} />CSV</button><button type="button" onClick={onOpenTradeReview} className="primary-button h-9">+ Trade</button></div></div></section><TradeHistoryTable headingId={`live-trade-history-${sessionId}`} onTradeClick={(trade) => onOpenExistingTradeReview(trade.id)} trades={trades.map((trade) => ({ id: trade.id, symbol: trade.symbol, side: trade.side, qty: trade.qty, entryTime: trade.entryTs / 1000, exitTime: trade.exitTs / 1000, realizedCents: trade.realizedCents, mfeTicks: trade.mfeTicks, maeTicks: trade.maeTicks, rMultiple: trade.rMultiple }))} /></DetailDialog>
}
