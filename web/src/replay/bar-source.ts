import type { BarFrame } from '../api/binary-frame'
import type { Bar1m } from '../fill-engine/types'

export class BarSource {
  readonly frame: BarFrame

  constructor(frame: BarFrame) { this.frame = frame }

  get count(): number { return this.frame.count }
  get firstTs(): number { return this.frame.count > 0 ? this.frame.ts[0] : 0 }
  get lastTs(): number { return this.frame.count > 0 ? this.frame.ts[this.frame.count - 1] : 0 }

  at(index: number): Bar1m | null {
    if (index < 0 || index >= this.frame.count) return null
    return {
      ts: this.frame.ts[index], openTicks: this.frame.open[index], highTicks: this.frame.high[index],
      lowTicks: this.frame.low[index], closeTicks: this.frame.close[index], volume: this.frame.volume[index],
    }
  }

  findIndex(timestamp: number): number {
    let low = 0
    let high = this.frame.count
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (this.frame.ts[middle] <= timestamp) low = middle + 1
      else high = middle
    }
    return Math.max(0, low - 1)
  }

  findIndexAtOrAfter(timestamp: number): number {
    let low = 0
    let high = this.frame.count
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (this.frame.ts[middle] < timestamp) low = middle + 1
      else high = middle
    }
    return Math.min(Math.max(0, this.frame.count - 1), low)
  }
}
