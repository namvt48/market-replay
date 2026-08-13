import { describe, expect, it } from 'vitest'
import { buildGridLayout, createLayoutPreset, LAYOUT_TEMPLATES, paneIds, pruneDetachedPanes } from './layout-presets'
import { clampSplitRatio, layoutReducer } from './layout-reducer'
import { chartSyncFlagsSchema, loadChartLayout, persistChartLayout } from './layout-storage'
import type { LayoutNode } from './types'

function storage(): Storage {
  let value: string | null = null
  return { get length() { return value ? 1 : 0 }, clear: () => { value = null }, getItem: () => value, key: () => null, removeItem: () => { value = null }, setItem: (_key, next) => { value = next } }
}

function paneAreaFractions(node: LayoutNode, area = 1, result: Record<string, number> = {}): Record<string, number> {
  if (node.kind === 'pane') {
    result[node.paneId] = area
    return result
  }
  paneAreaFractions(node.first, area * node.ratio, result)
  paneAreaFractions(node.second, area * (1 - node.ratio), result)
  return result
}

describe('chart layout', () => {
  it.each([['single', 1], ['2v', 2], ['2h', 2], ['3', 3], ['4', 4]] as const)('creates %s preset', (preset, count) => {
    expect(paneIds(createLayoutPreset(preset).root)).toHaveLength(count)
  })

  it('materializes every visual preset with the pane count advertised by its icon group', () => {
    for (const template of LAYOUT_TEMPLATES) {
      const state = createLayoutPreset(template.id)
      expect(paneIds(state.root), template.label).toHaveLength(template.count)
      expect(Object.keys(state.panes), template.label).toHaveLength(template.count)
    }
    expect(new Set(LAYOUT_TEMPLATES.map((template) => template.id)).size).toBe(LAYOUT_TEMPLATES.length)
  })

  it('clamps resize by the minimum usable pane size', () => {
    expect(clampSplitRatio(0.05, 1000, 240)).toBe(0.24)
    expect(clampSplitRatio(0.95, 1000, 240)).toBe(0.76)
    expect(clampSplitRatio(0.1, 300, 240)).toBe(0.5)
  })

  it('keeps the second divider fixed when resizing the first divider in three columns', () => {
    const state = createLayoutPreset('3-columns')
    const next = layoutReducer(state, { type: 'resize', splitId: 'split-root', ratio: 0.4, totalSize: 1200 })
    const before = paneAreaFractions(state.root)
    const after = paneAreaFractions(next.root)

    expect(after['pane-1']).toBeCloseTo(0.4)
    expect(after['pane-2']).toBeCloseTo(before['pane-1'] + before['pane-2'] - 0.4)
    expect(after['pane-3']).toBeCloseTo(before['pane-3'])
    expect(after['pane-1'] + after['pane-2']).toBeCloseTo(before['pane-1'] + before['pane-2'])
  })

  it('resizes only the two adjacent tracks in a four-column split chain', () => {
    const state = createLayoutPreset('4-columns')
    const next = layoutReducer(state, { type: 'resize', splitId: 'split-root-second', ratio: 0.45, totalSize: 900, minSize: 120 })
    const before = paneAreaFractions(state.root)
    const after = paneAreaFractions(next.root)

    expect(after['pane-1']).toBeCloseTo(before['pane-1'])
    expect(after['pane-4']).toBeCloseTo(before['pane-4'])
    expect(after['pane-2']).not.toBeCloseTo(before['pane-2'])
    expect(after['pane-3']).not.toBeCloseTo(before['pane-3'])
    expect(after['pane-2'] + after['pane-3']).toBeCloseTo(before['pane-2'] + before['pane-3'])
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

  it('builds a balanced grid for any pane count with no cap', () => {
    for (const count of [5, 6, 7]) {
      const ids = Array.from({ length: count }, (_, index) => `pane-${index + 1}`)
      const root = buildGridLayout(ids)
      const areas = Object.values(paneAreaFractions(root))
      expect(paneIds(root)).toEqual(ids)
      expect(Math.max(...areas) - Math.min(...areas)).toBeLessThan(1e-10)
    }
    expect(paneIds(buildGridLayout(['solo']))).toEqual(['solo'])
  })

  it('grows a layout past four panes into a rebalanced grid instead of blocking at the old cap', () => {
    let state = createLayoutPreset('single')
    for (let index = 2; index <= 7; index += 1) {
      state = layoutReducer(state, { type: 'add-pane', pane: { ...state.panes['pane-1'], id: `pane-${index}` } })
    }
    expect(paneIds(state.root)).toEqual(['pane-1', 'pane-2', 'pane-3', 'pane-4', 'pane-5', 'pane-6', 'pane-7'])
    expect(state.activePaneId).toBe('pane-7')
    expect(state.preset).toBe('custom')
  })

  it('ignores add-pane when the id already exists', () => {
    const state = createLayoutPreset('2v')
    const next = layoutReducer(state, { type: 'add-pane', pane: { ...state.panes['pane-1'], id: 'pane-2' } })
    expect(next).toBe(state)
  })

  it('rebalances the grid (not just the removed split) after removing a pane from a large layout', () => {
    let state = createLayoutPreset('single')
    for (let index = 2; index <= 6; index += 1) {
      state = layoutReducer(state, { type: 'add-pane', pane: { ...state.panes['pane-1'], id: `pane-${index}` } })
    }
    const next = layoutReducer(state, { type: 'remove-pane', paneId: 'pane-3' })
    expect(paneIds(next.root)).toEqual(['pane-1', 'pane-2', 'pane-4', 'pane-5', 'pane-6'])
    expect(next.panes['pane-3']).toBeUndefined()
  })

  it('prunes detached panes so a sibling fills the freed space, and returns null when everything is detached', () => {
    const four = createLayoutPreset('4')
    const pruned = pruneDetachedPanes(four.root, new Set(['pane-2']))
    expect(paneIds(pruned!)).toEqual(['pane-1', 'pane-3', 'pane-4'])
    expect(pruneDetachedPanes(four.root, new Set(paneIds(four.root)))).toBeNull()
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

  it('preserves every existing pane when switching layout and inherits only newly added panes', () => {
    let state = createLayoutPreset('2v', '1m')
    state = layoutReducer(state, { type: 'set-pane-symbol', paneId: 'pane-2', symbol: 'ES' })
    state = layoutReducer(state, { type: 'set-pane-timeframe', paneId: 'pane-2', timeframe: '15m' })
    state.panes['pane-2'].settings.appearance.backgroundColor = '#223344'

    const next = layoutReducer(state, { type: 'set-preset', preset: '4' })

    expect(next.panes['pane-1']).toEqual(state.panes['pane-1'])
    expect(next.panes['pane-2']).toEqual(state.panes['pane-2'])
    expect(next.panes['pane-2']).toMatchObject({ symbol: 'ES', timeframe: '15m' })
    expect(next.panes['pane-3']).toMatchObject({ symbol: null, timeframe: '1m' })
    expect(next.panes['pane-4']).toMatchObject({ symbol: null, timeframe: '1m' })
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

  it('persists a visual layout preset added by the expanded picker', () => {
    const target = storage()
    const state = createLayoutPreset('5-main-right', '15m')

    persistChartLayout(state, target)
    const restored = loadChartLayout(target)

    expect(restored.preset).toBe('5-main-right')
    expect(paneIds(restored.root)).toHaveLength(5)
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
