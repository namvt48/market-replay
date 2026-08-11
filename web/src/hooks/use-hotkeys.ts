import { useEffect, useState } from 'react'
import { paneIds } from '../chart-workspace/layout-presets'
import { persistChartLayout } from '../chart-workspace/layout-storage'
import { useChartWorkspace } from '../chart-workspace/use-chart-workspace'
import { replayEngine } from '../replay/replay-engine'
import { isEvalActive } from '../store/eval-store'
import { useUiStore } from '../store/ui-store'
import { resolveHotkey, type HotkeyCommand, type HotkeyDialogState } from './tradingview-shortcuts'

export interface HotkeyController {
  dialog: HotkeyDialogState | null
  layoutMenuRequest: number
  statusMessage: string
  closeDialog: () => void
  openShortcutHelp: () => void
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a, input, select, textarea, [contenteditable="true"], [role="dialog"], [role="menu"], [role="menuitem"]') !== null
}

function focusActiveChart(activePaneId: string): void {
  const chart = document.querySelector<HTMLElement>(`[data-chart-host="${CSS.escape(activePaneId)}"]`)
  if (!chart) return
  chart.tabIndex = 0
  chart.focus({ preventScroll: true })
}

export function useHotkeys(): HotkeyController {
  const { state, activate } = useChartWorkspace()
  const [dialog, setDialog] = useState<HotkeyDialogState | null>(null)
  const [layoutMenuRequest, setLayoutMenuRequest] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')

  useEffect(() => {
    const announce = (message: string): void => {
      setStatusMessage('')
      window.setTimeout(() => setStatusMessage(message), 0)
    }

    const execute = (command: HotkeyCommand, event: KeyboardEvent): void => {
      const replay = replayEngine.getSnapshot()
      const ids = paneIds(state.root)
      const activeIndex = Math.max(0, ids.indexOf(state.activePaneId))
      event.preventDefault()

      switch (command) {
        case 'open-symbol-search': setDialog({ type: 'symbol', query: '' }); return
        case 'open-interval-search': setDialog({ type: 'interval', query: '' }); return
        case 'open-layouts': setLayoutMenuRequest((request) => request + 1); return
        case 'save-layout': persistChartLayout(state); announce('Chart layout saved'); return
        case 'undo-drawing': replayEngine.undoDrawing(); return
        case 'redo-drawing': replayEngine.redoDrawing(); return
        case 'pan-left': replayEngine.moveChart('left'); return
        case 'pan-right': replayEngine.moveChart('right'); return
        case 'pan-left-far': replayEngine.moveChart('left', 20); return
        case 'pan-right-far': replayEngine.moveChart('right', 20); return
        case 'zoom-in': replayEngine.zoomChart(0.8); return
        case 'zoom-out': replayEngine.zoomChart(1.25); return
        case 'go-to-date': setDialog({ type: 'date' }); return
        case 'snapshot': replayEngine.takeChartSnapshot(); announce('Chart snapshot downloaded'); return
        case 'reset-chart': replayEngine.resetChartView(state.activePaneId); return
        case 'invert-scale': replayEngine.toggleInvertScale(); return
        case 'toggle-log-scale': replayEngine.togglePriceScaleMode('logarithmic'); return
        case 'toggle-percent-scale': replayEngine.togglePriceScaleMode('percentage'); return
        case 'focus-chart': focusActiveChart(state.activePaneId); return
        case 'next-chart': activate(ids[(activeIndex + 1) % ids.length]); return
        case 'previous-chart': activate(ids[(activeIndex - 1 + ids.length) % ids.length]); return
        case 'toggle-maximize': useUiStore.getState().toggleMaximizedPane(state.activePaneId); return
        case 'copy-drawing': replayEngine.copySelectedDrawing(); return
        case 'paste-drawing': replayEngine.pasteDrawing(); return
        case 'hide-drawings': replayEngine.toggleDrawingsVisibility(); return
        case 'draw-trend-line': replayEngine.setDrawingTool('trend-line'); return
        case 'draw-horizontal-line': replayEngine.setDrawingTool('horizontal-line'); return
        case 'draw-vertical-line': replayEngine.setDrawingTool('vertical-line'); return
        case 'draw-fib-retracement': replayEngine.setDrawingTool('fib-retracement'); return
        case 'draw-rectangle': replayEngine.setDrawingTool('rectangle'); return
        case 'delete-drawing': replayEngine.deleteSelectedDrawing(); return
        case 'cancel':
          if (replay.replayMode === 'selecting') replayEngine.cancelReplaySelection()
          else { replayEngine.setDrawingTool(null); replayEngine.deselectDrawing() }
          return
        case 'market-buy': replayEngine.placeMarket('buy'); return
        case 'market-sell': replayEngine.placeMarket('sell'); return
        case 'limit-buy': replayEngine.placePendingAtLast('buy', 'limit'); return
        case 'limit-sell': replayEngine.placePendingAtLast('sell', 'limit'); return
        case 'toggle-replay': replayEngine.togglePlay(); return
        case 'replay-step-back': if (!isEvalActive()) replayEngine.stepBack(); return
        case 'replay-step-forward': replayEngine.stepForward(); return
        case 'replay-day-back': if (!isEvalActive()) void replayEngine.seek(Math.max(0, replay.cursorTs - 86_400)); return
        case 'replay-day-forward': void replayEngine.seek(replay.cursorTs + 86_400); return
        case 'speed-down': replayEngine.cycleSpeed(-1); return
        case 'speed-up': replayEngine.cycleSpeed(1); return
        case 'flatten': replayEngine.flatten(); return
        case 'reverse': replayEngine.reverse(); return
        case 'toggle-drawing-scope': replayEngine.setDrawingMode(replay.drawingMode === 'analysis' ? 'replay' : 'analysis'); return
        case 'open-shortcut-help': setDialog({ type: 'shortcuts' }); return
      }
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || isEditable(event.target)) return
      if (document.querySelector('[aria-modal="true"]')) return
      const key = event.key.toLowerCase()
      const replay = replayEngine.getSnapshot()

      // Block the browser's native reload (Ctrl+R / Cmd+R) so replay state is
      // never lost to an accidental hard refresh while working in the app.
      if (key === 'r' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        return
      }

      if (replay.replayMode === 'selecting' && (key === 'arrowleft' || key === 'arrowright' || key === 'enter')) return
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (key === 'arrowup' || key === 'arrowdown')) {
        if (replayEngine.nudgeDrawing(key === 'arrowup' ? 'up' : 'down')) event.preventDefault()
        return
      }

      const command = resolveHotkey(event)
      if (command) {
        if ((command === 'next-chart' || command === 'previous-chart') && isInteractive(event.target)) return
        execute(command, event)
        return
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && /^\d$/.test(event.key)) {
        event.preventDefault()
        setDialog({ type: 'interval', query: event.key })
        return
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && /^[a-z]$/i.test(event.key)) {
        event.preventDefault()
        setDialog({ type: 'symbol', query: event.key })
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [activate, state])

  return {
    dialog,
    layoutMenuRequest,
    statusMessage,
    closeDialog: () => setDialog(null),
    openShortcutHelp: () => setDialog({ type: 'shortcuts' }),
  }
}
