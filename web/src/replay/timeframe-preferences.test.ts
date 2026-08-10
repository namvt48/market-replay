import { describe, expect, it } from 'vitest'
import { TimeframePreferenceStore, loadTimeframePreferences } from './timeframe-preferences'

function memoryStorage(initial: string | null = null): Storage {
  let value = initial
  return {
    getItem: () => value, setItem: (_key, next) => { value = next }, removeItem: () => { value = null },
    clear: () => { value = null }, key: () => null, get length() { return value === null ? 0 : 1 },
  }
}

describe('timeframe preferences', () => {
  it('recovers defaults from corrupt persisted state', () => {
    expect(loadTimeframePreferences(memoryStorage('{bad json'))).toMatchObject({ starredTimeframes: ['1m', '5m', '15m', '1h', '1d'], customTimeframes: [] })
  })

  it('adds canonical custom values and prevents normalized duplicates', () => {
    const storage = memoryStorage()
    const store = new TimeframePreferenceStore(storage)
    expect(store.addCustom('7m')).toEqual({ ok: true, value: '7m' })
    expect(store.addCustom(' 7M ')).toEqual({ ok: true, value: '7M' })
    expect(store.addCustom('60m')).toEqual({ ok: false, error: '1h already exists' })
    expect(new TimeframePreferenceStore(storage).getSnapshot().customTimeframes).toEqual(['7m', '7M'])
  })

  it('persists star and unstar actions', () => {
    const storage = memoryStorage()
    const store = new TimeframePreferenceStore(storage)
    store.toggleStar('5m')
    expect(store.getSnapshot().starredTimeframes).not.toContain('5m')
    store.toggleStar('45m')
    expect(new TimeframePreferenceStore(storage).getSnapshot().starredTimeframes).toEqual(['1m', '15m', '45m', '1h', '1d'])
  })
})
