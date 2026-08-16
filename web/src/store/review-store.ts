import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ReviewTradeSnapshot } from '../review/types'

export type ReviewTagColor = 'green' | 'blue' | 'orange' | 'red' | 'purple' | 'cyan' | 'grey'

export interface ReviewTag {
  id: string
  name: string
  color: ReviewTagColor
}

export interface ReviewTagGroup {
  id: string
  name: string
  tags: ReviewTag[]
}

export interface ReviewScreenshot {
  id: string
  dataUrl: string
  capturedAt: number
}

export interface ReviewDocument {
  note: string
  screenshots: ReviewScreenshot[]
  tagAssignments: Record<string, string>
  trade: ReviewTradeSnapshot
  updatedAt: number
}

interface ReviewState {
  documents: Record<string, ReviewDocument>
  tagGroups: ReviewTagGroup[]
  setNote: (key: string, trade: ReviewTradeSnapshot, note: string) => void
  addScreenshot: (key: string, trade: ReviewTradeSnapshot, screenshot: ReviewScreenshot) => void
  removeScreenshot: (key: string, screenshotId: string) => void
  addTagGroup: (name: string) => string
  renameTagGroup: (groupId: string, name: string) => void
  deleteTagGroup: (groupId: string) => void
  addTag: (groupId: string, name: string, color?: ReviewTagColor) => string
  updateTag: (groupId: string, tagId: string, patch: Partial<Pick<ReviewTag, 'name' | 'color'>>) => void
  deleteTag: (groupId: string, tagId: string) => void
  assignTag: (key: string, trade: ReviewTradeSnapshot, groupId: string, tagId: string | null) => void
}

function identifier(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function nextDocument(existing: ReviewDocument | undefined, trade: ReviewTradeSnapshot): ReviewDocument {
  return existing ?? { note: '', screenshots: [], tagAssignments: {}, trade, updatedAt: Date.now() }
}

export const useReviewStore = create<ReviewState>()(persist((set) => ({
  documents: {},
  tagGroups: [],
  setNote: (key, trade, note) => set((state) => {
    const current = nextDocument(state.documents[key], trade)
    return { documents: { ...state.documents, [key]: { ...current, note, trade, updatedAt: Date.now() } } }
  }),
  addScreenshot: (key, trade, screenshot) => set((state) => {
    const current = nextDocument(state.documents[key], trade)
    return { documents: { ...state.documents, [key]: { ...current, screenshots: [...current.screenshots, screenshot].slice(-6), trade, updatedAt: Date.now() } } }
  }),
  removeScreenshot: (key, screenshotId) => set((state) => {
    const current = state.documents[key]
    if (!current) return state
    return { documents: { ...state.documents, [key]: { ...current, screenshots: current.screenshots.filter((item) => item.id !== screenshotId), updatedAt: Date.now() } } }
  }),
  addTagGroup: (name) => {
    const id = identifier('group')
    set((state) => ({ tagGroups: [...state.tagGroups, { id, name: name.trim() || `Tag group ${state.tagGroups.length + 1}`, tags: [] }] }))
    return id
  },
  renameTagGroup: (groupId, name) => set((state) => ({ tagGroups: state.tagGroups.map((group) => group.id === groupId ? { ...group, name: name.trim() || group.name } : group) })),
  deleteTagGroup: (groupId) => set((state) => ({
    tagGroups: state.tagGroups.filter((group) => group.id !== groupId),
    documents: Object.fromEntries(Object.entries(state.documents).map(([key, document]) => {
      const { [groupId]: _removed, ...tagAssignments } = document.tagAssignments
      return [key, { ...document, tagAssignments }]
    })),
  })),
  addTag: (groupId, name, color = 'green') => {
    const id = identifier('tag')
    set((state) => ({ tagGroups: state.tagGroups.map((group) => group.id === groupId ? { ...group, tags: [...group.tags, { id, name: name.trim(), color }] } : group) }))
    return id
  },
  updateTag: (groupId, tagId, patch) => set((state) => ({ tagGroups: state.tagGroups.map((group) => group.id === groupId ? { ...group, tags: group.tags.map((tag) => tag.id === tagId ? { ...tag, ...patch, name: patch.name?.trim() || tag.name } : tag) } : group) })),
  deleteTag: (groupId, tagId) => set((state) => ({
    tagGroups: state.tagGroups.map((group) => group.id === groupId ? { ...group, tags: group.tags.filter((tag) => tag.id !== tagId) } : group),
    documents: Object.fromEntries(Object.entries(state.documents).map(([key, document]) => [key, document.tagAssignments[groupId] === tagId ? { ...document, tagAssignments: Object.fromEntries(Object.entries(document.tagAssignments).filter(([id]) => id !== groupId)) } : document])),
  })),
  assignTag: (key, trade, groupId, tagId) => set((state) => {
    const current = nextDocument(state.documents[key], trade)
    const tagAssignments = { ...current.tagAssignments }
    if (tagId) tagAssignments[groupId] = tagId
    else delete tagAssignments[groupId]
    return { documents: { ...state.documents, [key]: { ...current, tagAssignments, trade, updatedAt: Date.now() } } }
  }),
}), {
  name: 'market-replay:trade-review:v1',
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({ documents: state.documents, tagGroups: state.tagGroups }),
}))
