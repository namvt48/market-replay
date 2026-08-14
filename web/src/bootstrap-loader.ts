export async function loadDuringHydration<T>(
  hydrate: () => Promise<void>,
  load: () => Promise<T>,
): Promise<T> {
  const application = load()
  await hydrate()
  return application
}
