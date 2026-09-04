import { ImagePlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { uploadJournalImage } from '../../api/client'
import { fetchAnalyticsPerformance } from '../../api/analytics'
import type { AnalyticsPerformance } from '../../api/analytics'
import { loadLiveComposition, loadLiveTemplates, saveLiveComposition } from '../../store/live-store'
import type { LiveComposition, LiveTemplateBlock } from '../../store/live-store'
import { DetailDialog } from '../ui/DetailDialog'
import { LineChart } from '../analytics/InteractiveAnalyticsCharts'
import { resolveMetric } from './live-template'
import { StatCard } from './LiveJournalDetail'

interface Props {
  sessionId: string
  title: string
  templateId: string
  onClose: () => void
}

export function JournalComposer({ sessionId, title, templateId, onClose }: Props) {
  const [composition, setComposition] = useState<LiveComposition | null>(() => loadLiveComposition(sessionId))
  const [report, setReport] = useState<AnalyticsPerformance | null>(null)

  useEffect(() => {
    void fetchAnalyticsPerformance('live', sessionId, 5, 'UTC').then(setReport)
  }, [sessionId])

  const template = useMemo(() => loadLiveTemplates().find((t) => t.id === templateId) ?? null, [templateId])
  const blocks = template?.blocks ?? []

  const equityValues = useMemo(() => {
    if (!report?.equityCurve?.length) return []
    return report.equityCurve
      .filter((p) => p.closedAt)
      .map((p) => p.balance)
  }, [report])

  const persist = (blockOverrides: LiveComposition['blockOverrides']) => {
    const next: LiveComposition = { sessionId, templateId, blockOverrides, updatedAt: Date.now() }
    saveLiveComposition(sessionId, next)
    setComposition(next)
  }

  const patchOverride = (blockId: string, patch: { imageId?: string; text?: string }) => {
    const base = composition?.blockOverrides ?? {}
    persist({ ...base, [blockId]: { ...base[blockId], ...patch } })
  }

  const handleImageUpload = async (block: LiveTemplateBlock, file: File) => {
    const imageId = await uploadJournalImage(sessionId, file)
    patchOverride(block.id, { imageId })
  }

  return (
    <DetailDialog
      titleId="live-journal-composer-heading"
      title={<div className="flex min-w-0 items-center gap-1.5"><h2 id="live-journal-composer-heading" className="truncate text-ui-title font-semibold text-ink">{title}</h2></div>}
      status={<span className="rounded-control bg-surface-2 px-2 py-1 font-mono text-ui-meta font-semibold text-active-bright">{template?.name ?? 'Template'}</span>}
      onClose={onClose}
    >
      <section className="p-4 sm:p-5">
        {blocks.length === 0
          ? <p className="py-8 text-center text-ui-body text-muted">This template has no blocks yet.</p>
          : <ul className="space-y-3">
              {blocks.map((block) => {
                const imageId = composition?.blockOverrides[block.id]?.imageId
                return (
                  <li key={block.id} className="rounded-control border border-line bg-surface-0 p-3">
                    <h4 className="mb-2 text-ui-meta font-semibold uppercase tracking-[0.08em] text-muted">{block.label}</h4>
                    {block.kind === 'equity' && (
                      equityValues.length > 0
                        ? <LineChart compact values={equityValues} fillArea ariaLabel="Live equity curve" />
                        : <p className="py-8 text-center text-ui-body text-muted">No closed trades yet.</p>
                    )}
                    {block.kind === 'stat' && (
                      <StatCard label={block.label} value={report ? resolveMetric(report, block.metric ?? 'totalPnl') : '—'} />
                    )}
                    {block.kind === 'image' && (
                      imageId
                        ? <img src={`/api/v1/images/${imageId}`} alt={block.label} className="w-full rounded-control border border-line object-cover" loading="lazy" />
                        : <label className="tool-button inline-flex items-center gap-1.5">
                            <ImagePlus size={15} /> Upload image
                            <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImageUpload(block, f); e.target.value = '' }} />
                          </label>
                    )}
                    {block.kind === 'text' && (
                      <textarea
                        className="field-input h-28 w-full"
                        aria-label={`${block.label} text`}
                        defaultValue={composition?.blockOverrides[block.id]?.text ?? block.text ?? ''}
                        onBlur={(e) => patchOverride(block.id, { text: e.target.value })}
                      />
                    )}
                  </li>
                )
              })}
            </ul>}
      </section>
    </DetailDialog>
  )
}