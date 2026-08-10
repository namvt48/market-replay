import type { SerializedDrawing } from 'lightweight-charts-drawing'
import type { Time } from 'lightweight-charts'
import type { DisplayBar } from './chart-adapter'

function containingBarTime(timestamp: number, history: DisplayBar[]): number {
  if (history.length === 0 || timestamp < history[0].time) return timestamp
  let low = 0
  let high = history.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (history[middle].time <= timestamp) low = middle + 1
    else high = middle
  }
  return history[Math.max(0, low - 1)]?.time ?? timestamp
}

/** Projects canonical epoch/price anchors into the containing candle of the active timeframe. */
export function projectDrawingsToHistory(drawings: SerializedDrawing[], history: DisplayBar[]): SerializedDrawing[] {
  return drawings.map((drawing) => ({
    ...drawing,
    anchors: drawing.anchors.map((anchor) => ({
      ...anchor,
      time: (typeof anchor.time === 'number' ? containingBarTime(anchor.time, history) : anchor.time) as Time,
    })),
  }))
}
