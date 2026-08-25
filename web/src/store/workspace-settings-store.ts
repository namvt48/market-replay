import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { preferenceStorage } from './preference-sync'

export interface ExecutionCostOverride {
  spreadTicks: number
  commissionPerSide: number
}

export interface JournalTemplate {
  id: string
  name: string
  body: string
  favorite: boolean
  createdAt: number
  updatedAt: number
}

interface WorkspaceSettingsState {
  executionCosts: Record<string, ExecutionCostOverride>
  journalTemplates: JournalTemplate[]
  setExecutionCost: (symbol: string, value: ExecutionCostOverride) => void
  addTemplate: () => string
  duplicateTemplate: (id: string) => string | null
  updateTemplate: (id: string, patch: Partial<Pick<JournalTemplate, 'name' | 'body' | 'favorite'>>) => void
  deleteTemplate: (id: string) => void
}

const starterTemplate: JournalTemplate = {
  id: 'template-daily-review',
  name: 'Daily review',
  body: '## Plan\n- Market context:\n- Key level:\n- Risk limit:\n\n## Review\n- What worked:\n- What changes next time:',
  favorite: true,
  createdAt: 0,
  updatedAt: 0,
}

function identifier(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export const useWorkspaceSettingsStore = create<WorkspaceSettingsState>()(persist((set) => ({
  executionCosts: {},
  journalTemplates: [starterTemplate],
  setExecutionCost: (symbol, value) => set((state) => ({
    executionCosts: {
      ...state.executionCosts,
      [symbol]: {
        spreadTicks: Math.max(0, Number.isFinite(value.spreadTicks) ? value.spreadTicks : 0),
        commissionPerSide: Math.max(0, Number.isFinite(value.commissionPerSide) ? value.commissionPerSide : 0),
      },
    },
  })),
  addTemplate: () => {
    const id = identifier('template')
    const now = Date.now()
    set((state) => ({ journalTemplates: [...state.journalTemplates, { id, name: 'Untitled template', body: '', favorite: false, createdAt: now, updatedAt: now }] }))
    return id
  },
  duplicateTemplate: (id) => {
    let duplicateId: string | null = null
    set((state) => {
      const source = state.journalTemplates.find((template) => template.id === id)
      if (!source) return state
      duplicateId = identifier('template')
      const now = Date.now()
      return { journalTemplates: [...state.journalTemplates, { ...source, id: duplicateId, name: `${source.name} copy`, favorite: false, createdAt: now, updatedAt: now }] }
    })
    return duplicateId
  },
  updateTemplate: (id, patch) => set((state) => ({
    journalTemplates: state.journalTemplates.map((template) => template.id === id ? { ...template, ...patch, name: patch.name?.trim() || template.name, updatedAt: Date.now() } : template),
  })),
  deleteTemplate: (id) => set((state) => ({ journalTemplates: state.journalTemplates.filter((template) => template.id !== id) })),
}), {
  name: 'market-replay:workspace-settings:v1',
  storage: createJSONStorage(() => preferenceStorage),
  partialize: (state) => ({ executionCosts: state.executionCosts, journalTemplates: state.journalTemplates }),
}))

export function executionCostFor(symbol: string): ExecutionCostOverride | undefined {
  return useWorkspaceSettingsStore.getState().executionCosts[symbol]
}
