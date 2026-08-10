import { useSyncExternalStore } from 'react'
import { timeframePreferenceStore, type TimeframePreferences } from '../../replay/timeframe-preferences'

export function useTimeframePreferences(): TimeframePreferences {
  return useSyncExternalStore(timeframePreferenceStore.subscribe, timeframePreferenceStore.getSnapshot, timeframePreferenceStore.getSnapshot)
}
