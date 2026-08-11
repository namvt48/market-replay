import { describe, expect, it, vi } from 'vitest'
import { createLayoutPreset } from './layout-presets'
import { deleteSavedLayout, loadSavedLayouts, saveNamedLayout } from './saved-layouts'

function storage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('saved chart layouts', () => {
  it('saves, replaces by name, reloads and deletes a complete layout', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
    const target = storage()
    const first = saveNamedLayout('Review desk', createLayoutPreset('4', '5m'), target)
    expect(first[0].state.preset).toBe('4')
    const replaced = saveNamedLayout('review desk', createLayoutPreset('2h', '15m'), target)
    expect(replaced).toHaveLength(1)
    expect(loadSavedLayouts(target)[0].state.preset).toBe('2h')
    expect(Object.values(loadSavedLayouts(target)[0].state.panes).every((pane) => pane.timeframe === '15m')).toBe(true)
    expect(deleteSavedLayout(replaced[0].id, target)).toEqual([])
  })

  it('persists the shared market session in a named layout', () => {
    const target = storage()
    const state = createLayoutPreset('3')
    state.marketSession = 'rth'

    saveNamedLayout('RTH desk', state, target)

    expect(loadSavedLayouts(target)[0].state.marketSession).toBe('rth')
    expect(Object.values(loadSavedLayouts(target)[0].state.panes).every((pane) => !('marketSession' in pane.settings))).toBe(true)
  })

  it('persists independent chart sync flags in a named layout', () => {
    const target = storage()
    const state = createLayoutPreset('2v')
    state.syncFlags = { crosshair: false, dateRange: true, lockZoom: true }

    saveNamedLayout('Independent crosshair', state, target)

    expect(loadSavedLayouts(target)[0].state.syncFlags).toEqual({ crosshair: false, dateRange: true, lockZoom: true })
  })

  it('fails loudly for an empty name and recovers corrupt storage', () => {
    const target = storage()
    expect(() => saveNamedLayout('   ', createLayoutPreset('single'), target)).toThrow('Enter a layout name')
    target.setItem('market-replay:saved-chart-layouts', '{bad')
    expect(loadSavedLayouts(target)).toEqual([])
  })
})
