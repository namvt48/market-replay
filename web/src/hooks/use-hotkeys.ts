import { useEffect } from 'react'
import { replayEngine } from '../replay/replay-engine'
import { isEvalActive } from '../store/eval-store'

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)
}

export function useHotkeys(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isEditable(event.target)) return
      const key = event.key.toLowerCase()
      const replay = replayEngine.getSnapshot()
      if (key === 'escape' && replay.replayMode === 'selecting') { event.preventDefault(); replayEngine.cancelReplaySelection(); return }
      if (replay.replayMode === 'selecting' && (key === ' ' || key === 'arrowleft' || key === 'arrowright')) return
      if (key === ' ') { event.preventDefault(); replayEngine.togglePlay(); return }
      if (key === 'arrowleft') { if (isEvalActive()) return; event.preventDefault(); replayEngine.stepBack(); return }
      if (key === 'arrowright') { event.preventDefault(); replayEngine.stepForward(); return }
      if (key === '[') { replayEngine.cycleSpeed(-1); return }
      if (key === ']') { replayEngine.cycleSpeed(1); return }
      if (key === 'b') { replayEngine.placeMarket('buy'); return }
      if (key === 's') { replayEngine.placeMarket('sell'); return }
      if (key === 'f') { replayEngine.flatten(); return }
      if (key === 'r') { replayEngine.reverse(); return }
      if (key === 'a') { replayEngine.setDrawingMode(replayEngine.getSnapshot().drawingMode === 'analysis' ? 'replay' : 'analysis'); return }
      if (/^[1-5]$/.test(key)) { replayEngine.setQty(Number(key)); return }
      if (key === 'escape') { replayEngine.setDrawingTool(null); replayEngine.deselectDrawing(); return }
      if (key === 'delete' || key === 'backspace') replayEngine.deleteSelectedDrawing()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
