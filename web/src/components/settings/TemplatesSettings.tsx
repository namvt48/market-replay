import { Copy, FilePlus2, Search, Star, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactElement } from 'react'
import { useWorkspaceSettingsStore } from '../../store/workspace-settings-store'

export function TemplatesSettings(): ReactElement {
  const templates = useWorkspaceSettingsStore((state) => state.journalTemplates)
  const addTemplate = useWorkspaceSettingsStore((state) => state.addTemplate)
  const duplicateTemplate = useWorkspaceSettingsStore((state) => state.duplicateTemplate)
  const updateTemplate = useWorkspaceSettingsStore((state) => state.updateTemplate)
  const deleteTemplate = useWorkspaceSettingsStore((state) => state.deleteTemplate)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(templates[0]?.id ?? null)
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return templates.filter((template) => !normalized || `${template.name} ${template.body}`.toLowerCase().includes(normalized)).toSorted((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt)
  }, [query, templates])
  const selected = templates.find((template) => template.id === selectedId) ?? filtered[0] ?? null

  return (
    <section aria-labelledby="templates-settings-title" className="flex h-full min-h-[34rem] flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-line bg-surface-0/45 lg:w-72 lg:border-b-0 lg:border-r">
        <div className="border-b border-line p-3"><div className="flex items-center justify-between gap-2"><h2 id="templates-settings-title" className="text-ui-title font-semibold text-ink">Journal templates</h2><button type="button" onClick={() => setSelectedId(addTemplate())} className="tool-button" aria-label="New journal template"><FilePlus2 size={16} /></button></div><label className="relative mt-3 block"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" /><span className="sr-only">Search templates</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="field-input h-9 w-full pl-9" placeholder="Search templates" /></label></div>
        <div className="max-h-48 overflow-y-auto p-2 lg:max-h-none lg:min-h-0 lg:flex-1">{filtered.map((template) => <button key={template.id} type="button" onClick={() => setSelectedId(template.id)} aria-pressed={selected?.id === template.id} className="mb-1 flex min-h-11 w-full items-center gap-2 rounded-control px-3 text-left text-ui-body text-muted hover:bg-surface-2 hover:text-ink aria-pressed:bg-surface-3 aria-pressed:text-ink">{template.favorite ? <Star size={14} fill="currentColor" className="shrink-0 text-active-bright" /> : <span className="w-3.5" />}<span className="min-w-0 flex-1 truncate">{template.name}</span></button>)}</div>
      </aside>
      {selected ? <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"><input aria-label="Template name" value={selected.name} onChange={(event) => updateTemplate(selected.id, { name: event.target.value })} className="min-w-48 flex-1 bg-transparent text-lg font-semibold text-ink outline-none focus-visible:ring-1 focus-visible:ring-active" /><button type="button" onClick={() => updateTemplate(selected.id, { favorite: !selected.favorite })} aria-pressed={selected.favorite} className="secondary-button h-8 min-h-8 px-2.5"><Star size={14} fill={selected.favorite ? 'currentColor' : 'none'} />{selected.favorite ? 'Favorited' : 'Favorite'}</button><button type="button" onClick={() => { const id = duplicateTemplate(selected.id); if (id) setSelectedId(id) }} className="tool-button" aria-label="Duplicate template" title="Duplicate"><Copy size={15} /></button><button type="button" onClick={() => { deleteTemplate(selected.id); setSelectedId(templates.find((template) => template.id !== selected.id)?.id ?? null) }} className="tool-button text-loss-bright" aria-label="Delete template" title="Delete"><Trash2 size={15} /></button></header>
        <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6"><label className="flex min-h-80 flex-1 flex-col"><span className="mb-2 text-ui-meta font-semibold uppercase tracking-[0.06em] text-dim">Template content</span><textarea value={selected.body} onChange={(event) => updateTemplate(selected.id, { body: event.target.value })} className="field-input min-h-72 flex-1 resize-none p-4 font-mono text-ui-body leading-relaxed" placeholder="Write prompts, a checklist, or a repeatable review structure…" /></label><p className="mt-3 shrink-0 text-ui-meta text-dim">Saved automatically. These templates are available across browsers through workspace preferences.</p></div>
      </div> : <div className="grid min-h-80 flex-1 place-items-center p-8 text-center"><div><FilePlus2 size={24} className="mx-auto text-dim" /><p className="mt-3 text-ui-title font-semibold text-ink">Create your first journal template</p><button type="button" onClick={() => setSelectedId(addTemplate())} className="primary-button mt-4"><FilePlus2 size={15} />New template</button></div></div>}
    </section>
  )
}
