import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LayoutNode } from '../../chart-workspace/types'
import { ResizableChartLayout } from './ResizableChartLayout'

afterEach(cleanup)

const node: LayoutNode = { kind: 'split', id: 'root', orientation: 'horizontal', ratio: 0.5, first: { kind: 'pane', paneId: 'a' }, second: { kind: 'pane', paneId: 'b' } }

describe('ResizableChartLayout', () => {
  it('exposes separator semantics and keyboard resizing', async () => {
    const user = userEvent.setup()
    const onResize = vi.fn()
    render(<ResizableChartLayout node={node} renderPane={(id) => <div>{id}</div>} onResize={onResize} />)
    const separator = screen.getByRole('separator', { name: 'Resize horizontal chart split' })
    expect(separator).toHaveAttribute('aria-orientation', 'vertical')
    expect(separator).toHaveAttribute('aria-valuenow', '50')
    separator.focus()
    await user.keyboard('{ArrowRight}')
    expect(onResize).toHaveBeenCalledWith('root', 0.52, 0)
    await user.keyboard('{Home}')
    expect(onResize).toHaveBeenLastCalledWith('root', 0, 0)
  })
})
