import { Check, MoreHorizontal, Palette, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useMemo, useRef, useState, type ReactElement } from 'react'
import { useDismissableLayer } from '../../hooks/use-dismissable-layer'
import { useReviewStore, type ReviewTagColor, type ReviewTagGroup } from '../../store/review-store'

const COLORS: readonly ReviewTagColor[] = ['green', 'blue', 'orange', 'red', 'purple', 'cyan', 'grey']
const COLOR_CLASS: Record<ReviewTagColor, string> = { green: 'bg-profit/14 text-profit-bright', blue: 'bg-active/14 text-active-bright', orange: 'bg-amber-500/15 text-amber-300', red: 'bg-loss/14 text-loss-bright', purple: 'bg-purple-500/15 text-purple-300', cyan: 'bg-cyan-500/15 text-cyan-300', grey: 'bg-surface-3 text-muted' }
const COLOR_DOT_CLASS: Record<ReviewTagColor, string> = { green: 'bg-profit-bright', blue: 'bg-active-bright', orange: 'bg-amber-400', red: 'bg-loss-bright', purple: 'bg-purple-400', cyan: 'bg-cyan-400', grey: 'bg-neutral-400' }
const COLOR_LABEL: Record<ReviewTagColor, string> = { green: 'Green', blue: 'Blue', orange: 'Orange', red: 'Red', purple: 'Purple', cyan: 'Light blue', grey: 'Grey' }

interface TagColorPickerProps {
  name: string
  value: ReviewTagColor
  onChange: (color: ReviewTagColor) => void
}

function TagColorPicker({ name, value, onChange }: TagColorPickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  useDismissableLayer({ open, layerRef: controlRef, onDismiss: () => setOpen(false) })
  return (
    <div ref={controlRef} className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} className="tool-button" aria-label={`Choose ${name} color`} aria-haspopup="dialog" aria-expanded={open} title="Choose color"><Palette size={14} /></button>
      {open ? <div role="dialog" aria-label={`Color for ${name}`} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }} className="absolute right-0 top-9 z-40 w-56 rounded-panel border border-line-strong bg-[#111214] p-2 shadow-overlay">
        <p className="px-2 pb-2 text-ui-meta font-semibold uppercase tracking-[0.06em] text-dim">Tag color</p>
        <div role="radiogroup" aria-label={`Available colors for ${name}`} className="grid grid-cols-2 gap-1">
          {COLORS.map((color) => <button key={color} type="button" role="radio" aria-checked={value === color} onClick={() => { onChange(color); setOpen(false) }} className="flex h-9 items-center gap-2 rounded-control px-2 text-left text-ui-body text-muted hover:bg-surface-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-active aria-checked:bg-surface-3 aria-checked:text-ink"><span className={`size-3 rounded-[3px] ${COLOR_DOT_CLASS[color]}`} /><span className="flex-1">{COLOR_LABEL[color]}</span>{value === color ? <Check size={13} className="text-active-bright" /> : null}</button>)}
        </div>
      </div> : null}
    </div>
  )
}

function TagGroupCard({ group }: { group: ReviewTagGroup }): ReactElement {
  const addTag = useReviewStore((state) => state.addTag)
  const updateTag = useReviewStore((state) => state.updateTag)
  const deleteTag = useReviewStore((state) => state.deleteTag)
  const renameGroup = useReviewStore((state) => state.renameTagGroup)
  const deleteGroup = useReviewStore((state) => state.deleteTagGroup)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const submitTag = (): void => {
    if (!newName.trim()) return
    addTag(group.id, newName, 'blue')
    setNewName('')
    setAdding(false)
  }

  return (
    <article className="relative min-h-56 rounded-panel border border-line-strong bg-surface-0/45">
      <header className="flex min-h-12 items-center gap-2 border-b border-line px-3">
        <span aria-hidden="true" className="text-dim">⠿</span>
        <input aria-label={`Rename ${group.name} tag group`} value={group.name} onChange={(event) => renameGroup(group.id, event.target.value)} className="min-w-0 flex-1 bg-transparent text-ui-title font-semibold text-ink outline-none focus-visible:ring-1 focus-visible:ring-active" />
        <button type="button" onClick={() => setAdding(true)} className="secondary-button h-8 min-h-8 px-2.5"><Plus size={14} />Tag</button>
        <div className="relative"><button type="button" onClick={() => setMenuOpen((open) => !open)} className="tool-button" aria-label={`More options for ${group.name}`} aria-expanded={menuOpen}><MoreHorizontal size={16} /></button>{menuOpen ? <div role="menu" className="absolute right-0 top-9 z-20 w-40 rounded-control border border-line-strong bg-surface-2 p-1 shadow-overlay"><button type="button" role="menuitem" onClick={() => { deleteGroup(group.id); setMenuOpen(false) }} className="flex h-9 w-full items-center gap-2 rounded-[3px] px-2.5 text-left text-ui-body text-loss-bright hover:bg-loss/10"><Trash2 size={14} />Delete group</button></div> : null}</div>
      </header>
      <div className="p-2">
        {adding ? <form onSubmit={(event) => { event.preventDefault(); submitTag() }} className="mb-2 flex items-center gap-1 rounded-control border border-active bg-surface-1 p-1"><input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Tag name" aria-label={`New tag in ${group.name}`} className="h-8 min-w-0 flex-1 bg-transparent px-2 text-ui-body text-ink outline-none" /><button type="submit" className="tool-button" aria-label="Add tag"><Check size={15} /></button><button type="button" onClick={() => setAdding(false)} className="tool-button" aria-label="Cancel"><X size={15} /></button></form> : null}
        <ul className="space-y-1">
          {group.tags.map((tag) => (
            <li key={tag.id} className="group flex min-h-10 items-center gap-2 rounded-control px-2 hover:bg-surface-2">
              <span aria-hidden="true" className="text-dim">⠿</span>
              {editingTagId === tag.id ? <input autoFocus defaultValue={tag.name} onBlur={(event) => { updateTag(group.id, tag.id, { name: event.target.value }); setEditingTagId(null) }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setEditingTagId(null) }} aria-label={`Rename ${tag.name}`} className="field-input h-8 min-w-0 flex-1" /> : <span className={`max-w-full truncate rounded-[4px] px-2 py-1 text-ui-body font-medium ${COLOR_CLASS[tag.color]}`}>{tag.name}</span>}
              <div className="ml-auto flex items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <TagColorPicker name={tag.name} value={tag.color} onChange={(color) => updateTag(group.id, tag.id, { color })} />
                <button type="button" onClick={() => setEditingTagId(tag.id)} className="tool-button" aria-label={`Rename ${tag.name}`}><Pencil size={13} /></button>
                <button type="button" onClick={() => deleteTag(group.id, tag.id)} className="tool-button text-loss-bright" aria-label={`Delete ${tag.name}`}><Trash2 size={13} /></button>
              </div>
            </li>
          ))}
        </ul>
        {group.tags.length === 0 && !adding ? <button type="button" onClick={() => setAdding(true)} className="flex h-28 w-full items-center justify-center gap-2 text-ui-body text-dim hover:text-ink"><Plus size={15} />Add the first tag</button> : null}
      </div>
    </article>
  )
}

export function TagsSettings(): ReactElement {
  const groups = useReviewStore((state) => state.tagGroups)
  const addGroup = useReviewStore((state) => state.addTagGroup)
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return groups
    return groups.filter((group) => group.name.toLowerCase().includes(normalized) || group.tags.some((tag) => tag.name.toLowerCase().includes(normalized)))
  }, [groups, query])
  return (
    <section aria-labelledby="tags-settings-title" className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-ui-meta font-semibold uppercase tracking-[0.08em] text-active-bright">Trade review</p><h2 id="tags-settings-title" className="mt-1 text-xl font-semibold tracking-tight text-ink">Tag groups</h2><p className="mt-2 max-w-2xl text-ui-body text-muted">Organize the labels used in every journal review. A trade can use several tags from each group.</p></div>
        <button type="button" onClick={() => addGroup('New tag group')} className="primary-button shrink-0"><Plus size={15} />New group</button>
      </div>
      <label className="relative mt-5 block max-w-sm"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" /><span className="sr-only">Search tag groups</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="field-input h-10 w-full pl-9" placeholder="Search groups or tags" /></label>
      <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{filtered.map((group) => <TagGroupCard key={group.id} group={group} />)}</div>
      {filtered.length === 0 ? <div className="mt-8 rounded-panel border border-dashed border-line-strong p-10 text-center"><p className="text-ui-title font-semibold text-ink">{groups.length === 0 ? 'No tag groups yet' : 'No matching tags'}</p><p className="mt-1 text-ui-body text-dim">{groups.length === 0 ? 'Create a group for setup, confidence, execution, or any system you use.' : 'Try a different search.'}</p></div> : null}
    </section>
  )
}
