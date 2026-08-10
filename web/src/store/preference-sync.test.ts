import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  fetchPreferences: vi.fn(),
  putPreference: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../api/preferences', () => api)

const { SYNCED_PREFERENCE_KEYS, hydratePreferences, preferenceStorage } = await import('./preference-sync')

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  api.fetchPreferences.mockReset()
  api.putPreference.mockReset()
  api.putPreference.mockResolvedValue(undefined)
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('preferenceStorage', () => {
  it('writes locally straight away and mirrors to the backend once the burst settles', async () => {
    preferenceStorage.setItem('market-replay:chart-layout', '{"version":1,"preset":"2v"}')
    // The UI reads this back synchronously, so it cannot wait on a request.
    expect(preferenceStorage.getItem('market-replay:chart-layout')).toBe('{"version":1,"preset":"2v"}')
    expect(api.putPreference).not.toHaveBeenCalled()

    preferenceStorage.setItem('market-replay:chart-layout', '{"version":1,"preset":"4"}')
    await vi.runAllTimersAsync()

    // Debounced: dragging a slider or resizing panes must not become one
    // request per intermediate value.
    expect(api.putPreference).toHaveBeenCalledOnce()
    expect(api.putPreference).toHaveBeenCalledWith('market-replay:chart-layout', '{"version":1,"preset":"4"}')
  })

  it('leaves unlisted keys local-only', async () => {
    preferenceStorage.setItem('some-unrelated-key', 'value')
    await vi.runAllTimersAsync()
    expect(api.putPreference).not.toHaveBeenCalled()
    expect(preferenceStorage.getItem('some-unrelated-key')).toBe('value')
  })

  it('keeps the local write when the backend rejects', async () => {
    api.putPreference.mockRejectedValue(new Error('offline'))
    preferenceStorage.setItem('market-replay:drawing-favorites:v1', '["ray"]')
    await vi.runAllTimersAsync()
    expect(preferenceStorage.getItem('market-replay:drawing-favorites:v1')).toBe('["ray"]')
  })
})

describe('hydratePreferences', () => {
  it('seeds local storage from the backend so a fresh browser is not reset to defaults', async () => {
    const storage = memoryStorage()
    api.fetchPreferences.mockResolvedValue({
      'market-replay:chart-layout': '{"version":1,"preset":"3"}',
      'market-replay:timeframe-preferences': '{"starred":["5m"]}',
    })

    await hydratePreferences(storage)

    expect(storage.getItem('market-replay:chart-layout')).toBe('{"version":1,"preset":"3"}')
    expect(storage.getItem('market-replay:timeframe-preferences')).toBe('{"starred":["5m"]}')
  })

  it('ignores keys outside the synced set', async () => {
    const storage = memoryStorage()
    api.fetchPreferences.mockResolvedValue({ 'unexpected:key': '{}' })
    await hydratePreferences(storage)
    expect(storage.getItem('unexpected:key')).toBeNull()
  })

  it('leaves local settings untouched when the backend is unreachable', async () => {
    const storage = memoryStorage()
    storage.setItem('market-replay:chart-layout', '{"version":1,"preset":"single"}')
    api.fetchPreferences.mockRejectedValue(new Error('connection refused'))

    // Must resolve, not reject: boot is gated on it.
    await expect(hydratePreferences(storage)).resolves.toBeUndefined()
    expect(storage.getItem('market-replay:chart-layout')).toBe('{"version":1,"preset":"single"}')
  })

  it('covers every key the stores actually persist', () => {
    // A store wired to preferenceStorage but missing from this list would
    // save locally and silently never sync.
    expect(SYNCED_PREFERENCE_KEYS).toEqual(expect.arrayContaining([
      'market-replay:chart-pane-settings',
      'market-replay:chart-layout',
      'market-replay:saved-chart-layouts',
      'market-replay:timeframe-preferences',
      'market-replay:drawing-favorites:v1',
      'market-replay:drawing-templates:v1',
      'replay:eval',
      'replay:eval:accounts',
    ]))
  })
})
