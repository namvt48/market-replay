import { describe, expect, it } from 'vitest'
import { pruneSymbolCache } from './symbol-cache'

describe('pruneSymbolCache', () => {
  it('removes symbols that no replay or chart view still owns', () => {
    const nq = { id: 'nq' }
    const es = { id: 'es' }
    const gc = { id: 'gc' }
    const cache = new Map([['NQ', nq], ['ES', es], ['GC', gc]])

    pruneSymbolCache(cache, new Set(['NQ', 'GC']))

    expect([...cache.entries()]).toEqual([['NQ', nq], ['GC', gc]])
  })
})
