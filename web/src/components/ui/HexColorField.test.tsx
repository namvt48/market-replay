import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HexColorField } from './HexColorField'

afterEach(cleanup)

describe('HexColorField', () => {
  it('normalizes shorthand hex on Enter', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<HexColorField label="Background" value="#131722" onChange={onChange} />)
    const input = screen.getByLabelText('Background hex code')
    await user.clear(input)
    await user.type(input, '#abc{Enter}')
    expect(onChange).toHaveBeenCalledWith('#aabbcc')
    expect(input).toHaveValue('#aabbcc')
  })

  it('commits a pasted full hex value on blur', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<HexColorField label="Wick up" value="#089981" onChange={onChange} />)
    const input = screen.getByLabelText('Wick up hex code')
    await user.clear(input)
    await user.type(input, '#A1B2C3')
    await user.tab()
    expect(onChange).toHaveBeenCalledWith('#a1b2c3')
  })

  it('rolls invalid input back and exposes an accessible error', async () => {
    const user = userEvent.setup()
    render(<HexColorField label="Grid" value="#2a2e39" onChange={vi.fn()} />)
    const input = screen.getByLabelText('Grid hex code')
    await user.clear(input)
    await user.type(input, 'blue')
    await user.tab()
    expect(input).toHaveValue('#2a2e39')
    expect(screen.getByRole('alert')).toHaveTextContent('#RGB or #RRGGBB')
  })

  it('updates from the native color picker', () => {
    const onChange = vi.fn()
    render(<HexColorField label="Body up" value="#089981" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Body up picker'), { target: { value: '#123456' } })
    expect(onChange).toHaveBeenCalledWith('#123456')
  })
})
