export function pruneSymbolCache<T>(cache: Map<string, T>, retainedSymbols: ReadonlySet<string>): void {
  for (const symbol of cache.keys()) {
    if (!retainedSymbols.has(symbol)) cache.delete(symbol)
  }
}
