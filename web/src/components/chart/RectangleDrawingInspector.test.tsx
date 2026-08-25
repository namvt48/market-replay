import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DRAWING_METADATA, type DrawingAppearance, type DrawingAppearancePatch } from '../../replay/drawing-appearance'
import { RectangleDrawingInspector } from './RectangleDrawingInspector'

const drawing: DrawingAppearance = {
  ...DEFAULT_DRAWING_METADATA,
  id: 'rectangle-1',
  type: 'rectangle',
  strokeColor: '#fff9c4',
  text: 'abcbcb',
  textColor: '#9c27b0',
  fontSize: 14,
  rectangleMiddleLine: true,
  rectangleMiddleLineColor: '#9c27b0',
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
  return <RectangleDrawingInspector drawing={current} templates={[]} templateError={null} onChange={update} onDeleteTemplate={() => undefined} onClose={() => undefined} />
}

afterEach(cleanup)

describe('RectangleDrawingInspector', () => {
  it('matches the compact Style, Text, Coordinates and Visibility structure', () => {
    render(<Harness onChange={() => undefined} />)

    expect(screen.getByRole('dialog', { name: 'Edit rectangle drawing' })).toBeInTheDocument()
    expect(screen.getByText('Rectangle')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Style', 'Text', 'Coordinates', 'Visibility'])
    expect(screen.getByRole('combobox', { name: 'Rectangle extension' })).toHaveValue('none')
    expect(screen.getByRole('button', { name: 'Border appearance' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Middle line appearance' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Rectangle background appearance' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Drawing template' })).toBeInTheDocument()
  })

  it('live-syncs extend, border, middle line and background controls', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Rectangle extension' }), { target: { value: 'right' } })
    fireEvent.click(screen.getByRole('button', { name: 'Border appearance' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set color #f23645' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Border opacity' }), { target: { value: '55' } })
    fireEvent.click(screen.getByRole('button', { name: '3px' }))
    fireEvent.click(screen.getByRole('button', { name: 'dashed line' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Middle line' }))
    expect(screen.getByRole('button', { name: 'Middle line appearance' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Background' }))

    expect(onChange).toHaveBeenCalledWith({ extendLeft: false, extendRight: true })
    expect(onChange).toHaveBeenCalledWith({ strokeColor: '#f23645' })
    expect(onChange).toHaveBeenCalledWith({ strokeOpacity: 0.55 })
    expect(onChange).toHaveBeenCalledWith({ lineWidth: 3 })
    expect(onChange).toHaveBeenCalledWith({ borderStyle: 'dashed' })
    expect(onChange).toHaveBeenCalledWith({ rectangleMiddleLine: false })
    expect(onChange).toHaveBeenCalledWith({ fillOpacity: 0 })
  })

  it('portals appearance palettes outside the scrollable tab panel so they are not clipped', () => {
    render(<Harness onChange={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Middle line appearance' }))
    const palette = screen.getByRole('dialog', { name: 'Middle line color palette' })
    const tabPanel = screen.getByRole('tabpanel')

    expect(tabPanel).not.toContainElement(palette)
    expect(palette).toHaveClass('fixed')
  })

  it('live-syncs text appearance, content and alignment', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Text' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rectangle text color' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set color #f2f3f5' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Rectangle font size' }), { target: { value: '16' } })
    fireEvent.click(screen.getByRole('button', { name: 'Bold rectangle text' }))
    fireEvent.click(screen.getByRole('button', { name: 'Italic rectangle text' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Rectangle text' }), { target: { value: 'Middle label' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Rectangle vertical text alignment' }), { target: { value: 'top' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Rectangle horizontal text alignment' }), { target: { value: 'left' } })

    expect(onChange).toHaveBeenCalledWith({ textColor: '#f2f3f5' })
    expect(onChange).toHaveBeenCalledWith({ fontSize: 16 })
    expect(onChange).toHaveBeenCalledWith({ bold: true })
    expect(onChange).toHaveBeenCalledWith({ italic: true })
    expect(onChange).toHaveBeenCalledWith({ text: 'Middle label' })
    expect(onChange).toHaveBeenCalledWith({ verticalAlign: 'top' })
    expect(onChange).toHaveBeenCalledWith({ horizontalAlign: 'left' })
  })

  it('uses the shared Coordinates and Visibility panels', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Coordinates' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Point 1 price' }), { target: { value: '101.5' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Visibility' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Minutes' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ coordinates: [expect.objectContaining({ price: 101.5 }), expect.any(Object)] }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ visibility: expect.objectContaining({ minutes: expect.objectContaining({ enabled: false }) }) }))
  })
})
