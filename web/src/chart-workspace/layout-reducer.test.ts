import { describe, expect, it } from 'vitest'
import { createLayoutPreset, paneIds } from './layout-presets'
import { clampSplitRatio, layoutReducer } from './layout-reducer'
import { loadChartLayout, persistChartLayout } from './layout-storage'

function storage(): Storage {
  let value: string | null = null
  return { get length() { return value ? 1 : 0 }, clear: () => { value = null }, getItem: () => value, key: () => null, removeItem: () => { value = null }, setItem: (_key, next) => { value = next } }
}

describe('chart layout', () => {
  it.each([['single', 1], ['2v', 2], ['2h', 2], ['3', 3], ['4', 4]] as const)('creates %s preset', (preset, count) => {
    expect(paneIds(createLayoutPreset(preset).root)).toHaveLength(count)
  })

  it('clamps resize by the minimum usable pane size', () => {
    expect(clampSplitRatio(0.05, 1000, 240)).toBe(0.24)
    expect(clampSplitRatio(0.95, 1000, 240)).toBe(0.76)
    expect(clampSplitRatio(0.1, 300, 240)).toBe(0.5)
  })

  it('removes a pane, collapses its split and keeps active pane valid', () => {
    const state = layoutReducer(createLayoutPreset('3'), { type: 'activate', paneId: 'pane-2' })
    const next = layoutReducer(state, { type: 'remove-pane', paneId: 'pane-2' })
    expect(paneIds(next.root)).toEqual(['pane-1', 'pane-3'])
    expect(next.activePaneId).toBe('pane-1')
  })

  it('adds a pane beside the active pane and activates it', () => {
    const state = createLayoutPreset('single')
    const next = layoutReducer(state, { type: 'add-pane', pane: { ...state.panes['pane-1'], id: 'pane-2' } })
    expect(paneIds(next.root)).toEqual(['pane-1', 'pane-2'])
    expect(next.activePaneId).toBe('pane-2')
  })

  it('inherits active pane settings and timeframe when switching presets', () => {
    const state = createLayoutPreset('single', '45m')
    state.panes['pane-1'].settings.appearance.backgroundColor = '#123456'
    const next = layoutReducer(state, { type: 'set-preset', preset: '4' })
    expect(Object.values(next.panes).every((pane) => pane.timeframe === '45m' && pane.settings.appearance.backgroundColor === '#123456')).toBe(true)
  })

  it('restores layout geometry but starts a fresh app at the default 1m timeframe', () => {
    const target = storage()
    const state = layoutReducer(createLayoutPreset('4', '5m'), { type: 'resize', splitId: 'split-root', ratio: 0.62, totalSize: 1000 })
    persistChartLayout(state, target)
    const restored = loadChartLayout(target)
    expect(restored.root).toEqual(state.root)
    expect(restored.preset).toBe('4')
    expect(Object.values(restored.panes).every((pane) => pane.timeframe === '1m')).toBe(true)
    target.setItem('x', '{bad')
    expect(loadChartLayout(target).preset).toBe('single')
  })
})
