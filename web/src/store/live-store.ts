import { z } from 'zod'

// Live-journal statistics templates and per-journal compositions live in
// localStorage, exactly like eval accounts (eval-store). No zustand store
// on purpose: panels keep UI state locally.

export type LiveStatMetric =
  | 'totalPnl' | 'winRate' | 'profitFactor' | 'averageRr'
  | 'averageWin' | 'averageLoss' | 'totalTrades'

export type LiveBlockKind = 'equity' | 'stat' | 'image' | 'text'

export interface LiveTemplateBlock {
  id: string
  kind: LiveBlockKind
  label: string
  metric?: LiveStatMetric
  text?: string
}

export interface LiveTemplate {
  id: string
  name: string
  blocks: LiveTemplateBlock[]
  createdAt: number
  updatedAt: number
}

export interface LiveComposition {
  sessionId: string
  templateId: string
  blockOverrides: Record<string, { imageId?: string; text?: string }>
  updatedAt: number
}

const TEMPLATES_KEY = 'replay:live:templates'
const COMPOSITIONS_KEY = 'replay:live:compositions'

const blockSchema = z.object({
  id: z.string(),
  kind: z.enum(['equity', 'stat', 'image', 'text']),
  label: z.string(),
  metric: z.enum(['totalPnl', 'winRate', 'profitFactor', 'averageRr', 'averageWin', 'averageLoss', 'totalTrades']).optional(),
  text: z.string().optional(),
})

const templateSchema = z.object({
  id: z.string(),
  name: z.string(),
  blocks: z.array(blockSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const compositionSchema = z.object({
  sessionId: z.string(),
  templateId: z.string(),
  blockOverrides: z.record(z.string(), z.object({ imageId: z.string().optional(), text: z.string().optional() })),
  updatedAt: z.number(),
})

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function loadLiveTemplates(): LiveTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY)
    if (!raw) return []
    const parsed = z.array(templateSchema).safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

function persistTemplates(templates: LiveTemplate[]): void {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates))
}

export function createLiveTemplate(name: string): string {
  const now = Date.now()
  const id = newId('tpl')
  const templates = loadLiveTemplates()
  templates.push({ id, name, blocks: [], createdAt: now, updatedAt: now })
  persistTemplates(templates)
  return id
}

export function updateLiveTemplate(id: string, patch: Partial<Pick<LiveTemplate, 'name' | 'blocks'>>): void {
  const templates = loadLiveTemplates().map((t) =>
    t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t,
  )
  persistTemplates(templates)
}

export function deleteLiveTemplate(id: string): void {
  persistTemplates(loadLiveTemplates().filter((t) => t.id !== id))
}

export function duplicateLiveTemplate(id: string): string | null {
  const source = loadLiveTemplates().find((t) => t.id === id)
  if (!source) return null
  const now = Date.now()
  const copy: LiveTemplate = {
    ...source,
    id: newId('tpl'),
    name: `${source.name} copy`,
    createdAt: now,
    updatedAt: now,
    blocks: source.blocks.map((b) => ({ ...b, id: newId('blk') })),
  }
  persistTemplates([...loadLiveTemplates(), copy])
  return copy.id
}

export function loadLiveComposition(sessionId: string): LiveComposition | null {
  try {
    const raw = localStorage.getItem(COMPOSITIONS_KEY)
    if (!raw) return null
    const parsed = z.array(compositionSchema).safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    return parsed.data.find((c) => c.sessionId === sessionId) ?? null
  } catch {
    return null
  }
}

export function saveLiveComposition(sessionId: string, composition: LiveComposition): void {
  let existing: LiveComposition[] = []
  try {
    const raw = localStorage.getItem(COMPOSITIONS_KEY)
    if (raw) {
      const parsed = z.array(compositionSchema).safeParse(JSON.parse(raw))
      if (parsed.success) existing = parsed.data
    }
  } catch {
    // A corrupt registry must not block the write; start from empty.
  }
  const next = existing.filter((c) => c.sessionId !== sessionId)
  localStorage.setItem(COMPOSITIONS_KEY, JSON.stringify([...next, { ...composition, sessionId }]))
}
