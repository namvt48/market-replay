import { useEffect, useState } from 'react'

export type ResourceState<T> =
  | { status: 'idle' | 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error }

export function useAnalyticsResource<T>(enabled: boolean, load: (signal: AbortSignal) => Promise<T>): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({ status: enabled ? 'loading' : 'idle' })
  useEffect(() => {
    if (!enabled) { setState({ status: 'idle' }); return undefined }
    const controller = new AbortController()
    setState({ status: 'loading' })
    void load(controller.signal).then(
      (data) => { if (!controller.signal.aborted) setState({ status: 'success', data }) },
      (reason: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', error: reason instanceof Error ? reason : new Error('Analytics request failed') })
      },
    )
    return () => controller.abort()
  }, [enabled, load])
  return state
}
