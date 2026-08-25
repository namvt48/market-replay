import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DRAWING_METADATA, type DrawingAppearance, type DrawingAppearancePatch } from '../../replay/drawing-appearance'
import { TextDrawingInspector } from './TextDrawingInspector'

const TEXT_FONT_SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 40] as const

const drawing: DrawingAppearance = {
  ...DEFAULT_DRAWING_METADATA,
  id: 'text-1',
  type: 'text-annotation',
  textColor: '#2962ff',
  fontSize: 14,
  horizontalAlign: 'left',
  lineWidth: 1,
  extendLeft: false,
  extendRight: false,
  supportsExtend: false,
  coordinates: [{ price: 100, bar: 10 }],
}

function Harness({ initial = drawing, onChange = () => undefined, onDelete = () => undefined }: { initial?: DrawingAppearance; onChange?: (patch: DrawingAppearancePatch) => void; onDelete?: () => void }) {
  const [current, setCurrent] = useState(initial)
  const update = (patch: DrawingAppearancePatch): void => {
    onChange(patch)
    setCurrent((value) => ({ ...value, ...patch }))
  }
  return <TextDrawingInspector drawing={current} templates={[]} templateError={null} onChange={update} onDelete={onDelete} onDeleteTemplate={() => undefined} onClose={() => undefined} />
}

afterEach(cleanup)

describe('TextDrawingInspector', () => {
  it('matches the dedicated Text and Visibility format', () => {
    render(<Harness />)

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Text', 'Visibility'])
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveAttribute('placeholder', 'Add text')
    expect(screen.getByRole('combobox', { name: 'Font size' }).querySelectorAll('option')).toHaveLength(TEXT_FONT_SIZES.length)
    expect(Array.from(screen.getByRole('combobox', { name: 'Font size' }).querySelectorAll('option')).map((option) => option.textContent)).toEqual(TEXT_FONT_SIZES.map(String))
    expect(screen.getByRole('checkbox', { name: 'Background' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Border' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Text wrap' })).not.toBeChecked()
  })

  it('live-syncs text appearance and display toggles', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)

    await user.type(screen.getByRole('textbox', { name: 'Text' }), 'Breakout')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Font size' }), '24')
    await user.click(screen.getByRole('button', { name: 'Bold text' }))
    await user.click(screen.getByRole('button', { name: 'Italic text' }))
    await user.click(screen.getByRole('checkbox', { name: 'Background' }))
    await user.click(screen.getByRole('checkbox', { name: 'Border' }))
    await user.click(screen.getByRole('checkbox', { name: 'Text wrap' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Visibility' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Minutes' }))

    expect(onChange).toHaveBeenCalledWith({ text: 'Breakout' })
    expect(onChange).toHaveBeenCalledWith({ fontSize: 24 })
    expect(onChange).toHaveBeenCalledWith({ bold: true })
    expect(onChange).toHaveBeenCalledWith({ italic: true })
    expect(onChange).toHaveBeenCalledWith({ textBackgroundVisible: true })
    expect(onChange).toHaveBeenCalledWith({ textBorderVisible: true })
    expect(onChange).toHaveBeenCalledWith({ textWrap: true })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ visibility: expect.objectContaining({ minutes: expect.objectContaining({ enabled: false }) }) }))
  })

  it('deletes whitespace-only Text when the inspector closes', async () => {
    const onDelete = vi.fn()
    const user = userEvent.setup()
    render(<Harness initial={{ ...drawing, text: '   ' }} onDelete={onDelete} />)

    await user.click(screen.getByRole('button', { name: 'Ok' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
