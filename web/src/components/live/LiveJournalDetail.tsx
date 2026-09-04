import { ImagePlus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { deleteJournalImage, fetchTrades, listJournalImages, putTrades, uploadJournalImage } from '../../api/client'
import type { JournalImageMeta } from '../../api/client'
import type { ClosedTrade } from '../../api/types'
import { fetchAnalyticsPerformance } from '../../api/analytics'
import type { AnalyticsPerformance } from '../../api/analytics'
import { DetailDialog } from '../ui/DetailDialog'
import { LineChart } from '../analytics/InteractiveAnalyticsCharts'
import { TradeHistoryTable } from '../trades/TradeHistoryTable'
import { buildTradeFromForm } from './live-trade-form'
import type { TradeForm } from './live-trade-form'

const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const emptyForm: TradeForm = { symbol: '', side: 'long', qty: '1', entryPrice: '', exitPrice: '' }

interface Props {
  sessionId: string
  title: string
  onClose: () => void
  onChanged: () => void
}

export function LiveJournalDetail({ sessionId, title, onClose, onChanged }: Props) {
  const [report, setReport] = useState<AnalyticsPerformance | null>(null)
  const [images, setImages] = useState<JournalImageMeta[]>([])
  const [trades, setTrades] = useState<ClosedTrade[]>([])
  const [form, setForm] = useState<TradeForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    const [perf, imgs, trs] = await Promise.all([
      fetchAnalyticsPerformance('live', sessionId, 5, 'UTC'),
      listJournalImages(sessionId),
      fetchTrades(sessionId),
    ])
    setReport(perf)
    setImages(imgs)
    setTrades(trs)
  }, [sessionId])

  useEffect(() => { void reload() }, [reload])

  const equityValues = useMemo(() => {
    if (!report?.equityCurve?.length) return []
    return report.equityCurve
      .filter((p) => p.closedAt)
      .map((p) => p.balance)
  }, [report])

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

  return (
    <DetailDialog
      titleId="live-journal-detail-heading"
      title={<div className="flex min-w-0 items-center gap-1.5"><h2 id="live-journal-detail-heading" className="truncate text-ui-title font-semibold text-ink">{title}</h2></div>}
      status={<span className="rounded-control bg-surface-2 px-2 py-1 font-mono text-ui-meta font-semibold text-active-bright">LIVE</span>}
      onClose={onClose}
    >
      <section className="p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-control border border-line bg-surface-0 p-3">
            <h4 className="mb-2 text-ui-meta font-semibold uppercase tracking-[0.08em] text-muted">Equity</h4>
            {equityValues.length > 0
              ? <LineChart compact values={equityValues} fillArea ariaLabel="Live equity curve" />
              : <p className="py-8 text-center text-ui-body text-muted">No closed trades yet.</p>}
          </div>

          <dl className="grid gap-2 sm:grid-cols-3">
            <StatCard label="Total PnL" value={report ? dollars.format(report.overview.totalPnl) : '—'} tone={report && report.overview.totalPnl >= 0 ? 'text-profit-bright' : 'text-loss-bright'} />
            <StatCard label="Win rate" value={report ? `${(report.overview.winRate * 100).toFixed(1)}%` : '—'} />
            <StatCard label="Trades" value={report ? String(report.overview.totalTrades) : '—'} />
          </dl>

          <div className="rounded-control border border-line bg-surface-0 p-3">
            <h4 className="mb-2 text-ui-meta font-semibold uppercase tracking-[0.08em] text-muted">Add trade</h4>
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
            <button type="button" className="primary-button mt-3 h-9" disabled={saving || !form.symbol || !form.entryPrice || !form.exitPrice} onClick={() => void handleAddTrade()}>
              {saving ? 'Saving…' : 'Add trade'}
            </button>
          </div>

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
        </div>

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
      </section>
    </DetailDialog>
  )
}

function StatCard({ label, value, tone = 'text-ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-h-20 rounded-[14px] border border-line-strong bg-surface-1 px-4 py-3">
      <dt className="text-ui-body text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  )
}