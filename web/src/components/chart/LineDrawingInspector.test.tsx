import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DRAWING_METADATA, type DrawingAppearance } from '../../replay/drawing-appearance'
import { defaultDrawingTemplateAppearance, type DrawingTemplate } from '../../replay/drawing-templates'
import { LineDrawingInspector } from './LineDrawingInspector'

afterEach(cleanup)

const drawing: DrawingAppearance = {
  ...DEFAULT_DRAWING_METADATA,
  id: 'line-1',
  type: 'trend-line',
  locked: false,
  lineWidth: 2,
  extendLeft: false,
  extendRight: false,
  supportsExtend: true,
  coordinates: [{ price: 25091.75, bar: 105 }, { price: 25232.5, bar: 175 }],
}

function renderInspector(onChange = vi.fn(), onClose = vi.fn(), templates: DrawingTemplate[] = [], onDeleteTemplate = vi.fn()) {
  return {
    onChange,
    onClose,
    onDeleteTemplate,
    ...render(<LineDrawingInspector drawing={drawing} drawingName="Trend Line" templates={templates} templateError={null} onChange={onChange} onDeleteTemplate={onDeleteTemplate} onClose={onClose} />),
  }
}

describe('LineDrawingInspector', () => {
  it('matches the requested four-tab line property structure without Info controls', () => {
    renderInspector()

    expect(screen.getByRole('dialog', { name: 'Edit trend-line drawing' })).toHaveTextContent('Trend Line')
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Style', 'Text', 'Coordinates', 'Visibility'])
    expect(screen.getByRole('button', { name: 'Line appearance' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start line endpoint' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End line endpoint' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Line extension' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Middle point' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Price labels' })).toBeInTheDocument()
    expect(screen.queryByText('Info')).not.toBeInTheDocument()
    expect(screen.queryByText('Stats')).not.toBeInTheDocument()
  })

  it('syncs property edits immediately without waiting for Ok', async () => {
    const user = userEvent.setup()
    const first = renderInspector()

    await user.click(screen.getByRole('checkbox', { name: 'Middle point' }))
    expect(first.onChange).toHaveBeenCalledWith({ showMiddlePoint: true })

    await user.click(screen.getByRole('button', { name: 'Ok' }))
    expect(first.onClose).toHaveBeenCalledOnce()
  })

  it('can be dragged from its title bar', () => {
    renderInspector()
    const dialog = screen.getByRole('dialog', { name: 'Edit trend-line drawing' })
    const handle = screen.getByRole('button', { name: 'Move drawing properties' })
    const initialTransform = dialog.style.transform

    fireEvent.pointerDown(handle, { button: 0, isPrimary: true, pointerId: 7, clientX: 500, clientY: 220 })
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 620, clientY: 300 })
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 620, clientY: 300 })

    expect(dialog.style.transform).not.toBe(initialTransform)
  })

  it('live-syncs every Style control', async () => {
    const user = userEvent.setup()
    const view = renderInspector()

    await user.click(screen.getByRole('button', { name: 'Line appearance' }))
    await user.click(screen.getByRole('button', { name: 'Set color #f23645' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Line opacity' }), { target: { value: '45' } })
    await user.click(screen.getByRole('button', { name: '4px' }))
    await user.click(screen.getByRole('button', { name: 'dashed line' }))
    await user.click(screen.getByRole('button', { name: 'Start line endpoint' }))
    await user.click(within(screen.getByRole('menu', { name: 'start endpoint menu' })).getByRole('menuitemradio', { name: /arrow/i }))
    await user.click(screen.getByRole('button', { name: 'Line extension' }))
    await user.click(screen.getByRole('checkbox', { name: 'Extend left line' }))
    await user.click(screen.getByRole('checkbox', { name: 'Middle point' }))
    await user.click(screen.getByRole('checkbox', { name: 'Price labels' }))

    expect(view.onChange).toHaveBeenCalledWith({ strokeColor: '#f23645' })
    expect(view.onChange).toHaveBeenCalledWith({ strokeOpacity: 0.45 })
    expect(view.onChange).toHaveBeenCalledWith({ lineWidth: 4 })
    expect(view.onChange).toHaveBeenCalledWith({ borderStyle: 'dashed' })
    expect(view.onChange).toHaveBeenCalledWith({ lineStartStyle: 'arrow' })
    expect(view.onChange).toHaveBeenCalledWith({ extendLeft: true })
    expect(view.onChange).toHaveBeenCalledWith({ showMiddlePoint: true })
    expect(view.onChange).toHaveBeenCalledWith({ showPriceLabels: true })
  })

  it('live-syncs every Text control', async () => {
    const user = userEvent.setup()
    const view = renderInspector()
    await user.click(screen.getByRole('tab', { name: 'Text' }))
    await user.click(screen.getByRole('button', { name: 'Text color' }))
    await user.click(screen.getByRole('button', { name: 'Set color #ff9800' }))
    await user.click(screen.getByRole('button', { name: 'Text color' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Text opacity' }), { target: { value: '60' } })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Font size' }), '16')
    await user.click(screen.getByRole('button', { name: 'Bold text' }))
    await user.click(screen.getByRole('button', { name: 'Italic text' }))
    await user.type(screen.getByRole('textbox', { name: 'Drawing text' }), 'Live')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Vertical text alignment' }), 'bottom')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Horizontal text alignment' }), 'right')

    expect(view.onChange).toHaveBeenCalledWith({ textColor: '#ff9800' })
    expect(view.onChange).toHaveBeenCalledWith({ textOpacity: 0.6 })
    expect(view.onChange).toHaveBeenCalledWith({ fontSize: 16 })
    expect(view.onChange).toHaveBeenCalledWith({ bold: true })
    expect(view.onChange).toHaveBeenCalledWith({ italic: true })
    expect(view.onChange).toHaveBeenCalledWith({ text: 'Live' })
    expect(view.onChange).toHaveBeenCalledWith({ verticalAlign: 'bottom' })
    expect(view.onChange).toHaveBeenCalledWith({ horizontalAlign: 'right' })
  })

  it('closes the text color palette as soon as a color is selected', async () => {
    const user = userEvent.setup()
    renderInspector()

    await user.click(screen.getByRole('tab', { name: 'Text' }))
    await user.click(screen.getByRole('button', { name: 'Text color' }))
    await user.click(screen.getByRole('button', { name: 'Set color #ff9800' }))

    expect(screen.queryByRole('button', { name: 'Set color #ff9800' })).not.toBeInTheDocument()
  })

  it('live-syncs coordinate and visibility fields and ranges', async () => {
    const user = userEvent.setup()
    const view = renderInspector()
    await user.click(screen.getByRole('tab', { name: 'Coordinates' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Point 1 price' }), { target: { value: '25100.25' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Point 2 bar' }), { target: { value: '180' } })
    expect(view.onChange).toHaveBeenCalledWith({ coordinates: [{ price: 25100.25, bar: 105 }, { price: 25232.5, bar: 175 }] })
    expect(view.onChange).toHaveBeenCalledWith({ coordinates: [{ price: 25100.25, bar: 105 }, { price: 25232.5, bar: 180 }] })

    await user.click(screen.getByRole('tab', { name: 'Visibility' }))
    await user.click(screen.getByRole('checkbox', { name: 'Minutes' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minutes minimum' }), { target: { value: '5' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minutes maximum' }), { target: { value: '30' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Hours minimum range' }), { target: { value: '2' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Hours maximum range' }), { target: { value: '12' } })

    expect(view.onChange).toHaveBeenCalledWith({ visibility: expect.objectContaining({ minutes: { enabled: false, min: 1, max: 59 } }) })
    expect(view.onChange).toHaveBeenCalledWith({ visibility: expect.objectContaining({ minutes: { enabled: false, min: 5, max: 30 } }) })
    expect(view.onChange).toHaveBeenCalledWith({ visibility: expect.objectContaining({ hours: { enabled: true, min: 2, max: 12 } }) })
  })

  it('live-syncs default and named templates and can delete a template', async () => {
    const user = userEvent.setup()
    const template: DrawingTemplate = {
      id: 'template-1',
      name: 'Breakout',
      toolType: 'trend-line',
      appearance: { ...defaultDrawingTemplateAppearance(drawing), lineWidth: 4, strokeColor: '#f23645' },
      createdAt: 1,
      updatedAt: 1,
    }
    const view = renderInspector(vi.fn(), vi.fn(), [template])

    await user.click(screen.getByRole('button', { name: 'Drawing template' }))
    await user.click(screen.getByRole('menuitem', { name: 'Default' }))
    expect(view.onChange).toHaveBeenCalledWith(defaultDrawingTemplateAppearance(drawing))

    await user.click(screen.getByRole('button', { name: 'Drawing template' }))
    await user.click(screen.getByRole('menuitem', { name: 'Breakout' }))
    expect(view.onChange).toHaveBeenCalledWith(expect.objectContaining({ lineWidth: 4, strokeColor: '#f23645' }))

    await user.click(screen.getByRole('button', { name: 'Drawing template' }))
    await user.click(screen.getByRole('button', { name: 'Delete Breakout template' }))
    expect(view.onDeleteTemplate).toHaveBeenCalledWith('template-1')
  })

  it('edits text, coordinates, endpoint arrows, extension and visibility', async () => {
    const user = userEvent.setup()
    const view = renderInspector()

    await user.click(screen.getByRole('button', { name: 'End line endpoint' }))
    await user.click(within(screen.getByRole('menu', { name: 'end endpoint menu' })).getByRole('menuitemradio', { name: /arrow/i }))
    await user.click(screen.getByRole('button', { name: 'Line extension' }))
    await user.click(screen.getByRole('checkbox', { name: 'Extend right line' }))

    await user.click(screen.getByRole('tab', { name: 'Text' }))
    await user.type(screen.getByRole('textbox', { name: 'Drawing text' }), 'Breakout')
    await user.click(screen.getByRole('button', { name: 'Bold text' }))

    await user.click(screen.getByRole('tab', { name: 'Coordinates' }))
    const price = screen.getByRole('spinbutton', { name: 'Point 1 price' })
    await user.clear(price)
    await user.type(price, '25100')

    await user.click(screen.getByRole('tab', { name: 'Visibility' }))
    await user.click(screen.getByRole('checkbox', { name: 'Seconds' }))
    await user.click(screen.getByRole('button', { name: 'Ok' }))

    expect(view.onChange).toHaveBeenCalledWith({ lineEndStyle: 'arrow' })
    expect(view.onChange).toHaveBeenCalledWith({ extendRight: true })
    expect(view.onChange).toHaveBeenCalledWith({ text: 'Breakout' })
    expect(view.onChange).toHaveBeenCalledWith({ bold: true })
    expect(view.onChange).toHaveBeenCalledWith({ coordinates: expect.arrayContaining([expect.objectContaining({ price: 25100, bar: 105 })]) })
    expect(view.onChange).toHaveBeenCalledWith({ visibility: expect.objectContaining({ seconds: expect.objectContaining({ enabled: false }) }) })
  })
})
