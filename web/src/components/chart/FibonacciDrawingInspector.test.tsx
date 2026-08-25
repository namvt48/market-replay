import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DRAWING_METADATA, type DrawingAppearance, type DrawingAppearancePatch } from '../../replay/drawing-appearance'
import { FibonacciDrawingInspector } from './FibonacciDrawingInspector'

const drawing: DrawingAppearance = {
  ...DEFAULT_DRAWING_METADATA,
  id: 'fib-1',
  type: 'fib-retracement',
  lineWidth: 2,
  extendLeft: false,
  extendRight: false,
  supportsExtend: true,
  coordinates: [{ price: 100, bar: 10 }, { price: 120, bar: 30 }],
}

interface HarnessProps {
  onChange: (patch: DrawingAppearancePatch) => void
}

function Harness({ onChange }: HarnessProps) {
  const [current, setCurrent] = useState<DrawingAppearance>(drawing)
  const update = (patch: DrawingAppearancePatch): void => {
    onChange(patch)
    setCurrent((value) => ({ ...value, ...patch }))
  }
  return <FibonacciDrawingInspector drawing={current} templates={[]} templateError={null} onChange={update} onDeleteTemplate={() => undefined} onClose={() => undefined} />
}

afterEach(cleanup)

describe('FibonacciDrawingInspector', () => {
  it('matches the shared Style, Text, Coordinates and Visibility property structure', () => {
    render(<Harness onChange={() => undefined} />)

    expect(screen.getByRole('dialog', { name: 'Edit fib-retracement drawing' })).toBeInTheDocument()
    expect(screen.getByText('Fib Retracement')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Style', 'Text', 'Coordinates', 'Visibility'])
    expect(screen.getAllByRole('spinbutton', { name: /Level \d+ value/ })).toHaveLength(24)
    expect(screen.getByRole('button', { name: 'Drawing template' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ok' })).toBeInTheDocument()
  })

  it('syncs every Fibonacci style control immediately and enforces disabled states', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    const firstLevel = screen.getByRole('spinbutton', { name: 'Level 1 value' })
    expect(firstLevel).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show level 1' }))
    expect(firstLevel).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Levels line style' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Levels line style menu' })).getAllByRole('menuitemradio')[2])
    fireEvent.click(screen.getByRole('button', { name: 'Levels line thickness' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Levels line thickness menu' })).getAllByRole('menuitemradio')[2])
    fireEvent.change(screen.getByRole('combobox', { name: 'Fibonacci line extension' }), { target: { value: 'extend' } })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Trend line' }))
    fireEvent.change(screen.getByLabelText('Trend line color'), { target: { value: '#4caf50' } })
    fireEvent.change(screen.getByLabelText('Use one Fibonacci color'), { target: { value: '#81c784' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Background' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reverse' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Prices' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Text' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Level label format' }), { target: { value: 'percents' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Label horizontal position' }), { target: { value: 'left' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Label vertical position' }), { target: { value: 'bottom' } })

    const textHorizontal = screen.getByRole('combobox', { name: 'Text horizontal position' })
    expect(textHorizontal).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Text' }))
    expect(textHorizontal).toBeEnabled()
    fireEvent.change(textHorizontal, { target: { value: 'right' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Fibonacci text' }), { target: { value: 'Golden pocket' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Fibonacci font size' }), { target: { value: '14' } })

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fibonacciLevels: expect.any(Array) }))
    expect(onChange).toHaveBeenCalledWith({ borderStyle: 'dotted' })
    expect(onChange).toHaveBeenCalledWith({ lineWidth: 3 })
    expect(onChange).toHaveBeenCalledWith({ fibonacciExtend: true })
    expect(onChange).toHaveBeenCalledWith({ fibonacciDiagonalLine: false })
    expect(onChange).toHaveBeenCalledWith({ fibonacciTrendLineColor: '#4caf50' })
    expect(onChange).toHaveBeenCalledWith({ fillOpacity: 0 })
    expect(onChange).toHaveBeenCalledWith({ fibonacciReverse: true })
    expect(onChange).toHaveBeenCalledWith({ fibonacciPrices: false })
    expect(onChange).toHaveBeenCalledWith({ fibonacciLevelFormat: 'percents' })
    expect(onChange).toHaveBeenCalledWith({ fibonacciLabelPosition: 'left' })
    expect(onChange).toHaveBeenCalledWith({ fibonacciLabelVerticalPosition: 'bottom' })
    expect(onChange).toHaveBeenCalledWith({ fibonacciTextVisible: true })
    expect(onChange).toHaveBeenCalledWith({ horizontalAlign: 'right' })
    expect(onChange).toHaveBeenCalledWith({ text: 'Golden pocket' })
    expect(onChange).toHaveBeenCalledWith({ fontSize: 14 })
  })

  it('uses the shared coordinate and visibility panels', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Coordinates' }))
    const firstPrice = screen.getByRole('spinbutton', { name: 'Point 1 price' })
    fireEvent.change(firstPrice, { target: { value: '101.5' } })

    fireEvent.click(screen.getByRole('tab', { name: 'Visibility' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Minutes' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ coordinates: [expect.objectContaining({ price: 101.5 }), expect.any(Object)] }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ visibility: expect.objectContaining({ minutes: expect.objectContaining({ enabled: false }) }) }))
  })
})
