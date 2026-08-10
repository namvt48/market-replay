import { describe, expect, it } from 'vitest'
import { ReplaySelectionPrimitive } from './replay-selection-primitive'

describe('ReplaySelectionPrimitive', () => {
  it('keeps the selection guide while omitting the active replay-start line', () => {
    const primitive = new ReplaySelectionPrimitive()

    primitive.setState({ mode: 'selecting' })
    primitive.setPreview(120, 'Jan 02, 09:30')
    expect(primitive.visual()).toMatchObject({ selecting: true, lineVisible: true })

    primitive.setState({ mode: 'active', timestamp: 120 })
    expect(primitive.visual()).toMatchObject({ selecting: false, lineVisible: false })
  })
})
