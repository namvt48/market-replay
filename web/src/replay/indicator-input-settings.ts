import { z } from 'zod'
import type { IndicatorDescriptor, IndicatorInputDescriptor, IndicatorInputValue } from '../api/types'
import { preferenceStorage, type PreferenceStorage } from '../store/preference-sync'

export const INDICATOR_INPUT_SETTINGS_STORAGE_KEY = 'market-replay:indicator-settings:v1'

const colorSchema = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
  a: z.number().finite().min(0).max(1),
})
const inputValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), colorSchema])
const inputsSchema = z.record(z.string(), inputValueSchema)
const settingsSchema = z.object({
  version: z.literal(1),
  indicators: z.record(z.string(), inputsSchema),
})

type IndicatorInputSettings = z.infer<typeof settingsSchema>['indicators']

function readSettings(storage: Pick<PreferenceStorage, 'getItem'>): IndicatorInputSettings {
  try {
    const raw = storage.getItem(INDICATOR_INPUT_SETTINGS_STORAGE_KEY)
    if (!raw) return {}
    const candidate: unknown = JSON.parse(raw)
    const parsed = settingsSchema.safeParse(candidate)
    return parsed.success ? parsed.data.indicators : {}
  } catch {
    return {}
  }
}

function validInputValue(input: IndicatorInputDescriptor, value: IndicatorInputValue | undefined): value is IndicatorInputValue {
  if (value === undefined) return false
  if (input.kind === 'bool') return typeof value === 'boolean'
  if (input.kind === 'color') return colorSchema.safeParse(value).success
  if (input.kind === 'session' || input.kind === 'str') {
    return typeof value === 'string' && (!input.options || input.options.includes(value))
  }
  if (input.kind === 'time') {
    return typeof value === typeof input.default && (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (input.kind === 'int' && !Number.isInteger(value)) return false
  return (input.min === undefined || value >= input.min) && (input.max === undefined || value <= input.max)
}

export function loadIndicatorInputs(
  scriptId: string,
  storage: Pick<PreferenceStorage, 'getItem'> = preferenceStorage,
): Record<string, IndicatorInputValue> {
  return readSettings(storage)[scriptId] ?? {}
}

export function mergeIndicatorInputs(
  descriptor: IndicatorDescriptor,
  saved: Record<string, IndicatorInputValue>,
): Record<string, IndicatorInputValue> {
  return Object.fromEntries(descriptor.inputs.map((input) => {
    const value = saved[input.key]
    return [input.key, validInputValue(input, value) ? value : input.default]
  }))
}

export function saveIndicatorInputs(
  scriptId: string,
  inputs: Record<string, IndicatorInputValue>,
  storage: Pick<PreferenceStorage, 'getItem' | 'setItem'> = preferenceStorage,
): void {
  const parsed = inputsSchema.safeParse(inputs)
  if (!parsed.success) return
  const settings = readSettings(storage)
  const indicators = { ...settings, [scriptId]: parsed.data }
  try {
    storage.setItem(INDICATOR_INPUT_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, indicators }))
  } catch {
    // Indicator execution remains available when browser storage is unavailable.
  }
}
