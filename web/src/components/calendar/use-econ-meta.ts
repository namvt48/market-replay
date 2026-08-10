import { useCallback, useEffect, useState } from 'react'
import { fetchEconMeta } from '../../api/client'
import type { EconMeta } from '../../api/types'

export type EconMetaState =
  | { status: 'loading' }
  | { status: 'success'; data: EconMeta }
  | { status: 'error'; message: string }

interface EconMetaResult {
  state: EconMetaState
  retry: () => void
}

export function useEconMeta(): EconMetaResult {
  const [state, setState] = useState<EconMetaState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback((): void => setAttempt((current) => current + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void fetchEconMeta(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: 'success', data })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({
          status: 'error',
          message: error instanceof Error && error.message ? error.message : 'Calendar metadata could not be loaded.',
        })
      })
    return () => controller.abort()
  }, [attempt])

  return { state, retry }
}
