import { describe, expect, it } from 'vitest'
import { resolveHotkey, TRADINGVIEW_SHORTCUTS, type HotkeyCommand } from './tradingview-shortcuts'

interface ShortcutInput {
  key: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

function shortcut(input: ShortcutInput): HotkeyCommand | null {
  return resolveHotkey({
    key: input.key,
    altKey: input.altKey ?? false,
    ctrlKey: input.ctrlKey ?? false,
    metaKey: input.metaKey ?? false,
    shiftKey: input.shiftKey ?? false,
  })
}

interface ResolverCase {
  label: string
  input: ShortcutInput
  command: HotkeyCommand
}

const RESOLVER_CASES: readonly ResolverCase[] = [
  { label: 'question mark opens shortcut help', input: { key: '?', shiftKey: true }, command: 'open-shortcut-help' },
  { label: 'Shift+slash opens shortcut help', input: { key: '/', shiftKey: true }, command: 'open-shortcut-help' },
  { label: 'Ctrl+K opens symbol search', input: { key: 'k', ctrlKey: true }, command: 'open-symbol-search' },
  { label: 'comma opens interval search', input: { key: ',' }, command: 'open-interval-search' },
  { label: 'period opens layouts', input: { key: '.' }, command: 'open-layouts' },
  { label: 'Ctrl+S saves layout', input: { key: 's', ctrlKey: true }, command: 'save-layout' },
  { label: 'Ctrl+Z undoes drawing', input: { key: 'z', ctrlKey: true }, command: 'undo-drawing' },
  { label: 'Ctrl+Y redoes drawing', input: { key: 'y', ctrlKey: true }, command: 'redo-drawing' },
  { label: 'Ctrl+Shift+Z redoes drawing', input: { key: 'z', ctrlKey: true, shiftKey: true }, command: 'redo-drawing' },
  { label: 'left pans one bar', input: { key: 'ArrowLeft' }, command: 'pan-left' },
  { label: 'right pans one bar', input: { key: 'ArrowRight' }, command: 'pan-right' },
  { label: 'Ctrl+left pans farther', input: { key: 'ArrowLeft', ctrlKey: true }, command: 'pan-left-far' },
  { label: 'Ctrl+right pans farther', input: { key: 'ArrowRight', ctrlKey: true }, command: 'pan-right-far' },
  { label: 'Ctrl+up zooms in', input: { key: 'ArrowUp', ctrlKey: true }, command: 'zoom-in' },
  { label: 'Ctrl+down zooms out', input: { key: 'ArrowDown', ctrlKey: true }, command: 'zoom-out' },
  { label: 'Alt+G opens date navigation', input: { key: 'g', altKey: true }, command: 'go-to-date' },
  { label: 'Alt+S saves snapshot', input: { key: 's', altKey: true }, command: 'snapshot' },
  { label: 'Alt+R resets chart', input: { key: 'r', altKey: true }, command: 'reset-chart' },
  { label: 'Alt+I inverts scale', input: { key: 'i', altKey: true }, command: 'invert-scale' },
  { label: 'Alt+L toggles log scale', input: { key: 'l', altKey: true }, command: 'toggle-log-scale' },
  { label: 'Alt+P toggles percent scale', input: { key: 'p', altKey: true }, command: 'toggle-percent-scale' },
  { label: 'Alt+Z focuses chart', input: { key: 'z', altKey: true }, command: 'focus-chart' },
  { label: 'Tab activates next chart', input: { key: 'Tab' }, command: 'next-chart' },
  { label: 'Shift+Tab activates previous chart', input: { key: 'Tab', shiftKey: true }, command: 'previous-chart' },
  { label: 'Alt+Enter maximizes chart', input: { key: 'Enter', altKey: true }, command: 'toggle-maximize' },
  { label: 'Ctrl+C copies drawing', input: { key: 'c', ctrlKey: true }, command: 'copy-drawing' },
  { label: 'Ctrl+V pastes drawing', input: { key: 'v', ctrlKey: true }, command: 'paste-drawing' },
  { label: 'Ctrl+Alt+H hides drawings', input: { key: 'h', ctrlKey: true, altKey: true }, command: 'hide-drawings' },
  { label: 'Alt+T selects trend line', input: { key: 't', altKey: true }, command: 'draw-trend-line' },
  { label: 'Alt+H selects horizontal line', input: { key: 'h', altKey: true }, command: 'draw-horizontal-line' },
  { label: 'Alt+V selects vertical line', input: { key: 'v', altKey: true }, command: 'draw-vertical-line' },
  { label: 'Alt+F selects Fibonacci', input: { key: 'f', altKey: true }, command: 'draw-fib-retracement' },
  { label: 'Alt+Shift+R selects rectangle', input: { key: 'r', altKey: true, shiftKey: true }, command: 'draw-rectangle' },
  { label: 'Delete removes drawing', input: { key: 'Delete' }, command: 'delete-drawing' },
  { label: 'Backspace removes drawing', input: { key: 'Backspace' }, command: 'delete-drawing' },
  { label: 'Escape cancels current action', input: { key: 'Escape' }, command: 'cancel' },
  { label: 'Ctrl+Shift+B places market buy', input: { key: 'b', ctrlKey: true, shiftKey: true }, command: 'market-buy' },
  { label: 'Ctrl+Shift+S places market sell', input: { key: 's', ctrlKey: true, shiftKey: true }, command: 'market-sell' },
  { label: 'Shift+B opens limit buy', input: { key: 'b', shiftKey: true }, command: 'limit-buy' },
  { label: 'Shift+S opens limit sell', input: { key: 's', shiftKey: true }, command: 'limit-sell' },
  { label: 'Space toggles replay', input: { key: ' ' }, command: 'toggle-replay' },
  { label: 'Shift+left steps replay back', input: { key: 'ArrowLeft', shiftKey: true }, command: 'replay-step-back' },
  { label: 'Shift+right steps replay forward', input: { key: 'ArrowRight', shiftKey: true }, command: 'replay-step-forward' },
  { label: 'Ctrl+Shift+left seeks previous day', input: { key: 'ArrowLeft', ctrlKey: true, shiftKey: true }, command: 'replay-day-back' },
  { label: 'Ctrl+Shift+right seeks next day', input: { key: 'ArrowRight', ctrlKey: true, shiftKey: true }, command: 'replay-day-forward' },
  { label: 'left bracket decreases speed', input: { key: '[' }, command: 'speed-down' },
  { label: 'right bracket increases speed', input: { key: ']' }, command: 'speed-up' },
  { label: 'Shift+F flattens position', input: { key: 'f', shiftKey: true }, command: 'flatten' },
  { label: 'Shift+R reverses position', input: { key: 'r', shiftKey: true }, command: 'reverse' },
  { label: 'Shift+A toggles drawing scope', input: { key: 'a', shiftKey: true }, command: 'toggle-drawing-scope' },
]

const ALL_HOTKEY_COMMANDS: Record<HotkeyCommand, true> = {
  'open-symbol-search': true, 'open-interval-search': true, 'open-layouts': true, 'save-layout': true,
  'undo-drawing': true, 'redo-drawing': true, 'pan-left': true, 'pan-right': true,
  'pan-left-far': true, 'pan-right-far': true, 'zoom-in': true, 'zoom-out': true,
  'go-to-date': true, snapshot: true, 'reset-chart': true, 'invert-scale': true,
  'toggle-log-scale': true, 'toggle-percent-scale': true, 'focus-chart': true, 'next-chart': true,
  'previous-chart': true, 'toggle-maximize': true, 'copy-drawing': true, 'paste-drawing': true,
  'hide-drawings': true, 'draw-trend-line': true, 'draw-horizontal-line': true, 'draw-vertical-line': true,
  'draw-fib-retracement': true, 'draw-rectangle': true, 'delete-drawing': true, cancel: true,
  'market-buy': true, 'market-sell': true, 'limit-buy': true, 'limit-sell': true,
  'toggle-replay': true, 'replay-step-back': true, 'replay-step-forward': true, 'replay-day-back': true,
  'replay-day-forward': true, 'speed-down': true, 'speed-up': true, flatten: true,
  reverse: true, 'toggle-drawing-scope': true, 'open-shortcut-help': true,
}

describe('TradingView shortcut resolver', () => {
  it.each(RESOLVER_CASES)('$label', ({ input, command }) => {
    expect(shortcut(input)).toBe(command)
  })

  it('has a resolver case for every executable hotkey command', () => {
    expect([...new Set(RESOLVER_CASES.map(({ command }) => command))].sort()).toEqual(Object.keys(ALL_HOTKEY_COMMANDS).sort())
  })

  it('keeps unmodified letters and digits free for symbol and interval typing', () => {
    expect(shortcut({ key: 'b' })).toBeNull()
    expect(shortcut({ key: 's' })).toBeNull()
    expect(shortcut({ key: '5' })).toBeNull()
  })

  it('maps Shift for limit tickets and Ctrl/Shift for market orders', () => {
    expect(shortcut({ key: 'b', shiftKey: true })).toBe('limit-buy')
    expect(shortcut({ key: 'S', shiftKey: true })).toBe('limit-sell')
    expect(shortcut({ key: 'b', ctrlKey: true, shiftKey: true })).toBe('market-buy')
    expect(shortcut({ key: 'S', ctrlKey: true, shiftKey: true })).toBe('market-sell')
    expect(shortcut({ key: 'S', ctrlKey: true })).toBe('save-layout')
  })

  it('maps chart navigation, scale and drawing shortcuts without modifier collisions', () => {
    expect(shortcut({ key: 'ArrowLeft' })).toBe('pan-left')
    expect(shortcut({ key: 'ArrowLeft', ctrlKey: true })).toBe('pan-left-far')
    expect(shortcut({ key: 'ArrowUp', ctrlKey: true })).toBe('zoom-in')
    expect(shortcut({ key: 'r', altKey: true })).toBe('reset-chart')
    expect(shortcut({ key: 'r', altKey: true, shiftKey: true })).toBe('draw-rectangle')
    expect(shortcut({ key: 'h', altKey: true })).toBe('draw-horizontal-line')
    expect(shortcut({ key: 'h', altKey: true, ctrlKey: true })).toBe('hide-drawings')
  })

  it('supports Command on macOS wherever TradingView documents Ctrl/Command', () => {
    expect(shortcut({ key: 'k', metaKey: true })).toBe('open-symbol-search')
    expect(shortcut({ key: 'z', metaKey: true })).toBe('undo-drawing')
    expect(shortcut({ key: 'z', metaKey: true, shiftKey: true })).toBe('redo-drawing')
  })

  it('does not steal modified question-mark combinations', () => {
    expect(shortcut({ key: '?', ctrlKey: true, shiftKey: true })).toBeNull()
    expect(shortcut({ key: '?', altKey: true, shiftKey: true })).toBeNull()
    expect(shortcut({ key: '?', shiftKey: true })).toBe('open-shortcut-help')
  })

  it('contains an explicit support decision for every documented row', () => {
    expect(TRADINGVIEW_SHORTCUTS.length).toBeGreaterThan(50)
    expect(TRADINGVIEW_SHORTCUTS.every((entry) => ['supported', 'adapted', 'unavailable'].includes(entry.support))).toBe(true)
    expect(TRADINGVIEW_SHORTCUTS.some((entry) => entry.id === 'indicators' && entry.support === 'unavailable')).toBe(true)
    expect(TRADINGVIEW_SHORTCUTS.some((entry) => entry.id === 'buy-market' && entry.support === 'supported')).toBe(true)
  })
})
