import { fetchPreferences, putPreference } from '../api/preferences'

/**
 * The workspace settings that follow the user rather than the browser.
 *
 * Every one of these used to live only in localStorage, so a different
 * browser, a cleared site, or a second machine started from defaults —
 * while the far smaller watchlist was already stored server-side. They are
 * listed explicitly rather than mirroring every localStorage key, so an
 * incidental key can never start syncing by accident.
 */
// Drawing templates (market-replay:drawing-templates:v1) are deliberately
// absent: they moved off this generic blob mechanism onto their own table
// and CRUD endpoints (see replay/drawing-templates.ts's
// hydrateDrawingTemplates/syncDrawingTemplateUpsert/syncDrawingTemplateDelete).
// The key still works as a plain localStorage cache here — it's just no
// longer pushed to /api/v1/preferences.
export const SYNCED_PREFERENCE_KEYS = [
  'market-replay:chart-pane-settings',
  'market-replay:chart-layout',
  'market-replay:saved-chart-layouts',
  'market-replay:timeframe-preferences',
  'market-replay:drawing-favorites:v1',
  'market-replay:trade-review:v1',
  'replay:eval',
  'replay:eval:accounts',
] as const

const SYNCED = new Set<string>(SYNCED_PREFERENCE_KEYS)
/**
 * Session state this browser writes authoritatively (see eval-store). Its
 * backend copy is a debounced mirror that can lag or be lost to an unload,
 * so at hydrate time a differing local value is the newer one and wins.
 * Mirrors eval-store's EVAL_SESSION_STORAGE_KEY / EVAL_ACCOUNTS_STORAGE_KEY;
 * not imported from there because eval-store imports this module.
 */
const LOCAL_WRITER_WINS_KEYS = new Set<string>(['replay:eval', 'replay:eval:accounts'])
const EVAL_ACCOUNTS_KEY = 'replay:eval:accounts'
const PUSH_DEBOUNCE_MS = 400
const HYDRATE_TIMEOUT_MS = 1_200
// Long enough to survive a slow backend, short enough that a dead one never
// holds up a navigation; losing the race still leaves local-wins hydration
// as the backstop.
const FLUSH_TIMEOUT_MS = 2_000

export interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // Storage can throw outright when the browser blocks site data.
    return null
  }
}

function pageHiding(): boolean {
  try {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
  } catch {
    return false
  }
}

/**
 * localStorage that mirrors writes to the backend.
 *
 * Local first, always: the write that the UI depends on completes
 * synchronously, and the network round trip is a debounced afterthought. If
 * the backend is unreachable the workspace keeps working exactly as it did
 * before it had one — which is the behaviour PRODUCT.md asks for when
 * persistence is offline. The trade is that a settings change made while
 * offline is not carried to another machine; it is not lost locally.
 */
class SyncedPreferenceStorage implements PreferenceStorage {
  private readonly local: PreferenceStorage | null
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly pending = new Map<string, string>()

  constructor(local: PreferenceStorage | null = browserStorage()) {
    this.local = local
  }

  getItem(key: string): string | null { return this.local?.getItem(key) ?? null }

  setItem(key: string, value: string): void {
    this.local?.setItem(key, value)
    if (!SYNCED.has(key)) return
    this.schedulePush(key, value)
  }

  removeItem(key: string): void {
    this.local?.removeItem(key)
    if (!SYNCED.has(key)) return
    // Nothing to push: the next hydrate simply finds no remote value. A
    // dedicated delete would race the debounced write it is cancelling.
    const pending = this.timers.get(key)
    if (pending) {
      clearTimeout(pending)
      this.timers.delete(key)
    }
    this.pending.delete(key)
  }

  /** Pushes every queued backend write now; bounded, and never rejects. */
  flush(): Promise<void> {
    const queued = this.takePending()
    if (queued.length === 0) return Promise.resolve()
    const pushes = Promise.all(queued.map(([key, value]) => putPreference(key, value).catch(() => undefined)))
    return withTimeout(pushes.then(() => undefined), FLUSH_TIMEOUT_MS, 'preference flush timed out').catch(() => undefined)
  }

  /** Fire-and-forget push for pagehide: keepalive lets requests outlive the page. */
  flushDetached(): void {
    for (const [key, value] of this.takePending()) {
      void putPreference(key, value, { keepalive: true }).catch(() => undefined)
    }
  }

  private takePending(): [string, string][] {
    const queued = [...this.pending.entries()]
    for (const [key] of queued) {
      const timer = this.timers.get(key)
      if (timer) {
        clearTimeout(timer)
        this.timers.delete(key)
      }
      this.pending.delete(key)
    }
    return queued
  }

  /** Writes land in bursts (dragging a colour picker, resizing panes); only the last one matters. */
  private schedulePush(key: string, value: string): void {
    this.pending.set(key, value)
    const timer = this.timers.get(key)
    if (timer) clearTimeout(timer)
    if (pageHiding()) {
      this.pending.delete(key)
      void putPreference(key, value, { keepalive: true }).catch(() => undefined)
      return
    }
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key)
      const latest = this.pending.get(key)
      if (latest === undefined) return
      this.pending.delete(key)
      void putPreference(key, latest).catch(() => undefined)
    }, PUSH_DEBOUNCE_MS))
  }
}

const syncedPreferenceStorage = new SyncedPreferenceStorage()

export const preferenceStorage: PreferenceStorage = syncedPreferenceStorage

function mergeEvalAccountRegistries(localPayload: string, remotePayload: string): string {
  try {
    const local = JSON.parse(localPayload) as unknown
    const remote = JSON.parse(remotePayload) as unknown
    if (!Array.isArray(local) || !Array.isArray(remote)) return localPayload
    const localIds = new Set(local.flatMap((account) => {
      if (typeof account !== 'object' || account === null || !('accountId' in account)) return []
      const accountId = (account as { accountId?: unknown }).accountId
      return typeof accountId === 'string' ? [accountId] : []
    }))
    const remoteOnly = remote.filter((account) => {
      if (typeof account !== 'object' || account === null || !('accountId' in account)) return false
      const accountId = (account as { accountId?: unknown }).accountId
      return typeof accountId === 'string' && !localIds.has(accountId)
    })
    if (remoteOnly.length === 0) return localPayload
    return JSON.stringify([...local, ...remoteOnly].slice(0, 50))
  } catch {
    return localPayload
  }
}

/** Pushes every queued backend write now, for code paths about to navigate. */
export function flushPreferenceSync(): Promise<void> {
  return syncedPreferenceStorage.flush()
}

if (typeof window !== 'undefined') {
  // A debounced push that never fired leaves the backend with a stale copy,
  // which then resurrects old state on the next boot.
  window.addEventListener('pagehide', () => syncedPreferenceStorage.flushDetached())
}

/**
 * Pulls stored settings into localStorage before any store reads them.
 *
 * Must run before the setting stores are imported — they read their value
 * at construction — which is why main.tsx awaits this and then imports the
 * app. Bounded by a timeout and never rejects: a missing or slow backend
 * delays the workspace, it does not stop it.
 */
export async function hydratePreferences(storage: PreferenceStorage | null = browserStorage()): Promise<void> {
  if (!storage) return
  try {
    const remote = await withTimeout(fetchPreferences(), HYDRATE_TIMEOUT_MS, 'preference hydrate timed out')
    for (const [key, payload] of Object.entries(remote)) {
      if (!SYNCED.has(key)) continue
      if (LOCAL_WRITER_WINS_KEYS.has(key)) {
        const local = storage.getItem(key)
        if (local !== null && local !== payload) {
          if (key === EVAL_ACCOUNTS_KEY) storage.setItem(key, mergeEvalAccountRegistries(local, payload))
          continue
        }
      }
      storage.setItem(key, payload)
    }
  } catch {
    // Keep whatever this browser already had.
  }
}

/** Races promise against a timeout, rejecting with message if it loses. Shared by every hydrate-on-boot path (preferences, drawing templates) so a slow backend delays, never blocks, startup. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}
