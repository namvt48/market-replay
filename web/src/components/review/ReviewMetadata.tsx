import {
  CalendarDays, ChevronDown, ChevronsUp, CircleDollarSign, Database, GripVertical, Info, Plus,
  Search, Tag, Trash2, TrendingUp, X,
} from 'lucide-react'
import { useMemo, useState, type DragEvent, type ReactElement } from 'react'
import type { SymbolMeta } from '../../api/types'
import type { ReviewTrade } from '../../review/types'
import { reviewDocumentKey, reviewTradeSnapshot } from '../../review/types'
import { useReviewStore, type ReviewTag, type ReviewTagGroup } from '../../store/review-store'
import { reviewTagBadge, reviewTagColors } from './tag-colors'
import { formatChartTime, type ChartTimezone } from '../../replay/chart-timezone'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

function TagEditor({ group, tag, onClose }: { group: ReviewTagGroup; tag: ReviewTag; onClose: () => void }): ReactElement {
  const updateTag = useReviewStore((state) => state.updateTag)
  const deleteTag = useReviewStore((state) => state.deleteTag)
  const [name, setName] = useState(tag.name)
  return (
    <div role="dialog" aria-label={`Edit ${tag.name} tag`} className="absolute right-2 top-9 z-40 w-[min(18rem,calc(100%-1rem))] rounded-panel border border-line-strong bg-[#111318] p-3 shadow-overlay">
      <input autoFocus aria-label="Tag name" value={name} onChange={(event) => setName(event.target.value)} onBlur={() => updateTag(group.id, tag.id, { name })} className="field-input w-full text-ui-control" />
      <div className="mt-3 space-y-0.5">
        {reviewTagColors.map((color) => (
          <button key={color.id} type="button" onClick={() => updateTag(group.id, tag.id, { color: color.id })} className="flex min-h-8 w-full items-center gap-3 rounded-control px-2 text-left text-ui-control text-ink hover:bg-surface-3">
            <span className={`size-3 rounded-[3px] ${color.className}`} aria-hidden="true" />
            <span className="flex-1">{color.label}</span>
            {tag.color === color.id ? <span aria-label="Selected">✓</span> : null}
          </button>
        ))}
      </div>
      <div className="mt-3 border-t border-line pt-2">
        <button type="button" onClick={() => { deleteTag(group.id, tag.id); onClose() }} className="flex min-h-9 w-full items-center gap-2 rounded-control px-2 text-left text-loss-bright hover:bg-loss/10"><Trash2 size={14} />Delete tag</button>
      </div>
    </div>
  )
}

function TagGroupRow({ group, trade, dragging, onDragStart, onDragOver, onDrop, onDragEnd }: {
  group: ReviewTagGroup
  trade: ReviewTrade
  dragging: boolean
  onDragStart: () => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: () => void
  onDragEnd: () => void
}): ReactElement {
  const key = reviewDocumentKey(trade.sourceType, trade.sourceId, trade.id)
  const assignment = useReviewStore((state) => state.documents[key]?.tagAssignments[group.id] ?? null)
  const assignTag = useReviewStore((state) => state.assignTag)
  const addTag = useReviewStore((state) => state.addTag)
  const deleteTagGroup = useReviewStore((state) => state.deleteTagGroup)
  const [query, setQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<string | null>(null)
  const selectedIds = Array.isArray(assignment) ? assignment : assignment ? [assignment] : []
  const selected = group.tags.filter((tag) => selectedIds.includes(tag.id))
  const editing = group.tags.find((tag) => tag.id === editingTag) ?? null
  const filtered = group.tags.filter((tag) => tag.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const assign = (tagId: string | null): void => assignTag(key, reviewTradeSnapshot(trade), group.id, tagId)
  const create = (): void => {
    const name = query.trim()
    if (!name) return
    const tagId = addTag(group.id, name)
    assign(tagId)
    setQuery('')
    setPickerOpen(true)
  }
  return (
    <section className={`relative transition-opacity ${dragging ? 'opacity-45' : ''}`} aria-labelledby={`review-tag-group-${group.id}`} draggable onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd}>
      <div className="group flex h-8 items-center gap-2 px-3 text-ui-body">
        <GripVertical size={13} className="shrink-0 cursor-grab text-dim opacity-60 active:cursor-grabbing" aria-label="Drag to reorder tag group" />
        <Tag size={14} className="shrink-0 text-[#8fc5df]" aria-hidden="true" />
        <button type="button" onClick={() => setManageOpen((open) => !open)} id={`review-tag-group-${group.id}`} className="min-w-0 flex-1 truncate text-left text-muted hover:text-ink" aria-expanded={manageOpen}>{group.name}</button>
        {selected.length ? (
          <button type="button" onClick={() => setPickerOpen((open) => !open)} className="flex max-w-[56%] items-center gap-1 overflow-hidden" aria-label={`Change ${group.name} tag: ${selected.map((tag) => tag.name).join(', ')}`} aria-expanded={pickerOpen}>{selected.map((tag) => <span key={tag.id} className={`truncate rounded-control px-2 py-0.5 text-ui-meta font-semibold ${reviewTagBadge(tag.color)}`}>{tag.name}</span>)}</button>
        ) : (
          <button type="button" onClick={() => setPickerOpen((open) => !open)} className="shrink-0 px-1 text-ui-body italic text-[#8fc5df] hover:text-active-bright" aria-expanded={pickerOpen}>Add tag</button>
        )}
      </div>
      {manageOpen ? (
        <div className="mx-3 mb-2 flex items-center justify-between rounded-control border border-line bg-surface-2 px-2 py-1.5">
          <span className="truncate text-ui-meta text-muted">Manage {group.name}</span>
          <button type="button" onClick={() => deleteTagGroup(group.id)} className="flex min-h-7 items-center gap-1.5 rounded-control px-2 text-ui-meta text-loss-bright hover:bg-loss/10"><Trash2 size={13} />Delete group</button>
        </div>
      ) : null}
      {editing ? <TagEditor group={group} tag={editing} onClose={() => setEditingTag(null)} /> : null}
      {pickerOpen ? (
        <div className="mx-3 mb-2 rounded-panel border border-line-strong bg-[#111318] p-2 shadow-overlay">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-dim" />
            <input autoFocus aria-label={`Select tag for ${group.name}`} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); create() }; if (event.key === 'Escape') setPickerOpen(false) }} placeholder="Select tag or create new one" className="field-input w-full pl-8 pr-8 font-sans" />
            <button type="button" onClick={() => setPickerOpen(false)} className="absolute right-1 top-1 grid size-7 place-items-center rounded-control text-dim hover:bg-surface-3 hover:text-ink" aria-label="Close tag picker"><X size={13} /></button>
          </div>
          <div className="mt-1 max-h-40 overflow-y-auto">
            {selected.length ? <button type="button" onClick={() => assign(null)} className="flex min-h-8 w-full items-center gap-2 rounded-control px-2 text-left text-ui-body text-muted hover:bg-surface-3"><X size={13} />Clear all tags</button> : null}
            {filtered.map((tag) => <div key={tag.id} className="group/tag flex items-center rounded-control hover:bg-surface-3"><button type="button" onClick={() => { assign(tag.id); setQuery('') }} aria-pressed={selectedIds.includes(tag.id)} className="flex min-h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left"><span className={`size-2.5 shrink-0 rounded-[3px] ${reviewTagColors.find((color) => color.id === tag.color)?.className}`} /><span className="min-w-0 flex-1 truncate text-ui-body text-ink">{tag.name}</span>{selectedIds.includes(tag.id) ? <span className="text-active-bright">✓</span> : null}</button><button type="button" onClick={() => setEditingTag(tag.id)} className="mr-1 hidden min-h-7 rounded-control px-2 text-ui-meta text-muted hover:text-ink group-hover/tag:block focus:block" aria-label={`Edit ${tag.name} tag`}>Edit</button></div>)}
            {query.trim() && !group.tags.some((tag) => tag.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase()) ? <button type="button" onClick={create} className="flex min-h-8 w-full items-center gap-2 rounded-control px-2 text-left text-ui-body text-active-bright hover:bg-active/10"><Plus size={13} />Create “{query.trim()}”</button> : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function TagGroups({ trade }: { trade: ReviewTrade }): ReactElement {
  const groups = useReviewStore((state) => state.tagGroups)
  const addTagGroup = useReviewStore((state) => state.addTagGroup)
  const moveTagGroup = useReviewStore((state) => state.moveTagGroup)
  const [adding, setAdding] = useState(false)
  const [searching, setSearching] = useState(false)
  const [name, setName] = useState('')
  const [groupQuery, setGroupQuery] = useState('')
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null)
  const save = (): void => {
    addTagGroup(name)
    setName('')
    setAdding(false)
  }
  const visibleGroups = groups.filter((group) => group.name.toLocaleLowerCase().includes(groupQuery.trim().toLocaleLowerCase()))
  return (
    <div>
      <div className="px-3 pb-1 pt-1.5">
        <div className="flex h-8 items-center justify-between">
          <button type="button" onClick={() => setAdding(true)} className="flex min-h-8 items-center gap-2 text-ui-body text-muted hover:text-ink"><Plus size={17} />Tag group</button>
          <button type="button" onClick={() => setSearching((open) => !open)} className="tool-button size-8" aria-label="Search tag groups" aria-pressed={searching}><Search size={16} /></button>
        </div>
        {searching ? <div className="relative mb-1"><Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-dim" /><input autoFocus aria-label="Search tag groups" value={groupQuery} onChange={(event) => setGroupQuery(event.target.value)} placeholder="Search groups" className="field-input w-full pl-8 pr-8 font-sans" /><button type="button" onClick={() => { setSearching(false); setGroupQuery('') }} className="absolute right-1 top-1 grid size-7 place-items-center rounded-control text-dim hover:bg-surface-3 hover:text-ink" aria-label="Close tag group search"><X size={13} /></button></div> : null}
        {adding ? (
          <div role="dialog" aria-label="Add tag group" className="mb-1 rounded-panel border border-line-strong bg-surface-2 p-2 shadow-overlay">
            <label className="flex items-center gap-2 rounded-control border border-line bg-surface-0 px-2"><Tag size={15} className="text-muted" /><input autoFocus aria-label="Tag group name" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') save(); if (event.key === 'Escape') setAdding(false) }} placeholder={`New tag group (${groups.length + 1})`} className="h-10 min-w-0 flex-1 bg-transparent text-ui-control text-ink outline-none placeholder:text-muted" /></label>
            <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setAdding(false)} className="secondary-button min-h-8">Cancel</button><button type="button" onClick={save} className="primary-button min-h-8">Add group</button></div>
          </div>
        ) : null}
      </div>
      {groups.length === 0 ? <p className="px-3 py-3 text-ui-meta leading-5 text-dim">No tag groups yet. Add one to classify this trade.</p> : visibleGroups.length === 0 ? <p className="px-3 py-3 text-ui-meta text-dim">No matching tag groups.</p> : visibleGroups.map((group) => <TagGroupRow key={group.id} group={group} trade={trade} dragging={draggedGroupId === group.id} onDragStart={() => setDraggedGroupId(group.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedGroupId) moveTagGroup(draggedGroupId, group.id); setDraggedGroupId(null) }} onDragEnd={() => setDraggedGroupId(null)} />)}
    </div>
  )
}

function DetailRow({ icon, label, value, tone = '' }: { icon: ReactElement; label: string; value: string; tone?: string }): ReactElement {
  return <div className="flex min-h-11 items-center gap-2 border-b border-line px-3 last:border-b-0"><span className="text-muted">{icon}</span><dt className="flex-1 text-ui-body text-muted">{label}</dt><dd className={`max-w-[58%] rounded-control bg-surface-3 px-2 py-1 text-right font-mono text-ui-body tabular-nums text-ink ${tone}`}>{value}</dd></div>
}

function priceLabel(ticks: number | null, symbol: SymbolMeta | undefined): string {
  if (ticks === null) return '—'
  return symbol ? (ticks * symbol.tickSize).toFixed(symbol.priceDecimals) : `${ticks.toLocaleString('en-US')} ticks`
}

function Details({ trade, symbol, timezone }: { trade: ReviewTrade; symbol: SymbolMeta | undefined; timezone: ChartTimezone }): ReactElement {
  const grossCents = trade.realizedCents + trade.feesCents
  const rows = useMemo(() => [
    { section: 'context', icon: <Database size={14} />, label: 'Source', value: trade.sourceType === 'session' ? 'Replay session' : trade.sourceType === 'evaluation' ? 'Evaluation account' : 'Live account' },
    { section: 'context', icon: <TrendingUp size={14} />, label: 'Asset', value: trade.symbol },
    { section: 'context', icon: <ChevronsUp size={14} />, label: 'Side', value: trade.side === 'long' ? 'Long' : 'Short' },
    { section: 'execution', icon: <Info size={14} />, label: 'Exit reason', value: trade.exitReason ? trade.exitReason.replace(/([A-Z])/g, ' $1') : '—' },
    { section: 'execution', icon: <CalendarDays size={14} />, label: 'Entry date', value: trade.entryTs ? formatChartTime(trade.entryTs, timezone, true, true) : '—' },
    { section: 'execution', icon: <CircleDollarSign size={14} />, label: 'Entry price', value: priceLabel(trade.entryPriceTicks, symbol) },
    { section: 'execution', icon: <CircleDollarSign size={14} />, label: 'Total size', value: trade.qty.toFixed(2) },
    { section: 'execution', icon: <CircleDollarSign size={14} />, label: 'Stop loss', value: priceLabel(trade.initialStopTicks, symbol) },
    { section: 'execution', icon: <CircleDollarSign size={14} />, label: 'Take profit', value: priceLabel(trade.initialTakeProfitTicks, symbol) },
    { section: 'execution', icon: <CalendarDays size={14} />, label: 'Exit date', value: formatChartTime(trade.exitTs, timezone, true, true) },
    { section: 'execution', icon: <CircleDollarSign size={14} />, label: 'Exit price', value: priceLabel(trade.exitPriceTicks, symbol) },
    { section: 'result', icon: <CircleDollarSign size={14} />, label: 'Gross P/L', value: money.format(grossCents / 100), tone: grossCents >= 0 ? 'text-profit-bright' : 'text-loss-bright' },
    { section: 'result', icon: <CircleDollarSign size={14} />, label: 'Commission', value: money.format(trade.feesCents / 100) },
    { section: 'result', icon: <CircleDollarSign size={14} />, label: 'Net P/L', value: money.format(trade.realizedCents / 100), tone: trade.realizedCents >= 0 ? 'text-profit-bright' : 'text-loss-bright' },
  ], [grossCents, symbol, timezone, trade])
  return <dl>{rows.map((row, index) => <div key={row.label} className={index > 0 && row.section !== rows[index - 1].section ? 'mt-3 border-t border-line pt-3' : ''}><DetailRow icon={row.icon} label={row.label} value={row.value} tone={row.tone} /></div>)}</dl>
}

export function ReviewMetadata({ trade, symbols, timezone }: { trade: ReviewTrade; symbols: SymbolMeta[]; timezone: ChartTimezone }): ReactElement {
  const [tab, setTab] = useState<'tags' | 'details'>('tags')
  const [expanded, setExpanded] = useState(true)
  const symbol = symbols.find((item) => item.symbol === trade.symbol)
  return (
    <section className="mt-3 shrink-0 bg-surface-0/45 px-3 pb-3" aria-label="Trade metadata">
      <header className="flex h-10 items-center justify-between">
        <div className="flex rounded-panel border border-line-strong bg-surface-0 p-0.5" role="tablist" aria-label="Trade metadata views">
          <button type="button" role="tab" aria-selected={tab === 'tags'} onClick={() => setTab('tags')} className="min-h-8 rounded-control px-4 text-ui-body font-medium text-muted aria-selected:bg-surface-3 aria-selected:text-ink">Tag groups</button>
          <button type="button" role="tab" aria-selected={tab === 'details'} onClick={() => setTab('details')} className="min-h-8 rounded-control px-4 text-ui-body font-medium text-muted aria-selected:bg-surface-3 aria-selected:text-ink">Details</button>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-label={expanded ? 'Hide trade metadata' : 'Show trade metadata'}
          aria-expanded={expanded}
          className="tool-button size-8"
        >
          <ChevronDown size={16} className={`text-active-bright transition-transform ${expanded ? '' : '-rotate-90'}`} aria-hidden="true" />
        </button>
      </header>
      {expanded ? <div role="tabpanel" className="max-h-[48vh] overflow-y-auto rounded-control border border-line">
        {tab === 'tags' ? <TagGroups trade={trade} /> : <Details trade={trade} symbol={symbol} timezone={timezone} />}
      </div> : null}
    </section>
  )
}
