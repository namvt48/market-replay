export type ShortcutSupport = 'supported' | 'adapted' | 'unavailable'

export type ShortcutCategory = 'Chart' | 'Drawings' | 'Multi-chart' | 'Trading' | 'Market Replay'

export interface TradingViewShortcut {
  id: string
  category: ShortcutCategory
  action: string
  keys: readonly string[]
  support: ShortcutSupport
  note?: string
}

export type HotkeyDialogState =
  | { type: 'shortcuts' }
  | { type: 'symbol'; query: string }
  | { type: 'interval'; query: string }
  | { type: 'date' }

export type HotkeyCommand =
  | 'open-symbol-search'
  | 'open-interval-search'
  | 'open-layouts'
  | 'save-layout'
  | 'undo-drawing'
  | 'redo-drawing'
  | 'pan-left'
  | 'pan-right'
  | 'pan-left-far'
  | 'pan-right-far'
  | 'zoom-in'
  | 'zoom-out'
  | 'go-to-date'
  | 'snapshot'
  | 'reset-chart'
  | 'invert-scale'
  | 'toggle-log-scale'
  | 'toggle-percent-scale'
  | 'focus-chart'
  | 'next-chart'
  | 'previous-chart'
  | 'toggle-maximize'
  | 'copy-drawing'
  | 'paste-drawing'
  | 'hide-drawings'
  | 'draw-trend-line'
  | 'draw-horizontal-line'
  | 'draw-vertical-line'
  | 'draw-fib-retracement'
  | 'draw-rectangle'
  | 'delete-drawing'
  | 'cancel'
  | 'market-buy'
  | 'market-sell'
  | 'limit-buy'
  | 'limit-sell'
  | 'toggle-replay'
  | 'replay-step-back'
  | 'replay-step-forward'
  | 'replay-day-back'
  | 'replay-day-forward'
  | 'speed-down'
  | 'speed-up'
  | 'flatten'
  | 'reverse'
  | 'toggle-drawing-scope'
  | 'open-shortcut-help'

interface KeyboardShortcutEvent {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export function resolveHotkey(event: KeyboardShortcutEvent): HotkeyCommand | null {
  const key = event.key.toLowerCase()
  const primary = event.ctrlKey || event.metaKey

  if (!primary && !event.altKey && (key === '?' || (key === '/' && event.shiftKey))) return 'open-shortcut-help'
  if (primary && !event.altKey && key === 'k') return 'open-symbol-search'
  if (!primary && !event.altKey && !event.shiftKey && key === ',') return 'open-interval-search'
  if (!primary && !event.altKey && !event.shiftKey && key === '.') return 'open-layouts'
  if (primary && !event.altKey && !event.shiftKey && key === 's') return 'save-layout'
  if (primary && !event.altKey && !event.shiftKey && key === 'z') return 'undo-drawing'
  if (primary && !event.altKey && (key === 'y' || (event.shiftKey && key === 'z'))) return 'redo-drawing'

  if (primary && !event.altKey && event.shiftKey && key === 'arrowleft') return 'replay-day-back'
  if (primary && !event.altKey && event.shiftKey && key === 'arrowright') return 'replay-day-forward'
  if (primary && !event.altKey && key === 'arrowup') return 'zoom-in'
  if (primary && !event.altKey && key === 'arrowdown') return 'zoom-out'
  if (primary && !event.altKey && key === 'arrowleft') return 'pan-left-far'
  if (primary && !event.altKey && key === 'arrowright') return 'pan-right-far'
  if (!primary && !event.altKey && !event.shiftKey && key === 'arrowleft') return 'pan-left'
  if (!primary && !event.altKey && !event.shiftKey && key === 'arrowright') return 'pan-right'

  if (event.altKey && !primary && key === 'g') return 'go-to-date'
  if (event.altKey && !primary && !event.shiftKey && key === 's') return 'snapshot'
  if (event.altKey && !primary && key === 'r' && !event.shiftKey) return 'reset-chart'
  if (event.altKey && !primary && key === 'i') return 'invert-scale'
  if (event.altKey && !primary && key === 'l') return 'toggle-log-scale'
  if (event.altKey && !primary && key === 'p') return 'toggle-percent-scale'
  if (event.altKey && !primary && key === 'z') return 'focus-chart'
  if (event.altKey && !primary && key === 'enter') return 'toggle-maximize'

  if (!primary && !event.altKey && key === 'tab') return event.shiftKey ? 'previous-chart' : 'next-chart'

  if (primary && event.altKey && key === 'h') return 'hide-drawings'
  if (primary && !event.altKey && key === 'c') return 'copy-drawing'
  if (primary && !event.altKey && key === 'v') return 'paste-drawing'
  if (event.altKey && !primary && !event.shiftKey && key === 't') return 'draw-trend-line'
  if (event.altKey && !primary && !event.shiftKey && key === 'h') return 'draw-horizontal-line'
  if (event.altKey && !primary && !event.shiftKey && key === 'v') return 'draw-vertical-line'
  if (event.altKey && !primary && !event.shiftKey && key === 'f') return 'draw-fib-retracement'
  if (event.altKey && !primary && event.shiftKey && key === 'r') return 'draw-rectangle'

  if (primary && !event.altKey && event.shiftKey && key === 'b') return 'market-buy'
  if (primary && !event.altKey && event.shiftKey && key === 's') return 'market-sell'
  if (!primary && !event.altKey && event.shiftKey && key === 'b') return 'limit-buy'
  if (!primary && !event.altKey && event.shiftKey && key === 's') return 'limit-sell'

  if (!primary && !event.altKey && !event.shiftKey && key === ' ') return 'toggle-replay'
  if (!primary && !event.altKey && event.shiftKey && key === 'arrowleft') return 'replay-step-back'
  if (!primary && !event.altKey && event.shiftKey && key === 'arrowright') return 'replay-step-forward'
  if (!primary && !event.altKey && !event.shiftKey && key === '[') return 'speed-down'
  if (!primary && !event.altKey && !event.shiftKey && key === ']') return 'speed-up'
  if (!primary && !event.altKey && event.shiftKey && key === 'f') return 'flatten'
  if (!primary && !event.altKey && event.shiftKey && key === 'r') return 'reverse'
  if (!primary && !event.altKey && event.shiftKey && key === 'a') return 'toggle-drawing-scope'
  if (!primary && !event.altKey && (key === 'delete' || key === 'backspace')) return 'delete-drawing'
  if (!primary && !event.altKey && key === 'escape') return 'cancel'
  return null
}

/**
 * TradingView Advanced Charts / Trading Platform shortcuts, mapped against
 * the capabilities Market Replay actually has. Unsupported product areas are
 * deliberately listed instead of registering a keyboard trap that does
 * nothing useful.
 */
export const TRADINGVIEW_SHORTCUTS: readonly TradingViewShortcut[] = [
  { id: 'quick-search', category: 'Chart', action: 'Quick symbol search', keys: ['Ctrl/⌘', 'K'], support: 'supported' },
  { id: 'type-symbol', category: 'Chart', action: 'Change symbol', keys: ['Type symbol'], support: 'supported' },
  { id: 'type-interval', category: 'Chart', action: 'Change interval', keys: ['Digit', 'or ,'], support: 'supported' },
  { id: 'indicators', category: 'Chart', action: 'Open indicators', keys: ['/'], support: 'unavailable', note: 'Indicators are not implemented yet.' },
  { id: 'load-layout', category: 'Chart', action: 'Open chart layouts', keys: ['.'], support: 'supported' },
  { id: 'save-layout', category: 'Chart', action: 'Save current layout', keys: ['Ctrl/⌘', 'S'], support: 'adapted', note: 'Market Replay layouts auto-save; this forces an immediate save.' },
  { id: 'undo', category: 'Chart', action: 'Undo drawing change', keys: ['Ctrl/⌘', 'Z'], support: 'supported' },
  { id: 'redo', category: 'Chart', action: 'Redo drawing change', keys: ['Ctrl/⌘', 'Y'], support: 'supported' },
  { id: 'pan-one-left', category: 'Chart', action: 'Move chart one bar left', keys: ['←'], support: 'supported' },
  { id: 'pan-one-right', category: 'Chart', action: 'Move chart one bar right', keys: ['→'], support: 'supported' },
  { id: 'pan-far-left', category: 'Chart', action: 'Move chart further left', keys: ['Ctrl/⌘', '←'], support: 'supported' },
  { id: 'pan-far-right', category: 'Chart', action: 'Move chart further right', keys: ['Ctrl/⌘', '→'], support: 'supported' },
  { id: 'wheel-pan', category: 'Chart', action: 'Horizontal pan', keys: ['Shift', 'Mouse wheel'], support: 'supported', note: 'Handled natively by the chart.' },
  { id: 'zoom-in', category: 'Chart', action: 'Zoom in', keys: ['Ctrl/⌘', '↑'], support: 'supported' },
  { id: 'zoom-out', category: 'Chart', action: 'Zoom out', keys: ['Ctrl/⌘', '↓'], support: 'supported' },
  { id: 'wheel-zoom', category: 'Chart', action: 'Zoom focused area', keys: ['Ctrl/⌘', 'Mouse wheel'], support: 'supported', note: 'Handled natively by the chart.' },
  { id: 'go-date', category: 'Chart', action: 'Go to date', keys: ['Alt/⌥', 'G'], support: 'supported' },
  { id: 'snapshot', category: 'Chart', action: 'Take chart snapshot', keys: ['Alt/⌥', 'S'], support: 'adapted', note: 'Downloads a PNG because local replay charts do not have share URLs.' },
  { id: 'reset', category: 'Chart', action: 'Reset chart', keys: ['Alt/⌥', 'R'], support: 'supported' },
  { id: 'invert', category: 'Chart', action: 'Invert price scale', keys: ['Alt/⌥', 'I'], support: 'supported' },
  { id: 'log', category: 'Chart', action: 'Toggle logarithmic scale', keys: ['Alt/⌥', 'L'], support: 'supported' },
  { id: 'percent', category: 'Chart', action: 'Toggle percentage scale', keys: ['Alt/⌥', 'P'], support: 'supported' },
  { id: 'keyboard-nav', category: 'Chart', action: 'Focus active chart', keys: ['Alt/⌥', 'Z'], support: 'adapted' },
  { id: 'collapse-pane', category: 'Chart', action: 'Collapse indicator pane', keys: ['Ctrl/⌘', 'Double-click'], support: 'unavailable', note: 'Market Replay has no indicator panes.' },

  { id: 'measure', category: 'Drawings', action: 'Temporary Measure tool', keys: ['Shift', 'Mouse down'], support: 'supported', note: 'Hold Shift for the initial mouse-down, then release it while dragging. The result stays visible until the next chart or drawing interaction.' },
  { id: 'copy-drawing', category: 'Drawings', action: 'Copy selected drawing', keys: ['Ctrl/⌘', 'C'], support: 'supported' },
  { id: 'paste-drawing', category: 'Drawings', action: 'Paste drawing', keys: ['Ctrl/⌘', 'V'], support: 'supported' },
  { id: 'hide-drawings', category: 'Drawings', action: 'Hide/show all drawings', keys: ['Ctrl/⌘', 'Alt/⌥', 'H'], support: 'supported' },
  { id: 'clone-drawing', category: 'Drawings', action: 'Clone drawing', keys: ['Ctrl/⌘', 'Drag'], support: 'supported' },
  { id: 'constrain-drawing', category: 'Drawings', action: 'Move horizontally or vertically', keys: ['Shift', 'Drag'], support: 'supported' },
  { id: 'nudge-drawing', category: 'Drawings', action: 'Move selected drawing', keys: ['Arrow keys'], support: 'supported' },
  { id: 'multi-drawing', category: 'Drawings', action: 'Select multiple drawings', keys: ['Ctrl/⌘', 'Click'], support: 'unavailable', note: 'The drawing engine currently supports one selection.' },
  { id: 'magnet', category: 'Drawings', action: 'Temporary magnet mode', keys: ['Ctrl/⌘', 'Move point'], support: 'unavailable', note: 'OHLC magnet snapping is not implemented.' },
  { id: 'partial-erase', category: 'Drawings', action: 'Partially erase drawing', keys: ['Eraser', 'Ctrl/⌘'], support: 'unavailable', note: 'The current drawing set has no eraser tool.' },
  { id: 'trend', category: 'Drawings', action: 'Trend line', keys: ['Alt/⌥', 'T'], support: 'supported' },
  { id: 'horizontal', category: 'Drawings', action: 'Horizontal line', keys: ['Alt/⌥', 'H'], support: 'supported' },
  { id: 'vertical', category: 'Drawings', action: 'Vertical line', keys: ['Alt/⌥', 'V'], support: 'supported' },
  { id: 'cross-line', category: 'Drawings', action: 'Cross line', keys: ['Alt/⌥', 'C'], support: 'unavailable', note: 'Cross-line drawing is not in the current tool registry.' },
  { id: 'fib', category: 'Drawings', action: 'Fib retracement', keys: ['Alt/⌥', 'F'], support: 'supported' },
  { id: 'rectangle', category: 'Drawings', action: 'Rectangle', keys: ['Alt/⌥', 'Shift', 'R'], support: 'supported' },
  { id: 'square', category: 'Drawings', action: 'Square constraint', keys: ['Rectangle', 'Shift'], support: 'unavailable', note: 'Rectangle currently uses free coordinates.' },
  { id: 'circle', category: 'Drawings', action: 'Circle constraint', keys: ['Ellipse', 'Shift'], support: 'unavailable', note: 'Ellipse is not in the current tool registry.' },

  { id: 'next-chart', category: 'Multi-chart', action: 'Next chart', keys: ['Tab'], support: 'supported' },
  { id: 'previous-chart', category: 'Multi-chart', action: 'Previous chart', keys: ['Shift', 'Tab'], support: 'supported' },
  { id: 'maximize', category: 'Multi-chart', action: 'Maximize/restore active chart', keys: ['Alt/⌥', 'Enter'], support: 'supported' },
  { id: 'maximize-click', category: 'Multi-chart', action: 'Maximize/restore chart', keys: ['Alt/⌥', 'Click'], support: 'supported' },
  { id: 'watchlist', category: 'Multi-chart', action: 'Add symbol to watchlist', keys: ['Alt/⌥', 'W'], support: 'unavailable', note: 'Market Replay has no watchlist.' },

  { id: 'buy-market', category: 'Trading', action: 'Buy market', keys: ['Ctrl/⌘', 'Shift', 'B'], support: 'supported' },
  { id: 'sell-market', category: 'Trading', action: 'Sell market', keys: ['Ctrl/⌘', 'Shift', 'S'], support: 'supported' },
  { id: 'buy-limit', category: 'Trading', action: 'Buy limit ticket at last price', keys: ['Shift', 'B'], support: 'adapted', note: 'Creates a draggable order ticket on the active chart.' },
  { id: 'sell-limit', category: 'Trading', action: 'Sell limit ticket at last price', keys: ['Shift', 'S'], support: 'adapted', note: 'Creates a draggable order ticket on the active chart.' },
  { id: 'dom-limit', category: 'Trading', action: 'Place limit order from DOM', keys: ['DOM cell click'], support: 'unavailable', note: 'Market Replay has no DOM panel.' },
  { id: 'dom-stop', category: 'Trading', action: 'Place stop order from DOM', keys: ['Ctrl/⌘', 'DOM click'], support: 'unavailable', note: 'Market Replay has no DOM panel.' },
  { id: 'center-dom', category: 'Trading', action: 'Center DOM', keys: ['Shift', 'Alt/⌥', 'C'], support: 'unavailable', note: 'Market Replay has no DOM panel.' },

  { id: 'replay-play', category: 'Market Replay', action: 'Play/pause replay', keys: ['Space'], support: 'supported' },
  { id: 'replay-back', category: 'Market Replay', action: 'Step replay back', keys: ['Shift', '←'], support: 'supported' },
  { id: 'replay-forward', category: 'Market Replay', action: 'Step replay forward', keys: ['Shift', '→'], support: 'supported' },
  { id: 'replay-day-back', category: 'Market Replay', action: 'Previous replay day', keys: ['Ctrl/⌘', 'Shift', '←'], support: 'supported' },
  { id: 'replay-day-forward', category: 'Market Replay', action: 'Next replay day', keys: ['Ctrl/⌘', 'Shift', '→'], support: 'supported' },
  { id: 'speed-down', category: 'Market Replay', action: 'Decrease replay speed', keys: ['['], support: 'supported' },
  { id: 'speed-up', category: 'Market Replay', action: 'Increase replay speed', keys: [']'], support: 'supported' },
  { id: 'flatten', category: 'Market Replay', action: 'Flatten position', keys: ['Shift', 'F'], support: 'supported' },
  { id: 'reverse', category: 'Market Replay', action: 'Reverse position', keys: ['Shift', 'R'], support: 'supported' },
  { id: 'drawing-scope', category: 'Market Replay', action: 'Toggle replay/analysis drawings', keys: ['Shift', 'A'], support: 'supported' },
] as const
