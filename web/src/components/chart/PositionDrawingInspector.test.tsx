import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DRAWING_METADATA, type DrawingAppearance, type DrawingAppearancePatch } from '../../replay/drawing-appearance'
import { PositionDrawingInspector } from './PositionDrawingInspector'

const longPosition: DrawingAppearance = {
  ...DEFAULT_DRAWING_METADATA,
  id: 'long-1',
  type: 'long-position',
  lineWidth: 1,
  extendLeft: false,
  extendRight: false,
  supportsExtend: false,
  positionTickSize: 0.25,
  positionPricePrecision: 2,
  coordinates: [
    { price: 24_434.5, bar: 100 },
    { price: 24_184.5, bar: 100 },
    { price: 24_961.25, bar: 150 },
  ],
}

interface HarnessProps {
  initial?: DrawingAppearance
  onChange: (patch: DrawingAppearancePatch) => void
}

function Harness({ initial = longPosition, onChange }: HarnessProps) {
  const [current, setCurrent] = useState<DrawingAppearance>(initial)
  const update = (patch: DrawingAppearancePatch): void => {
    onChange(patch)
    setCurrent((value) => ({ ...value, ...patch }))
  }
  return <PositionDrawingInspector drawing={current} templates={[]} templateError={null} onChange={update} onDeleteTemplate={() => undefined} onClose={() => undefined} />
}

afterEach(cleanup)

describe('PositionDrawingInspector', () => {
  it('matches the shared Style, Text, Coordinates and Visibility structure', () => {
    render(<Harness onChange={() => undefined} />)

    expect(screen.getByRole('dialog', { name: 'Edit long-position drawing' })).toBeInTheDocument()
    expect(screen.getByText('Long Position')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Style', 'Text', 'Coordinates', 'Visibility'])
    expect(screen.getByRole('spinbutton', { name: 'Position account size' })).toHaveValue(1000)
    expect(screen.getByRole('spinbutton', { name: 'Position profit ticks' })).toHaveValue(2107)
    expect(screen.getByRole('spinbutton', { name: 'Position stop ticks' })).toHaveValue(1000)
    expect(screen.getByRole('combobox', { name: 'Position quantity precision' })).toHaveValue('default')
  })

  it('live-syncs inputs and converts ticks back into Long Position anchor prices', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Position account size' }), { target: { value: '2500' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Position risk mode' }), { target: { value: 'cash' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Position profit ticks' }), { target: { value: '2000' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Position stop ticks' }), { target: { value: '800' } })

    expect(onChange).toHaveBeenCalledWith({ positionAccountSize: 2500 })
    expect(onChange).toHaveBeenCalledWith({ positionRiskMode: 'cash' })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ coordinates: expect.arrayContaining([expect.objectContaining({ price: 24_934.5 })]) }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ coordinates: expect.arrayContaining([expect.objectContaining({ price: 24_234.5 })]) }))
  })

  it('reverses profit and stop tick directions for Short Position', () => {
    const onChange = vi.fn()
    const shortPosition: DrawingAppearance = {
      ...longPosition,
      id: 'short-1',
      type: 'short-position',
      coordinates: [{ price: 100, bar: 10 }, { price: 110, bar: 10 }, { price: 80, bar: 30 }],
    }
    render(<Harness initial={shortPosition} onChange={onChange} />)

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Position profit ticks' }), { target: { value: '60' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Position stop ticks' }), { target: { value: '20' } })

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ coordinates: expect.arrayContaining([expect.objectContaining({ price: 85 })]) }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ coordinates: expect.arrayContaining([expect.objectContaining({ price: 105 })]) }))
  })

  it('live-syncs Style colors, price labels and every Stats option from unclipped popovers', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Style' }))

    fireEvent.click(screen.getByRole('button', { name: 'Position target color' }))
    const targetPalette = screen.getByRole('dialog', { name: 'Position target color palette' })
    expect(screen.getByRole('tabpanel')).not.toContainElement(targetPalette)
    fireEvent.click(within(targetPalette).getByRole('button', { name: 'Set color #ff9800' }))
    fireEvent.change(within(targetPalette).getByRole('slider', { name: 'Position target opacity' }), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Text' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Price labels' }))
    fireEvent.click(screen.getByRole('button', { name: 'Position stats' }))
    const stats = screen.getByRole('dialog', { name: 'Position stats options' })
    expect(screen.getByRole('tabpanel')).not.toContainElement(stats)
    fireEvent.click(within(stats).getByRole('checkbox', { name: 'TP PL' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Compact stats mode' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Always show stats' }))

    expect(onChange).toHaveBeenCalledWith({ positionTargetColor: '#ff9800' })
    expect(onChange).toHaveBeenCalledWith({ positionTargetOpacity: 0.45 })
    expect(onChange).toHaveBeenCalledWith({ positionPriceLabels: false })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ positionStats: expect.arrayContaining(['tp-pl']) }))
    expect(onChange).toHaveBeenCalledWith({ positionCompactStats: true })
    expect(onChange).toHaveBeenCalledWith({ positionAlwaysShowStats: true })
  })

  it('uses the shared Coordinates and Visibility panels', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Coordinates' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Point 1 bar' }), { target: { value: '105' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Visibility' }))
    expect(screen.getByRole('dialog', { name: 'Edit long-position drawing' })).toHaveClass('sm:w-[28.5rem]')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Minutes' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ coordinates: expect.arrayContaining([expect.objectContaining({ bar: 105 })]) }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ visibility: expect.objectContaining({ minutes: expect.objectContaining({ enabled: false }) }) }))
  })
})
