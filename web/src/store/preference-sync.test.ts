import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  fetchPreferences: vi.fn(),
  putPreference: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../api/preferences', () => api)

const { SYNCED_PREFERENCE_KEYS, flushPreferenceSync, hydratePreferences, preferenceStorage } = await import('./preference-sync')

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
    // save locally and silently never sync. Drawing templates are
    // deliberately absent — they sync through their own CRUD endpoints
    // (replay/drawing-templates.ts), not this generic blob mechanism.
    expect(SYNCED_PREFERENCE_KEYS).toEqual(expect.arrayContaining([
      'market-replay:chart-pane-settings',
      'market-replay:chart-layout',
      'market-replay:saved-chart-layouts',
      'market-replay:timeframe-preferences',
      'market-replay:drawing-favorites:v1',
      'market-replay:trade-review:v1',
      'replay:eval',
      'replay:eval:accounts',
    ]))
    expect(SYNCED_PREFERENCE_KEYS).not.toContain('market-replay:drawing-templates:v1')
  })
})

describe('flushPreferenceSync', () => {
  it('pushes every queued write immediately and cancels the debounce', async () => {
    preferenceStorage.setItem('replay:eval', '{"accountId":"eval-ES-new","phase":"ready"}')
    preferenceStorage.setItem('replay:eval:accounts', '[{"accountId":"eval-ES-new"}]')
    expect(api.putPreference).not.toHaveBeenCalled()

    await flushPreferenceSync()

    expect(api.putPreference).toHaveBeenCalledTimes(2)
    expect(api.putPreference).toHaveBeenCalledWith('replay:eval', '{"accountId":"eval-ES-new","phase":"ready"}')
    expect(api.putPreference).toHaveBeenCalledWith('replay:eval:accounts', '[{"accountId":"eval-ES-new"}]')

    await vi.runAllTimersAsync()
    expect(api.putPreference).toHaveBeenCalledTimes(2)
  })

  it('pushes only the latest value of a key written twice', async () => {
    preferenceStorage.setItem('replay:eval', '{"v":1}')
    preferenceStorage.setItem('replay:eval', '{"v":2}')

    await flushPreferenceSync()

    expect(api.putPreference).toHaveBeenCalledOnce()
    expect(api.putPreference).toHaveBeenCalledWith('replay:eval', '{"v":2}')
  })

  it('resolves when the backend rejects: navigation must not hang on the network', async () => {
    api.putPreference.mockRejectedValue(new Error('offline'))
    preferenceStorage.setItem('replay:eval', '{}')

    await expect(flushPreferenceSync()).resolves.toBeUndefined()
  })

  it('resolves straight away with nothing queued', async () => {
    await expect(flushPreferenceSync()).resolves.toBeUndefined()
    expect(api.putPreference).not.toHaveBeenCalled()
  })
})

describe('hydratePreferences local-writer-wins keys', () => {
  it('keeps a differing local eval session and registry instead of resurrecting the stale backend copy', async () => {
    const storage = memoryStorage()
    storage.setItem('replay:eval', '{"accountId":"eval-ES-new","phase":"ready"}')
    storage.setItem('replay:eval:accounts', '[{"accountId":"eval-ES-new"}]')
    api.fetchPreferences.mockResolvedValue({
      'replay:eval': '{"accountId":"eval-NQ-old","phase":"running"}',
      'replay:eval:accounts': '[]',
    })

    await hydratePreferences(storage)

    expect(storage.getItem('replay:eval')).toBe('{"accountId":"eval-ES-new","phase":"ready"}')
    expect(storage.getItem('replay:eval:accounts')).toBe('[{"accountId":"eval-ES-new"}]')
  })

  it('adds remote-only evaluation accounts to an existing local registry', async () => {
    const storage = memoryStorage()
    storage.setItem('replay:eval:accounts', '[{"accountId":"eval-local","name":"Local name"}]')
    api.fetchPreferences.mockResolvedValue({
      'replay:eval:accounts': '[{"accountId":"eval-local","name":"Stale remote name"},{"accountId":"demo-eval-progress"}]',
    })

    await hydratePreferences(storage)

    expect(JSON.parse(storage.getItem('replay:eval:accounts') ?? '[]')).toEqual([
      { accountId: 'eval-local', name: 'Local name' },
      { accountId: 'demo-eval-progress' },
    ])
  })

  it('seeds the eval keys from the backend on a browser that has no local copy', async () => {
    const storage = memoryStorage()
    api.fetchPreferences.mockResolvedValue({
      'replay:eval': '{"accountId":"eval-NQ-old"}',
      'replay:eval:accounts': '[{"accountId":"eval-NQ-old"}]',
    })

    await hydratePreferences(storage)

    expect(storage.getItem('replay:eval')).toBe('{"accountId":"eval-NQ-old"}')
    expect(storage.getItem('replay:eval:accounts')).toBe('[{"accountId":"eval-NQ-old"}]')
  })

  it('still lets the backend win for workspace settings keys', async () => {
    const storage = memoryStorage()
    storage.setItem('market-replay:chart-layout', '{"preset":"local"}')
    api.fetchPreferences.mockResolvedValue({ 'market-replay:chart-layout': '{"preset":"remote"}' })

    await hydratePreferences(storage)

    expect(storage.getItem('market-replay:chart-layout')).toBe('{"preset":"remote"}')
  })

  it('create → navigate → boot keeps the new account when the flush reached the backend', async () => {
    preferenceStorage.setItem('replay:eval', '{"accountId":"eval-ES-new","phase":"ready"}')
    preferenceStorage.setItem('replay:eval:accounts', '[{"accountId":"eval-ES-new"}]')
    await flushPreferenceSync()

    api.fetchPreferences.mockResolvedValue({
      'replay:eval': '{"accountId":"eval-ES-new","phase":"ready"}',
      'replay:eval:accounts': '[{"accountId":"eval-ES-new"}]',
    })
    await hydratePreferences()

    expect(preferenceStorage.getItem('replay:eval')).toBe('{"accountId":"eval-ES-new","phase":"ready"}')
    expect(preferenceStorage.getItem('replay:eval:accounts')).toBe('[{"accountId":"eval-ES-new"}]')
  })

  it('create → navigate → boot keeps the new account even when the backend still holds the stale copy', async () => {
    preferenceStorage.setItem('replay:eval', '{"accountId":"eval-ES-new","phase":"ready"}')
    preferenceStorage.setItem('replay:eval:accounts', '[{"accountId":"eval-ES-new"}]')
    api.fetchPreferences.mockResolvedValue({
      'replay:eval': '{"accountId":"eval-NQ-old"}',
      'replay:eval:accounts': '[]',
    })

    await hydratePreferences()

    expect(preferenceStorage.getItem('replay:eval')).toBe('{"accountId":"eval-ES-new","phase":"ready"}')
    expect(preferenceStorage.getItem('replay:eval:accounts')).toBe('[{"accountId":"eval-ES-new"}]')
  })
})
