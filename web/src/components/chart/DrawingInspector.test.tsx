import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  horizontalAlign: 'center', verticalAlign: 'inside', bold: false, italic: false, fontSize: 13,
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
  it('shows one compact property group at a time through accessible tabs', async () => {
    const user = userEvent.setup()
    render(<Harness onChange={() => undefined} />)

    const tabs = screen.getByRole('tablist', { name: 'Drawing property sections' })
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Style', 'Fill', 'Text', 'Templates'])
    expect(screen.getByRole('tab', { name: 'Style' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('spinbutton', { name: /Thickness/i })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Label' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Template name' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Text' }))
    expect(screen.getByRole('textbox', { name: 'Label' })).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: /Thickness/i })).not.toBeInTheDocument()

    screen.getByRole('tab', { name: 'Text' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Templates' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Template name' })).toBeInTheDocument()
    expect(tabs).toBeInTheDocument()
  })

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
    await user.click(screen.getByRole('tab', { name: 'Text' }))
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

    await user.click(inspector.getByRole('tab', { name: 'Templates' }))
    await user.type(inspector.getByRole('textbox', { name: 'Template name' }), 'Trend setup')
    await user.click(inspector.getByRole('button', { name: 'Save' }))

    expect(onSaveTemplate).toHaveBeenCalledWith('Trend setup')
  })

  it('edits all 24 Fibonacci level slots and Fibonacci-specific display controls', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness initial={{ ...drawing, type: 'fib-retracement' }} onChange={onChange} />)

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Line', 'Levels', 'Display', 'Templates'])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Line style' }), 'dotted')
    await user.click(screen.getByRole('checkbox', { name: 'Extend lines' }))
    await user.click(screen.getByRole('checkbox', { name: 'Diagonal' }))

    await user.click(screen.getByRole('tab', { name: 'Levels' }))
    expect(screen.getAllByRole('spinbutton', { name: /Level \d+ value/ })).toHaveLength(24)
    await user.click(screen.getByRole('checkbox', { name: 'Show level 1' }))

    await user.click(screen.getByRole('tab', { name: 'Display' }))
    await user.click(screen.getByRole('checkbox', { name: 'Reverse' }))
    await user.click(screen.getByRole('checkbox', { name: 'Prices' }))
    await user.click(screen.getByRole('checkbox', { name: 'Levels' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Level label format' }), 'percents')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Label horizontal position' }), 'center')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Label vertical position' }), 'bottom')
    await user.click(screen.getByRole('checkbox', { name: 'Text' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Text horizontal position' }), 'left')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Text vertical position' }), 'top')
    await user.type(screen.getByRole('textbox', { name: 'Text content' }), 'Golden pocket')

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fibonacciLevels: expect.arrayContaining([expect.objectContaining({ visible: true })]) }))
    expect(onChange).toHaveBeenCalledWith({ borderStyle: 'dotted' })
    expect(onChange).toHaveBeenCalledWith({ fibonacciExtend: true })
    expect(onChange).toHaveBeenCalledWith({ fibonacciDiagonalLine: false })
    expect(onChange).toHaveBeenCalledWith({ fibonacciReverse: true })
    expect(onChange).toHaveBeenCalledWith({ fibonacciPrices: false })
    expect(onChange).toHaveBeenCalledWith({ fibonacciLevelLabels: false })
    expect(onChange).toHaveBeenCalledWith({ fibonacciLevelFormat: 'percents' })
    expect(onChange).toHaveBeenCalledWith({ fibonacciLabelPosition: 'center' })
    expect(onChange).toHaveBeenCalledWith({ fibonacciLabelVerticalPosition: 'bottom' })
    expect(onChange).toHaveBeenCalledWith({ fibonacciTextVisible: true })
    expect(onChange).toHaveBeenCalledWith({ horizontalAlign: 'left' })
    expect(onChange).toHaveBeenCalledWith({ verticalAlign: 'top' })
    expect(onChange).toHaveBeenCalledWith({ text: 'Golden pocket' })
  })

  it('offers a middle line only for rectangle drawings', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const view = render(<Harness initial={{ ...drawing, type: 'rectangle' }} onChange={onChange} />)

    await user.click(screen.getByRole('checkbox', { name: 'Mid line' }))
    const color = screen.getByRole('textbox', { name: 'Mid line color hex code' })
    await user.clear(color)
    await user.type(color, '#ff5500')
    await user.tab()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Mid line style' }), 'dashed')
    fireEvent.change(screen.getByRole('slider', { name: /Mid line opacity/i }), { target: { value: '35' } })
    const thickness = screen.getByRole('spinbutton', { name: 'Mid line thickness' })
    await user.clear(thickness)
    await user.type(thickness, '3')
    expect(onChange).toHaveBeenCalledWith({ rectangleMiddleLine: true })
    expect(onChange).toHaveBeenCalledWith({ rectangleMiddleLineColor: '#ff5500' })
    expect(onChange).toHaveBeenCalledWith({ rectangleMiddleLineStyle: 'dashed' })
    expect(onChange).toHaveBeenCalledWith({ rectangleMiddleLineWidth: 3 })
    expect(onChange).toHaveBeenCalledWith({ rectangleMiddleLineOpacity: 0.35 })

    view.unmount()
    render(<Harness initial={{ ...drawing, type: 'trend-line' }} onChange={onChange} />)
    expect(screen.queryByRole('checkbox', { name: 'Mid line' })).not.toBeInTheDocument()
  })
})
