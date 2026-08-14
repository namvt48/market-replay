import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getEvalState, useEvalStore } from '../store/eval-store'
import { useEvalSession } from './use-eval-session'

describe('useEvalSession', () => {
  beforeEach(() => getEvalState().abandon())

  it('does not render again when an unselected eval field changes', () => {
    let renders = 0
    function PhaseProbe(): React.ReactNode {
      const selection = useEvalSession((session) => ({ phase: session.phase, accountId: session.accountId }))
      renders += 1
      return <span>{selection.phase}:{selection.accountId ?? 'none'}</span>
    }

    render(<PhaseProbe />)
    expect(renders).toBe(1)

    act(() => useEvalStore.setState({ lastEvalBalance: 12345 }))

    expect(renders).toBe(1)
  })
})
