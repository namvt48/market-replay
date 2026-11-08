import { describe, expect, it } from 'vitest'
import type { IndicatorDescriptor } from '../api/types'
import {
  INDICATOR_INPUT_SETTINGS_STORAGE_KEY,
  loadIndicatorInputs,
  mergeIndicatorInputs,
  saveIndicatorInputs,
} from './indicator-input-settings'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

const descriptor: IndicatorDescriptor = {
  id: 'sample',
  name: 'Sample',
  version: 1,
  meta: { onMainPanel: true },
  inputs: [
    { kind: 'bool', key: 'enabled', label: 'Enabled', default: true },
    { kind: 'int', key: 'period', label: 'Period', default: 14, min: 1, max: 100 },
    { kind: 'str', key: 'mode', label: 'Mode', default: 'daily', options: ['daily', 'weekly'] },
  ],
}

describe('indicator input settings', () => {
  it('restores compatible values and falls back for new or incompatible inputs', () => {
    const storage = memoryStorage()
    saveIndicatorInputs('sample', {
      enabled: false,
      period: 20,
      mode: 'unsupported',
      removedInput: 'stale',
    }, storage)

    const merged = mergeIndicatorInputs(descriptor, loadIndicatorInputs('sample', storage))

    expect(merged).toEqual({ enabled: false, period: 20, mode: 'daily' })
  })

  it('ignores malformed stored settings instead of blocking indicator startup', () => {
    const storage = memoryStorage()
    storage.setItem(INDICATOR_INPUT_SETTINGS_STORAGE_KEY, 'not-json')

    expect(mergeIndicatorInputs(descriptor, loadIndicatorInputs('sample', storage))).toEqual({
      enabled: true,
      period: 14,
      mode: 'daily',
    })
  })
})
