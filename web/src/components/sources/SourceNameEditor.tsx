import { Pencil, X } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent, type ReactElement } from 'react'
import { SOURCE_NAME_MAX_LENGTH, normalizedSourceName } from '../../sources/source-name'

interface SourceNameEditorProps {
  currentName: string | null | undefined
  defaultName: string
  sourceLabel: string
  onSave: (name: string) => Promise<void>
}

export function SourceNameEditor({ currentName, defaultName, sourceLabel, onSave }: SourceNameEditorProps): ReactElement {
  const inputId = useId()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(normalizedSourceName(currentName))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) setValue(normalizedSourceName(currentName))
  }, [currentName, editing])

  const cancel = (): void => {
    setEditing(false)
    setValue(normalizedSourceName(currentName))
    setError(null)
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave(normalizedSourceName(value))
      setEditing(false)
    } catch {
      setError(`Could not rename this ${sourceLabel}. Try again after persistence reconnects.`)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return <button type="button" onClick={() => setEditing(true)} title={`Rename ${sourceLabel}`} className="tool-button relative size-7 min-h-7 min-w-7 p-0 text-dim after:absolute after:-inset-2 hover:text-ink" aria-label={`Rename ${sourceLabel}`}><Pencil size={12} /></button>
  }

  return (
    <form onSubmit={(event) => { void submit(event) }} className="mt-1 min-w-0 basis-full" aria-label={`Rename ${sourceLabel}`}>
      <label htmlFor={inputId} className="sr-only">Display name</label>
      <div className="flex items-center gap-1.5">
        <input id={inputId} autoFocus maxLength={SOURCE_NAME_MAX_LENGTH} value={value} onChange={(event) => setValue(event.target.value)} placeholder={defaultName} className="h-8 min-w-0 flex-1 rounded-control border border-line-strong bg-surface-0 px-2.5 text-ui-body text-ink outline-none focus:border-active" />
        <button type="submit" disabled={saving} className="primary-button h-8 min-h-8 px-2.5">{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={saving} onClick={cancel} className="tool-button size-8 min-h-8 min-w-8" aria-label="Cancel rename"><X size={14} /></button>
      </div>
      {error ? <p className="mt-1 text-ui-meta text-loss-bright" role="alert">{error}</p> : null}
    </form>
  )
}
