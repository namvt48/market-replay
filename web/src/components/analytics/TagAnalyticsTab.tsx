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

interface TagMetricProps { label: string; value: string; detail: string; tone?: 'default' | 'active' | 'profit' | 'loss' }
function Metric({ label, value, detail, tone = 'default' }: TagMetricProps): ReactElement {
  const toneClass = tone === 'active' ? 'text-active-bright' : tone === 'profit' ? 'text-profit-bright' : tone === 'loss' ? 'text-loss-bright' : 'text-ink'
  return <div className="rounded-[12px] border border-line-strong bg-surface-1 p-5"><p className="text-ui-body text-muted">{label}</p><p className={`mt-1 font-mono text-[24px] font-semibold leading-8 ${toneClass}`}>{value}</p><p className="mt-1 text-ui-meta text-dim">{detail}</p></div>
}

export function TagAnalyticsTab({ sourceType, sourceId }: { sourceType: AnalyticsSourceType; sourceId: string }): ReactElement {
  const groups = useReviewStore((state) => state.tagGroups)
  const documents = useReviewStore((state) => state.documents)
  const rows = useMemo<TagRow[]>(() => {
    const byTag = new Map<string, TagRow>()
    for (const group of groups) {
      for (const tag of group.tags) {
        byTag.set(`${group.id}:${tag.id}`, { groupId: group.id, groupName: group.name, tagId: tag.id, tagName: tag.name, color: tag.color, trades: 0, wins: 0, pnlCents: 0, rValues: [] })
      }
    }
    for (const document of Object.values(documents)) {
      if (document.trade.sourceType !== sourceType || document.trade.sourceId !== sourceId) continue
      for (const [groupId, assignment] of Object.entries(document.tagAssignments)) {
        for (const tagId of Array.isArray(assignment) ? assignment : [assignment]) {
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
    }
    return [...byTag.values()].toSorted((a, b) => b.trades - a.trades || b.pnlCents - a.pnlCents)
  }, [documents, groups, sourceId, sourceType])
  const taggedTrades = useMemo(() => new Set(Object.values(documents).filter((document) => document.trade.sourceType === sourceType && document.trade.sourceId === sourceId && Object.keys(document.tagAssignments).length > 0).map((document) => document.trade.id)).size, [documents, sourceId, sourceType])
  const groupedRows = useMemo(() => groups.map((group) => ({ group, rows: rows.filter((row) => row.groupId === group.id) })).filter(({ rows: groupRows }) => groupRows.length > 0), [groups, rows])
  const totalAssignments = rows.reduce((sum, row) => sum + row.trades, 0)
  const assignedRows = rows.filter((row) => row.trades > 0)
  const profitableTags = assignedRows.filter((row) => row.pnlCents > 0).length
  const best = assignedRows.toSorted((a, b) => b.pnlCents - a.pnlCents)[0]

  if (taggedTrades === 0) return (
    <section className="grid min-h-[430px] place-items-center rounded-[14px] border border-[#3c4046] bg-[#121416] px-6 text-center">
      <div className="max-w-md"><span className="mx-auto grid size-12 place-items-center rounded-xl border border-[#3c4046] bg-[#191c20] text-[#7fa4ff]"><Tag size={21} /></span><h2 className="mt-4 text-xl font-semibold text-[#f2f4f6]">No tagged trades yet</h2><p className="mt-2 text-sm leading-6 text-[#9299a3]">Open Trade Review, create a tag group, and label trades from this source. Tag performance will appear here from those real assignments.</p><a href="/" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#464a51] bg-[#202328] px-4 text-sm font-medium text-white hover:bg-[#292d33]"><ArrowLeft size={15} />Back to Review</a></div>
    </section>
  )

  return (
    <div className="space-y-6">
      <header><h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#f2f4f6]">Performance by tag</h2></header>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Tagged trades" value={String(taggedTrades)} detail="Unique closed trades" tone="active" />
        <Metric label="Tag assignments" value={String(totalAssignments)} detail={`${rows.length} tags represented`} tone="active" />
        <Metric label="Profitable tags" value={String(profitableTags)} detail={`of ${rows.length} with net positive P&L`} tone="profit" />
        <Metric label="Best net tag" value={best?.tagName ?? '—'} detail={best ? money.format(best.pnlCents / 100) : 'No result'} tone={best ? best.pnlCents >= 0 ? 'profit' : 'loss' : 'default'} />
      </section>
      <section aria-labelledby="tag-group-performance-heading" className="space-y-4">
        <div><h3 id="tag-group-performance-heading" className="text-[18px] font-semibold text-ink">Performance by tag group</h3></div>
        <div className="grid gap-4 xl:grid-cols-2">
          {groupedRows.map(({ group, rows: groupRows }) => <section key={group.id} aria-labelledby={`tag-group-${group.id}`} className="overflow-hidden rounded-[14px] border border-line-strong bg-surface-1">
            <div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h4 id={`tag-group-${group.id}`} className="text-[17px] font-semibold text-ink">{group.name}</h4><p className="mt-1 text-ui-meta text-muted">{groupRows.length} tags</p></div><BarChart3 size={18} className="text-active-bright" aria-hidden="true" /></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse text-left" aria-label={`${group.name} tag performance`}><thead className="bg-surface-0 text-ui-meta text-muted"><tr><th scope="col" className="px-5 py-3 font-medium">Tag</th><th scope="col" className="px-3 py-3 text-right font-medium">Trades</th><th scope="col" className="px-3 py-3 text-right font-medium">Win rate</th><th scope="col" className="px-3 py-3 text-right font-medium">Average R</th><th scope="col" className="px-5 py-3 text-right font-medium">Net P&amp;L</th></tr></thead><tbody className="divide-y divide-line">{groupRows.map((row) => { const averageR = row.rValues.length ? row.rValues.reduce((sum, value) => sum + value, 0) / row.rValues.length : null; const winRate = row.trades ? `${(row.wins / row.trades * 100).toFixed(1)}%` : '—'; return <tr key={`${row.groupId}:${row.tagId}`} className="hover:bg-surface-2"><th scope="row" className="px-5 py-3 text-left"><span className={`inline-block rounded-control px-2 py-1 text-ui-meta font-semibold ${reviewTagBadge(row.color)}`}>{row.tagName}</span></th><td className="px-3 py-3 text-right font-mono text-ui-body text-ink">{row.trades}</td><td className="px-3 py-3 text-right font-mono text-ui-body text-ink">{winRate}</td><td className="px-3 py-3 text-right font-mono text-ui-body text-ink">{averageR === null ? '—' : `${averageR.toFixed(2)}R`}</td><td className={`px-5 py-3 text-right font-mono text-ui-body font-semibold ${row.trades === 0 ? 'text-muted' : row.pnlCents >= 0 ? 'text-profit-bright' : 'text-loss-bright'}`}>{row.trades === 0 ? '—' : `${row.pnlCents > 0 ? '+' : ''}${money.format(row.pnlCents / 100)}`}</td></tr> })}</tbody></table></div>
          </section>)}
        </div>
      </section>
    </div>
  )
}
