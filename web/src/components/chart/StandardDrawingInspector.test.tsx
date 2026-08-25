import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DRAWING_METADATA, type DrawingAppearance, type DrawingAppearancePatch } from '../../replay/drawing-appearance'
import { StandardDrawingInspector } from './StandardDrawingInspector'

const drawing: DrawingAppearance = {
  ...DEFAULT_DRAWING_METADATA,
  id: 'callout-1',
  type: 'callout',
  lineWidth: 2,
  extendLeft: false,
  extendRight: false,
  supportsExtend: false,
  coordinates: [{ price: 100, bar: 10 }, { price: 120, bar: 30 }],
}

function Harness({ onChange }: { onChange: (patch: DrawingAppearancePatch) => void }) {
  const [current, setCurrent] = useState(drawing)
  const update = (patch: DrawingAppearancePatch): void => {
    onChange(patch)
    setCurrent((value) => ({ ...value, ...patch }))
  }
  return <StandardDrawingInspector drawing={current} drawingName="Callout" templates={[]} templateError={null} onChange={update} onClose={() => undefined} onSaveTemplate={() => undefined} onApplyTemplate={() => undefined} onDeleteTemplate={() => undefined} moving={false} onMovePointerDown={() => undefined} onMovePointerMove={() => undefined} onMovePointerUp={() => undefined} onMoveKeyDown={() => undefined} />
}

afterEach(cleanup)

describe('StandardDrawingInspector', () => {
  it('gives every fallback drawing the shared four-tab property format', async () => {
    const user = userEvent.setup()
    render(<Harness onChange={() => undefined} />)

    expect(screen.getByRole('dialog', { name: 'Edit callout drawing' })).toHaveTextContent('Callout')
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Style', 'Text', 'Coordinates', 'Visibility'])
    expect(screen.getByText('LINE & BORDER')).toBeInTheDocument()
    expect(screen.getByText('FILL')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Text' }))
    expect(screen.getByRole('textbox', { name: 'Drawing text' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Coordinates' }))
    expect(screen.getByRole('spinbutton', { name: 'Point 1 price' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Visibility' }))
    expect(screen.getByRole('checkbox', { name: 'Minutes' })).toBeInTheDocument()
  })

  it('live-syncs Style, Text, Coordinates and Visibility changes', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Thickness (px)' }), { target: { value: '4' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Fill opacity' }), { target: { value: '35' } })
    await user.click(screen.getByRole('tab', { name: 'Text' }))
    await user.type(screen.getByRole('textbox', { name: 'Drawing text' }), 'Breakout')
    await user.click(screen.getByRole('button', { name: 'Align text right' }))
    await user.click(screen.getByRole('tab', { name: 'Coordinates' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Point 1 price' }), { target: { value: '101.5' } })
    await user.click(screen.getByRole('tab', { name: 'Visibility' }))
    await user.click(screen.getByRole('checkbox', { name: 'Minutes' }))

    expect(onChange).toHaveBeenCalledWith({ lineWidth: 4 })
    expect(onChange).toHaveBeenCalledWith({ fillOpacity: 0.35 })
    expect(onChange).toHaveBeenCalledWith({ text: 'Breakout' })
    expect(onChange).toHaveBeenCalledWith({ horizontalAlign: 'right' })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ coordinates: [expect.objectContaining({ price: 101.5 }), expect.any(Object)] }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ visibility: expect.objectContaining({ minutes: expect.objectContaining({ enabled: false }) }) }))
  })
})
