import { ArrowLeft, BarChart3, Tag } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { AnalyticsSourceType } from '../../api/analytics'
import { useReviewStore } from '../../store/review-store'
import { reviewTagBadge } from '../review/tag-colors'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

interface TagRow {
  groupId: string
  groupName: string
  tagId: string
  tagName: string
  color: Parameters<typeof reviewTagBadge>[0]
  trades: number
  wins: number
  pnlCents: number
  rValues: number[]
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }): ReactElement {
  return <div className="rounded-[12px] border border-[#3c4046] bg-[#121416] p-5"><p className="text-[13px] text-[#aeb4bd]">{label}</p><p className="mt-1 font-mono text-[24px] font-semibold leading-8 text-[#f1f3f5]">{value}</p><p className="mt-1 text-xs text-[#858c96]">{detail}</p></div>
}

export function TagAnalyticsTab({ sourceType, sourceId }: { sourceType: AnalyticsSourceType; sourceId: string }): ReactElement {
  const groups = useReviewStore((state) => state.tagGroups)
  const documents = useReviewStore((state) => state.documents)
  const rows = useMemo<TagRow[]>(() => {
    const byTag = new Map<string, TagRow>()
    for (const document of Object.values(documents)) {
      if (document.trade.sourceType !== sourceType || document.trade.sourceId !== sourceId) continue
      for (const [groupId, tagId] of Object.entries(document.tagAssignments)) {
        const group = groups.find((item) => item.id === groupId)
        const tag = group?.tags.find((item) => item.id === tagId)
        if (!group || !tag) continue
        const key = `${groupId}:${tagId}`
        const row = byTag.get(key) ?? { groupId, groupName: group.name, tagId, tagName: tag.name, color: tag.color, trades: 0, wins: 0, pnlCents: 0, rValues: [] }
        row.trades += 1
        row.wins += document.trade.realizedCents > 0 ? 1 : 0
        row.pnlCents += document.trade.realizedCents
        if (document.trade.rMultiple !== null) row.rValues.push(document.trade.rMultiple)
        byTag.set(key, row)
      }
    }
    return [...byTag.values()].toSorted((a, b) => b.trades - a.trades || b.pnlCents - a.pnlCents)
  }, [documents, groups, sourceId, sourceType])
  const taggedTrades = useMemo(() => new Set(Object.values(documents).filter((document) => document.trade.sourceType === sourceType && document.trade.sourceId === sourceId && Object.keys(document.tagAssignments).length > 0).map((document) => document.trade.id)).size, [documents, sourceId, sourceType])
  const totalAssignments = rows.reduce((sum, row) => sum + row.trades, 0)
  const profitableTags = rows.filter((row) => row.pnlCents > 0).length
  const best = rows.toSorted((a, b) => b.pnlCents - a.pnlCents)[0]
  const maxTrades = Math.max(1, ...rows.map((row) => row.trades))

  if (rows.length === 0) return (
    <section className="grid min-h-[430px] place-items-center rounded-[14px] border border-[#3c4046] bg-[#121416] px-6 text-center">
      <div className="max-w-md"><span className="mx-auto grid size-12 place-items-center rounded-xl border border-[#3c4046] bg-[#191c20] text-[#7fa4ff]"><Tag size={21} /></span><h2 className="mt-4 text-xl font-semibold text-[#f2f4f6]">No tagged trades yet</h2><p className="mt-2 text-sm leading-6 text-[#9299a3]">Open Trade Review, create a tag group, and label trades from this source. Tag performance will appear here from those real assignments.</p><a href="/" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#464a51] bg-[#202328] px-4 text-sm font-medium text-white hover:bg-[#292d33]"><ArrowLeft size={15} />Back to Review</a></div>
    </section>
  )

  return (
    <div className="space-y-6">
      <header><h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#f2f4f6]">Performance by tag</h2><p className="mt-1 text-[13px] leading-5 text-[#9299a3]">Compare the outcomes of the labels applied during Trade Review.</p></header>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Tagged trades" value={String(taggedTrades)} detail="Unique closed trades" />
        <Metric label="Tag assignments" value={String(totalAssignments)} detail={`${rows.length} tags represented`} />
        <Metric label="Profitable tags" value={String(profitableTags)} detail={`of ${rows.length} with net positive P&L`} />
        <Metric label="Best net tag" value={best?.tagName ?? '—'} detail={best ? money.format(best.pnlCents / 100) : 'No result'} />
      </section>
      <section className="rounded-[14px] border border-[#3c4046] bg-[#121416] p-5">
        <div className="mb-5 flex items-center justify-between"><div><h3 className="text-[17px] font-semibold text-[#f1f3f5]">Tag frequency</h3><p className="mt-1 text-xs text-[#8d949e]">Hover a bar for its exact assignment count.</p></div><BarChart3 size={18} className="text-[#7fa4ff]" /></div>
        <div className="space-y-3">
          {rows.slice(0, 12).map((row) => <div key={`${row.groupId}:${row.tagId}`} className="group relative grid grid-cols-[minmax(100px,180px)_1fr_38px] items-center gap-3" tabIndex={0}><span className={`truncate rounded-control px-2 py-1 text-xs font-semibold ${reviewTagBadge(row.color)}`}>{row.tagName}</span><div className="h-2 overflow-hidden rounded-full bg-[#24272c]"><div className="h-full rounded-full bg-[#5b8cff]" style={{ width: `${Math.max(5, row.trades / maxTrades * 100)}%` }} /></div><span className="text-right font-mono text-xs text-[#b8bec7]">{row.trades}</span><span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 rounded-md border border-[#4b5058] bg-[#0d0f12] px-3 py-2 text-xs text-[#d8dce2] shadow-lg group-hover:block group-focus:block">{row.groupName} · {row.tagName}: {row.trades} assignments</span></div>)}
        </div>
      </section>
      <section className="overflow-hidden rounded-[14px] border border-[#3c4046] bg-[#121416]">
        <div className="border-b border-[#35393f] px-5 py-4"><h3 className="text-[17px] font-semibold text-[#f1f3f5]">Tag outcomes</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead className="bg-[#0d0f11] text-xs text-[#939aa4]"><tr><th className="px-5 py-3 font-medium">Group / tag</th><th className="px-3 py-3 text-right font-medium">Trades</th><th className="px-3 py-3 text-right font-medium">Win rate</th><th className="px-3 py-3 text-right font-medium">Average R</th><th className="px-5 py-3 text-right font-medium">Net P&amp;L</th></tr></thead>
            <tbody className="divide-y divide-[#30343a]">
              {rows.map((row) => {
                const averageR = row.rValues.length ? row.rValues.reduce((sum, value) => sum + value, 0) / row.rValues.length : null
                return <tr key={`${row.groupId}:${row.tagId}`} className="hover:bg-white/[0.025]"><td className="px-5 py-3"><span className="block text-xs text-[#858c96]">{row.groupName}</span><span className={`mt-1 inline-block rounded-control px-2 py-1 text-xs font-semibold ${reviewTagBadge(row.color)}`}>{row.tagName}</span></td><td className="px-3 py-3 text-right font-mono text-sm text-[#d9dde2]">{row.trades}</td><td className="px-3 py-3 text-right font-mono text-sm text-[#d9dde2]">{(row.wins / row.trades * 100).toFixed(1)}%</td><td className="px-3 py-3 text-right font-mono text-sm text-[#d9dde2]">{averageR === null ? '—' : `${averageR.toFixed(2)}R`}</td><td className={`px-5 py-3 text-right font-mono text-sm font-semibold ${row.pnlCents >= 0 ? 'text-profit-bright' : 'text-loss-bright'}`}>{row.pnlCents > 0 ? '+' : ''}{money.format(row.pnlCents / 100)}</td></tr>
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
