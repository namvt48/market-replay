import { z } from 'zod'
import { preferenceStorage } from '../store/preference-sync'
import type { Timeframe } from '../api/types'
import { normalizeTimeframe, sortTimeframes, timeframeSchema } from './timeframe'

const STORAGE_KEY = 'market-replay:timeframe-preferences'
const BUILT_INS: Timeframe[] = ['1m', '2m', '3m', '5m', '10m', '15m', '30m', '45m', '1h', '2h', '3h', '4h', '6h', '12h', '1d', '1w', '1M']
const DEFAULT_STARRED: Timeframe[] = ['1m', '5m', '15m', '1h', '1d']

const preferenceSchema = z.object({
  version: z.literal(1),
  starredTimeframes: z.array(timeframeSchema),
  customTimeframes: z.array(timeframeSchema),
})

export interface TimeframePreferences {
  version: 1
  starredTimeframes: Timeframe[]
  customTimeframes: Timeframe[]
}

export type PreferenceResult = { ok: true; value: Timeframe } | { ok: false; error: string }

export const DEFAULT_TIMEFRAME_PREFERENCES: TimeframePreferences = {
  version: 1,
  starredTimeframes: DEFAULT_STARRED,
  customTimeframes: [],
}

function unique(values: Timeframe[]): Timeframe[] {
  return [...new Set(values)]
}

export function loadTimeframePreferences(storage: Pick<Storage, 'getItem'> = preferenceStorage): TimeframePreferences {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_TIMEFRAME_PREFERENCES, starredTimeframes: [...DEFAULT_STARRED] }
    const parsed = preferenceSchema.parse(JSON.parse(raw))
    return {
      version: 1,
      starredTimeframes: sortTimeframes(unique(parsed.starredTimeframes)),
      customTimeframes: sortTimeframes(unique(parsed.customTimeframes).filter((timeframe) => !BUILT_INS.includes(timeframe))),
    }
  } catch {
    return { ...DEFAULT_TIMEFRAME_PREFERENCES, starredTimeframes: [...DEFAULT_STARRED] }
  }
}

export class TimeframePreferenceStore {
  private snapshot: TimeframePreferences
  private listeners = new Set<() => void>()
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'>

  constructor(storage: Pick<Storage, 'getItem' | 'setItem'> = preferenceStorage) {
    this.storage = storage
    this.snapshot = loadTimeframePreferences(storage)
  }

  getSnapshot = (): TimeframePreferences => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  reload(): void { this.snapshot = loadTimeframePreferences(this.storage); this.emit() }

  addCustom(input: string): PreferenceResult {
    const normalized = normalizeTimeframe(input)
    if (!normalized) return { ok: false, error: 'Use 1–1440m, 1–12h, 1d, 1–52w, or 1–12M' }
    const all = [...BUILT_INS, ...this.snapshot.customTimeframes]
    if (all.includes(normalized)) return { ok: false, error: `${normalized} already exists` }
    this.commit({ ...this.snapshot, customTimeframes: sortTimeframes([...this.snapshot.customTimeframes, normalized]) })
    return { ok: true, value: normalized }
  }

  toggleStar(timeframe: Timeframe): void {
    const starred = this.snapshot.starredTimeframes.includes(timeframe)
      ? this.snapshot.starredTimeframes.filter((item) => item !== timeframe)
      : [...this.snapshot.starredTimeframes, timeframe]
    this.commit({ ...this.snapshot, starredTimeframes: sortTimeframes(unique(starred)) })
  }

  private commit(next: TimeframePreferences): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(next))
    this.snapshot = next
    this.emit()
  }

  private emit(): void { this.listeners.forEach((listener) => listener()) }
}

export const timeframePreferenceStore = new TimeframePreferenceStore()
export const BUILT_IN_TIMEFRAMES = BUILT_INS
