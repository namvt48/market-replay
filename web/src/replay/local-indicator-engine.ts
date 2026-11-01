import type { IndicatorDescriptor, IndicatorRunResult, Timeframe } from '../api/types'

interface WorkerRequest {
  id: number
  type: string
  payload?: unknown
  signal?: AbortSignal
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer?: number
  onAbort?: () => void
}

let worker: Worker | undefined
let nextId = 0
let active: WorkerRequest | undefined
const queue: WorkerRequest[] = []

function settle(request: WorkerRequest, callback: () => void): void {
  if (request.timer !== undefined) window.clearTimeout(request.timer)
  if (request.onAbort) request.signal?.removeEventListener('abort', request.onAbort)
  callback()
}

function failActive(error: Error): void {
  const request = active
  active = undefined
  worker?.terminate()
  worker = undefined
  if (request) settle(request, () => request.reject(error))
  dispatch()
}

function cancelActive(request: WorkerRequest): void {
  if (active !== request) return
  active = undefined
  settle(request, () => request.reject(new DOMException('The operation was aborted', 'AbortError')))
  dispatch()
}


function getWorker(): Worker {
  if (worker) return worker
  const instance = new Worker(new URL('./indicator-worker.ts', import.meta.url), { type: 'module', name: 'local-indicators' })
  instance.addEventListener('message', (event: MessageEvent<{ id: number; value?: unknown; error?: string }>) => {
    const request = active
    if (!request || request.id !== event.data.id) return
    active = undefined
    settle(request, () => {
      if (event.data.error) request.reject(new Error(event.data.error))
      else request.resolve(event.data.value)
    })
    dispatch()
  })
  instance.addEventListener('error', () => {
    if (worker === instance) failActive(new Error('Local indicator worker failed'))
  })
  worker = instance
  return instance
}

function dispatch(): void {
  if (active || queue.length === 0) return
  const request = queue.shift()
  if (!request) return
  if (request.signal?.aborted) {
    settle(request, () => request.reject(new DOMException('The operation was aborted', 'AbortError')))
    dispatch()
    return
  }
  active = request
  request.timer = window.setTimeout(() => failActive(new Error('Local indicator worker timed out')), 10_000)
  try {
    getWorker().postMessage({ id: request.id, type: request.type, payload: request.payload })
  } catch (error) {
    failActive(error instanceof Error ? error : new Error(String(error)))
  }
}

function request<T>(type: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('The operation was aborted', 'AbortError'))
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (error: Error) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  const queued: WorkerRequest = {
    id: ++nextId,
    type,
    payload,
    signal,
    resolve: (value) => resolvePromise(value as T),
    reject: rejectPromise,
  }
  queued.onAbort = (): void => {
    const queuedIndex = queue.indexOf(queued)
    if (queuedIndex !== -1) {
      queue.splice(queuedIndex, 1)
      settle(queued, () => queued.reject(new DOMException('The operation was aborted', 'AbortError')))
    } else if (active === queued) {
      cancelActive(queued)
    }
  }
  signal?.addEventListener('abort', queued.onAbort, { once: true })
  queue.push(queued)
  dispatch()
  return promise
}

export function localIndicatorCatalog(signal?: AbortSignal): Promise<IndicatorDescriptor[]> {
  return request<IndicatorDescriptor[]>('list', undefined, signal)
}

export function runLocalIndicator(symbol: string, timeframe: Timeframe, script: string, bars: unknown[], inputs: Record<string, unknown>, tickSize: number, sessionTz: string, dailyBars: unknown[], isFuture: boolean, signal?: AbortSignal): Promise<IndicatorRunResult> {
  return request<IndicatorRunResult>('run', [symbol, timeframe, script, bars, inputs, tickSize, sessionTz, dailyBars, isFuture], signal)
}
