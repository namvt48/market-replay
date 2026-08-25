import { shortEvalAccountHash } from '../eval/rules'
import { shortReplaySessionHash } from '../replay/session-state'

export const SOURCE_NAME_MAX_LENGTH = 80

export function normalizedSourceName(value: string | null | undefined): string {
  return value?.trim().slice(0, SOURCE_NAME_MAX_LENGTH) ?? ''
}

export function replaySessionDisplayName(session: { id: string; name?: string | null }): string {
  return normalizedSourceName(session.name) || `#${shortReplaySessionHash(session.id)}`
}

export function evaluationDisplayName(account: { accountId: string; name?: string | null }): string {
  return normalizedSourceName(account.name) || `#${shortEvalAccountHash(account.accountId)}`
}
