import { afterEach, describe, expect, it, vi } from 'vitest'
import { openChartPopout } from './chart-popout'

afterEach(() => {
  vi.restoreAllMocks()
  document.head.querySelectorAll('[data-popout-test]').forEach((node) => node.remove())
})

describe('chart pop-out window', () => {
  it('creates a styled same-origin document for the detached chart portal', () => {
    const style = document.createElement('style')
    style.dataset.popoutTest = 'true'
    style.textContent = '.popout-test { color: white; }'
    document.head.append(style)

    const popupDocument = document.implementation.createHTMLDocument('')
    const popup = Object.create(window) as Window
    const focus = vi.fn()
    Object.defineProperty(popup, 'document', { configurable: true, value: popupDocument })
    Object.defineProperty(popup, 'focus', { configurable: true, value: focus })
    const open = vi.spyOn(window, 'open').mockReturnValue(popup)

    const target = openChartPopout('pane-2', 'NQ · 5m')

    expect(open).toHaveBeenCalledWith('', 'market-replay-pane-2', expect.stringContaining('popup=yes'))
    expect(target?.window).toBe(popup)
    expect(target?.root).toBe(popupDocument.getElementById('market-replay-popout-root'))
    expect(popupDocument.title).toBe('NQ · 5m — Market Replay')
    expect(popupDocument.head.querySelector('style')?.textContent).toContain('.popout-test')
    expect(focus).toHaveBeenCalledOnce()
  })

  it('returns null when the browser blocks the new window', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    expect(openChartPopout('pane-1', 'NQ · 1m')).toBeNull()
  })
})
