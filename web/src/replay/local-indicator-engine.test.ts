import { afterEach, describe, expect, it, vi } from 'vitest'

class TestWorker extends EventTarget {
  static instances: TestWorker[] = []
  sent: Array<{ id: number; type: string }> = []
  terminated = false
  constructor() { super(); TestWorker.instances.push(this) }
  postMessage(message: { id: number; type: string }): void { this.sent.push(message) }
  terminate(): void { this.terminated = true }
  complete(id: number, value: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: { id, value } }))
  }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); TestWorker.instances = [] })

describe('local indicator cancellation', () => {
  it('rejects an obsolete caller without destroying unrelated worker state or publishing its late reply', async () => {
    // Reset the module-scoped worker between cases to exercise the abort boundary.
    vi.resetModules()
    vi.stubGlobal('Worker', TestWorker)
    const { localIndicatorCatalog } = await import('./local-indicator-engine')
    const controller = new AbortController()
    const obsolete = localIndicatorCatalog(controller.signal)
    const rejected = expect(obsolete).rejects.toMatchObject({ name: 'AbortError' })
    const worker = TestWorker.instances[0]
    controller.abort()
    await rejected
    expect(worker.terminated).toBe(false)
    const next = localIndicatorCatalog()
    worker.complete(worker.sent[0].id, [{ id: 'obsolete' }])
    expect(TestWorker.instances).toHaveLength(1)
    const catalog = [{ id: 'ema', name: 'EMA', version: 1, meta: { onMainPanel: true }, inputs: [] }]
    worker.complete(worker.sent[1].id, catalog)
    await expect(next).resolves.toEqual(catalog)
  })

  it('removes an aborted queued request without disturbing the active worker request', async () => {
    vi.resetModules()
    vi.stubGlobal('Worker', TestWorker)
    const { localIndicatorCatalog } = await import('./local-indicator-engine')
    const active = localIndicatorCatalog()
    const worker = TestWorker.instances[0]
    const controller = new AbortController()
    const queued = localIndicatorCatalog(controller.signal)
    const rejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    expect(worker.sent).toHaveLength(1)
    expect(worker.terminated).toBe(false)
    const catalog = [{ id: 'ema', name: 'EMA', version: 1, meta: { onMainPanel: true }, inputs: [] }]
    worker.complete(worker.sent[0].id, catalog)
    await expect(active).resolves.toEqual(catalog)
    expect(TestWorker.instances).toHaveLength(1)
  })
})
