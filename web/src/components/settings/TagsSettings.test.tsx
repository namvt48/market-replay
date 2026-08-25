import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useReviewStore } from '../../store/review-store'
import { TagsSettings } from './TagsSettings'

describe('TagsSettings', () => {
  beforeEach(() => {
    useReviewStore.setState({ tagGroups: [{ id: 'setup', name: 'Setup', tags: [{ id: 'breakout', name: 'Breakout', color: 'blue' }] }] })
  })

  it('opens a named color palette and applies the selected color', async () => {
    const user = userEvent.setup()
    render(<TagsSettings />)

    await user.click(screen.getByRole('button', { name: 'Choose Breakout color' }))
    expect(screen.getByRole('dialog', { name: 'Color for Breakout' })).toBeVisible()
    await user.click(screen.getByRole('radio', { name: 'Red' }))

    expect(useReviewStore.getState().tagGroups[0]?.tags[0]?.color).toBe('red')
    expect(screen.queryByRole('dialog', { name: 'Color for Breakout' })).not.toBeInTheDocument()
  })
})
