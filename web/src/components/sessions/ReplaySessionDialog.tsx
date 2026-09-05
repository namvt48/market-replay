import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { chartTimezoneDateTimeValue, chartTimezoneTimestampFromDateTimeValue, type ChartTimezone } from '../../replay/chart-timezone'

interface ReplaySessionDialogProps {
  mode: 'new' | 'save'
  initialTimestamp?: number
  timezone: ChartTimezone
  onClose: () => void
  onSubmit: (name: string, timestamp?: number) => Promise<void> | void
}

export function ReplaySessionDialog({ mode, initialTimestamp, timezone, onClose, onSubmit }: ReplaySessionDialogProps): ReactElement {
  const [name, setName] = useState('')
  const [dateTime, setDateTime] = useState(() => chartTimezoneDateTimeValue(initialTimestamp ?? Math.floor(Date.now() / 1000), timezone))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const title = mode === 'new' ? 'New replay session' : 'Save replay session'

  useEffect(() => { nameRef.current?.focus() }, [])

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) { setError('Enter a session name.'); return }
    const timestamp = mode === 'new' ? chartTimezoneTimestampFromDateTimeValue(dateTime, timezone) : undefined
    if (mode === 'new' && timestamp === null) { setError('Choose a valid replay start date and time.'); return }
    setBusy(true)
    setError(null)
    try { await onSubmit(trimmedName, timestamp ?? undefined); onClose() } catch { setError('The session could not be saved. Please try again.') } finally { setBusy(false) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/72 p-4 backdrop-blur-[2px] max-sm:p-0" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="replay-session-dialog-title" className="w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-[18px] border border-line-strong bg-surface-0 shadow-overlay max-sm:w-full max-sm:rounded-none">
        <header className="flex min-h-14 items-center justify-between border-b border-line px-4 sm:px-5">
          <div><h2 id="replay-session-dialog-title" className="text-ui-title font-semibold text-ink">{title}</h2><p className="mt-0.5 text-ui-meta text-dim">{mode === 'new' ? 'Choose where the replay begins, then save it under a clear name.' : 'Keep this temporary replay and its trade history.'}</p></div>
          <button type="button" onClick={onClose} disabled={busy} className="tool-button" aria-label="Close session dialog"><X size={17} /></button>
        </header>
        <form onSubmit={(event) => void submit(event)} className="p-4 sm:p-5">
          <label className="block text-ui-body font-medium text-ink">Session name<input ref={nameRef} value={name} onChange={(event) => { setName(event.target.value); setError(null) }} placeholder="e.g. NQ opening range" className="field-input mt-1.5 h-10 w-full" maxLength={120} /></label>
          {mode === 'new' ? <label className="mt-4 block text-ui-body font-medium text-ink">Replay start <span className="font-mono text-ui-meta text-dim">({timezone.kind === 'preset' ? timezone.id : 'UTC offset'})</span><input type="datetime-local" aria-label="Replay start" value={dateTime} onChange={(event) => { setDateTime(event.target.value); setError(null) }} className="field-input mt-1.5 h-10 w-full" /></label> : null}
          {error ? <p role="alert" className="mt-3 text-ui-meta text-loss-bright">{error}</p> : null}
          <footer className="mt-5 flex justify-end gap-2 border-t border-line pt-3"><button type="button" onClick={onClose} disabled={busy} className="secondary-button">Cancel</button><button type="submit" disabled={busy} className="primary-button">{busy ? 'Saving…' : mode === 'new' ? 'Start replay' : 'Save session'}</button></footer>
        </form>
      </div>
    </div>, document.body,
  )
}
