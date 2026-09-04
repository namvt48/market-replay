import { useEffect, useMemo, useState } from 'react'
import { NotebookPen, Plus } from 'lucide-react'
import { createSession, fetchSessions } from '../../api/client'
import { fetchAnalyticsSources } from '../../api/analytics'
import type { AnalyticsSource } from '../../api/analytics'
import { createLiveTemplate, loadLiveTemplates } from '../../store/live-store'
import { LiveJournalDetail } from './LiveJournalDetail'
import { TemplateEditor } from './TemplateEditor'
import { JournalComposer } from './JournalComposer'

interface NewJournalDraft {
  name: string
  symbol: string
  startBalanceDollars: string
}

export function LivePanel() {
  const [sources, setSources] = useState<AnalyticsSource[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<NewJournalDraft | null>(null)
  const [creating, setCreating] = useState(false)
  const [templates, setTemplates] = useState(() => loadLiveTemplates())
  const [editorOpen, setEditorOpen] = useState(false)
  const [composerTarget, setComposerTarget] = useState<{ sessionId: string; templateId: string } | null>(null)

  const refresh = async () => {
    const [all, sessions] = await Promise.all([fetchAnalyticsSources(), fetchSessions()])
    const liveIds = new Set(sessions.filter((s) => s.kind === 'live').map((s) => s.id))
    setSources(all.filter((src) => src.type === 'live' || liveIds.has(src.id)))
  }

  useEffect(() => { void refresh() }, [])

  const selected = useMemo(
    () => sources.find((src) => src.id === selectedId) ?? null,
    [sources, selectedId],
  )

  const handleCreateJournal = async () => {
    if (!draft) return
    setCreating(true)
    try {
      const balanceCents = Math.round((parseFloat(draft.startBalanceDollars) || 10000) * 100)
      await createSession(draft.symbol.trim() || 'LIVE', '1d', Math.floor(Date.now() / 1000), {
        kind: 'live',
        initialBalanceCents: balanceCents,
        name: draft.name.trim() || 'Live journal',
      })
      setDraft(null)
      await refresh()
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Live trade journal">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="flex items-center gap-2 text-ui-title font-semibold text-ink"><NotebookPen size={16} /> Live</h2>
        <button type="button" className="primary-button ml-auto gap-1.5" onClick={() => setDraft({ name: '', symbol: 'LIVE', startBalanceDollars: '10000' })}>
          <Plus size={14} /> <span className="sr-only">Create live journal</span>Journal
        </button>
        <button type="button" className="secondary-button gap-1.5" onClick={() => { createLiveTemplate('Untitled stats template'); setTemplates(loadLiveTemplates()); setEditorOpen(true) }}>
          <Plus size={14} /> <span className="sr-only">Create stats template</span>Template
        </button>
      </header>

      {editorOpen && <TemplateEditor onClose={() => setEditorOpen(false)} />}

      {draft && (
        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <label className="contents">
            <span className="sr-only">Journal name</span>
            <input className="field-input h-9" placeholder="Name (e.g. Month 1)" value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="contents">
            <span className="sr-only">Symbol</span>
            <input className="field-input h-9" placeholder="Symbol (default LIVE)" value={draft.symbol}
              onChange={(e) => setDraft({ ...draft, symbol: e.target.value })} />
          </label>
          <label className="contents">
            <span className="sr-only">Start balance (USD)</span>
            <input className="field-input h-9" type="number" min={0} step={100} placeholder="Start balance ($)" value={draft.startBalanceDollars}
              onChange={(e) => setDraft({ ...draft, startBalanceDollars: e.target.value })} />
          </label>
          <div className="flex gap-2">
            <button type="button" className="primary-button h-9" disabled={creating} onClick={() => void handleCreateJournal()}>Create</button>
            <button type="button" className="secondary-button h-9" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {sources.length === 0
          ? <div className="grid h-full place-items-center p-8 text-center"><div><NotebookPen size={24} className="mx-auto text-dim" /><p className="mt-3 text-ui-body text-muted">No live journals yet — create one above.</p></div></div>
          : <ul className="space-y-1">
              {sources.map((src) => (
                <li key={src.id}>
                  <button type="button" onClick={() => setSelectedId(src.id)} className="flex min-h-11 w-full items-center gap-2 rounded-control border border-transparent px-3 text-left hover:bg-surface-2">
                    <span className="min-w-0 flex-1 truncate text-ui-body text-ink">{src.title}</span>
                    <span className="text-ui-meta text-muted">{src.tradeCount} trades</span>
                  </button>
                </li>
              ))}
            </ul>}
        {templates.length > 0 && (
          <div className="mt-4 border-t border-line pt-2">
            <h3 className="px-3 pb-1 text-ui-meta font-semibold uppercase tracking-[0.08em] text-muted">Stats templates</h3>
            <ul className="space-y-1">
              {templates.map((tpl) => (
                <li key={tpl.id}>
                  <button type="button" onClick={() => { const first = sources[0]; if (first) setComposerTarget({ sessionId: first.id, templateId: tpl.id }) }} className="flex min-h-9 w-full items-center rounded-control px-3 text-left text-ui-body text-ink hover:bg-surface-2">
                    <span className="truncate">{tpl.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {selected && (
        <LiveJournalDetail
          sessionId={selected.id}
          title={selected.title}
          onClose={() => setSelectedId(null)}
          onChanged={() => void refresh()}
          templates={templates}
          onCompose={(templateId) => { if (selectedId) setComposerTarget({ sessionId: selectedId, templateId }) }}
        />
      )}

      {composerTarget && (
        <JournalComposer
          sessionId={composerTarget.sessionId}
          title={selected?.title ?? ''}
          templateId={composerTarget.templateId}
          onClose={() => setComposerTarget(null)}
        />
      )}
    </section>
  )
}