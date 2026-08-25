import { useId, type ReactElement } from 'react'
import type { DrawingAppearance, DrawingAppearancePatch, DrawingVisibilityUnit } from '../../replay/drawing-appearance'

interface DrawingPropertyPanelProps {
  drawing: DrawingAppearance
  onChange: (patch: DrawingAppearancePatch) => void
}

const VISIBILITY_ROWS: readonly { unit: DrawingVisibilityUnit; label: string; domainMax: number }[] = [
  { unit: 'seconds', label: 'Seconds', domainMax: 59 },
  { unit: 'minutes', label: 'Minutes', domainMax: 59 },
  { unit: 'hours', label: 'Hours', domainMax: 24 },
  { unit: 'days', label: 'Days', domainMax: 366 },
  { unit: 'weeks', label: 'Weeks', domainMax: 52 },
  { unit: 'months', label: 'Months', domainMax: 12 },
]

const PANEL_INPUT = 'h-9 rounded-control border border-[#4b4d52] bg-[#202020] px-2.5 text-ui-control text-[#d6d6d6] outline-none transition-colors focus:border-active disabled:cursor-not-allowed disabled:text-[#686868]'

export function DrawingCoordinatesPanel({ drawing, onChange }: DrawingPropertyPanelProps): ReactElement {
  const fieldId = useId()
  const coordinates = drawing.coordinates ?? []
  return (
    <div className="space-y-4">
      {coordinates.map((coordinate, index) => (
        <div key={index} className="grid grid-cols-[6rem_1fr_6.25rem] items-center gap-2">
          <label htmlFor={`${fieldId}-price-${index}`} className="text-ui-control">#{index + 1} (price, bar)</label>
          <input
            id={`${fieldId}-price-${index}`}
            aria-label={`Point ${index + 1} price`}
            type="number"
            step="any"
            value={coordinate.price}
            onChange={(event) => onChange({
              coordinates: coordinates.map((value, coordinateIndex) => coordinateIndex === index ? { ...value, price: Number(event.target.value) } : value),
            })}
            className={`${PANEL_INPUT} min-w-0 font-mono`}
          />
          <input
            aria-label={`Point ${index + 1} bar`}
            type="number"
            min="0"
            step="1"
            value={coordinate.bar}
            onChange={(event) => onChange({
              coordinates: coordinates.map((value, coordinateIndex) => coordinateIndex === index ? { ...value, bar: Number(event.target.value) } : value),
            })}
            className={`${PANEL_INPUT} min-w-0 font-mono`}
          />
        </div>
      ))}
      {coordinates.length === 0 ? <p className="text-ui-body text-[#8e8e8e]">Coordinates become available after the drawing is placed.</p> : null}
    </div>
  )
}

export function DrawingVisibilityPanel({ drawing, onChange }: DrawingPropertyPanelProps): ReactElement {
  return (
    <div className="space-y-3">
      {VISIBILITY_ROWS.map(({ unit, label, domainMax }) => {
        const rule = drawing.visibility[unit]
        return (
          <div key={unit} className="grid grid-cols-[5.5rem_1fr_1fr] items-center gap-2 sm:grid-cols-[5.5rem_6.25rem_1fr_6.25rem]">
            <label className="flex cursor-pointer items-center gap-2 text-ui-control">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(event) => onChange({ visibility: { ...drawing.visibility, [unit]: { ...rule, enabled: event.target.checked } } })}
                className="size-[18px] accent-white"
              />
              {label}
            </label>
            <input
              aria-label={`${label} minimum`}
              type="number"
              min="1"
              value={rule.min}
              onChange={(event) => onChange({ visibility: { ...drawing.visibility, [unit]: { ...rule, min: Math.max(1, Number(event.target.value)) } } })}
              className={`${PANEL_INPUT} min-w-0 font-mono`}
            />
            <div className="drawing-visibility-range hidden sm:block">
              <span className="drawing-visibility-range__track" />
              <input
                aria-label={`${label} minimum range`}
                type="range"
                min="1"
                max={Math.max(domainMax, rule.max)}
                value={rule.min}
                onChange={(event) => onChange({ visibility: { ...drawing.visibility, [unit]: { ...rule, min: Math.min(Number(event.target.value), rule.max) } } })}
              />
              <input
                aria-label={`${label} maximum range`}
                type="range"
                min="1"
                max={Math.max(domainMax, rule.max)}
                value={rule.max}
                onChange={(event) => onChange({ visibility: { ...drawing.visibility, [unit]: { ...rule, max: Math.max(Number(event.target.value), rule.min) } } })}
              />
            </div>
            <input
              aria-label={`${label} maximum`}
              type="number"
              min={rule.min}
              value={rule.max}
              onChange={(event) => onChange({ visibility: { ...drawing.visibility, [unit]: { ...rule, max: Math.max(rule.min, Number(event.target.value)) } } })}
              className={`${PANEL_INPUT} min-w-0 font-mono`}
            />
          </div>
        )
      })}
    </div>
  )
}
