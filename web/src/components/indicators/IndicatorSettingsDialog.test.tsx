import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActiveIndicator, IndicatorDescriptor } from '../../api/types'
import { IndicatorSettingsDialog } from './IndicatorSettingsDialog'

const descriptor: IndicatorDescriptor = {
  id: 'session-study',
  name: 'Session Study',
  version: 1,
  meta: { onMainPanel: true },
  inputs: [
    { kind: 'session', key: 'asia', label: 'Asia Session', default: '2000-0000', group: 'Schedule' },
    { kind: 'time', key: 'open', label: 'Cash Open', default: 930, group: 'Schedule' },
    { kind: 'color', key: 'color', label: 'Session Color', default: { r: 0, g: 0, b: 0, a: 0.2 }, group: 'Schedule' },
  ],
}

const indicator: ActiveIndicator = {
  id: 'session-study',
  scriptId: 'session-study',
  name: 'Session Study',
  visible: true,
  inputs: { asia: '2000-0000', open: 930, color: { r: 0, g: 0, b: 0, a: 0.2 } },
}

afterEach(cleanup)

describe('IndicatorSettingsDialog', () => {
  it('edits session, clock and color values using purpose-built controls', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<IndicatorSettingsDialog indicator={indicator} descriptor={descriptor} onApply={onApply} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Asia Session start'), { target: { value: '21:30' } })
    fireEvent.change(screen.getByLabelText('Cash Open'), { target: { value: '09:45' } })
    fireEvent.change(screen.getByLabelText('Session Color hex'), { target: { value: '#112233' } })
    fireEvent.change(screen.getByLabelText('Session Color opacity'), { target: { value: '40' } })
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).toHaveBeenCalledWith({
      asia: '2130-0000',
      open: 945,
      color: { r: 17, g: 34, b: 51, a: 0.4 },
    })
  })
})
