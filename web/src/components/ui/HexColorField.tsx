import { useEffect, useId, useState } from 'react'
import { isHexColor, normalizeHexColor } from '../../replay/drawing-appearance'

interface HexColorFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
}

export function HexColorField({ label, value, onChange }: HexColorFieldProps) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setDraft(value); setError(null) }, [value])

  const commit = (): void => {
    if (!isHexColor(draft)) {
      setDraft(value)
      setError('Enter #RGB or #RRGGBB')
      return
    }
    const normalized = normalizeHexColor(draft, value)
    setDraft(normalized)
    setError(null)
    onChange(normalized)
  }

  return (
    <div className="field-label">
      <label htmlFor={`${id}-hex`}>{label}</label>
      <span className="flex h-9 items-center overflow-hidden rounded-control border border-line bg-surface-0 focus-within:border-active">
        <input type="color" value={normalizeHexColor(value, '#000000')} onChange={(event) => { setError(null); onChange(event.target.value.toLowerCase()) }} className="h-full w-10 shrink-0 cursor-pointer border-0 bg-transparent p-1" aria-label={`${label} picker`} />
        <input id={`${id}-hex`} value={draft} onChange={(event) => { setDraft(event.target.value); setError(null) }} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} className="min-w-0 flex-1 bg-transparent px-2 font-mono text-ui-body uppercase text-ink outline-none" aria-label={`${label} hex code`} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} spellCheck={false} />
      </span>
      {error ? <span id={`${id}-error`} role="alert" className="text-ui-meta text-loss-bright">{error}</span> : null}
    </div>
  )
}
