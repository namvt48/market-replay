import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CHART_PANE_SETTINGS } from '../../replay/chart-settings-store'
import { ChartSettingsDialog } from './ChartSettingsDialog'

afterEach(cleanup)

describe('ChartSettingsDialog', () => {
  it('provides a picker and editable hex input for every color setting', () => {
    render(<ChartSettingsDialog value={DEFAULT_CHART_PANE_SETTINGS} onPreview={vi.fn()} onApply={vi.fn()} onCancel={vi.fn()} />)
    const labels = ['Body up', 'Body down', 'Wick up', 'Wick down', 'Border up', 'Border down', 'Background', 'Price & time text', 'Vertical grid', 'Horizontal grid']
    for (const label of labels) {
      expect(screen.getByLabelText(`${label} picker`)).toBeInTheDocument()
      expect(screen.getByLabelText(`${label} hex code`)).toBeInTheDocument()
    }
  })

  it('live-previews toggles and applies the resulting draft', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    const onApply = vi.fn()
    render(<ChartSettingsDialog value={DEFAULT_CHART_PANE_SETTINGS} onPreview={onPreview} onApply={onApply} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('checkbox', { name: 'Show grid' }))
    await user.click(screen.getByRole('checkbox', { name: 'Show volume' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onPreview).toHaveBeenCalled()
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ showGrid: false, showVolume: false }) }))
  })

  it('keeps global timezone controls out of per-chart settings and preserves the timezone on reset', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    const value = { ...DEFAULT_CHART_PANE_SETTINGS, timezone: { kind: 'preset', id: 'PT' } as const }
    render(<ChartSettingsDialog value={value} onPreview={onPreview} onApply={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText('Timezone')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Fixed UTC offset')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ timezone: { kind: 'preset', id: 'PT' } }))
  })

  it('resets the draft and cancels with Escape', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    const onCancel = vi.fn()
    const value = { ...DEFAULT_CHART_PANE_SETTINGS, appearance: { ...DEFAULT_CHART_PANE_SETTINGS.appearance, backgroundColor: '#ffffff' } }
    render(<ChartSettingsDialog value={value} onPreview={onPreview} onApply={vi.fn()} onCancel={onCancel} />)
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onPreview).toHaveBeenLastCalledWith(DEFAULT_CHART_PANE_SETTINGS)
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })
})
