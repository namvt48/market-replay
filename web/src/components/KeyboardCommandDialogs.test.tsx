import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useUiStore } from '../store/ui-store'
import { KeyboardCommandDialogs } from './KeyboardCommandDialogs'

describe('KeyboardCommandDialogs', () => {
  it('shows supported, adapted and unavailable TradingView shortcuts in one searchable dialog', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<KeyboardCommandDialogs state={{ type: 'shortcuts' }} onClose={onClose} />)

    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    expect(screen.getByText('Quick symbol search')).toBeInTheDocument()
    expect(screen.getByText('Indicators are not implemented yet.')).toBeInTheDocument()
    expect(screen.getAllByText('ADAPTED').length).toBeGreaterThan(0)

    await user.type(screen.getByRole('textbox', { name: 'Search shortcuts' }), 'market')
    expect(screen.getByText('Buy market')).toBeInTheDocument()
    expect(screen.queryByText('Quick symbol search')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close Keyboard shortcuts' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('focuses interval entry and applies a typed-minute shortcut with Enter', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    useUiStore.setState({ activeTf: '1m' })
    render(<KeyboardCommandDialogs state={{ type: 'interval', query: '5' }} onClose={onClose} />)

    expect(screen.getByRole('textbox', { name: 'Interval' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(useUiStore.getState().activeTf).toBe('5m')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
