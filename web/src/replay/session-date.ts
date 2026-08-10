const dateFormatterCache = new Map<string, Intl.DateTimeFormat>()

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateFormatterCache.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  dateFormatterCache.set(timeZone, formatter)
  return formatter
}

function partsAt(timestampMs: number, timeZone: string): Record<string, number> {
  return Object.fromEntries(
    dateFormatter(timeZone)
      .formatToParts(new Date(timestampMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
}

/** Returns YYYY-MM-DD in the instrument's session timezone. */
export function sessionDateValue(timestamp: number, timeZone: string): string {
  try {
    const parts = partsAt(timestamp * 1_000, timeZone)
    return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
  } catch {
    return new Date(timestamp * 1_000).toISOString().slice(0, 10)
  }
}

/** Converts a calendar date to 09:30 in the instrument's session timezone. */
export function sessionOpenTimestamp(date: string, timeZone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const desiredAsUtc = Date.UTC(year, month - 1, day, 9, 30, 0)
  let guess = desiredAsUtc
  try {
    // Two passes cover DST offsets because the second pass observes the
    // timezone at the corrected instant rather than at the UTC guess.
    for (let pass = 0; pass < 2; pass += 1) {
      const actual = partsAt(guess, timeZone)
      const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
      guess += desiredAsUtc - actualAsUtc
    }
  } catch {
    return Math.floor(desiredAsUtc / 1_000)
  }
  return Math.floor(guess / 1_000)
}
