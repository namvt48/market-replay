import { describe, expect, it } from 'vitest'
import { createLayoutPreset, paneIds } from './layout-presets'
import { clampSplitRatio, layoutReducer } from './layout-reducer'
import { chartSyncFlagsSchema, loadChartLayout, persistChartLayout } from './layout-storage'

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
    state.marketSession = 'rth'
    state.syncFlags = { crosshair: false, dateRange: true, lockZoom: true }
    const next = layoutReducer(state, { type: 'set-preset', preset: '4' })
    expect(Object.values(next.panes).every((pane) => pane.timeframe === '45m' && pane.settings.appearance.backgroundColor === '#123456')).toBe(true)
    expect(next.marketSession).toBe('rth')
    expect(next.syncFlags).toEqual({ crosshair: false, dateRange: true, lockZoom: true })
  })

  it('keeps symbol and timeframe changes scoped to one pane', () => {
    const state = createLayoutPreset('4')
    const withSymbol = layoutReducer(state, { type: 'set-pane-symbol', paneId: 'pane-2', symbol: 'ES' })
    const next = layoutReducer(withSymbol, { type: 'set-pane-timeframe', paneId: 'pane-2', timeframe: '5m' })

    expect(next.panes['pane-2']).toMatchObject({ symbol: 'ES', timeframe: '5m' })
    expect(next.panes['pane-1']).toMatchObject({ symbol: null, timeframe: '1m' })
    expect(next.panes['pane-3']).toMatchObject({ symbol: null, timeframe: '1m' })
    expect(next.panes['pane-4']).toMatchObject({ symbol: null, timeframe: '1m' })
  })

  it('stores market session once at workspace level', () => {
    const state = createLayoutPreset('4')
    const next = layoutReducer(state, { type: 'set-market-session', marketSession: 'rth' })

    expect(next.marketSession).toBe('rth')
    expect(Object.values(next.panes).every((pane) => !('marketSession' in pane.settings))).toBe(true)
  })

  it('defaults both sync flags on and updates either flag independently', () => {
    const state = createLayoutPreset('4')
    expect(state.syncFlags).toEqual({ crosshair: true, dateRange: true, lockZoom: false })

    const next = layoutReducer(state, { type: 'set-sync-flags', syncFlags: { crosshair: false } })

    expect(next.syncFlags).toEqual({ crosshair: false, dateRange: true, lockZoom: false })
    expect(chartSyncFlagsSchema.safeParse({ crosshair: true, dateRange: 'yes', lockZoom: false }).success).toBe(false)
  })

  it('restores layout geometry but starts a fresh app at the default 1m timeframe', () => {
    const target = storage()
    const resized = layoutReducer(createLayoutPreset('4', '5m'), { type: 'resize', splitId: 'split-root', ratio: 0.62, totalSize: 1000 })
    const state = layoutReducer(resized, { type: 'set-sync-flags', syncFlags: { lockZoom: true } })
    persistChartLayout(state, target)
    expect(target.getItem('market-replay:chart-layout')).toContain('"version":5')
    const restored = loadChartLayout(target)
    expect(restored.root).toEqual(state.root)
    expect(restored.preset).toBe('4')
    expect(restored.syncFlags.lockZoom).toBe(true)
    expect(Object.values(restored.panes).every((pane) => pane.timeframe === '1m')).toBe(true)
    target.setItem('x', '{bad')
    expect(loadChartLayout(target).preset).toBe('single')
  })

  it('migrates v1 pane sessions and defaults sync flags in current shared state', () => {
    const target = storage()
    const current = createLayoutPreset('2v', '5m')
    const { marketSession: _marketSession, ...legacy } = current
    const panes = Object.fromEntries(Object.entries(legacy.panes).map(([id, pane]) => [id, {
      ...pane,
      settings: { ...pane.settings, marketSession: id === 'pane-2' ? 'rth' : 'eth' },
    }]))
    target.setItem('market-replay:chart-layout', JSON.stringify({ version: 1, ...legacy, panes, activePaneId: 'pane-2' }))

    const restored = loadChartLayout(target)

    expect(restored.marketSession).toBe('rth')
    expect(restored.syncFlags).toEqual({ crosshair: true, dateRange: true, lockZoom: false })
    expect(Object.values(restored.panes).every((pane) => pane.timeframe === '1m' && !('marketSession' in pane.settings))).toBe(true)
  })

  it('migrates v2 workspace state to default-on sync flags', () => {
    const target = storage()
    const current = createLayoutPreset('2h', '15m')
    const { syncFlags: _syncFlags, ...v2 } = current
    target.setItem('market-replay:chart-layout', JSON.stringify({ version: 2, ...v2 }))

    const restored = loadChartLayout(target)

    expect(restored.syncFlags).toEqual({ crosshair: true, dateRange: true, lockZoom: false })
    expect(Object.values(restored.panes).every((pane) => pane.timeframe === '1m')).toBe(true)
  })

  it('migrates v3 sync flags with lock zoom off', () => {
    const target = storage()
    const current = createLayoutPreset('2v')
    const v3 = { ...current, syncFlags: { crosshair: false, dateRange: true } }
    target.setItem('market-replay:chart-layout', JSON.stringify({ version: 3, ...v3 }))

    expect(loadChartLayout(target).syncFlags).toEqual({ crosshair: false, dateRange: true, lockZoom: false })
  })

  it('migrates v4 panes to replay-following symbols', () => {
    const target = storage()
    const current = createLayoutPreset('2v')
    const panes = Object.fromEntries(Object.entries(current.panes).map(([id, { symbol: _symbol, ...pane }]) => [id, pane]))
    target.setItem('market-replay:chart-layout', JSON.stringify({ version: 4, ...current, panes }))

    expect(Object.values(loadChartLayout(target).panes).every((pane) => pane.symbol === null)).toBe(true)
  })
})
