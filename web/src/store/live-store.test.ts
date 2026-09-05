import { describe, expect, it, beforeEach } from 'vitest'
import {
  createLiveTemplate, deleteLiveTemplate, duplicateLiveTemplate,
  loadLiveComposition, loadLiveNote, loadLiveTemplates, saveLiveComposition,
  saveLiveNote, updateLiveTemplate,
} from './live-store'

const TEMPLATES_KEY = 'replay:live:templates'
const COMPOSITIONS_KEY = 'replay:live:compositions'
const NOTES_KEY = 'replay:live:notes'

describe('live-store', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('creates, updates, duplicates and deletes templates', () => {
    const id = createLiveTemplate('My Template')
    expect(loadLiveTemplates().map((t) => t.name)).toEqual(['My Template'])

    updateLiveTemplate(id, { name: 'Renamed' })
    expect(loadLiveTemplates().find((t) => t.id === id)?.name).toBe('Renamed')

    const copyId = duplicateLiveTemplate(id)
    const all = loadLiveTemplates()
    expect(all).toHaveLength(2)
    expect(all.find((t) => t.id === copyId)?.name).toBe('Renamed copy')

    deleteLiveTemplate(id)
    expect(loadLiveTemplates().find((t) => t.id === id)).toBeUndefined()
  })

  it('persists and reloads a composition per session', () => {
    const templateId = createLiveTemplate('T')
    saveLiveComposition('session-1', { sessionId: 'session-1', templateId, blockOverrides: { 'block-a': { text: 'hello' } }, updatedAt: 1 })
    const loaded = loadLiveComposition('session-1')
    expect(loaded?.templateId).toBe(templateId)
    expect(loaded?.blockOverrides['block-a']?.text).toBe('hello')
    expect(loadLiveComposition('session-2')).toBeNull()
  })

  it('persists and reloads a journal note per session', () => {
    saveLiveNote('session-1', '## Week one')
    saveLiveNote('session-1', '## Week one\n\nLonger reflection')
    expect(loadLiveNote('session-1')).toBe('## Week one\n\nLonger reflection')
    expect(loadLiveNote('session-2')).toBe('')
  })

  it('replaces only the note of the same session', () => {
    saveLiveNote('session-1', 'first')
    saveLiveNote('session-2', 'second')
    expect(loadLiveNote('session-1')).toBe('first')
    expect(loadLiveNote('session-2')).toBe('second')
    saveLiveNote('session-2', 'updated')
    expect(loadLiveNote('session-1')).toBe('first')
    expect(loadLiveNote('session-2')).toBe('updated')
  })

  it('ignores corrupt localStorage payloads', () => {
    localStorage.setItem(TEMPLATES_KEY, '{not json')
    localStorage.setItem(COMPOSITIONS_KEY, '42')
    localStorage.setItem(NOTES_KEY, '["not-a-note"]')
    expect(loadLiveTemplates()).toEqual([])
    expect(loadLiveComposition('x')).toBeNull()
    expect(loadLiveNote('x')).toBe('')
  })
})
