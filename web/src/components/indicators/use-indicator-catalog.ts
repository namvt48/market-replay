import { useEffect, useSyncExternalStore } from 'react'
import { fetchIndicators } from '../../api/client'
import type { IndicatorDescriptor } from '../../api/types'

interface IndicatorCatalogSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error'
  descriptors: IndicatorDescriptor[]
  error: string | null
}

let snapshot: IndicatorCatalogSnapshot = { status: 'idle', descriptors: [], error: null }
let request: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit(next: IndicatorCatalogSnapshot): void {
  snapshot = next
  listeners.forEach((listener) => listener())
}

function loadCatalog(): Promise<void> {
  if (request) return request
  emit({ ...snapshot, status: 'loading', error: null })
  request = fetchIndicators()
    .then((descriptors) => emit({ status: 'ready', descriptors, error: null }))
    .catch((error: unknown) => {
      request = null
      emit({ status: 'error', descriptors: [], error: error instanceof Error ? error.message : 'Indicators could not be loaded' })
    })
  return request
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): IndicatorCatalogSnapshot { return snapshot }

export function useIndicatorCatalog(): IndicatorCatalogSnapshot {
  const catalog = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => { if (catalog.status === 'idle') void loadCatalog() }, [catalog.status])
  return catalog
}

export function retryIndicatorCatalog(): void {
  request = null
  void loadCatalog()
}
