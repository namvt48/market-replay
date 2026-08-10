import { z } from 'zod'
import { chartAppearanceSchema, DEFAULT_CHART_APPEARANCE, type ChartAppearanceSettings } from './chart-settings'
import { chartTimezoneSchema, DEFAULT_CHART_TIMEZONE, type ChartTimezone } from './chart-timezone'
import { DEFAULT_MARKET_SESSION, marketSessionSchema, type MarketSession } from './market-session'
import { preferenceStorage } from '../store/preference-sync'

const STORAGE_KEY = 'market-replay:chart-pane-settings'

export interface ChartPaneSettings {
  appearance: ChartAppearanceSettings
  timezone: ChartTimezone
  marketSession: MarketSession
}

export const chartPaneSettingsSchema = z.object({
  appearance: chartAppearanceSchema,
  timezone: chartTimezoneSchema,
  marketSession: marketSessionSchema.default(DEFAULT_MARKET_SESSION),
})
const storageSchema = z.object({ version: z.literal(1), panes: z.record(z.string(), chartPaneSettingsSchema) })

export const DEFAULT_CHART_PANE_SETTINGS: ChartPaneSettings = {
  appearance: DEFAULT_CHART_APPEARANCE,
  timezone: DEFAULT_CHART_TIMEZONE,
  marketSession: DEFAULT_MARKET_SESSION,
}

export class ChartSettingsStore {
  private panes: Record<string, ChartPaneSettings> = {}
  private listeners = new Set<() => void>()
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'>

  constructor(storage: Pick<Storage, 'getItem' | 'setItem'> = preferenceStorage) {
    this.storage = storage
    this.reload()
  }

  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getSnapshot = (): Record<string, ChartPaneSettings> => this.panes

  getPane(id: string): ChartPaneSettings {
    const value = this.panes[id]
    return value
      ? { appearance: { ...value.appearance }, timezone: { ...value.timezone }, marketSession: value.marketSession }
      : { appearance: { ...DEFAULT_CHART_APPEARANCE }, timezone: { ...DEFAULT_CHART_TIMEZONE }, marketSession: DEFAULT_MARKET_SESSION }
  }

  setPane(id: string, settings: ChartPaneSettings): void {
    const next = { ...this.panes, [id]: chartPaneSettingsSchema.parse(settings) }
    this.storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, panes: next }))
    this.panes = next
    this.listeners.forEach((listener) => listener())
  }

  reload(): void {
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      this.panes = raw ? storageSchema.parse(JSON.parse(raw)).panes : {}
    } catch {
      this.panes = {}
    }
    this.listeners.forEach((listener) => listener())
  }
}

export const chartSettingsStore = new ChartSettingsStore()
