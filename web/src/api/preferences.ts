import { z } from 'zod'

// Workspace settings are opaque to the server: it stores and returns each
// payload verbatim. The client keeps them as the exact JSON text it would
// have written to localStorage, so hydrating is a straight assignment and
// adding a setting needs no backend change.
const preferencesSchema = z.record(z.string(), z.unknown())

async function checkedFetch(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`)
  }
  return response
}

/** Every stored setting, as the JSON text each store expects to read. */
export async function fetchPreferences(): Promise<Record<string, string>> {
  const response = await checkedFetch('/api/v1/preferences')
  const parsed = preferencesSchema.parse(await response.json())
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, JSON.stringify(value)]))
}

export async function putPreference(key: string, payload: string, init?: RequestInit): Promise<void> {
  await checkedFetch(`/api/v1/preferences/${encodeURIComponent(key)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: payload, ...init,
  })
}

export async function deletePreference(key: string): Promise<void> {
  await checkedFetch(`/api/v1/preferences/${encodeURIComponent(key)}`, { method: 'DELETE' })
}
