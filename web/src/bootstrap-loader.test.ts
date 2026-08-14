import { describe, expect, it, vi } from 'vitest'
import { loadDuringHydration } from './bootstrap-loader'

describe('loadDuringHydration', () => {
  it('starts loading the application chunk before preference hydration settles', async () => {
    let finishHydration: () => void = () => undefined
    const hydrate = vi.fn(() => new Promise<void>((resolve) => { finishHydration = resolve }))
    const load = vi.fn().mockResolvedValue({ default: 'app' })

    const result = loadDuringHydration(hydrate, load)

    expect(hydrate).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledOnce()
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(hydrate.mock.invocationCallOrder[0])
    let settled = false
    void result.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    finishHydration()
    await expect(result).resolves.toEqual({ default: 'app' })
  })
})
