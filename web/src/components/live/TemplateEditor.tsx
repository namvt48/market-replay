import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { DetailDialog } from '../ui/DetailDialog'
import { loadLiveTemplates, updateLiveTemplate } from '../../store/live-store'
import type { LiveStatMetric, LiveTemplateBlock } from '../../store/live-store'

const METRICS: Array<{ value: LiveStatMetric; label: string }> = [
  { value: 'totalPnl', label: 'Total PnL' },
  { value: 'winRate', label: 'Win rate' },
  { value: 'profitFactor', label: 'Profit factor' },
  { value: 'averageRr', label: 'Avg R multiple' },
  { value: 'averageWin', label: 'Avg win' },
  { value: 'averageLoss', label: 'Avg loss' },
  { value: 'totalTrades', label: 'Trades' },
]

function newBlock(kind: LiveTemplateBlock['kind']): LiveTemplateBlock {
  const id = `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  switch (kind) {
    case 'equity': return { id, kind, label: 'Equity curve' }
    case 'stat': return { id, kind, label: 'Stat card', metric: 'totalPnl' }
    case 'image': return { id, kind, label: 'Image slot' }
    case 'text': return { id, kind, label: 'Text', text: '' }
  }
}

interface Props {
  onClose: () => void
}

export function TemplateEditor({ onClose }: Props) {
  const template = loadLiveTemplates().at(-1)
  const [blocks, setBlocks] = useState<LiveTemplateBlock[]>(template?.blocks ?? [])
  const [name, setName] = useState(template?.name ?? 'Untitled stats template')
  const [dirty, setDirty] = useState(false)

  const save = () => {
    if (!template) return
    updateLiveTemplate(template.id, { name, blocks })
    setDirty(false)
    onClose()
  }

  const patchBlock = (id: string, patch: Partial<LiveTemplateBlock>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
    setDirty(true)
  }

  const moveBlock = (index: number, dir: -1 | 1) => {
    setBlocks((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setDirty(true)
  }

  return (
    <DetailDialog
      titleId="live-template-editor-heading"
      title={
        <input
          id="live-template-editor-heading"
          aria-label="Template name"
          value={name}
          onChange={(e) => { setName(e.target.value); setDirty(true) }}
          className="w-full bg-transparent text-lg font-semibold text-ink outline-none focus-visible:ring-1 focus-visible:ring-active"
        />
      }
      status={
        <>
          <button type="button" className="primary-button h-8" disabled={!dirty} onClick={save}>Save</button>
          <button type="button" className="secondary-button h-8" onClick={onClose}>Cancel</button>
        </>
      }
      onClose={onClose}
    >
      <div className="grid gap-2 p-4">
        <div className="flex flex-wrap gap-2">
          {(['equity', 'stat', 'image', 'text'] as const).map((kind) => (
            <button key={kind} type="button" className="tool-button" onClick={() => { setBlocks((prev) => [...prev, newBlock(kind)]); setDirty(true) }}>
              <Plus size={14} /> Add {kind}
            </button>
          ))}
        </div>
        {blocks.length === 0 && <p className="py-8 text-center text-ui-body text-muted">No blocks yet — add equity, stat, image or text blocks.</p>}
        <ul className="space-y-2">
          {blocks.map((block, index) => (
            <li key={block.id} className="flex flex-wrap items-center gap-2 rounded-control border border-line bg-surface-0 p-2">
              <span className="w-24 shrink-0 text-ui-meta font-semibold uppercase tracking-[0.08em] text-muted">{block.kind}</span>
              <input className="field-input h-8 min-w-32 flex-1" value={block.label} onChange={(e) => patchBlock(block.id, { label: e.target.value })} aria-label={`${block.kind} label`} />
              {block.kind === 'stat' && (
                <select className="field-input h-8" value={block.metric} onChange={(e) => patchBlock(block.id, { metric: e.target.value as LiveStatMetric })} aria-label="Metric">
                  {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              )}
              {block.kind === 'text' && (
                <textarea className="field-input h-8 min-w-48 flex-1" value={block.text ?? ''} onChange={(e) => patchBlock(block.id, { text: e.target.value })} aria-label="Text content" />
              )}
              <button type="button" className="tool-button" onClick={() => moveBlock(index, -1)} aria-label={`Move ${block.label} up`}><ArrowUp size={14} /></button>
              <button type="button" className="tool-button" onClick={() => moveBlock(index, 1)} aria-label={`Move ${block.label} down`}><ArrowDown size={14} /></button>
              <button type="button" className="tool-button text-loss-bright" onClick={() => { setBlocks((prev) => prev.filter((b) => b.id !== block.id)); setDirty(true) }} aria-label={`Delete ${block.label}`}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      </div>
    </DetailDialog>
  )
}