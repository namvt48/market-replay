import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DRAWING_METADATA, type DrawingAppearance, type DrawingAppearancePatch } from '../../replay/drawing-appearance'
import { DrawingInspector } from './DrawingInspector'

afterEach(cleanup)

const drawing: DrawingAppearance = {
  ...DEFAULT_DRAWING_METADATA,
  id: 'drawing-1', type: 'trend-line', lineWidth: 2, extendLeft: false, extendRight: false, supportsExtend: true,
  strokeColor: '#e9a23b', strokeOpacity: 1, borderStyle: 'solid', fillColor: '#e9a23b', fillOpacity: 0.12,
  text: '', textColor: '#e8edf0', textOpacity: 1, backgroundColor: '#070d12', backgroundOpacity: 0.82,
  horizontalAlign: 'center', verticalAlign: 'inside', bold: false, italic: false, fontSize: 12,
}

interface HarnessProps {
  initial?: DrawingAppearance
  onChange: (patch: DrawingAppearancePatch) => void
}

function Harness({ initial = drawing, onChange }: HarnessProps) {
  const [current, setCurrent] = useState<DrawingAppearance>(initial)
  const update = (patch: DrawingAppearancePatch): void => {
    onChange(patch)
    setCurrent((value) => ({ ...value, ...patch }))
  }
  return <DrawingInspector drawing={current} templates={[]} templateError={null} onChange={update} onClose={() => undefined} onSaveTemplate={() => undefined} onApplyTemplate={() => undefined} onDeleteTemplate={() => undefined} />
}

describe('DrawingInspector', () => {
  it('edits line, extend and text appearance through accessible controls', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)

    const stroke = screen.getByRole('textbox', { name: 'Stroke hex code' })
    await user.clear(stroke)
    await user.type(stroke, '#12abef')
    await user.tab()
    await user.selectOptions(screen.getByRole('combobox', { name: /Border style/i }), 'dashed')
    await user.click(screen.getByRole('button', { name: 'Extend right' }))
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Breakout')
    await user.click(screen.getByRole('button', { name: 'Bold text' }))
    await user.click(screen.getByRole('button', { name: 'Align text right' }))

    expect(onChange).toHaveBeenCalledWith({ strokeColor: '#12abef' })
    expect(onChange).toHaveBeenCalledWith({ borderStyle: 'dashed' })
    expect(onChange).toHaveBeenCalledWith({ extendRight: true })
    expect(onChange).toHaveBeenCalledWith({ text: 'Breakout' })
    expect(onChange).toHaveBeenCalledWith({ bold: true })
    expect(onChange).toHaveBeenCalledWith({ horizontalAlign: 'right' })
  })

  it('saves a named template from the current drawing', async () => {
    const onSaveTemplate = vi.fn()
    const user = userEvent.setup()
    const inspector = render(<DrawingInspector drawing={drawing} templates={[]} templateError={null} onChange={() => undefined} onClose={() => undefined} onSaveTemplate={onSaveTemplate} onApplyTemplate={() => undefined} onDeleteTemplate={() => undefined} />)

    await user.type(inspector.getByRole('textbox', { name: 'Template name' }), 'Trend setup')
    await user.click(inspector.getByRole('button', { name: 'Save' }))

    expect(onSaveTemplate).toHaveBeenCalledWith('Trend setup')
  })

  it('edits all 24 Fibonacci level slots and Fibonacci-specific display controls', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness initial={{ ...drawing, type: 'fib-retracement' }} onChange={onChange} />)

    expect(screen.getAllByRole('spinbutton', { name: /Level \d+ value/ })).toHaveLength(24)
    await user.click(screen.getByRole('checkbox', { name: 'Show level 1' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Line style' }), 'dotted')
    await user.click(screen.getByRole('button', { name: 'Extend across chart' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Position' }), 'left')

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fibonacciLevels: expect.arrayContaining([expect.objectContaining({ visible: true })]) }))
    expect(onChange).toHaveBeenCalledWith({ borderStyle: 'dotted' })
    expect(onChange).toHaveBeenCalledWith({ fibonacciExtend: true })
    expect(onChange).toHaveBeenCalledWith({ fibonacciLabelPosition: 'left' })
  })
})
